import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "jimny-brake-generation-correction-20261025");
const POLICY = "JIMNY_BRAKE_EXACT_ENGINE_GENERATION_V1_2026_10_25";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const TARGETS = [
  { application_id: "ap_1e2f7a7b7513dd1ecf4c", series: "JB33", engine: "G13BB", keep_from: 1998, keep_to: 2002,
    db: "DB403", source_rows: [2333], evidence: "Bendix Jimny SN/JB G13BB 4WD 1998-2002" },
  { application_id: "ap_bda35eb9844ddb492b8e", series: "JB43", engine: "M13A", keep_from: 2001, keep_to: 2018,
    db: "DB403", source_rows: [2334, 2335], evidence: "Bendix Jimny SN/JB M13A 4WD source ranges cover 2000-2018" },
  { application_id: "ap_9b208cf6db363df0806a", series: "SN413", engine: "G13BB", keep_from: 1998, keep_to: 2002,
    db: "DB403", source_rows: [2333], evidence: "Bendix Jimny SN/JB G13BB 4WD 1998-2002; SN413 is explicitly included by the source platform" },
  { application_id: "ap_cb99828e68c35d25826a", series: "SN413", engine: "M13A", keep_from: 2001, keep_to: 2018,
    db: "DB403", source_rows: [2334, 2335], evidence: "Bendix Jimny SN/JB M13A 4WD source ranges cover 2000-2018; SN413 is explicitly included by the source platform" },
  { application_id: "ap_8460a87f33fa713f3be4", series: "JB74W", engine: "K15B", keep_from: 2018, keep_to: 2026,
    db: "DB2606", source_rows: [2337, 2338], evidence: "Bendix Jimny A6G K15B 2018-on; NexAuto JB74W K15B 2018-2026" },
];

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK_ARG) {
  const result = await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length)));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const targetIds = TARGETS.map((row) => row.application_id);
const [applications, allApplications, years, seriesRows, powertrains, engineLinks, engineCodes, referenceFitments, partReferences,
  productFitments, provenance, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_applications", "application_id", targetIds),
  fetchAll("vehicle_catalog_applications", "application_id,canonical_key,status"),
  selectIn("vehicle_catalog_application_years", "application_id", targetIds),
  fetchAll("vehicle_catalog_series", "series_id,code"),
  fetchAll("vehicle_catalog_powertrains", "powertrain_id,display_name"),
  fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id,is_primary"),
  fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
  selectIn("vehicle_catalog_part_reference_fitments", "application_id", targetIds),
  selectIn("catalog_part_references", "normalized_value", ["DB403", "DB2606"]),
  selectIn("vehicle_catalog_product_fitments", "application_id", targetIds),
  selectIn("vehicle_catalog_application_provenance", "application_id", targetIds),
  selectIn("customer_vehicles", "vehicle_catalog_application_id", targetIds),
  selectIn("order_items", "vehicle_catalog_application_id", targetIds),
  selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", targetIds),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", targetIds),
]);

assert(applications.length === TARGETS.length, `Expected ${TARGETS.length} target applications, got ${applications.length}`);
assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0,
  "A year-corrected Jimny application has commerce references; transactional review is required");

const appById = new Map(applications.map((row) => [row.application_id, row]));
const seriesById = new Map(seriesRows.map((row) => [row.series_id, row]));
const powertrainById = new Map(powertrains.map((row) => [row.powertrain_id, row]));
const engineCodeById = new Map(engineCodes.map((row) => [row.engine_code_id, row]));
const engineCodesByPowertrain = groupBy(engineLinks, (row) => row.powertrain_id);
const yearsByApp = groupBy(years, (row) => row.application_id);
const refByValue = new Map(partReferences.map((row) => [row.normalized_value, row]));
const refValueById = new Map(partReferences.map((row) => [row.id, row.normalized_value]));

for (const value of ["DB403", "DB2606"]) {
  const reference = required(refByValue.get(value), `part reference ${value}`);
  assert(reference.product_type === "brake_pad" && reference.reference_scheme === "bendix_db", `${value} is not a Bendix brake-pad reference`);
  assert(reference.lifecycle_status === "active", `${value} is not active`);
}

