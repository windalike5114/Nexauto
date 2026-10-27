import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "swift-zd53s-akebono-reference-20261025");
const POLICY = "SWIFT_ZD53S_AKEBONO_EXACT_CHASSIS_V1_2026_10_25";
const SOURCE_CODE = "AKEBONO_JP_SUZUKI_FITMENT_2026";
const SOURCE_URL = "https://www.akebono-brake.com/product_technology/aftermarket/docs/pf09_suzuki.pdf";
const APPLICATION_ID = "ap_cbbbabc16abfd4f3bd53";
const EXPECTED = { series: "ZD53S", body: "Hatchback", drive: "AWD", engine: "K12C", years: range(2017, 2026) };
const FITMENTS = [
  { position: "front", reference_value: "AN-754WK", normalized_value: "AN754WK" },
  { position: "rear", reference_value: "AN-773WK", normalized_value: "AN773WK" },
];
const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
if (APPLY && ROLLBACK_ARG) throw new Error("Choose --apply or --rollback=<backup-directory>.");

loadEnv(path.join(ROOT, ".env.local"));
assert(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK_ARG) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const initial = await prepare();
writeReport(initial, "report-only");
console.log(JSON.stringify(summary(initial, "report-only"), null, 2));
if (!APPLY) process.exit(0);
assert(initial.blockers.length === 0, `Preflight blockers: ${JSON.stringify(initial.blockers)}`);
const fresh = await prepare();
assert(fresh.blockers.length === 0, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(initial.plan_hash === fresh.plan_hash, "Fresh plan changed; no writes issued.");
const backup = createBackup(fresh);
try {
  await applyPlan(fresh);
  const verification = await verify(fresh);
  const result = { ...summary(fresh, "apply"), backup_directory: relative(backup), verification };
  writeJson(path.join(OUT, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}

async function prepare() {
  const [application, years, series, variant, powertrain, engineLinks, allEngineCodes, source, scheme, references,
    referenceFitments, productFitments] = await Promise.all([
    fetchOne("vehicle_catalog_applications", (query) => query.eq("application_id", APPLICATION_ID)),
    fetchMany("vehicle_catalog_application_years", (query) => query.eq("application_id", APPLICATION_ID)),
    fetchMany("vehicle_catalog_series", (query) => query.eq("code", EXPECTED.series)),
    fetchMany("vehicle_catalog_variants", (query) => query.eq("body_style", EXPECTED.body).eq("drive_type", EXPECTED.drive)),
    fetchMany("vehicle_catalog_powertrains", (query) => query.ilike("display_name", `%${EXPECTED.engine}%`)),
    fetchAll("vehicle_catalog_powertrain_engine_codes", "*"), fetchAll("vehicle_catalog_engine_codes", "*"),
    fetchMaybe("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE)),
    fetchMaybe("catalog_reference_schemes", (query) => query.eq("product_type", "brake_pad").eq("code", "akebono_an")),
    fetchMany("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "akebono_an")
      .in("normalized_value", FITMENTS.map((row) => row.normalized_value))),
    fetchMany("vehicle_catalog_part_reference_fitments", (query) => query.eq("application_id", APPLICATION_ID)),
    fetchMany("vehicle_catalog_product_fitments", (query) => query.eq("application_id", APPLICATION_ID)),
  ]);
  const blockers = [];
  const matchingSeries = series.find((row) => row.series_id === application.series_id);
  const matchingVariant = variant.find((row) => row.variant_id === application.variant_id);
  const matchingPowertrain = powertrain.find((row) => row.powertrain_id === application.powertrain_id);
  const engineCodeById = new Map(allEngineCodes.map((row) => [row.engine_code_id, row.code]));
  const engineCodes = engineLinks.filter((row) => row.powertrain_id === application.powertrain_id).map((row) => engineCodeById.get(row.engine_code_id));
  const actualYears = years.map((row) => Number(row.model_year)).sort((a, b) => a - b);
  if (!matchingSeries) blockers.push({ reason: "series_mismatch", expected: EXPECTED.series, actual_series_id: application.series_id });
  if (!matchingVariant) blockers.push({ reason: "variant_mismatch", expected: { body: EXPECTED.body, drive: EXPECTED.drive }, actual_variant_id: application.variant_id });
  if (!matchingPowertrain || !engineCodes.includes(EXPECTED.engine)) blockers.push({ reason: "engine_mismatch", expected: EXPECTED.engine,
    actual_powertrain_id: application.powertrain_id, engine_codes: engineCodes });
  if (JSON.stringify(actualYears) !== JSON.stringify(EXPECTED.years)) blockers.push({ reason: "year_mismatch", expected: EXPECTED.years, actual: actualYears });
  const refByValue = new Map(references.map((row) => [row.normalized_value, row]));
  const planned = FITMENTS.map((item) => ({ ...item, existing_reference: refByValue.get(item.normalized_value) ?? null,
    existing_fitments: referenceFitments.filter((row) => row.position === item.position) }));
  const publicPlan = planned.map((row) => ({ application_id: APPLICATION_ID, series: EXPECTED.series, years: EXPECTED.years,
    position: row.position, reference_scheme: "akebono_an", reference_value: row.reference_value,
    action: row.existing_reference ? "reuse_reference_and_publish_fitment" : "create_reference_and_publish_fitment", product_write: false }));
  const targetReferenceFitments = source ? referenceFitments.filter((row) => row.data_source_id === source.id) : [];
  return { generated_at: new Date().toISOString(), blockers, application, years, source, scheme, references, targetReferenceFitments,
    productFitments, planned, public_plan: publicPlan, product_hash: semanticHash(productFitments), plan_hash: stableHash(publicPlan) };
}

async function applyPlan(plan) {
  const sourcePayload = { code: SOURCE_CODE, name: "Akebono Japan Suzuki aftermarket fitment catalogue", source_kind: "product_catalogue",
    vehicle_identity_priority: 100, product_fitment_priority: 20, active: true,
    metadata: { product_line: "brake_pad", reference_scheme: "akebono_an", market: "JP", source_confidence: "authoritative",
      url: SOURCE_URL, retrieved_on: "2026-10-25" } };
  let response = await db.from("catalog_data_sources").upsert(sourcePayload, { onConflict: "code" }).select("*").single();
  if (response.error) throw response.error;
  const dataSource = response.data;
  response = await db.from("catalog_reference_schemes").upsert({ product_type: "brake_pad", code: "akebono_an",
    name: "Akebono AN brake pad reference", issuer: "Akebono Brake Industry", active: true,
    metadata: { value_pattern: "^AN-[0-9]+WK$", market: "JP" } }, { onConflict: "product_type,code" });
  if (response.error) throw response.error;
  for (const item of plan.planned) {
    response = await db.from("catalog_part_references").upsert({ product_type: "brake_pad", reference_scheme: "akebono_an",
      reference_value: item.reference_value, normalized_value: item.normalized_value, lifecycle_status: "active",
      metadata: { issuer: "Akebono Brake Industry", source_code: SOURCE_CODE } },
    { onConflict: "product_type,reference_scheme,normalized_value" }).select("*").single();
    if (response.error) throw response.error;
    const reference = response.data;
    response = await db.from("vehicle_catalog_part_reference_fitments").upsert({ application_id: APPLICATION_ID,
      part_reference_id: reference.id, position: item.position, data_source_id: dataSource.id, fitment_status: "published", confidence: "exact",
      source_row_numbers: [162], match_reasons: ["exact_chassis_code", "exact_akebono_catalog_row", "open_ended_2017_on_range"],
      metadata: { policy_version: POLICY, source_code: SOURCE_CODE, evidence_url: SOURCE_URL, source_vehicle_code: "ZD53S",
        selection_mode: "deterministic", product_write: false } },
    { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (response.error) throw response.error;
  }
}

async function verify(plan) {
  const source = await fetchOne("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE));
  const refs = await fetchMany("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "akebono_an")
    .in("normalized_value", FITMENTS.map((row) => row.normalized_value)));
  const refByValue = new Map(refs.map((row) => [row.normalized_value, row]));
  const fits = await fetchMany("vehicle_catalog_part_reference_fitments", (query) => query.eq("application_id", APPLICATION_ID).eq("data_source_id", source.id));
  const failures = FITMENTS.filter((item) => !fits.some((row) => row.part_reference_id === refByValue.get(item.normalized_value)?.id
    && row.position === item.position && row.fitment_status === "published" && row.metadata?.policy_version === POLICY));
  const products = await fetchMany("vehicle_catalog_product_fitments", (query) => query.eq("application_id", APPLICATION_ID));
  assert(!failures.length, `Reference readback failed: ${JSON.stringify(failures)}`);
  assert(semanticHash(products) === plan.product_hash, "Protected product layer changed.");
  return { ok: true, verified_at: new Date().toISOString(), application_id: APPLICATION_ID, application_years_2000_2026: 10,
    published_references: FITMENTS.map((row) => `${row.position}:${row.reference_value}`), product_layer_unchanged: true };
}

function createBackup(plan) {
  const directory = path.join(ROOT, "tmp", "production-backups", `swift-zd53s-akebono-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const key of ["source", "scheme", "references", "targetReferenceFitments", "productFitments"]) writeJson(path.join(directory, `${key}.json`), plan[key]);
  writeJson(path.join(directory, "manifest.json"), { policy: POLICY, application_id: APPLICATION_ID, created_at: new Date().toISOString(),
    rollback_command: `node scripts/catalog/publish-swift-zd53s-akebono-references-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("swift-zd53s-akebono-"), "Invalid rollback directory.");
  const sourceBefore = readJson(path.join(directory, "source.json"));
  const schemeBefore = readJson(path.join(directory, "scheme.json"));
  const referencesBefore = readJson(path.join(directory, "references.json"));
  const fitmentsBefore = readJson(path.join(directory, "targetReferenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const sourceNow = await fetchMaybe("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE));
  if (sourceNow) { let result = await db.from("vehicle_catalog_part_reference_fitments").delete().eq("application_id", APPLICATION_ID).eq("data_source_id", sourceNow.id); if (result.error) throw result.error; }
  const createdRefs = await fetchMany("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "akebono_an")
    .in("normalized_value", FITMENTS.map((row) => row.normalized_value)));
  if (fitmentsBefore.length) { const result = await db.from("vehicle_catalog_part_reference_fitments").insert(fitmentsBefore); if (result.error) throw result.error; }
  for (const ref of createdRefs.filter((row) => !referencesBefore.some((before) => before.id === row.id))) {
    const fitCount = await countRows("vehicle_catalog_part_reference_fitments", (query) => query.eq("part_reference_id", ref.id));
    const productCount = await countRows("catalog_part_reference_products", (query) => query.eq("part_reference_id", ref.id));
    if (!fitCount && !productCount) { const result = await db.from("catalog_part_references").delete().eq("id", ref.id); if (result.error) throw result.error; }
  }
  if (referencesBefore.length) { const result = await db.from("catalog_part_references").upsert(referencesBefore,
    { onConflict: "product_type,reference_scheme,normalized_value" }); if (result.error) throw result.error; }
  if (schemeBefore) { const result = await db.from("catalog_reference_schemes").upsert(schemeBefore, { onConflict: "product_type,code" }); if (result.error) throw result.error; }
  else if (!(await countRows("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "akebono_an")))) {
    const result = await db.from("catalog_reference_schemes").delete().eq("product_type", "brake_pad").eq("code", "akebono_an"); if (result.error) throw result.error;
  }
  if (sourceBefore) { const result = await db.from("catalog_data_sources").upsert(sourceBefore, { onConflict: "code" }); if (result.error) throw result.error; }
  else if (sourceNow && !(await countRows("vehicle_catalog_part_reference_fitments", (query) => query.eq("data_source_id", sourceNow.id)))) {
    const result = await db.from("catalog_data_sources").delete().eq("id", sourceNow.id); if (result.error) throw result.error;
  }
  const productsNow = await fetchMany("vehicle_catalog_product_fitments", (query) => query.eq("application_id", APPLICATION_ID));
  assert(semanticHash(productsNow) === semanticHash(productsBefore), "Rollback changed product layer.");
  const output = { verified: true, automatic, rolled_back_at: new Date().toISOString(), product_layer_unchanged: true };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), output);
  return output;
}

function summary(plan, mode) { return { generated_at: plan.generated_at, mode, policy: POLICY, production_writes: mode === "apply",
  application_id: APPLICATION_ID, application_years_2000_2026: 10, references: FITMENTS.map((row) => `${row.position}:${row.reference_value}`),
  source_url: SOURCE_URL, new_product_writes: 0, blockers: plan.blockers, plan_sha256: plan.plan_hash }; }
function writeReport(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight.json"), summary(plan, mode)); writeJson(path.join(OUT, "plan.json"), plan.public_plan); }
function range(from, to) { return Array.from({ length: to - from + 1 }, (_, index) => from + index); }
function assert(value, message) { if (!value) throw new Error(message); }
function relative(value) { return path.relative(ROOT, value).replaceAll("\\", "/"); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(rows) { return stableHash(rows.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function fetchMany(table, filter) { const { data, error } = await filter(db.from(table).select("*")); if (error) throw error; return data ?? []; }
async function fetchOne(table, filter) { const { data, error } = await filter(db.from(table).select("*")).single(); if (error) throw error; return data; }
async function fetchMaybe(table, filter) { const { data, error } = await filter(db.from(table).select("*")).maybeSingle(); if (error) throw error; return data ?? null; }
async function countRows(table, filter) { const { count, error } = await filter(db.from(table).select("*", { count: "exact", head: true })); if (error) throw error; return count ?? 0; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
