import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "range-rover-model-ownership-20261025");
const SOURCE_CODE = "RANGE_ROVER_MODEL_OWNERSHIP_CORRECTION_2026_10_25";
const SERIES_TARGET = new Map([
  ["L320", "RANGE ROVER SPORT"],
  ["L461", "RANGE ROVER SPORT"],
  ["L494", "RANGE ROVER SPORT"],
  ["L538", "RANGE ROVER EVOQUE"],
  ["L551", "RANGE ROVER EVOQUE"],
  ["L560", "RANGE ROVER VELAR"],
]);

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const make = required((await selectEq("vehicle_catalog_makes", "name", "LAND ROVER"))[0], "LAND ROVER make");
const models = await selectEq("vehicle_catalog_models", "make_id", make.make_id);
const modelByName = new Map(models.filter((row) => row.status === "active").map((row) => [row.name, row]));
const sourceModel = required(modelByName.get("RANGE ROVER"), "RANGE ROVER model");
for (const name of new Set(SERIES_TARGET.values())) required(modelByName.get(name), `${name} model`);

const relevantModelIds = [sourceModel.model_id, ...new Set([...SERIES_TARGET.values()].map((name) => modelByName.get(name).model_id))];
const series = await selectIn("vehicle_catalog_series", "model_id", relevantModelIds);
const sourceSeries = series.filter((row) => row.model_id === sourceModel.model_id && SERIES_TARGET.has(row.normalized_code));
const targetSeriesByModelAndCode = new Map(series.filter((row) => row.status === "active")
  .map((row) => [`${row.model_id}|${row.normalized_code}`, row]));
for (const row of sourceSeries) {
  const targetModel = modelByName.get(SERIES_TARGET.get(row.normalized_code));
  required(targetSeriesByModelAndCode.get(`${targetModel.model_id}|${row.normalized_code}`),
    `${targetModel.name} ${row.normalized_code} series`);
}

const applications = await selectIn("vehicle_catalog_applications", "model_id", relevantModelIds);
const sourceSeriesIds = new Set(sourceSeries.map((row) => row.series_id));
const sourceApplications = applications.filter((row) => row.status === "active" && sourceSeriesIds.has(row.series_id));
const sourceIds = sourceApplications.map((row) => row.application_id);
const applicationByCanonical = new Map(applications.map((row) => [row.canonical_key, row]));

const actions = [];
const blockers = [];
for (const source of sourceApplications) {
  const oldSeries = required(sourceSeries.find((row) => row.series_id === source.series_id), source.series_id);
  const targetModel = modelByName.get(SERIES_TARGET.get(oldSeries.normalized_code));
  const targetSeries = targetSeriesByModelAndCode.get(`${targetModel.model_id}|${oldSeries.normalized_code}`);
  const targetCanonicalKey = canonicalKey(source, targetModel.model_id, targetSeries.series_id);
  const peer = applicationByCanonical.get(targetCanonicalKey);
  if (peer && peer.status !== "active") {
    blockers.push({ application_id: source.application_id, reason: "target_canonical_key_occupied_by_inactive_application", peer });
    continue;
  }
  actions.push({
    action: peer ? "merge" : "reassign",
    source_application_id: source.application_id,
    target_application_id: peer?.application_id ?? source.application_id,
    old_model: sourceModel.name,
    new_model: targetModel.name,
    series: oldSeries.normalized_code,
    old_series_id: oldSeries.series_id,
    new_series_id: targetSeries.series_id,
    target_model_id: targetModel.model_id,
    old_canonical_key: source.canonical_key,
    new_canonical_key: targetCanonicalKey,
    source,
    peer: peer ?? null,
  });
}