const bendixSourceIds = unique(referenceFitments.filter((row) => refValueById.get(row.part_reference_id) === "DB403")
  .map((row) => row.data_source_id));
assert(bendixSourceIds.length === 1, `Expected one Bendix source id from DB403 rows, got ${JSON.stringify(bendixSourceIds)}`);
const dataSourceId = bendixSourceIds[0];
const otherActiveCanonicalKeys = new Set(allApplications.filter((row) => row.status === "active" && !targetIds.includes(row.application_id))
  .map((row) => row.canonical_key));

const plan = [];
const blockers = [];
for (const spec of TARGETS) {
  const application = required(appById.get(spec.application_id), spec.application_id);
  const series = seriesById.get(application.series_id)?.code;
  const engineValues = unique((engineCodesByPowertrain.get(application.powertrain_id) ?? [])
    .map((row) => engineCodeById.get(row.engine_code_id)?.code));
  const currentYears = (yearsByApp.get(spec.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  assert(series === spec.series, `${spec.application_id}: expected ${spec.series}, got ${series}`);
  assert(engineValues.includes(spec.engine), `${spec.application_id}: expected engine ${spec.engine}, got ${engineValues.join(",")}; ${powertrainById.get(application.powertrain_id)?.display_name}`);
  assert(currentYears.length > 0, `${spec.application_id}: no application years`);
  const keptYears = currentYears.filter((year) => year >= spec.keep_from && year <= spec.keep_to);
  const removedYears = currentYears.filter((year) => !keptYears.includes(year));
  assert(keptYears.length > 0, `${spec.application_id}: correction would remove all years`);
  assert(keptYears[0] === spec.keep_from && keptYears.at(-1) === spec.keep_to,
    `${spec.application_id}: expected retained range ${spec.keep_from}-${spec.keep_to}, got ${keptYears[0]}-${keptYears.at(-1)}`);
  const newCanonicalKey = [application.model_id, application.series_id, application.variant_id, application.powertrain_id,
    spec.keep_from, spec.keep_to].join("|");
  if (otherActiveCanonicalKeys.has(newCanonicalKey)) blockers.push({ application_id: spec.application_id, reason: "canonical_key_collision", new_canonical_key: newCanonicalKey });
  const targetReference = required(refByValue.get(spec.db), spec.db);
  const positionRows = referenceFitments.filter((row) => row.application_id === spec.application_id && row.position === "front");
  const targetRow = positionRows.find((row) => row.part_reference_id === targetReference.id && row.data_source_id === dataSourceId) ?? null;
  const conflictingPublished = positionRows.filter((row) => row.fitment_status === "published" && row.part_reference_id !== targetReference.id)
    .map((row) => refValueById.get(row.part_reference_id) ?? row.part_reference_id);
  if (conflictingPublished.length) blockers.push({ application_id: spec.application_id, reason: "published_front_conflict", conflicts: conflictingPublished });
  plan.push({ ...spec, current_year_from: application.year_from, current_year_to: application.year_to, current_years: currentYears,
    kept_years: keptYears, removed_years: removedYears, current_canonical_key: application.canonical_key, new_canonical_key: newCanonicalKey,
    part_reference_id: targetReference.id, data_source_id: dataSourceId, existing_target_row: targetRow,
    rows_to_reject: positionRows.filter((row) => row.part_reference_id !== targetReference.id && row.fitment_status !== "rejected") });
}

assert(blockers.length === 0, `Preflight blockers: ${JSON.stringify(blockers)}`);
const productHash = stableHash(productFitments);
const report = {
  generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", production_writes: APPLY,
  policy: POLICY, source: { code: SOURCE_CODE, workbook: "Desktop/database/Bendix刹车片_全量车找件_V01.xlsx" },
  plan: plan.map(publicPlan), blockers,
  totals: {
    applications: plan.length,
    corrected_applications: plan.filter((row) => row.removed_years.length).length,
    application_years_removed_all_years: plan.reduce((sum, row) => sum + row.removed_years.length, 0),
    application_years_removed_2000_2026: plan.reduce((sum, row) => sum + row.removed_years.filter((year) => year >= 2000 && year <= 2026).length, 0),
    retained_application_years_2000_2026: plan.reduce((sum, row) => sum + row.kept_years.filter((year) => year >= 2000 && year <= 2026).length, 0),
    front_reference_publications: plan.length,
    wrong_candidate_rejections: plan.reduce((sum, row) => sum + row.rows_to_reject.length, 0),
    product_writes: 0,
  },
  integrity: { product_fitment_preimage_sha256: productHash, product_fitment_rows: productFitments.length,
    no_commerce_references: true, canonical_collisions: blockers.filter((row) => row.reason === "canonical_key_collision").length },
};
fs.mkdirSync(OUT, { recursive: true });
writeJson(path.join(OUT, APPLY ? "apply-plan.json" : "preflight.json"), report);

let backupDirectory = null;
let verification = null;
if (APPLY) {
  backupDirectory = createBackup({ applications, years, referenceFitments, productFitments, provenance,
    customerVehicles, orderItems, orderSnapshots, orderWipers, plan: plan.map(publicPlan) });
  try {
    for (const item of plan) {
      if (item.removed_years.length) {
        const { error: deleteError } = await db.from("vehicle_catalog_application_years").delete()
          .eq("application_id", item.application_id).in("model_year", item.removed_years);
        if (deleteError) throw deleteError;
        const { data: updated, error: updateError } = await db.from("vehicle_catalog_applications").update({
          year_from: item.keep_from, year_to: item.keep_to, canonical_key: item.new_canonical_key, review_status: "approved",
        }).eq("application_id", item.application_id).eq("canonical_key", item.current_canonical_key).select("application_id");
        if (updateError) throw updateError;
        assert((updated ?? []).length === 1, `Concurrent application update: ${item.application_id}`);
      }
      for (const wrong of item.rows_to_reject) {
        const { error } = await db.from("vehicle_catalog_part_reference_fitments").update({
          fitment_status: "rejected", confidence: wrong.confidence,
          match_reasons: unique([...(wrong.match_reasons ?? []), "superseded_by_exact_engine_generation"]),
          metadata: { ...(wrong.metadata ?? {}), rejected_by_policy: POLICY, correct_db: item.db, evidence: item.evidence },
        }).eq("application_id", wrong.application_id).eq("part_reference_id", wrong.part_reference_id)
          .eq("position", wrong.position).eq("data_source_id", wrong.data_source_id);
        if (error) throw error;
      }
      const payload = {
        application_id: item.application_id, part_reference_id: item.part_reference_id, position: "front",
        data_source_id: item.data_source_id, fitment_status: "published", confidence: "exact",
        source_row_numbers: item.source_rows,
        match_reasons: ["exact_engine", "exact_generation_year_window", "authoritative_bendix_full_catalog"],
        metadata: { policy_version: POLICY, source_code: SOURCE_CODE, evidence: item.evidence,
          nexauto_series: item.series, engine_code: item.engine, corrected_year_window: [item.keep_from, item.keep_to], product_write: false },
      };
      const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(payload,
        { onConflict: "application_id,part_reference_id,position,data_source_id" });
      if (error) throw error;
    }
    verification = await verify(plan, productHash);
  } catch (error) {
    const rollbackResult = await rollback(backupDirectory, true);
    throw new Error(`Apply failed and was rolled back (${rollbackResult.verified}): ${error.message}`);
  }
}

const result = { ...report, backup_directory: backupDirectory ? path.relative(ROOT, backupDirectory).replaceAll("\\", "/") : null, verification };
writeJson(path.join(OUT, APPLY ? "applied.json" : "report.json"), result);
console.log(JSON.stringify({ output: path.relative(ROOT, OUT).replaceAll("\\", "/"), totals: report.totals,
  backup_directory: result.backup_directory, verification }, null, 2));

async function verify(currentPlan, expectedProductHash) {
  const ids = currentPlan.map((row) => row.application_id);
  const [currentApps, currentYears, currentRefs, currentProducts] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids),
    selectIn("vehicle_catalog_application_years", "application_id", ids),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids),
  ]);
  const currentAppById = new Map(currentApps.map((row) => [row.application_id, row]));
  const currentYearsByApp = groupBy(currentYears, (row) => row.application_id);
  const failures = [];
  for (const item of currentPlan) {
    const application = currentAppById.get(item.application_id);
    const actualYears = (currentYearsByApp.get(item.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    if (application?.year_from !== item.keep_from || application?.year_to !== item.keep_to || application?.canonical_key !== item.new_canonical_key
      || JSON.stringify(actualYears) !== JSON.stringify(item.kept_years)) failures.push({ application_id: item.application_id, reason: "year_correction_readback_failed" });
    const published = currentRefs.filter((row) => row.application_id === item.application_id && row.position === "front" && row.fitment_status === "published");
    if (published.length !== 1 || published[0].part_reference_id !== item.part_reference_id || published[0].data_source_id !== item.data_source_id)
      failures.push({ application_id: item.application_id, reason: "front_reference_readback_failed", published });
  }
  const currentProductHash = stableHash(currentProducts);
  if (currentProductHash !== expectedProductHash) failures.push({ reason: "protected_product_layer_changed" });
  assert(failures.length === 0, `Verification failures: ${JSON.stringify(failures)}`);
  return { ok: true, verified_at: new Date().toISOString(), applications_verified: ids.length,
    exact_front_references_published: currentPlan.length, product_layer_unchanged: true, product_fitment_sha256: currentProductHash };
}

function createBackup(value) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `jimny-brake-generation-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, rows] of Object.entries(value)) writeJson(path.join(directory, `${name}.json`), rows);
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/correct-and-publish-jimny-brakes-20261025.mjs --rollback=${path.relative(ROOT, directory).replaceAll("\\", "/")}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const allowedRoot = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${allowedRoot}${path.sep}`) && path.basename(directory).startsWith("jimny-brake-generation-"), "Invalid rollback directory");
  const applicationsBefore = readJson(path.join(directory, "applications.json"));
  const yearsBefore = readJson(path.join(directory, "years.json"));
  const refsBefore = readJson(path.join(directory, "referenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const ids = applicationsBefore.map((row) => row.application_id);
  for (const row of applicationsBefore) {
    const { error } = await db.from("vehicle_catalog_applications").update({ year_from: row.year_from, year_to: row.year_to,
      year_status: row.year_status, canonical_key: row.canonical_key, status: row.status, review_status: row.review_status })
      .eq("application_id", row.application_id);
    if (error) throw error;
  }
  let response = await db.from("vehicle_catalog_application_years").delete().in("application_id", ids); if (response.error) throw response.error;
  if (yearsBefore.length) { response = await db.from("vehicle_catalog_application_years").insert(yearsBefore); if (response.error) throw response.error; }
  response = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (response.error) throw response.error;
  if (refsBefore.length) { response = await db.from("vehicle_catalog_part_reference_fitments").insert(refsBefore); if (response.error) throw response.error; }
  const [appsNow, yearsNow, refsNow, productsNow] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids),
  ]);
  const checks = {
    applications_restored: semanticHash(appsNow) === semanticHash(applicationsBefore),
    years_restored: semanticHash(yearsNow) === semanticHash(yearsBefore),
    reference_fitments_restored: semanticHash(refsNow) === semanticHash(refsBefore),
    product_layer_unchanged: semanticHash(productsNow) === semanticHash(productsBefore),
  };
  assert(Object.values(checks).every(Boolean), `Rollback verification failed: ${JSON.stringify(checks)}`);
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), checks };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function publicPlan(row) { return { application_id: row.application_id, series: row.series, engine: row.engine,
  current_years: row.current_years, kept_years: row.kept_years, removed_years: row.removed_years,
  db_reference: row.db, source_row_numbers: row.source_rows, evidence: row.evidence,
  current_canonical_key: row.current_canonical_key, new_canonical_key: row.new_canonical_key,
  existing_target_status: row.existing_target_row?.fitment_status ?? null,
  rejected_candidates: row.rows_to_reject.map((item) => ({ part_reference_id: item.part_reference_id, current_status: item.fitment_status })),
  product_write: false }; }
function required(value, label) { assert(value, `Missing ${label}`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(value) { return stableHash(value.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function selectIn(table, field, values) { const output = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").in(field, batch).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return output; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
