import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.find((value) => value.startsWith("--rollback="));
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "recent-brake-reference-productization-20261025");
const POLICY = "BRAKE_VERIFIED_REFERENCE_TO_EXISTING_NBP_V1_2026_10_25";
const SOURCE = "MATERIALIZED_FROM_VERIFIED_BENDIX_REFERENCE_2026_10_25";
const PAIRS = [
  { db: "DB1841", sku: "NBP1208", position: "front", input: path.join(ROOT, "outputs", "colorado-lwh-brake-reference-20261025", "safe.jsonl") },
  { db: "DB2245", sku: "NBP1267", position: "rear", input: path.join(ROOT, "outputs", "brake-priority-exact-config-publish-20261025", "safe.jsonl") },
];
loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK.slice("--rollback=".length))), null, 2));
  process.exit(0);
}
const pairInputs = PAIRS.map((pair) => ({ ...pair, rows: readJsonl(pair.input).filter((row) => row.db_reference === pair.db && row.position === pair.position) }));
const initial = await prepare();
writeOutputs(initial, "report-only");
console.log(JSON.stringify(summary(initial, "report-only"), null, 2));
if (!APPLY) process.exit(0);
assert(initial.blockers.length === 0, `Preflight blockers: ${JSON.stringify(initial.blockers)}`);
const fresh = await prepare();
assert(fresh.blockers.length === 0, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(fresh.plan_hash === initial.plan_hash, "Fresh plan changed; no writes issued");
const backup = createBackup(fresh);
try {
  const writes = fresh.plan.filter((row) => row.operation !== "noop").map((row) => ({
    application_id: row.application_id, product_variant_id: row.product_variant_id, position: row.position,
    fitment_status: "published", source: SOURCE,
    notes: `policy=${POLICY}; db_reference=${row.db}; part_reference_id=${row.part_reference_id}; reference_product_link=verified_exact_cross_reference`,
  }));
  if (writes.length) {
    const { error } = await db.from("vehicle_catalog_product_fitments").upsert(writes, { onConflict: "application_id,product_variant_id,position" });
    if (error) throw error;
  }
  const verification = await verify(fresh);
  const result = { ...summary(fresh, "apply"), backup_directory: path.relative(ROOT, backup).replaceAll("\\", "/"), verification };
  writeJson(path.join(OUT, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true);
  throw new Error(`Apply failed and rollback verified=${restored.verified}: ${error.message}`);
}

async function prepare() {
  const applicationIds = unique(pairInputs.flatMap((pair) => pair.rows.map((row) => row.application_id)));
  const dbValues = PAIRS.map((row) => row.db);
  const skus = PAIRS.map((row) => row.sku);
  const [applications, years, referenceFitments, productFitments, references, productVariants] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", applicationIds), selectIn("vehicle_catalog_application_years", "application_id", applicationIds),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", applicationIds), selectIn("vehicle_catalog_product_fitments", "application_id", applicationIds),
    selectIn("catalog_part_references", "normalized_value", dbValues), selectIn("product_variants", "sku", skus),
  ]);
  const products = await selectIn("products", "id", unique(productVariants.map((row) => row.product_id)));
  const identifiers = await selectIn("product_identifiers", "normalized_value", dbValues);
  const referenceProductLinks = await selectIn("catalog_part_reference_products", "part_reference_id", references.map((row) => row.id));
  const referencedVariantIds = unique(productFitments.map((row) => row.product_variant_id));
  const existingVariants = await selectIn("product_variants", "id", referencedVariantIds);
  const existingProducts = await selectIn("products", "id", unique(existingVariants.map((row) => row.product_id)));
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const referenceByValue = new Map(references.map((row) => [row.normalized_value, row]));
  const variantBySku = new Map(productVariants.map((row) => [row.sku, row]));
  const productById = new Map(products.map((row) => [row.id, row]));
  const existingVariantById = new Map(existingVariants.map((row) => [row.id, row]));
  const existingProductById = new Map(existingProducts.map((row) => [row.id, row]));
  const plan = [];
  const blockers = [];
  for (const pair of pairInputs) {
    const reference = referenceByValue.get(pair.db);
    const variant = variantBySku.get(pair.sku);
    const product = productById.get(variant?.product_id);
    const dbIdentifiers = identifiers.filter((row) => row.identifier_type === "cross_reference" && row.normalized_value === pair.db);
    const targetIdentifiers = dbIdentifiers.filter((row) => row.product_variant_id === variant?.id && row.verification_status !== "rejected");
    const links = referenceProductLinks.filter((row) => row.part_reference_id === reference?.id && row.product_variant_id === variant?.id
      && row.relation_type === "exact_cross_reference" && row.verification_status === "verified");
    if (!reference || reference.product_type !== "brake_pad" || !["active", "to_be_discontinued"].includes(reference.lifecycle_status)) blockers.push({ db: pair.db, reason: "reference_invalid" });
    if (!variant || variant.active !== true || normalizePosition(variant.attributes?.position) !== pair.position) blockers.push({ sku: pair.sku, reason: "variant_invalid_or_position_mismatch" });
    if (!product || product.category_slug !== "brake-pad" || product.active !== true || product.commerce_status !== "active" || product.checkout_enabled !== true) blockers.push({ sku: pair.sku, reason: "product_not_sellable" });
    if (targetIdentifiers.length !== 1 || dbIdentifiers.some((row) => row.product_variant_id !== variant?.id && row.verification_status !== "rejected")) blockers.push({ db: pair.db, sku: pair.sku, reason: "cross_reference_not_unique" });
    if (links.length !== 1) blockers.push({ db: pair.db, sku: pair.sku, reason: "verified_reference_product_link_missing" });
    for (const input of pair.rows) {
      const application = appById.get(input.application_id);
      const liveYears = (yearsByApp.get(input.application_id) ?? []).map((row) => Number(row.model_year)).filter((year) => year >= 2000 && year <= 2026).sort((a, b) => a - b);
      if (!application || application.status !== "active" || JSON.stringify(liveYears) !== JSON.stringify(input.years.filter((year) => year >= 2000 && year <= 2026))) {
        blockers.push({ application_id: input.application_id, reason: "application_or_years_changed" }); continue;
      }
      const exactReference = referenceFitments.filter((row) => row.application_id === input.application_id && row.part_reference_id === reference?.id
        && row.position === pair.position && row.fitment_status === "published");
      if (!exactReference.length) { blockers.push({ application_id: input.application_id, reason: "published_reference_missing" }); continue; }
      const publishedBrakeProducts = productFitments.filter((row) => row.application_id === input.application_id && row.fitment_status === "published").filter((row) => {
        const existingVariant = existingVariantById.get(row.product_variant_id);
        return existingProductById.get(existingVariant?.product_id)?.category_slug === "brake-pad";
      });
      const conflicting = publishedBrakeProducts.filter((row) => row.position === pair.position && row.product_variant_id !== variant.id);
      if (conflicting.length) { blockers.push({ application_id: input.application_id, reason: "published_nbp_conflict", conflicting }); continue; }
      const current = productFitments.find((row) => row.application_id === input.application_id && row.product_variant_id === variant.id && row.position === pair.position);
      plan.push({ application_id: input.application_id, years: liveYears, db: pair.db, sku: pair.sku, position: pair.position,
        part_reference_id: reference.id, product_variant_id: variant.id, operation: current?.fitment_status === "published" ? "noop" : current ? "update" : "insert", previous_row: current ?? null });
    }
  }
  return { generated_at: new Date().toISOString(), plan, blockers, snapshot: { productFitments }, plan_hash: stableHash(plan.map(publicPlan)) };
}

