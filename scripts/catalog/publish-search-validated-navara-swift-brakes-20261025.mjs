import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "brake-search-resolvable-20261025");
const POLICY = "SEARCH_VALIDATED_NAVARA_SWIFT_BRAKES_V1_2026_10_25";
const SOURCE_ROWS = {
  JNBK_D22_DB438_CROSSREF_2026: { code: "JNBK_D22_DB438_CROSSREF_2026",
    name: "JNBK D22 application and Bendix DB438 cross-reference evidence", source_kind: "market_reference",
    vehicle_identity_priority: 80, product_fitment_priority: 20, active: true,
    metadata: { product_line: "brake_pad", reference_scheme: "bendix_db", source_confidence: "high",
      evidence_type: "exact_application_plus_manufacturer_cross_reference",
      url: "https://www.jnbk-brake.com/catalogue/partdetails.aspx?PartNumber=PN2344" } },
  BENDIX_SWIFT_DB1117_CROSSCHECK_2026: { code: "BENDIX_SWIFT_DB1117_CROSSCHECK_2026",
    name: "Bendix Swift DB1117 exact-configuration cross-check", source_kind: "market_reference",
    vehicle_identity_priority: 80, product_fitment_priority: 20, active: true,
    metadata: { product_line: "brake_pad", reference_scheme: "bendix_db", source_confidence: "high",
      evidence_type: "authoritative_local_catalogue_plus_exact_vehicle_crosscheck",
      url: "https://www.autosurplus.com.au/bendix-gct-disc-brake-pad-set-db1117-gct" } },
};
const TARGETS = [
  target("ap_b87570d6bdbb8db78e97", "NISSAN", "NAVARA", "LPD22", "Cab Chassis", "RWD", ["KA20DE"], range(1999, 2002), "DB438", "JNBK_D22_DB438_CROSSREF_2026", [1]),
  target("ap_6297dd38959c1c222e97", "NISSAN", "NAVARA", "PD22", "Cab Chassis", "RWD", ["KA20DE"], range(1999, 2002), "DB438", "JNBK_D22_DB438_CROSSREF_2026", [1]),
];
const DEFERRED_YEAR_SPLITS = [
  { application_ids: ["ap_6ad2f32974f9482b22e7", "ap_126d7724d936b840bb8e"], series: ["AA34", "SF413"], engine: "G13B", candidate: "DB1117", reason: "application_spans_1990_2001_but_exact_evidence_starts_later" },
  { application_ids: ["ap_4e280f408ef7c25f9c75", "ap_224873b3c4b5458c5bfc"], series: ["AB35", "SF413"], engine: "G13BA", candidate: "DB1117", reason: "application_spans_1990_2001_but_exact_evidence_starts_later" },
];
const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
if (APPLY && ROLLBACK_ARG) throw new Error("Choose --apply or --rollback=<backup-directory>.");

