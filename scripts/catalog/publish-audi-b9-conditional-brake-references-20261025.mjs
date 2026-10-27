import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "brake-audi-b9-conditional-20261025");
const BACKUP_ROOT = path.join(ROOT, "tmp", "production-backups");
const POLICY = "AUDI_B9_CONDITIONAL_BRAKE_OPTIONS_V1_2026_10_25";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
const unknown = process.argv.slice(2).filter((value) => value !== "--apply" && !value.startsWith("--rollback="));
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
if (APPLY && ROLLBACK_ARG) throw new Error("Choose --apply or --rollback=<backup-directory>.");

const OPTIONS = {
  front: ["DB2504", "DB2508", "DB2509"],
  rear: ["DB2510"],
};
const EVIDENCE_URLS = [
  "https://www.bendix.com.au/products/db2504-euro",
  "https://www.bendix.com.au/products/db2509-euro",
  "https://assets.bendix.com.au/pdfs/Bendix-New-Releases-August-2022-PRJ-08180.pdf",
  "https://www.bendix.com.au/news-events/new-bendix-website-delivers-fast-search-and-more-streamlined-experience",
];

loadEnv(path.join(ROOT, ".env.local"));
assert(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (ROLLBACK_ARG) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const production = await loadProduction();
const prepared = prepare(production);
writeOutputs(prepared, "report-only");
console.log(JSON.stringify(summarize(prepared, "report-only"), null, 2));
if (!APPLY) process.exit(0);

assert(prepared.blockers.length === 0, `Preflight blockers: ${JSON.stringify(prepared.blockers)}`);
const fresh = prepare(await loadProduction());
assert(fresh.blockers.length === 0, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(fresh.plan_hash === prepared.plan_hash, "Production state changed after preflight; no writes issued.");
const backup = createBackup(fresh);
try {
  await applyPlan(fresh);
  const verification = await verify(fresh);
  const result = { ...summarize(fresh, "apply"), backup_directory: relative(backup), verification };
  writeJson(path.join(OUTPUT_DIR, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  writeJson(path.join(backup, "automatic-rollback-result.json"), restored);
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}

function prepare(data) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const referenceById = new Map(data.references.map((row) => [row.id, row]));
  const referenceByValue = new Map(data.references
    .filter((row) => row.product_type === "brake_pad" && row.reference_scheme === "bendix_db")
    .map((row) => [row.normalized_value, row]));
  const fitmentsByApplication = groupBy(data.referenceFitments, (row) => row.application_id);
  const productFitmentsByApplication = groupBy(data.productFitments, (row) => row.application_id);
  const productTypeByVariant = productVariantTypeMap(data.products, data.productVariants);
  const blockers = [];
  if (!data.dataSource?.active) blockers.push({ reason: "missing_or_inactive_data_source", source_code: SOURCE_CODE });
  for (const values of Object.values(OPTIONS)) {
    for (const value of values) if (!referenceByValue.has(value)) blockers.push({ reason: "missing_reference", db_reference: value });
  }

  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(application.series_id);
    const seriesCode = String(series?.code ?? series?.display_name ?? "").toUpperCase();
    if (String(make?.name ?? "").toUpperCase() !== "AUDI") continue;
    if (!/^(A4|S4)(\b|\s|\/)/i.test(String(model?.name ?? ""))) continue;
    if (!/^8W(?:2|5|C|D|H|J)$/.test(seriesCode.replace(/[^A-Z0-9]/g, ""))) continue;
    const years = (yearsByApplication.get(application.application_id) ?? [])
      .map((row) => Number(row.model_year)).filter((year) => year >= 2015 && year <= 2026).sort((a, b) => a - b);
    if (!years.length) continue;
    const hasPublishedReference = (fitmentsByApplication.get(application.application_id) ?? []).some((fitment) =>
      fitment.fitment_status === "published" && referenceById.get(fitment.part_reference_id)?.product_type === "brake_pad");
    const hasPublishedProduct = (productFitmentsByApplication.get(application.application_id) ?? []).some((fitment) =>
      fitment.fitment_status === "published" && productTypeByVariant.get(fitment.product_variant_id) === "brake_pad");
    if (hasPublishedReference || hasPublishedProduct) continue;
    applications.push({ application_id: application.application_id, make: make.name, model: model.name,
      series: seriesCode, years });
  }

  const rows = [];
  for (const application of applications) {
    for (const [position, optionSet] of Object.entries(OPTIONS)) {
      for (const value of optionSet) {
        const reference = referenceByValue.get(value);
        if (!reference) continue;
        const previous = (fitmentsByApplication.get(application.application_id) ?? []).find((fitment) =>
          fitment.part_reference_id === reference.id && fitment.position === position
          && fitment.data_source_id === data.dataSource.id) ?? null;
        rows.push({ ...application, position, db_reference: value, part_reference_id: reference.id,
          data_source_id: data.dataSource.id, option_set: optionSet, previous_row: previous });
      }
    }
  }
  const publicPlan = rows.map(({ previous_row, ...row }) => ({ ...row, previous_status: previous_row?.fitment_status ?? null,
    selection_mode: "conditional_one_of", evidence_urls: EVIDENCE_URLS }));
  const applicationIds = unique(applications.map((row) => row.application_id));
  const protectedProducts = data.productFitments.filter((row) => applicationIds.includes(row.application_id));
  return { generated_at: new Date().toISOString(), applications, rows, blockers, public_plan: publicPlan,
    plan_hash: stableHash({ publicPlan, productHash: semanticHash(protectedProducts) }),
    product_hash: semanticHash(protectedProducts), snapshot: {
      referenceFitments: data.referenceFitments.filter((row) => applicationIds.includes(row.application_id)),
      productFitments: protectedProducts,
    } };
}

async function applyPlan(plan) {
  for (const row of plan.rows) {
    const payload = {
      application_id: row.application_id,
      part_reference_id: row.part_reference_id,
      position: row.position,
      data_source_id: row.data_source_id,
      fitment_status: "published",
      confidence: "high",
      source_row_numbers: [],
      match_reasons: ["official_bendix_a4_b9_8w_catalog", "multiple_factory_brake_options", "user_approved_multi_reference_mode"],
      metadata: {
        ...(row.previous_row?.metadata ?? {}),
        policy_version: POLICY,
        source_code: SOURCE_CODE,
        selection_mode: "conditional_one_of",
        option_set: row.option_set,
        configuration_confirmation_required: true,
        discriminator_hint: "Confirm Audi/VW PR code, caliper, disc size or OE brake package before product selection",
        evidence_urls: EVIDENCE_URLS,
        exact_knowledge_coverage: false,
        conditional_search_coverage: true,
        product_write: false,
      },
    };
    const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(payload, {
      onConflict: "application_id,part_reference_id,position,data_source_id",
    });
    if (error) throw error;
  }
}

async function verify(plan) {
  const ids = unique(plan.applications.map((row) => row.application_id));
  const [fitments, products] = await Promise.all([
    selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "*", "application_id", ids),
  ]);
  const failures = [];
  for (const expected of plan.rows) {
    const actual = fitments.find((row) => row.application_id === expected.application_id
      && row.part_reference_id === expected.part_reference_id && row.position === expected.position
      && row.data_source_id === expected.data_source_id);
    if (!actual || actual.fitment_status !== "published" || actual.metadata?.policy_version !== POLICY
      || actual.metadata?.selection_mode !== "conditional_one_of") {
      failures.push({ application_id: expected.application_id, position: expected.position,
        db_reference: expected.db_reference, reason: "readback_failed" });
    }
  }
  if (semanticHash(products) !== plan.product_hash) failures.push({ reason: "protected_product_layer_changed" });
  assert(!failures.length, `Verification failures: ${JSON.stringify(failures)}`);
  return { ok: true, verified_at: new Date().toISOString(), applications: ids.length,
    relationships: plan.rows.length, product_layer_unchanged: true };
}

function createBackup(plan) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(BACKUP_ROOT, `audi-b9-conditional-brakes-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "referenceFitments.json"), plan.snapshot.referenceFitments);
  writeJson(path.join(directory, "productFitments.json"), plan.snapshot.productFitments);
  writeJson(path.join(directory, "plan.json"), plan.public_plan);
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/publish-audi-b9-conditional-brake-references-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  assert(directory.startsWith(`${BACKUP_ROOT}${path.sep}`) && path.basename(directory).startsWith("audi-b9-conditional-brakes-"),
    "Invalid rollback directory.");
  const before = readJson(path.join(directory, "referenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const plan = readJson(path.join(directory, "plan.json"));
  const ids = unique(plan.map((row) => row.application_id));
  let response = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids);
  if (response.error) throw response.error;
  if (before.length) {
    response = await db.from("vehicle_catalog_part_reference_fitments").insert(before);
    if (response.error) throw response.error;
  }
  const [after, productsAfter] = await Promise.all([
    selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "*", "application_id", ids),
  ]);
  const checks = { reference_fitments_restored: semanticHash(after) === semanticHash(before),
    product_layer_unchanged: semanticHash(productsAfter) === semanticHash(productsBefore) };
  assert(Object.values(checks).every(Boolean), `Rollback verification failed: ${JSON.stringify(checks)}`);
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), checks };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

async function loadProduction() {
  const [applications, years, makes, models, series, products, productVariants, productFitments,
    referenceFitments, references, dataSource] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "application_id,model_id,series_id,status"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("vehicle_catalog_makes", "make_id,name"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name"),
    fetchAll("vehicle_catalog_series", "series_id,code,display_name"),
    fetchAll("products", "id,category_slug"),
    fetchAll("product_variants", "id,product_id,sku"),
    fetchAll("vehicle_catalog_product_fitments", "*"),
    fetchAll("vehicle_catalog_part_reference_fitments", "*"),
    fetchAll("catalog_part_references", "*"),
    fetchSingle("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)),
  ]);
  return { applications, years, makes, models, series, products, productVariants, productFitments,
    referenceFitments, references, dataSource };
}

function productVariantTypeMap(products, variants) {
  const categoryByProduct = new Map(products.map((row) => [row.id, row.category_slug]));
  return new Map(variants.map((row) => [row.id, categoryByProduct.get(row.product_id) === "brake-pads" || /^NBP/i.test(row.sku)
    ? "brake_pad" : categoryByProduct.get(row.product_id)]));
}
function summarize(plan, mode) {
  return { generated_at: plan.generated_at, mode, policy: POLICY, production_writes: mode === "apply",
    applications: plan.applications.length, application_years_2015_2026: sum(plan.applications.map((row) => row.years.length)),
    conditional_reference_relationships: plan.rows.length, front_options: OPTIONS.front, rear_options: OPTIONS.rear,
    exact_knowledge_coverage: 0, conditional_search_applications: plan.applications.length,
    product_writes: 0, blockers: plan.blockers, plan_sha256: plan.plan_hash };
}
function writeOutputs(plan, mode) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson(path.join(OUTPUT_DIR, "preflight-summary.json"), summarize(plan, mode));
  writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), plan.public_plan);
  writeJson(path.join(OUTPUT_DIR, "blockers.json"), plan.blockers);
}
async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
async function fetchSingle(table, columns, build) {
  const { data, error } = await build(db.from(table).select(columns)).maybeSingle();
  if (error) throw error;
  return data;
}
async function selectIn(table, columns, field, values) {
  if (!values.length) return [];
  const rows = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await db.from(table).select(columns).in(field, values.slice(index, index + 100));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
function groupBy(rows, keyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}
function semanticHash(rows) { return stableHash([...rows].map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex"); }
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, normalize(item)]));
  return value;
}
function unique(values) { return [...new Set(values)]; }
function sum(values) { return values.reduce((total, value) => total + Number(value || 0), 0); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function relative(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