async function verify(prepared) {
  const ids = unique(prepared.plan.map((row) => row.application_id));
  const current = await selectIn("vehicle_catalog_product_fitments", "application_id", ids);
  const failures = prepared.plan.filter((row) => !current.some((item) => item.application_id === row.application_id && item.product_variant_id === row.product_variant_id
    && item.position === row.position && item.fitment_status === "published"));
  assert(failures.length === 0, `Product fitment readback failed for ${failures.length} rows`);
  return { ok: true, verified_at: new Date().toISOString(), relationships: prepared.plan.length,
    applications: ids.length, application_years: prepared.plan.reduce((sum, row) => sum + row.years.length, 0) };
}

function createBackup(prepared) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `recent-brake-productization-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "productFitments.json"), prepared.snapshot.productFitments);
  writeJson(path.join(directory, "plan.json"), prepared.plan.map(publicPlan));
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/materialize-recent-brake-reference-products-20261025.mjs --rollback=${path.relative(ROOT, directory).replaceAll("\\", "/")}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("recent-brake-productization-"), "Invalid rollback directory");
  const before = readJson(path.join(directory, "productFitments.json"));
  const ids = unique(readJson(path.join(directory, "plan.json")).map((row) => row.application_id));
  let response = await db.from("vehicle_catalog_product_fitments").delete().in("application_id", ids); if (response.error) throw response.error;
  if (before.length) { response = await db.from("vehicle_catalog_product_fitments").insert(before); if (response.error) throw response.error; }
  const after = await selectIn("vehicle_catalog_product_fitments", "application_id", ids);
  assert(semanticHash(after) === semanticHash(before), "Rollback verification failed");
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), rows: before.length };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function summary(prepared, mode) { const writes = prepared.plan.filter((row) => row.operation !== "noop"); return {
  generated_at: prepared.generated_at, mode, production_writes: mode === "apply" ? writes.length : 0, policy: POLICY,
  relationships: prepared.plan.length, writes: writes.length, applications: new Set(prepared.plan.map((row) => row.application_id)).size,
  application_years: prepared.plan.reduce((sum, row) => sum + row.years.length, 0), by_pair: PAIRS.map((pair) => ({ db: pair.db, sku: pair.sku,
    position: pair.position, applications: prepared.plan.filter((row) => row.db === pair.db).length,
    application_years: prepared.plan.filter((row) => row.db === pair.db).reduce((sum, row) => sum + row.years.length, 0) })),
  blockers: prepared.blockers, new_skus: 0, plan_sha256: prepared.plan_hash }; }
function writeOutputs(prepared, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight-summary.json"), summary(prepared, mode)); writeJsonl(path.join(OUT, "plan.jsonl"), prepared.plan.map(publicPlan)); }
function publicPlan(row) { return { application_id: row.application_id, years: row.years, db: row.db, sku: row.sku, position: row.position, operation: row.operation, product_write: row.operation !== "noop" }; }
function normalizePosition(value) { const text = String(value ?? "").toLowerCase(); if (text.includes("front")) return "front"; if (text.includes("rear")) return "rear"; return text; }
function assert(value, message) { if (!value) throw new Error(message); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupBy(values, keyFn) { const map = new Map(); for (const value of values) { const key = keyFn(value); const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); } return map; }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(value) { return stableHash(value.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, values) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, values.map(JSON.stringify).join("\n") + (values.length ? "\n" : "")); }
async function selectIn(table, field, values) { const output = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").in(field, batch).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return output; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