const mergeActions = actions.filter((row) => row.action === "merge");
const relationshipIds = [...new Set([...sourceIds, ...mergeActions.map((row) => row.target_application_id)])];
const [years, provenance, products, wipers, references, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_application_years", "application_id", relationshipIds),
  selectIn("vehicle_catalog_application_provenance", "application_id", relationshipIds),
  selectIn("vehicle_catalog_product_fitments", "application_id", relationshipIds),
  selectIn("vehicle_catalog_wiper_fitments", "application_id", relationshipIds),
  selectIn("vehicle_catalog_part_reference_fitments", "application_id", relationshipIds),
  selectIn("customer_vehicles", "vehicle_catalog_application_id", mergeActions.map((row) => row.source_application_id)),
  selectIn("order_items", "vehicle_catalog_application_id", mergeActions.map((row) => row.source_application_id)),
  selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", mergeActions.map((row) => row.source_application_id)),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", mergeActions.map((row) => row.source_application_id)),
]);

if (customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length) {
  blockers.push({ reason: "merge_source_has_commerce_references", counts: {
    customer_vehicles: customerVehicles.length,
    order_items: orderItems.length,
    order_vehicle_snapshots: orderSnapshots.length,
    order_wiper_fulfillment: orderWipers.length,
  }});
}

const yearsByApplication = groupBy(years, (row) => row.application_id);
const provenanceByApplication = groupBy(provenance, (row) => row.application_id);
const productsByApplication = groupBy(products, (row) => row.application_id);
const wipersByApplication = groupBy(wipers, (row) => row.application_id);
const referencesByApplication = groupBy(references, (row) => row.application_id);

for (const action of mergeActions) {
  const sourceYears = (yearsByApplication.get(action.source_application_id) ?? []).map((row) => Number(row.model_year)).sort(numberSort);
  const targetYears = (yearsByApplication.get(action.target_application_id) ?? []).map((row) => Number(row.model_year)).sort(numberSort);
  if (JSON.stringify(sourceYears) !== JSON.stringify(targetYears)) {
    blockers.push({ application_id: action.source_application_id, target_application_id: action.target_application_id,
      reason: "merge_year_vectors_differ", sourceYears, targetYears });
  }
  action.products_to_upsert = preferredRelationshipRows(
    productsByApplication.get(action.source_application_id), productsByApplication.get(action.target_application_id),
    productKey, "fitment_status", action.target_application_id, "notes");
  action.wipers_to_upsert = preferredRelationshipRows(
    wipersByApplication.get(action.source_application_id), wipersByApplication.get(action.target_application_id),
    wiperKey, "fitment_status", action.target_application_id, "notes");
  action.references_to_upsert = preferredRelationshipRows(
    referencesByApplication.get(action.source_application_id), referencesByApplication.get(action.target_application_id),
    referenceKey, "fitment_status", action.target_application_id, null);
  action.provenance_to_upsert = missingRows(
    provenanceByApplication.get(action.source_application_id), provenanceByApplication.get(action.target_application_id), provenanceKey)
    .map((row) => ({ ...stripTimes(row), application_id: action.target_application_id }));
}

const sourceSeriesApplications = await selectIn("vehicle_catalog_applications", "series_id", [...sourceSeriesIds]);
const seriesToInactivate = sourceSeries.filter((row) => {
  const active = sourceSeriesApplications.filter((application) => application.series_id === row.series_id && application.status === "active");
  return active.every((application) => sourceIds.includes(application.application_id));
}).map((row) => row.series_id);

const plan = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? "apply" : "report-only",
  production_writes: APPLY,
  source_code: SOURCE_CODE,
  evidence: {
    rule: "L320/L461/L494 are Range Rover Sport; L538/L551 are Range Rover Evoque; L560 is Range Rover Velar.",
    catalogue_source: "Bendix刹车片_全量车找件_V01.xlsx / 01刹车片",
  },
  counts: {
    source_applications: sourceApplications.length,
    merges: mergeActions.length,
    reassignments: actions.filter((row) => row.action === "reassign").length,
    application_years_2000_2026: years.filter((row) => sourceIds.includes(row.application_id)
      && Number(row.model_year) >= 2000 && Number(row.model_year) <= 2026).length,
    product_fitments_to_upsert: sum(mergeActions, "products_to_upsert"),
    wiper_fitments_to_upsert: sum(mergeActions, "wipers_to_upsert"),
    reference_fitments_to_upsert: sum(mergeActions, "references_to_upsert"),
    provenance_to_upsert: sum(mergeActions, "provenance_to_upsert"),
    source_series_to_inactivate: seriesToInactivate.length,
    blockers: blockers.length,
  },
  blockers,
  series_to_inactivate: seriesToInactivate,
  actions,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJson(path.join(OUTPUT_DIR, APPLY ? "apply-plan.json" : "preflight.json"), plan);
