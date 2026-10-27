import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const RUN_DATE = "2026-10-24";
const SOURCE_CODE = "VEHICLE_MODEL_IDENTITY_CORRECTION_2026_10_24";
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "vehicle-catalog-model-corrections-20261024");
const PREFLIGHT_PATH = path.join(OUTPUT_DIR, "preflight.json");
const MERGE_PATH = path.join(OUTPUT_DIR, "merge-analysis.json");

loadEnv(path.resolve(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const preflight = JSON.parse(fs.readFileSync(PREFLIGHT_PATH, "utf8"));
const mergeAnalysis = JSON.parse(fs.readFileSync(MERGE_PATH, "utf8"));
const preflightById = new Map(preflight.resolutions.map((row) => [row.applicationId, row]));
const mergeRows = mergeAnalysis.rows.filter((row) => row.exactCanonicalPeerIds.length === 1);
const directRows = mergeAnalysis.rows.filter((row) => row.exactCanonicalPeerIds.length === 0);

assert(mergeAnalysis.rows.length === 87, `Expected 87 corrections, got ${mergeAnalysis.rows.length}`);
assert(mergeRows.length === 85, `Expected 85 canonical merges, got ${mergeRows.length}`);
assert(directRows.length === 2, `Expected 2 direct corrections, got ${directRows.length}`);
assert(directRows.every((row) => ["DR1W", "DR2W"].includes(row.seriesCode)), "Unexpected direct correction series");

const sourceIds = mergeAnalysis.rows.map((row) => row.applicationId);
const targetIds = mergeRows.map((row) => row.exactCanonicalPeerIds[0]);
const allApplicationIds = [...new Set([...sourceIds, ...targetIds])];
const seriesIds = [...new Set(preflight.resolutions.flatMap((row) => [row.currentSeriesId, ...(row.targetSeries ?? []).map((item) => item.seriesId)]).filter(Boolean))];

const [applications, years, provenance, products, wipers, series, seriesApplications, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectInChunks("vehicle_catalog_applications", "*", "application_id", allApplicationIds),
  selectInChunks("vehicle_catalog_application_years", "*", "application_id", allApplicationIds),
  selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", allApplicationIds),
  selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", allApplicationIds),
  selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", allApplicationIds),
  selectInChunks("vehicle_catalog_series", "*", "series_id", seriesIds),
  selectInChunks("vehicle_catalog_applications", "*", "series_id", seriesIds),
  selectInChunks("customer_vehicles", "*", "vehicle_catalog_application_id", sourceIds),
  selectInChunks("order_items", "*", "vehicle_catalog_application_id", sourceIds),
  selectInChunks("order_vehicle_snapshots", "*", "vehicle_catalog_application_id", sourceIds),
  selectInChunks("order_wiper_fulfillment", "*", "vehicle_catalog_application_id", sourceIds),
]);

assert(customerVehicles.length === 0 && orderItems.length === 0 && orderSnapshots.length === 0 && orderWipers.length === 0,
  "Commerce rows reference a source application; manual transactional merge required");

const applicationById = new Map(applications.map((row) => [row.application_id, row]));
const yearsByApplication = groupBy(years, (row) => row.application_id);
const provenanceByApplication = groupBy(provenance, (row) => row.application_id);
const productsByApplication = groupBy(products, (row) => row.application_id);
const wipersByApplication = groupBy(wipers, (row) => row.application_id);
const seriesById = new Map(series.map((row) => [row.series_id, row]));

const plan = {
  generatedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "report",
  sourceCode: SOURCE_CODE,
  mergeApplications: [],
  directApplications: [],
  totals: {
    applicationsCorrected: 87,
    canonicalMerges: 85,
    directInPlace: 2,
    applicationYearsRepresented: mergeAnalysis.rows.reduce((sum, row) => sum + row.sourceYears.length, 0),
    productFitmentsToInsert: 0,
    productFitmentsAlreadyPresent: 0,
    wiperFitmentsAlreadyPresent: 0,
    conflictingWipersToPreserveRejected: 0,
    provenanceToInsert: 0,
    provenanceAlreadyPresent: 0,
  },
};

for (const row of mergeRows) {
  const source = required(applicationById.get(row.applicationId), `source ${row.applicationId}`);
  const targetId = row.exactCanonicalPeerIds[0];
  const target = required(applicationById.get(targetId), `target ${targetId}`);
  const targetSeriesId = required(row.targetSeriesId, `target series ${row.applicationId}`);
  const targetModelId = required(row.targetModelId, `target model ${row.applicationId}`);
  assert(source.status === "active" || source.status === "inactive", `Unexpected source status ${source.application_id}:${source.status}`);
  assert(target.status === "active", `Target is not active ${target.application_id}`);
  assert(target.model_id === targetModelId && target.series_id === targetSeriesId, `Target identity changed ${target.application_id}`);
  assertSameApplicationShape(source, target);
  assert(sameSet(yearValues(yearsByApplication.get(source.application_id)), yearValues(yearsByApplication.get(target.application_id))),
    `Application years differ ${source.application_id} -> ${target.application_id}`);

  const targetProductKeys = new Set((productsByApplication.get(targetId) ?? []).map(productKey));
  const sourceProducts = productsByApplication.get(source.application_id) ?? [];
  const productsToInsert = sourceProducts.filter((item) => !targetProductKeys.has(productKey(item))).map((item) => ({
    ...stripApplicationRow(item),
    application_id: targetId,
    notes: appendNote(item.notes, `${SOURCE_CODE}; merged from ${source.application_id}`),
  }));
  plan.totals.productFitmentsToInsert += productsToInsert.length;
  plan.totals.productFitmentsAlreadyPresent += sourceProducts.length - productsToInsert.length;

  const targetWiperByConfiguration = new Map((wipersByApplication.get(targetId) ?? []).map((item) => [item.wiper_configuration_id, item]));
  const targetPublished = (wipersByApplication.get(targetId) ?? []).filter((item) => item.fitment_status === "published");
  const sourceWipers = wipersByApplication.get(source.application_id) ?? [];
  const wipersToInsert = sourceWipers.filter((item) => !targetWiperByConfiguration.has(item.wiper_configuration_id)).map((item) => ({
    ...stripApplicationRow(item),
    application_id: targetId,
    fitment_status: targetPublished.length ? "rejected" : item.fitment_status,
    notes: appendNote(item.notes, targetPublished.length
      ? `${SOURCE_CODE}; preserved from ${source.application_id} as rejected because canonical target has an authoritative published configuration`
      : `${SOURCE_CODE}; merged from ${source.application_id}`),
  }));
  plan.totals.wiperFitmentsAlreadyPresent += sourceWipers.length - wipersToInsert.length;
  plan.totals.conflictingWipersToPreserveRejected += wipersToInsert.filter((item) => item.fitment_status === "rejected").length;

  const targetProvenanceKeys = new Set((provenanceByApplication.get(targetId) ?? []).map(provenanceKey));
  const sourceProvenance = provenanceByApplication.get(source.application_id) ?? [];
  const provenanceToInsert = sourceProvenance.filter((item) => !targetProvenanceKeys.has(provenanceKey(item))).map((item) => ({
    ...item,
    application_id: targetId,
  }));
  plan.totals.provenanceToInsert += provenanceToInsert.length;
  plan.totals.provenanceAlreadyPresent += sourceProvenance.length - provenanceToInsert.length;

  plan.mergeApplications.push({
    sourceApplicationId: source.application_id,
    targetApplicationId: targetId,
    issueClass: row.issueClass,
    seriesCode: row.seriesCode,
    years: row.years,
    targetModelId,
    targetSeriesId,
    productsToInsert,
    wipersToInsert,
    provenanceToInsert,
  });
}

for (const row of directRows) {
  const resolution = required(preflightById.get(row.applicationId), `resolution ${row.applicationId}`);
  const source = required(applicationById.get(row.applicationId), `source ${row.applicationId}`);
  const targetModel = required(resolution.targetModels?.[0], `target model ${row.applicationId}`);
  const currentSeries = required(seriesById.get(source.series_id), `series ${source.series_id}`);
  const seriesUsage = seriesApplications.filter((item) => item.series_id === source.series_id);
  assert(seriesUsage.length === 1 && seriesUsage[0].application_id === source.application_id,
    `Series ${source.series_id} is shared and cannot move in place`);
  const newCanonicalKey = [targetModel.modelId, source.series_id, source.variant_id, source.powertrain_id, source.year_from, source.year_to].join("|");
  assert(!applications.some((item) => item.application_id !== source.application_id && item.canonical_key === newCanonicalKey),
    `Canonical key already exists for ${source.application_id}`);
  plan.directApplications.push({
    applicationId: source.application_id,
    issueClass: row.issueClass,
    seriesCode: row.seriesCode,
    years: row.years,
    currentModelId: source.model_id,
    targetModelId: targetModel.modelId,
    seriesId: source.series_id,
    currentSeriesModelId: currentSeries.model_id,
    newCanonicalKey,
    childCounts: {
      years: (yearsByApplication.get(source.application_id) ?? []).length,
      products: (productsByApplication.get(source.application_id) ?? []).length,
      wipers: (wipersByApplication.get(source.application_id) ?? []).length,
      provenance: (provenanceByApplication.get(source.application_id) ?? []).length,
    },
  });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const planPath = path.join(OUTPUT_DIR, APPLY ? "apply-plan.json" : "correction-plan.json");
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

let backupDir = null;
if (APPLY) {
  backupDir = createBackup({ applications, years, provenance, products, wipers, series, customerVehicles, orderItems, orderSnapshots, orderWipers });
  for (const item of plan.mergeApplications) {
    if (item.productsToInsert.length) await upsertRows("vehicle_catalog_product_fitments", item.productsToInsert, "application_id,product_variant_id,position");
    if (item.wipersToInsert.length) await upsertRows("vehicle_catalog_wiper_fitments", item.wipersToInsert, "application_id,wiper_configuration_id");
    if (item.provenanceToInsert.length) await upsertRows("vehicle_catalog_application_provenance", item.provenanceToInsert, "application_id,source_group,source_url");
    const { error } = await db.from("vehicle_catalog_applications").update({ status: "inactive" }).eq("application_id", item.sourceApplicationId).eq("status", "active");
    if (error) throw error;
  }
  for (const item of plan.directApplications) {
    const { error: seriesError } = await db.from("vehicle_catalog_series").update({ model_id: item.targetModelId }).eq("series_id", item.seriesId).eq("model_id", item.currentSeriesModelId);
    if (seriesError) throw seriesError;
    const { error: applicationError } = await db.from("vehicle_catalog_applications").update({
      model_id: item.targetModelId,
      canonical_key: item.newCanonicalKey,
      review_status: "approved",
    }).eq("application_id", item.applicationId).eq("status", "active");
    if (applicationError) throw applicationError;
  }
}

const verification = APPLY ? await verify(plan) : null;
const report = { ...plan, backupDir, verification };
const reportPath = path.join(OUTPUT_DIR, APPLY ? "applied.json" : "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ mode: plan.mode, planPath, reportPath, backupDir, totals: plan.totals, verification }, null, 2));

async function verify(currentPlan) {
  const sourceIdsToCheck = currentPlan.mergeApplications.map((item) => item.sourceApplicationId);
  const targetIdsToCheck = currentPlan.mergeApplications.map((item) => item.targetApplicationId);
  const directIdsToCheck = currentPlan.directApplications.map((item) => item.applicationId);
  const [sourceApps, targetApps, directApps, targetProducts, targetWipers, directProducts, directWipers] = await Promise.all([
    selectInChunks("vehicle_catalog_applications", "*", "application_id", sourceIdsToCheck),
    selectInChunks("vehicle_catalog_applications", "*", "application_id", targetIdsToCheck),
    selectInChunks("vehicle_catalog_applications", "*", "application_id", directIdsToCheck),
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", targetIdsToCheck),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", targetIdsToCheck),
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", directIdsToCheck),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", directIdsToCheck),
  ]);
  const sourceStatusOk = sourceApps.length === sourceIdsToCheck.length && sourceApps.every((row) => row.status === "inactive");
  const targetStatusOk = targetApps.length === targetIdsToCheck.length && targetApps.every((row) => row.status === "active");
  const directIdentityOk = currentPlan.directApplications.every((item) => {
    const row = directApps.find((candidate) => candidate.application_id === item.applicationId);
    return row?.model_id === item.targetModelId && row?.series_id === item.seriesId && row?.canonical_key === item.newCanonicalKey && row?.status === "active";
  });
  const targetProductKeys = new Set(targetProducts.map((row) => `${row.application_id}|${productKey(row)}`));
  const productsMerged = currentPlan.mergeApplications.every((item) => item.productsToInsert.every((row) => targetProductKeys.has(`${item.targetApplicationId}|${productKey(row)}`)));
  const targetWiperKeys = new Set(targetWipers.map((row) => `${row.application_id}|${row.wiper_configuration_id}|${row.fitment_status}`));
  const wipersPreserved = currentPlan.mergeApplications.every((item) => item.wipersToInsert.every((row) => targetWiperKeys.has(`${item.targetApplicationId}|${row.wiper_configuration_id}|${row.fitment_status}`)));
  const directChildCountsOk = currentPlan.directApplications.every((item) =>
    directProducts.filter((row) => row.application_id === item.applicationId).length === item.childCounts.products &&
    directWipers.filter((row) => row.application_id === item.applicationId).length === item.childCounts.wipers);
  const activePublishedWipers = targetWipers.filter((row) => row.fitment_status === "published");
  const publishedByTarget = groupBy(activePublishedWipers, (row) => row.application_id);
  const duplicatePublishedTargets = [...publishedByTarget.entries()].filter(([, rows]) => rows.length > 1).map(([applicationId, rows]) => ({ applicationId, rows: rows.length }));
  const ok = sourceStatusOk && targetStatusOk && directIdentityOk && productsMerged && wipersPreserved && directChildCountsOk && duplicatePublishedTargets.length === 0;
  assert(ok, "Post-apply verification failed");
  return { ok, sourceStatusOk, targetStatusOk, directIdentityOk, productsMerged, wipersPreserved, directChildCountsOk, duplicatePublishedTargets };
}

function createBackup(tables) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve(ROOT, "tmp", "production-backups", `vehicle-model-corrections-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { createdAt: new Date().toISOString(), sourceCode: SOURCE_CODE, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const content = JSON.stringify(rows, null, 2);
    const filename = `${name}.json`;
    fs.writeFileSync(path.join(dir, filename), content);
    manifest.tables[name] = { rows: rows.length, file: filename, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

async function upsertRows(table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await db.from(table).upsert(rows.slice(index, index + 100), { onConflict });
    if (error) throw error;
  }
}

async function selectInChunks(table, columns, field, values) {
  if (!values.length) return [];
  const output = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await db.from(table).select(columns).in(field, values.slice(index, index + 100));
    if (error) throw error;
    output.push(...data);
  }
  return output;
}

function stripApplicationRow(row) {
  const { application_id: _applicationId, ...rest } = row;
  return rest;
}

function assertSameApplicationShape(source, target) {
  for (const field of ["variant_id", "powertrain_id", "year_from", "year_to", "year_status"]) {
    assert((source[field] ?? null) === (target[field] ?? null), `Application shape differs on ${field}: ${source.application_id} -> ${target.application_id}`);
  }
}

function productKey(row) {
  return `${row.product_variant_id}|${row.position}`;
}

function provenanceKey(row) {
  return `${row.source_group}|${row.source_url}`;
}

function yearValues(rows = []) {
  return rows.map((row) => Number(row.model_year));
}

function sameSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function appendNote(existing, addition) {
  return [existing, addition].filter(Boolean).join("; ");
}

function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const rows = output.get(key) ?? [];
    rows.push(value);
    output.set(key, rows);
  }
  return output;
}

function required(value, message) {
  if (value === undefined || value === null || value === "") throw new Error(`Missing ${message}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
