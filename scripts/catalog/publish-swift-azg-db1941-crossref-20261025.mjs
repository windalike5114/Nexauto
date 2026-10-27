import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "swift-azg-db1941-crossref-20261025");
const POLICY = "SWIFT_AZG_OEM_DB1941_CHAIN_V1_2026_10_25";
const SOURCE_CODE = "SWIFT_AZG_OEM_DB1941_CROSSREF_2026";
const DB_REFERENCE = "DB1941";
const YEARS = range(2010, 2017);
const EVIDENCE_URLS = [
  "https://partsouq.com/en/catalog/genuine/parts?c=Suzuki&gid=15&q=TSMNZC72S00202241&vid=9",
  "https://partsouq.com/en/catalog/genuine/parts?c=Suzuki&gid=544&q=TSMNZC02S00223017&vid=9",
  "https://safelinebrakes.co.za/wp-content/uploads/pdftemp/Part_D3702_842625dc46b85b5a25f333e5ce7f3f42.pdf",
  "https://www.ms-motorservice.com/MediaAssets/air-supply-luftversorgung-alimentation-en-air-alimentacion-de-aire-alimentazione-dellaria-snabzenie-vozduhom_1272659.pdf",
  "https://www.frenos-ate.es/media/3842/catalogue-ate-disc-brakes-scheibenbremsen-2020.pdf",
];
const TARGETS = [
  target("ap_48c2a278111d048cd2eb", "AZH412", "AWD", ["K12B"]),
  target("ap_36fd30c8d26bcf79fb11", "AZH412", "FWD", ["K12B"]),
  target("ap_2a10a4e619c642e55f73", "AZG412", "AWD", ["K12B"]),
  target("ap_5bcb2af0ebea039abbec", "AZG412", "FWD", ["K12B"]),
  target("ap_6efb0e944dec8c05521a", "AZG413D", "FWD", ["D13A", "D13AA"]),
  target("ap_27e5e90ac8b7ed02b241", "ZC02S", "FWD", ["D13A", "D13AA"]),
  target("ap_b66ed5ee9cad116add02", "ZC92S", "FWD", ["D13A", "D13AA"]),
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
writeOutputs(initial, "report-only");
console.log(JSON.stringify(summary(initial, "report-only"), null, 2));
if (!APPLY) process.exit(0);
assert(!initial.blockers.length, `Preflight blockers: ${JSON.stringify(initial.blockers)}`);
const fresh = await prepare();
assert(!fresh.blockers.length, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
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
  const ids = TARGETS.map((row) => row.application_id);
  const [applications, years, series, variants, engineLinks, engineCodes, reference, source, refFitments, products] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    fetchAll("vehicle_catalog_series", "series_id,code"), fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type"),
    fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id"), fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
    fetchOne("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "bendix_db").eq("normalized_value", DB_REFERENCE)),
    fetchMaybe("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE)),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids),
  ]);
  const blockers = [];
  if (applications.length !== TARGETS.length) blockers.push({ reason: "missing_target_applications", expected: TARGETS.length, actual: applications.length });
  if (reference.lifecycle_status !== "active") blockers.push({ reason: "db1941_not_active", lifecycle_status: reference.lifecycle_status });
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const seriesById = new Map(series.map((row) => [row.series_id, row.code]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));
  const codeById = new Map(engineCodes.map((row) => [row.engine_code_id, row.code]));
  const linksByPowertrain = groupBy(engineLinks, (row) => row.powertrain_id);
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const plan = [];
  for (const spec of TARGETS) {
    const application = appById.get(spec.application_id);
    if (!application) continue;
    const actualSeries = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id) ?? {};
    const actualCodes = unique((linksByPowertrain.get(application.powertrain_id) ?? []).map((row) => codeById.get(row.engine_code_id)));
    const actualYears = (yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    if (actualSeries !== spec.series) blockers.push({ application_id: spec.application_id, reason: "series_mismatch", expected: spec.series, actual: actualSeries });
    if (variant.body_style !== "Hatchback" || variant.drive_type !== spec.drive) blockers.push({ application_id: spec.application_id,
      reason: "variant_mismatch", expected: { body: "Hatchback", drive: spec.drive }, actual: { body: variant.body_style, drive: variant.drive_type } });
    if (!spec.engine_codes.every((code) => actualCodes.includes(code))) blockers.push({ application_id: spec.application_id,
      reason: "engine_mismatch", expected: spec.engine_codes, actual: actualCodes });
    if (!arrayEqual(actualYears, YEARS)) blockers.push({ application_id: spec.application_id, reason: "year_mismatch", expected: YEARS, actual: actualYears });
    const publishedOther = refFitments.filter((row) => row.application_id === spec.application_id && row.position === "front"
      && row.fitment_status === "published" && row.part_reference_id !== reference.id);
    if (publishedOther.length) blockers.push({ application_id: spec.application_id, reason: "published_front_reference_conflict",
      part_reference_ids: publishedOther.map((row) => row.part_reference_id) });
    plan.push({ ...spec, years: actualYears, previous_source_row: source ? refFitments.find((row) => row.application_id === spec.application_id
      && row.position === "front" && row.part_reference_id === reference.id && row.data_source_id === source.id) ?? null : null });
  }
  const publicPlan = plan.map((row) => ({ ...row, db_reference: DB_REFERENCE, position: "front",
    action: row.previous_source_row ? "refresh_published_crossref" : "publish_crossref", evidence_urls: EVIDENCE_URLS, product_write: false }));
  return { generated_at: new Date().toISOString(), blockers, plan, public_plan: publicPlan, source, reference, refFitments, products,
    product_hash: semanticHash(products), plan_hash: stableHash(publicPlan) };
}

async function applyPlan(plan) {
  let response = await db.from("catalog_data_sources").upsert({ code: SOURCE_CODE,
    name: "Suzuki Swift AZG OE to Bendix DB1941 cross-reference chain", source_kind: "market_reference",
    vehicle_identity_priority: 80, product_fitment_priority: 30, active: true,
    metadata: { product_line: "brake_pad", reference_scheme: "bendix_db", evidence_type: "vehicle_identity_plus_oe_cross_reference",
      source_confidence: "high", oem_numbers: ["55810-68L00", "55810-68L50"], bendix_reference: DB_REFERENCE,
      evidence_urls: EVIDENCE_URLS, retrieved_on: "2026-10-25" } }, { onConflict: "code" }).select("*").single();
  if (response.error) throw response.error;
  const source = response.data;
  for (const item of plan.plan) {
    response = await db.from("vehicle_catalog_part_reference_fitments").upsert({ application_id: item.application_id,
      part_reference_id: plan.reference.id, position: "front", data_source_id: source.id, fitment_status: "published", confidence: "high",
      source_row_numbers: [1, 2, 3], match_reasons: ["same_swift_azg_brake_family", "exact_engine_generation",
        "oem_pad_number_to_bendix_cross_reference", "documented_vehicle_code_alias"],
      metadata: { policy_version: POLICY, source_code: SOURCE_CODE, reference_chain: ["vehicle identity", "Suzuki OE 55810-68L00/68L50", "Bendix DB1941"],
        evidence_urls: EVIDENCE_URLS, selection_mode: "deterministic", product_write: false } },
    { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (response.error) throw response.error;
  }
}

async function verify(plan) {
  const source = await fetchOne("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE));
  const ids = plan.plan.map((row) => row.application_id);
  const [refs, products] = await Promise.all([selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids)]);
  const failures = ids.filter((id) => !refs.some((row) => row.application_id === id && row.part_reference_id === plan.reference.id
    && row.position === "front" && row.data_source_id === source.id && row.fitment_status === "published"
    && row.metadata?.policy_version === POLICY));
  assert(!failures.length, `Readback failed: ${failures.join(",")}`);
  assert(semanticHash(products) === plan.product_hash, "Protected product layer changed.");
  return { ok: true, verified_at: new Date().toISOString(), applications: ids.length, application_years_2000_2026: ids.length * YEARS.length,
    db_reference: DB_REFERENCE, product_layer_unchanged: true };
}

function createBackup(plan) {
  const directory = path.join(ROOT, "tmp", "production-backups", `swift-azg-db1941-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const key of ["source", "refFitments", "products"]) writeJson(path.join(directory, `${key}.json`), plan[key]);
  writeJson(path.join(directory, "manifest.json"), { policy: POLICY, created_at: new Date().toISOString(),
    rollback_command: `node scripts/catalog/publish-swift-azg-db1941-crossref-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("swift-azg-db1941-"), "Invalid rollback directory.");
  const sourceBefore = readJson(path.join(directory, "source.json"));
  const refsBefore = readJson(path.join(directory, "refFitments.json"));
  const productsBefore = readJson(path.join(directory, "products.json"));
  const ids = TARGETS.map((row) => row.application_id);
  const sourceNow = await fetchMaybe("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE));
  if (sourceNow) { let result = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids).eq("data_source_id", sourceNow.id); if (result.error) throw result.error; }
  const sourceRowsBefore = sourceBefore ? refsBefore.filter((row) => row.data_source_id === sourceBefore.id) : [];
  if (sourceRowsBefore.length) { const result = await db.from("vehicle_catalog_part_reference_fitments").insert(sourceRowsBefore); if (result.error) throw result.error; }
  if (sourceBefore) { const result = await db.from("catalog_data_sources").upsert(sourceBefore, { onConflict: "code" }); if (result.error) throw result.error; }
  else if (sourceNow) { const count = await countRows("vehicle_catalog_part_reference_fitments", (query) => query.eq("data_source_id", sourceNow.id));
    if (!count) { const result = await db.from("catalog_data_sources").delete().eq("id", sourceNow.id); if (result.error) throw result.error; } }
  const productsNow = await selectIn("vehicle_catalog_product_fitments", "application_id", ids);
  assert(semanticHash(productsNow) === semanticHash(productsBefore), "Rollback changed product layer.");
  const output = { verified: true, automatic, rolled_back_at: new Date().toISOString(), product_layer_unchanged: true };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), output);
  return output;
}

function summary(plan, mode) { return { generated_at: plan.generated_at, mode, policy: POLICY, production_writes: mode === "apply",
  applications: plan.plan.length, application_years_2000_2026: plan.plan.length * YEARS.length, db_reference: DB_REFERENCE,
  evidence_urls: EVIDENCE_URLS, product_writes: 0, blockers: plan.blockers, plan_sha256: plan.plan_hash }; }
function writeOutputs(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight.json"), summary(plan, mode)); writeJson(path.join(OUT, "plan.json"), plan.public_plan); }
function target(applicationId, series, drive, engineCodes) { return { application_id: applicationId, series, body: "Hatchback", drive, engine_codes: engineCodes }; }
function range(from, to) { return Array.from({ length: to - from + 1 }, (_, index) => from + index); }
function groupBy(rows, keyFn) { const output = new Map(); for (const row of rows) { const key = keyFn(row); const values = output.get(key) ?? []; values.push(row); output.set(key, values); } return output; }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function arrayEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function assert(value, message) { if (!value) throw new Error(message); }
function relative(value) { return path.relative(ROOT, value).replaceAll("\\", "/"); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(rows) { return stableHash(rows.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function selectIn(table, field, values) { const output = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").in(field, batch).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return output; }
async function fetchOne(table, filter) { const { data, error } = await filter(db.from(table).select("*")).single(); if (error) throw error; return data; }
async function fetchMaybe(table, filter) { const { data, error } = await filter(db.from(table).select("*")).maybeSingle(); if (error) throw error; return data ?? null; }
async function countRows(table, filter) { const { count, error } = await filter(db.from(table).select("*", { count: "exact", head: true })); if (error) throw error; return count ?? 0; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
