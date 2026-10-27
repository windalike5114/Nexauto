import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "corolla-e21-wagon-brake-bridge-20261025");
const POLICY = "COROLLA_E21_WAGON_BODY_ONLY_BRIDGE_V1_2026_10_25";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const SOURCE_SHA256 = "8612087defd75010203b3b3fa658e473390591a3b1a0339f288dce5e020a41c2";
const TARGETS = [
  target("ap_120abc39f1e8d0f03321", "ZWE211W", range(2019, 2026)),
  target("ap_34a89a89b0316ed714e6", "ZWE211", range(2019, 2026)),
  target("ap_4c32c6f4b4eefb4b4e9a", "ZWE219", range(2022, 2026)),
];
const OPTIONS = {
  front: { DB2159: [235], DB2544: [237, 239, 241, 243] },
  rear: { DB1786: [234], DB2529: [236, 238, 240, 242] },
};
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

const sourceWorkbook = readBendixWorkbook();
assert(sourceWorkbook.sha256 === SOURCE_SHA256, `Bendix source changed: ${sourceWorkbook.sha256}`);
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
  const dbValues = Object.values(OPTIONS).flatMap((values) => Object.keys(values));
  const [applications, years, series, variants, engineLinks, engineCodes, refs, dataSource, refFitments, products] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    fetchAll("vehicle_catalog_series", "series_id,code"), fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type"),
    fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id"), fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
    selectIn("catalog_part_references", "normalized_value", dbValues), fetchOne("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE)),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids),
  ]);
  const blockers = [];
  if (applications.length !== TARGETS.length) blockers.push({ reason: "missing_target_applications", expected: TARGETS.length, actual: applications.length });
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const seriesById = new Map(series.map((row) => [row.series_id, row.code]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));
  const codeById = new Map(engineCodes.map((row) => [row.engine_code_id, row.code]));
  const linksByPowertrain = groupBy(engineLinks, (row) => row.powertrain_id);
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const refByValue = new Map(refs.map((row) => [row.normalized_value, row]));
  const sourceById = new Map(sourceWorkbook.uniqueRows.map((row) => [Number(row.sourceRowId), row]));
  const plan = [];
  for (const spec of TARGETS) {
    const app = appById.get(spec.application_id); if (!app) continue;
    const variant = variantById.get(app.variant_id) ?? {};
    const actualYears = (yearsByApp.get(app.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    const actualCodes = unique((linksByPowertrain.get(app.powertrain_id) ?? []).map((row) => codeById.get(row.engine_code_id)));
    if (seriesById.get(app.series_id) !== spec.series) blockers.push({ application_id: spec.application_id, reason: "series_mismatch" });
    if (variant.body_style !== "Wagon" || variant.drive_type !== "FWD") blockers.push({ application_id: spec.application_id, reason: "variant_mismatch", variant });
    if (!actualCodes.includes("2ZR-FXE")) blockers.push({ application_id: spec.application_id, reason: "engine_mismatch", actualCodes });
    if (!arrayEqual(actualYears, spec.years)) blockers.push({ application_id: spec.application_id, reason: "year_mismatch", expected: spec.years, actual: actualYears });
    const options = {};
    for (const [position, dbMap] of Object.entries(OPTIONS)) {
      options[position] = [];
      for (const [dbValue, sourceRows] of Object.entries(dbMap)) {
        const ref = refByValue.get(dbValue);
        if (!ref || ref.product_type !== "brake_pad" || ref.reference_scheme !== "bendix_db") blockers.push({ application_id: spec.application_id, reason: "invalid_reference", dbValue });
        const matchingRows = sourceRows.map((id) => sourceById.get(id)).filter((row) => row?.bendixReference === dbValue && row.position === position
          && row.driveType === "前驱" && row.engineCodes.includes("2ZRFXE"));
        const uncovered = spec.years.filter((year) => !matchingRows.some((row) => year >= row.yearFrom && year <= row.yearTo));
        if (uncovered.length) blockers.push({ application_id: spec.application_id, position, dbValue, reason: "source_year_gap", uncovered });
        options[position].push({ db_reference: dbValue, part_reference_id: ref?.id, source_row_numbers: matchingRows.map((row) => row.sourceRowId) });
      }
      const allowedIds = new Set(options[position].map((row) => row.part_reference_id));
      const conflicts = refFitments.filter((row) => row.application_id === spec.application_id && row.position === position
        && row.fitment_status === "published" && !allowedIds.has(row.part_reference_id));
      if (conflicts.length) blockers.push({ application_id: spec.application_id, position, reason: "published_reference_conflict" });
    }
    plan.push({ ...spec, options });
  }
  const publicPlan = plan.map((row) => ({ application_id: row.application_id, series: row.series, years: row.years,
    body_bridge: "E21 sedan/hatchback source to E21 wagon with same 2ZR-FXE and FWD", positions: row.options, product_write: false }));
  return { generated_at: new Date().toISOString(), blockers, plan, public_plan: publicPlan, dataSource, refFitments, products,
    product_hash: semanticHash(products), plan_hash: stableHash(publicPlan) };
}

async function applyPlan(plan) {
  for (const item of plan.plan) for (const [position, options] of Object.entries(item.options)) for (const option of options) {
    const response = await db.from("vehicle_catalog_part_reference_fitments").upsert({ application_id: item.application_id,
      part_reference_id: option.part_reference_id, position, data_source_id: plan.dataSource.id, fitment_status: "published", confidence: "high",
      source_row_numbers: option.source_row_numbers, match_reasons: ["same_e21_platform", "exact_2zr_fxe_engine", "exact_fwd_drive",
        "full_year_coverage", "body_classification_only_bridge", "evidence_backed_multiple_brake_configurations"],
      metadata: { policy_version: POLICY, source_code: SOURCE_CODE, source_sha256: SOURCE_SHA256, selection_mode: "conditional_one_of",
        option_set: options.map((row) => row.db_reference).sort(), configuration_confirmation_required: true,
        discriminator_hint: "Confirm caliper / disc / OEM configuration", body_bridge: "sedan_or_hatchback_to_wagon_same_e21_platform",
        product_write: false } }, { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (response.error) throw response.error;
  }
}

async function verify(plan) {
  const ids = plan.plan.map((row) => row.application_id);
  const [rows, products] = await Promise.all([selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids)]);
  const failures = [];
  for (const item of plan.plan) for (const [position, options] of Object.entries(item.options)) {
    const actual = rows.filter((row) => row.application_id === item.application_id && row.position === position && row.fitment_status === "published");
    if (!arrayEqual(actual.map((row) => row.part_reference_id).sort(), options.map((row) => row.part_reference_id).sort())
      || actual.some((row) => row.metadata?.policy_version !== POLICY)) failures.push({ application_id: item.application_id, position });
  }
  assert(!failures.length, `Readback failures: ${JSON.stringify(failures)}`);
  assert(semanticHash(products) === plan.product_hash, "Protected product layer changed.");
  return { ok: true, verified_at: new Date().toISOString(), applications: ids.length,
    application_years_2000_2026: plan.plan.reduce((sum, row) => sum + row.years.length, 0), product_layer_unchanged: true };
}

function createBackup(plan) {
  const directory = path.join(ROOT, "tmp", "production-backups", `corolla-e21-wagon-brake-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "refFitments.json"), plan.refFitments); writeJson(path.join(directory, "products.json"), plan.products);
  writeJson(path.join(directory, "manifest.json"), { policy: POLICY, created_at: new Date().toISOString(),
    rollback_command: `node scripts/catalog/publish-corolla-e21-wagon-body-bridge-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("corolla-e21-wagon-brake-"), "Invalid rollback directory.");
  const refsBefore = readJson(path.join(directory, "refFitments.json")); const productsBefore = readJson(path.join(directory, "products.json"));
  const ids = TARGETS.map((row) => row.application_id);
  let response = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (response.error) throw response.error;
  if (refsBefore.length) { response = await db.from("vehicle_catalog_part_reference_fitments").insert(refsBefore); if (response.error) throw response.error; }
  const productsNow = await selectIn("vehicle_catalog_product_fitments", "application_id", ids);
  assert(semanticHash(productsNow) === semanticHash(productsBefore), "Rollback changed product layer.");
  const output = { verified: true, automatic, rolled_back_at: new Date().toISOString(), product_layer_unchanged: true };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), output); return output;
}

function summary(plan, mode) { return { generated_at: plan.generated_at, mode, policy: POLICY, production_writes: mode === "apply",
  applications: plan.plan.length, application_years_2000_2026: plan.plan.reduce((sum, row) => sum + row.years.length, 0),
  reference_relationships: plan.plan.length * 4, product_writes: 0, blockers: plan.blockers, plan_sha256: plan.plan_hash }; }
function writeOutputs(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight.json"), summary(plan, mode)); writeJson(path.join(OUT, "plan.json"), plan.public_plan); }
function target(applicationId, series, years) { return { application_id: applicationId, series, years }; }
function range(from, to) { return Array.from({ length: to - from + 1 }, (_, index) => from + index); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function groupBy(rows, keyFn) { const output = new Map(); for (const row of rows) { const key = keyFn(row); const values = output.get(key) ?? []; values.push(row); output.set(key, values); } return output; }
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
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