writeCsv(path.join(OUTPUT_DIR, "application-trace.csv"), actions.map((row) => ({
  action: row.action,
  source_application_id: row.source_application_id,
  target_application_id: row.target_application_id,
  old_model: row.old_model,
  new_model: row.new_model,
  series: row.series,
  old_series_id: row.old_series_id,
  new_series_id: row.new_series_id,
})));

let backupDir = null;
if (APPLY) {
  assert(!blockers.length, `Preflight has ${blockers.length} blocker(s)`);
  backupDir = createBackup({ models, series, applications, sourceSeriesApplications, years, provenance, products, wipers,
    references, customerVehicles, orderItems, orderSnapshots, orderWipers });
  for (const action of actions) {
    if (action.action === "reassign") {
      const { data, error } = await db.from("vehicle_catalog_applications").update({
        model_id: action.target_model_id,
        series_id: action.new_series_id,
        canonical_key: action.new_canonical_key,
        review_status: "approved",
      }).eq("application_id", action.source_application_id)
        .eq("canonical_key", action.old_canonical_key).eq("status", "active").select("application_id");
      if (error) throw error;
      assert(data.length === 1, `Concurrent reassign change: ${action.source_application_id}`);
      continue;
    }
    await upsert("vehicle_catalog_product_fitments", action.products_to_upsert, "application_id,product_variant_id,position");
    await upsert("vehicle_catalog_wiper_fitments", action.wipers_to_upsert, "application_id,wiper_configuration_id");
    await upsert("vehicle_catalog_part_reference_fitments", action.references_to_upsert,
      "application_id,part_reference_id,position,data_source_id");
    await upsert("vehicle_catalog_application_provenance", action.provenance_to_upsert,
      "application_id,source_group,source_url");
    const { data, error } = await db.from("vehicle_catalog_applications")
      .update({ status: "inactive", review_status: "approved" })
      .eq("application_id", action.source_application_id).eq("status", "active").select("application_id");
    if (error) throw error;
    assert(data.length === 1, `Concurrent merge change: ${action.source_application_id}`);
  }
  for (const seriesId of seriesToInactivate) {
    const { error } = await db.from("vehicle_catalog_series").update({ status: "inactive" })
      .eq("series_id", seriesId).eq("status", "active");
    if (error) throw error;
  }
}

const verification = APPLY ? await verify(actions, seriesToInactivate) : null;
const result = { ...plan, backup_dir: backupDir, verification };
writeJson(path.join(OUTPUT_DIR, APPLY ? "applied.json" : "report.json"), result);
console.log(JSON.stringify({ output_dir: OUTPUT_DIR, counts: plan.counts, backup_dir: backupDir, verification }, null, 2));

async function verify(currentActions, inactiveSeriesIds) {
  const appIds = [...new Set(currentActions.flatMap((row) => [row.source_application_id, row.target_application_id]))];
  const afterApplications = await selectIn("vehicle_catalog_applications", "application_id", appIds);
  const afterById = new Map(afterApplications.map((row) => [row.application_id, row]));
  for (const action of currentActions) {
    const source = afterById.get(action.source_application_id);
    if (action.action === "merge") assert(source?.status === "inactive", `Merge source still active: ${action.source_application_id}`);
    else {
      assert(source?.status === "active", `Reassigned application inactive: ${action.source_application_id}`);
      assert(source.model_id === action.target_model_id && source.series_id === action.new_series_id,
        `Reassigned identity mismatch: ${action.source_application_id}`);
    }
    assert(afterById.get(action.target_application_id)?.status === "active", `Target inactive: ${action.target_application_id}`);
  }
  const seriesRows = await selectIn("vehicle_catalog_series", "series_id", inactiveSeriesIds);
  assert(seriesRows.every((row) => row.status === "inactive"), "A source series remains active");
  const activeCanonical = afterApplications.filter((row) => row.status === "active").map((row) => row.canonical_key);
  assert(activeCanonical.length === new Set(activeCanonical).size, "Duplicate active canonical keys after repair");
  return { ok: true, checked_applications: afterApplications.length, inactive_series: seriesRows.length };
}