loadEnv(path.join(ROOT, ".env.local"));
assert(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK_ARG) { console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length))), null, 2)); process.exit(0); }
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
  writeJson(path.join(OUT, "navara-swift-applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}

async function prepare() {
  const ids = TARGETS.map((row) => row.application_id);
  const [apps, years, makes, models, series, variants, engineLinks, engineCodes, refs, existingFitments, products,
    source1, source2, refProducts] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    fetchAll("vehicle_catalog_makes"), fetchAll("vehicle_catalog_models"), fetchAll("vehicle_catalog_series"), fetchAll("vehicle_catalog_variants"),
    fetchAll("vehicle_catalog_powertrain_engine_codes"), fetchAll("vehicle_catalog_engine_codes"),
    selectIn("catalog_part_references", "normalized_value", ["DB438", "DB1117"]),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids),
    fetchMaybe("catalog_data_sources", (query) => query.eq("code", "JNBK_D22_DB438_CROSSREF_2026")),
    fetchMaybe("catalog_data_sources", (query) => query.eq("code", "BENDIX_SWIFT_DB1117_CROSSCHECK_2026")),
    fetchAll("catalog_part_reference_products"),
  ]);
  const blockers = [];
  const appById = new Map(apps.map((row) => [row.application_id, row]));
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const modelById = new Map(models.map((row) => [row.model_id, row]));
  const seriesById = new Map(series.map((row) => [row.series_id, row]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));
  const codeById = new Map(engineCodes.map((row) => [row.engine_code_id, row.code]));
  const linksByPowertrain = Map.groupBy(engineLinks, (row) => row.powertrain_id);
  const yearsByApp = Map.groupBy(years, (row) => row.application_id);
  const refByValue = new Map(refs.filter((row) => row.product_type === "brake_pad" && row.reference_scheme === "bendix_db")
    .map((row) => [row.normalized_value, row]));
  const plan = [];
  for (const spec of TARGETS) {
    const app = appById.get(spec.application_id); if (!app) { blockers.push({ application_id: spec.application_id, reason: "missing_application" }); continue; }
    const model = modelById.get(app.model_id); const make = makeById.get(model?.make_id); const currentSeries = seriesById.get(app.series_id);
    const variant = variantById.get(app.variant_id); const actualYears = (yearsByApp.get(app.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    const actualEngines = (linksByPowertrain.get(app.powertrain_id) ?? []).map((row) => codeById.get(row.engine_code_id)).filter(Boolean).sort();
    for (const [field, expected, actual] of [["make", spec.make, make?.normalized_name], ["model", spec.model, model?.normalized_name],
      ["series", spec.series, currentSeries?.normalized_code], ["body", spec.body, variant?.body_style], ["drive", spec.drive, variant?.drive_type]]) {
      if (expected !== actual) blockers.push({ application_id: spec.application_id, reason: `${field}_mismatch`, expected, actual });
    }
    if (!arrayEqual(spec.engine_codes, actualEngines)) blockers.push({ application_id: spec.application_id, reason: "engine_mismatch", expected: spec.engine_codes, actual: actualEngines });
    if (!arrayEqual(spec.years, actualYears)) blockers.push({ application_id: spec.application_id, reason: "year_mismatch", expected: spec.years, actual: actualYears });
    const ref = refByValue.get(spec.db_reference);
    if (!ref) blockers.push({ application_id: spec.application_id, reason: "missing_bendix_reference", db_reference: spec.db_reference });
    const publishedConflicts = existingFitments.filter((row) => row.application_id === spec.application_id && row.position === "front"
      && row.fitment_status === "published" && row.part_reference_id !== ref?.id);
    if (publishedConflicts.length) blockers.push({ application_id: spec.application_id, reason: "published_front_conflict", rows: publishedConflicts.length });
    plan.push({ ...spec, part_reference_id: ref?.id });
  }
  const publicPlan = plan.map(({ part_reference_id, ...row }) => ({ ...row, part_reference_id }));
  return { generated_at: new Date().toISOString(), blockers, plan, public_plan: publicPlan, existingFitments, products,
    sources_before: [source1, source2].filter(Boolean), refProducts, product_hash: semanticHash(products),
    ref_product_hash: semanticHash(refProducts), plan_hash: stableHash(publicPlan) };
}

async function applyPlan(plan) {
  const usedSourceCodes = [...new Set(plan.plan.map((row) => row.source_code))];
  for (const code of usedSourceCodes) { const result = await db.from("catalog_data_sources").upsert(SOURCE_ROWS[code], { onConflict: "code" }); if (result.error) throw result.error; }
  const sources = await selectIn("catalog_data_sources", "code", usedSourceCodes);
  const sourceByCode = new Map(sources.map((row) => [row.code, row]));
  for (const item of plan.plan) {
    const result = await db.from("vehicle_catalog_part_reference_fitments").upsert({ application_id: item.application_id,
      part_reference_id: item.part_reference_id, position: "front", data_source_id: sourceByCode.get(item.source_code).id,
      fitment_status: "published", confidence: "high", source_row_numbers: item.source_rows,
      match_reasons: item.make === "NISSAN"
        ? ["exact_pd22_lpd22_chassis", "exact_ka20de_engine", "exact_rwd_drive", "jnbk_pn2344_to_bendix_db438_cross_reference"]
        : ["exact_ea_ma_chassis_alias", "exact_sf413_aa34_ab35_code", "exact_g13b_g13ba_engine", "bendix_db1117_crosscheck"],
      metadata: { policy_version: POLICY, source_code: item.source_code, evidence_urls: SOURCE_ROWS[item.source_code].metadata.url,
        cross_reference_chain: item.db_reference === "DB438" ? "JNBK PN2344 -> Bendix DB438" : "Bendix DB1117 direct",
        product_write: false } }, { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (result.error) throw result.error;
  }
}

async function verify(plan) {
  const ids = plan.plan.map((row) => row.application_id);
  const [rows, products, refProducts, sources] = await Promise.all([
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids), fetchAll("catalog_part_reference_products"),
    selectIn("catalog_data_sources", "code", [...new Set(plan.plan.map((row) => row.source_code))]),
  ]);
  const sourceByCode = new Map(sources.map((row) => [row.code, row.id]));
  const failures = plan.plan.filter((item) => !rows.some((row) => row.application_id === item.application_id
    && row.part_reference_id === item.part_reference_id && row.position === "front" && row.data_source_id === sourceByCode.get(item.source_code)
    && row.fitment_status === "published" && row.confidence === "high" && row.metadata?.policy_version === POLICY));
  assert(!failures.length, `Readback failures: ${JSON.stringify(failures)}`);
  assert(semanticHash(products) === plan.product_hash, "Protected product layer changed.");
  assert(semanticHash(refProducts) === plan.ref_product_hash, "Protected product-reference links changed.");
  return { ok: true, verified_at: new Date().toISOString(), applications: plan.plan.length,
    application_years_2000_2026: plan.plan.reduce((sum, row) => sum + row.years.filter((year) => year >= 2000 && year <= 2026).length, 0),
    by_reference: Object.fromEntries(["DB438", "DB1117"].map((value) => [value, plan.plan.filter((row) => row.db_reference === value).length])),
    product_layer_unchanged: true, reference_product_links_unchanged: true };
}

function createBackup(plan) {
  const directory = path.join(ROOT, "tmp", "production-backups", `search-validated-navara-swift-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "fitments.json"), plan.existingFitments); writeJson(path.join(directory, "sources.json"), plan.sources_before);
  writeJson(path.join(directory, "products.json"), plan.products); writeJson(path.join(directory, "referenceProducts.json"), plan.refProducts);
  writeJson(path.join(directory, "manifest.json"), { policy: POLICY, created_at: new Date().toISOString(),
    rollback_command: `node scripts/catalog/publish-search-validated-navara-swift-brakes-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("search-validated-navara-swift-"), "Invalid rollback directory.");
  const before = readJson(path.join(directory, "fitments.json")); const sourcesBefore = readJson(path.join(directory, "sources.json"));
  const productsBefore = readJson(path.join(directory, "products.json")); const refProductsBefore = readJson(path.join(directory, "referenceProducts.json"));
  const ids = TARGETS.map((row) => row.application_id);
  let result = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (result.error) throw result.error;
  if (before.length) { result = await db.from("vehicle_catalog_part_reference_fitments").insert(before); if (result.error) throw result.error; }
  for (const code of Object.keys(SOURCE_ROWS)) {
    const old = sourcesBefore.find((row) => row.code === code);
    if (old) { result = await db.from("catalog_data_sources").upsert(old, { onConflict: "code" }); if (result.error) throw result.error; }
    else { result = await db.from("catalog_data_sources").delete().eq("code", code); if (result.error) throw result.error; }
  }
  const [products, refProducts] = await Promise.all([selectIn("vehicle_catalog_product_fitments", "application_id", ids), fetchAll("catalog_part_reference_products")]);
  assert(semanticHash(products) === semanticHash(productsBefore), "Rollback changed product layer.");
  assert(semanticHash(refProducts) === semanticHash(refProductsBefore), "Rollback changed product-reference links.");
  const output = { verified: true, automatic, rolled_back_at: new Date().toISOString(), product_layer_unchanged: true };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), output); return output;
}