function canonicalKey(row, modelId, seriesId) {
  return [modelId, seriesId, row.variant_id, row.powertrain_id, row.year_from, row.year_to].join("|");
}
function preferredRelationshipRows(source = [], target = [], keyFn, statusField, targetApplicationId, noteField) {
  const targetByKey = new Map(target.map((row) => [keyFn(row), row]));
  const rows = [];
  for (const sourceRow of source ?? []) {
    const targetRow = targetByKey.get(keyFn(sourceRow));
    if (targetRow && statusRank(targetRow[statusField]) >= statusRank(sourceRow[statusField])) continue;
    const clone = { ...stripTimes(sourceRow), application_id: targetApplicationId };
    if (noteField) clone[noteField] = appendNote(clone[noteField], `${SOURCE_CODE}; merged_from=${sourceRow.application_id}`);
    rows.push(clone);
  }
  return rows;
}
function statusRank(value) { return ({ rejected: 0, draft: 1, review: 2, published: 3 })[value] ?? 0; }
function missingRows(source = [], target = [], keyFn) {
  const targetKeys = new Set((target ?? []).map(keyFn));
  return (source ?? []).filter((row) => !targetKeys.has(keyFn(row)));
}
function productKey(row) { return `${row.product_variant_id}|${row.position}`; }
function wiperKey(row) { return row.wiper_configuration_id; }
function referenceKey(row) { return `${row.part_reference_id}|${row.position}|${row.data_source_id}`; }
function provenanceKey(row) { return `${row.source_group}|${row.source_url}`; }
function stripTimes(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function appendNote(value, note) { return [value, note].filter(Boolean).join("; "); }
function numberSort(left, right) { return left - right; }
function sum(rows, field) { return rows.reduce((total, row) => total + (row[field]?.length ?? 0), 0); }
function required(value, label) { assert(value, `Missing ${label}`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = map.get(key) ?? [];
    values.push(row);
    map.set(key, values);
  }
  return map;
}
async function selectEq(table, field, value) {
  const { data, error } = await db.from(table).select("*").eq(field, value);
  if (error) throw error;
  return data ?? [];
}
async function selectIn(table, field, values) {
  if (!values.length) return [];
  const output = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await db.from(table).select("*").in(field, values.slice(index, index + 100));
    if (error) throw error;
    output.push(...(data ?? []));
  }
  return output;
}
async function upsert(table, rows, onConflict) {
  if (!rows?.length) return;
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await db.from(table).upsert(rows.slice(index, index + 200), { onConflict });
    if (error) throw error;
  }
}
function createBackup(tables) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "tmp", "production-backups", `range-rover-model-ownership-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { created_at: new Date().toISOString(), source_code: SOURCE_CODE, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const contents = JSON.stringify(rows, null, 2);
    const filename = `${name}.json`;
    fs.writeFileSync(path.join(dir, filename), contents);
    manifest.tables[name] = { rows: rows.length, filename,
      sha256: crypto.createHash("sha256").update(contents).digest("hex") };
  }
  writeJson(path.join(dir, "manifest.json"), manifest);
  return dir;
}
function writeJson(filename, value) { fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`); }
function writeCsv(filename, rows) {
  if (!rows.length) return fs.writeFileSync(filename, "");
  const columns = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  fs.writeFileSync(filename, `${columns.map(quote).join(",")}\n${rows.map((row) => columns.map((column) => quote(row[column])).join(",")).join("\n")}\n`);
}
function loadEnv(filename) {
  if (!fs.existsSync(filename)) return;
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