function summary(plan, mode) { return { generated_at: plan.generated_at, mode, policy: POLICY, production_writes: mode === "apply",
  applications: plan.plan.length, application_years_2000_2026: plan.plan.reduce((sum, row) => sum + row.years.filter((year) => year >= 2000 && year <= 2026).length, 0),
  references: Object.fromEntries(["DB438", "DB1117"].map((value) => [value, plan.plan.filter((row) => row.db_reference === value).length])),
  deferred_year_splits: DEFERRED_YEAR_SPLITS, product_writes: 0, blockers: plan.blockers, plan_sha256: plan.plan_hash }; }
function writeOutputs(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "navara-swift-preflight.json"), summary(plan, mode)); writeJson(path.join(OUT, "navara-swift-plan.json"), plan.public_plan); }
function target(application_id, make, model, series, body, drive, engine_codes, years, db_reference, source_code, source_rows) { return { application_id, make, model, series, body, drive, engine_codes, years, db_reference, source_code, source_rows }; }
function range(from, to) { return Array.from({ length: to - from + 1 }, (_, index) => from + index); }
function arrayEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function assert(value, message) { if (!value) throw new Error(message); }
function relative(value) { return path.relative(ROOT, value).replaceAll("\\", "/"); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(rows) { return stableHash(rows.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function fetchMaybe(table, filter) { const { data, error } = await filter(db.from(table).select("*")).maybeSingle(); if (error) throw error; return data ?? null; }
async function selectIn(table, field, values) { if (!values.length) return []; const output = []; for (let index = 0; index < values.length; index += 50) { const { data, error } = await db.from(table).select("*").in(field, values.slice(index, index + 50)); if (error) throw error; output.push(...(data ?? [])); } return output; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
