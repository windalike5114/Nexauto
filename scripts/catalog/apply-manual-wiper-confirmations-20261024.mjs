import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const REPORT_ONLY = process.argv.includes("--report-only");
if (APPLY === REPORT_ONLY) throw new Error("Choose exactly one of --report-only or --apply.");

const ROOT = process.cwd();
const SOURCE_CODE = "MANUAL_WIPER_CONFIRMATIONS_2026_10_24";
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "wiper-manual-confirmation-apply-20261024");
const SOURCE_WORKBOOK = path.resolve(ROOT, "outputs", "wiper-gap-backfill-processing-20261024", "NexAuto_ManualConfirm_Processed_2026-10-24.xlsx");
const MAZDA_TITAN_SOURCE = "https://www2.mazda.co.jp/service/recall/ima/20120405139/";

const TITAN_CORRECTIONS = [
  ["ap_806f9d996bd751c1faef", "LHR85"],
  ["ap_e8ba39e54f89be90ab5d", "LHS85"],
  ["ap_7484b6b86952373309a3", "LJR85"],
  ["ap_087be6316a68112fc12c", "LJS85"],
  ["ap_a534b556ce75dd8c4ac6", "LKR85"],
  ["ap_4772eb90b64ee2368e14", "LKS85"],
  ["ap_6dc0a0d645beaa2a7947", "LLR85"],
  ["ap_48a017cb7ad04f0f587c", "LLS85"],
  ["ap_84bdd7ecfe368af76f9e", "LMR85"],
  ["ap_39aecdf51bed542dfe4e", "LMS85"],
  ["ap_7e8c48a98bda3146433a", "LNR85"],
  ["ap_06f9c2979eeb64d164ff", "LNS85"],
  ["ap_55e186cc21790579fab5", "LPR85"],
  ["ap_04d28141cd325bb3ddac", "LPS85"],
].map(([applicationId, seriesCode]) => ({ applicationId, seriesCode }));

const DEFERRED = [
  { scope: "Ford Focus", applications: 11, reason: "Application spans multiple generations; 2011 and 2018 boundaries and catalogue length conflicts require deterministic series/VIN splits." },
  { scope: "Nissan Navara", applications: 1, reason: "2025 D23 and 2026 D27 share one application; split is required before a generation-specific fitment can be published." },
  { scope: "Subaru Forester SL9", applications: 1, reason: "Review is low confidence and has no exact SL9 length/adapter source." },
  { scope: "Toyota Hiace KLH12/KLH22", applications: 2, reason: "The reviewed 21/21 claim conflicts with raw WiperTech Hiace configurations and lacks an exact KLH source." },
  { scope: "Toyota Vitz KVP91", applications: 1, reason: "The supplied link does not establish KVP91 -> XP90 identity or the 24/14/12 configuration." },
];

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const data = await loadData();
const prepared = prepare(data);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const planPath = path.join(OUTPUT_DIR, APPLY ? "apply-plan.json" : "report.json");
fs.writeFileSync(planPath, JSON.stringify(prepared.report, null, 2));

let applied = null;
if (APPLY) {
  if (prepared.blockers.length) throw new Error(`Preflight has ${prepared.blockers.length} blocker(s).`);
  applied = await applyPrepared(data, prepared);
  fs.writeFileSync(path.join(OUTPUT_DIR, "applied.json"), JSON.stringify(applied, null, 2));
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "report",
  planPath,
  titanCorrections: prepared.actions.length,
  alreadyCorrect: prepared.actions.filter((row) => row.action === "already_correct").length,
  blockers: prepared.blockers,
  actionSummary: countBy(prepared.actions, (row) => row.action),
  deferred: DEFERRED,
  applied,
}, null, 2));

function prepare(data) {
  const blockers = [];
  const applicationById = new Map(data.applications.map((row) => [row.application_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const targetModels = data.models.filter((row) => upper(row.name) === "TITAN" && upper(makeById.get(row.make_id)?.name) === "MAZDA" && row.status === "active");
  if (targetModels.length !== 1) blockers.push({ reason: "target_model_count", expected: 1, actual: targetModels.length, make: "MAZDA", model: "TITAN" });
  const targetModel = targetModels[0];
  const correctionIds = new Set(TITAN_CORRECTIONS.map((row) => row.applicationId));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const productsByApplication = groupBy(data.products, (row) => row.application_id);
  const wipersByApplication = groupBy(data.wipers, (row) => row.application_id);
  const provenanceByApplication = groupBy(data.provenance, (row) => row.application_id);
  const actions = [];

  for (const decision of TITAN_CORRECTIONS) {
    const source = applicationById.get(decision.applicationId);
    if (!source) {
      blockers.push({ applicationId: decision.applicationId, reason: "missing_application" });
      continue;
    }
    const sourceModel = modelById.get(source.model_id);
    const sourceMake = makeById.get(sourceModel?.make_id);
    const currentSeries = seriesById.get(source.series_id);
    const variant = variantById.get(source.variant_id);
    const identity = {
      make: upper(sourceMake?.name), model: upper(sourceModel?.name), series: upper(currentSeries?.code), body: lower(variant?.body_style), status: source.status,
    };
    if (identity.make !== "MAZDA") blockers.push({ applicationId: source.application_id, reason: "make_mismatch", actual: identity.make });
    if (!["5", "TITAN"].includes(identity.model)) blockers.push({ applicationId: source.application_id, reason: "model_mismatch", actual: identity.model });
    if (identity.series !== decision.seriesCode) blockers.push({ applicationId: source.application_id, reason: "series_mismatch", expected: decision.seriesCode, actual: identity.series });
    if (identity.body !== "cab chassis") blockers.push({ applicationId: source.application_id, reason: "body_mismatch", expected: "cab chassis", actual: identity.body });
    if (!["active", "inactive"].includes(source.status)) blockers.push({ applicationId: source.application_id, reason: "unexpected_application_status", status: source.status });
    if (!yearsByApplication.get(source.application_id)?.length) blockers.push({ applicationId: source.application_id, reason: "missing_application_years" });

    if (targetModel && source.model_id === targetModel.model_id && currentSeries?.model_id === targetModel.model_id) {
      actions.push(baseAction("already_correct", source, currentSeries, targetModel, source.series_id));
      continue;
    }

    const targetSeriesMatches = data.series.filter((row) => row.model_id === targetModel?.model_id && upper(row.code) === decision.seriesCode && row.status === "active");
    if (targetSeriesMatches.length > 1) {
      blockers.push({ applicationId: source.application_id, reason: "multiple_target_series", seriesCode: decision.seriesCode, count: targetSeriesMatches.length });
      continue;
    }

    if (targetSeriesMatches.length === 1) {
      const targetSeries = targetSeriesMatches[0];
      const peer = data.applications.find((row) => row.application_id !== source.application_id && row.status === "active" &&
        row.model_id === targetModel.model_id && row.series_id === targetSeries.series_id && sameShape(row, source));
      if (peer) {
        const commerceReferences = commerceCount(data, source.application_id);
        if (commerceReferences) blockers.push({ applicationId: source.application_id, reason: "commerce_references_require_manual_merge", count: commerceReferences });
        const sourceYears = yearValues(yearsByApplication.get(source.application_id));
        const targetYears = yearValues(yearsByApplication.get(peer.application_id));
        if (!sameSet(sourceYears, targetYears)) blockers.push({ applicationId: source.application_id, reason: "canonical_peer_years_differ", targetApplicationId: peer.application_id, sourceYears, targetYears });
        actions.push({
          ...baseAction(source.status === "inactive" ? "already_merged" : "merge", source, currentSeries, targetModel, targetSeries.series_id),
          targetApplicationId: peer.application_id,
          productsToCopy: source.status === "active" ? productsByApplication.get(source.application_id) ?? [] : [],
          wipersToCopy: source.status === "active" ? wipersByApplication.get(source.application_id) ?? [] : [],
          provenanceToCopy: source.status === "active" ? provenanceByApplication.get(source.application_id) ?? [] : [],
        });
      } else {
        if (source.status !== "active") blockers.push({ applicationId: source.application_id, reason: "inactive_source_without_canonical_peer", status: source.status });
        const newCanonicalKey = canonicalKey(source, targetModel.model_id, targetSeries.series_id);
        const conflict = data.applications.find((row) => row.application_id !== source.application_id && row.canonical_key === newCanonicalKey);
        if (conflict) blockers.push({ applicationId: source.application_id, reason: "canonical_key_conflict", conflictingApplicationId: conflict.application_id });
        actions.push({ ...baseAction("reassign_target_series", source, currentSeries, targetModel, targetSeries.series_id), newCanonicalKey });
      }
      continue;
    }

    const seriesUsers = data.applications.filter((row) => row.series_id === source.series_id && row.status === "active");
    if (source.status !== "active") blockers.push({ applicationId: source.application_id, reason: "inactive_source_without_target_series", status: source.status });
    const unrelatedUsers = seriesUsers.filter((row) => !correctionIds.has(row.application_id));
    if (unrelatedUsers.length) {
      blockers.push({ applicationId: source.application_id, reason: "source_series_shared_with_unrelated_applications", seriesId: source.series_id, applications: unrelatedUsers.map((row) => row.application_id) });
      continue;
    }
    const newCanonicalKey = canonicalKey(source, targetModel?.model_id, source.series_id);
    const conflict = data.applications.find((row) => row.application_id !== source.application_id && row.canonical_key === newCanonicalKey);
    if (conflict) blockers.push({ applicationId: source.application_id, reason: "canonical_key_conflict", conflictingApplicationId: conflict.application_id });
    actions.push({ ...baseAction("move_series_in_place", source, currentSeries, targetModel, source.series_id), newCanonicalKey, seriesUserIds: seriesUsers.map((row) => row.application_id) });
  }

  const duplicateSources = TITAN_CORRECTIONS.map((row) => row.applicationId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateSources.length) blockers.push({ reason: "duplicate_source_decisions", applicationIds: duplicateSources });
  return {
    actions,
    blockers,
    report: {
      generatedAt: new Date().toISOString(), mode: APPLY ? "apply" : "report", sourceCode: SOURCE_CODE, sourceWorkbook: SOURCE_WORKBOOK,
      evidence: { mazdaTitan: MAZDA_TITAN_SOURCE }, actions, blockers, deferred: DEFERRED,
      totals: { titanApplications: actions.length, titanApplicationYears: actions.reduce((sum, row) => sum + row.applicationYears, 0) },
    },
  };
}

async function applyPrepared(data, prepared) {
  const affectedIds = new Set();
  const affectedSeriesIds = new Set();
  for (const action of prepared.actions) {
    affectedIds.add(action.sourceApplicationId);
    if (action.targetApplicationId) affectedIds.add(action.targetApplicationId);
    affectedSeriesIds.add(action.currentSeriesId);
    affectedSeriesIds.add(action.targetSeriesId);
  }
  const affectedApplicationIds = [...affectedIds];
  const backupData = {
    ...data,
    years: await selectInChunks("vehicle_catalog_application_years", "*", "application_id", affectedApplicationIds),
    products: await selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", affectedApplicationIds),
    wipers: await selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", affectedApplicationIds),
    provenance: await selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", affectedApplicationIds),
  };
  const backupDir = createBackup(backupData, affectedApplicationIds, [...affectedSeriesIds]);
  const timestamp = new Date().toISOString();
  const movedSeries = new Set();

  for (const action of prepared.actions) {
    if (action.action === "already_correct") {
      await addProvenance(action.sourceApplicationId, timestamp);
      continue;
    }
    if (action.action === "already_merged") {
      await addProvenance(action.targetApplicationId, timestamp);
      continue;
    }
    if (action.action === "merge") {
      await mergeApplication(action, timestamp);
      continue;
    }
    if (action.action === "move_series_in_place" && !movedSeries.has(action.currentSeriesId)) {
      const { error } = await db.from("vehicle_catalog_series").update({ model_id: action.targetModelId }).eq("series_id", action.currentSeriesId);
      if (error) throw error;
      movedSeries.add(action.currentSeriesId);
    }
    const { error } = await db.from("vehicle_catalog_applications").update({
      model_id: action.targetModelId,
      series_id: action.targetSeriesId,
      canonical_key: action.newCanonicalKey,
      review_status: "approved",
    }).eq("application_id", action.sourceApplicationId).eq("status", "active");
    if (error) throw error;
    await addProvenance(action.sourceApplicationId, timestamp);
  }

  const verification = await verify(prepared.actions);
  return { appliedAt: timestamp, sourceCode: SOURCE_CODE, backupDir, actionSummary: countBy(prepared.actions, (row) => row.action), verification, deferred: DEFERRED };
}

async function mergeApplication(action, timestamp) {
  const [targetProducts, targetWipers, targetProvenance] = await Promise.all([
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", [action.targetApplicationId]),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", [action.targetApplicationId]),
    selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", [action.targetApplicationId]),
  ]);
  const productKeys = new Set(targetProducts.map(productKey));
  const productsToInsert = action.productsToCopy.filter((row) => !productKeys.has(productKey(row))).map((row) => ({ ...stripApplication(row), application_id: action.targetApplicationId, notes: appendNote(row.notes, `${SOURCE_CODE}; moved from ${action.sourceApplicationId}`) }));
  if (productsToInsert.length) await upsertRows("vehicle_catalog_product_fitments", productsToInsert, "application_id,product_variant_id,position");

  const wiperKeys = new Set(targetWipers.map((row) => row.wiper_configuration_id));
  const targetHasPublished = targetWipers.some((row) => row.fitment_status === "published");
  const wipersToInsert = action.wipersToCopy.filter((row) => !wiperKeys.has(row.wiper_configuration_id)).map((row) => ({
    ...stripApplication(row), application_id: action.targetApplicationId,
    fitment_status: targetHasPublished && row.fitment_status === "published" ? "rejected" : row.fitment_status,
    notes: appendNote(row.notes, `${SOURCE_CODE}; moved from ${action.sourceApplicationId}${targetHasPublished ? "; preserved rejected because target already has a published configuration" : ""}`),
  }));
  if (wipersToInsert.length) await upsertRows("vehicle_catalog_wiper_fitments", wipersToInsert, "application_id,wiper_configuration_id");

  const provenanceKeys = new Set(targetProvenance.map(provenanceKey));
  const provenanceToInsert = action.provenanceToCopy.filter((row) => !provenanceKeys.has(provenanceKey(row))).map((row) => ({ ...row, application_id: action.targetApplicationId }));
  if (provenanceToInsert.length) await upsertRows("vehicle_catalog_application_provenance", provenanceToInsert, "application_id,source_group,source_url");
  await addProvenance(action.targetApplicationId, timestamp);
  const { error } = await db.from("vehicle_catalog_applications").update({ status: "inactive", review_status: "approved" }).eq("application_id", action.sourceApplicationId).eq("status", "active");
  if (error) throw error;
}

async function addProvenance(applicationId, timestamp) {
  const row = { application_id: applicationId, source_group: SOURCE_CODE, source_url: MAZDA_TITAN_SOURCE, raw_record_count: 1, first_collected_at: timestamp, last_collected_at: timestamp };
  const { error } = await db.from("vehicle_catalog_application_provenance").upsert(row, { onConflict: "application_id,source_group,source_url" });
  if (error) throw error;
}

async function verify(actions) {
  const targetIds = actions.map((row) => ["merge", "already_merged"].includes(row.action) ? row.targetApplicationId : row.sourceApplicationId);
  const sourceMergeIds = actions.filter((row) => ["merge", "already_merged"].includes(row.action)).map((row) => row.sourceApplicationId);
  const [applications, models, makes, series, provenance, publishedWipers, mergeSources] = await Promise.all([
    selectInChunks("vehicle_catalog_applications", "*", "application_id", targetIds),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,model_id,code,status"),
    selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", targetIds),
    fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status", (query) => query.eq("fitment_status", "published")),
    selectInChunks("vehicle_catalog_applications", "application_id,status", "application_id", sourceMergeIds),
  ]);
  const modelById = new Map(models.map((row) => [row.model_id, row]));
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(series.map((row) => [row.series_id, row]));
  const identityFailures = applications.filter((row) => {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const itemSeries = seriesById.get(row.series_id);
    return row.status !== "active" || upper(make?.name) !== "MAZDA" || upper(model?.name) !== "TITAN" || itemSeries?.model_id !== model?.model_id;
  }).map((row) => row.application_id);
  const missingProvenance = targetIds.filter((id) => !provenance.some((row) => row.application_id === id && row.source_group === SOURCE_CODE));
  const mergeSourcesStillActive = mergeSources.filter((row) => row.status !== "inactive").map((row) => row.application_id);
  const duplicatePublished = [...groupBy(publishedWipers, (row) => row.application_id).entries()].filter(([, rows]) => rows.length > 1).map(([applicationId, rows]) => ({ applicationId, count: rows.length }));
  const ok = applications.length === new Set(targetIds).size && identityFailures.length === 0 && missingProvenance.length === 0 && mergeSourcesStillActive.length === 0 && duplicatePublished.length === 0;
  if (!ok) throw new Error("Post-apply verification failed.");
  return { ok, targetApplications: new Set(targetIds).size, identityFailures, missingProvenance, mergeSourcesStillActive, duplicatePublished };
}

function baseAction(action, source, currentSeries, targetModel, targetSeriesId) {
  return {
    action,
    sourceApplicationId: source.application_id,
    sourceStatus: source.status,
    currentModelId: source.model_id,
    currentSeriesId: source.series_id,
    seriesCode: currentSeries?.code,
    targetModelId: targetModel?.model_id,
    targetSeriesId,
    yearFrom: source.year_from,
    yearTo: source.year_to,
    applicationYears: Number(source.year_to) - Number(source.year_from) + 1,
  };
}

function createBackup(data, applicationIds, seriesIds) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp", "production-backups", `manual-wiper-confirmations-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const tables = {
    vehicle_catalog_applications: data.applications.filter((row) => applicationIds.includes(row.application_id) || seriesIds.includes(row.series_id)),
    vehicle_catalog_application_years: data.years.filter((row) => applicationIds.includes(row.application_id)),
    vehicle_catalog_series: data.series.filter((row) => seriesIds.includes(row.series_id)),
    vehicle_catalog_product_fitments: data.products.filter((row) => applicationIds.includes(row.application_id)),
    vehicle_catalog_wiper_fitments: data.wipers.filter((row) => applicationIds.includes(row.application_id)),
    vehicle_catalog_application_provenance: data.provenance.filter((row) => applicationIds.includes(row.application_id)),
    customer_vehicles: data.customerVehicles,
    order_items: data.orderItems,
    order_vehicle_snapshots: data.orderSnapshots,
    order_wiper_fulfillment: data.orderWipers,
  };
  const manifest = { createdAt: new Date().toISOString(), sourceCode: SOURCE_CODE, sourceWorkbook: SOURCE_WORKBOOK, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const content = JSON.stringify(rows, null, 2);
    const filename = `${name}.json`;
    fs.writeFileSync(path.join(directory, filename), content);
    manifest.tables[name] = { rows: rows.length, file: filename, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

async function loadData() {
  const sourceIds = TITAN_CORRECTIONS.map((row) => row.applicationId);
  const [applications, years, variants, series, models, makes, products, wipers, provenance, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "*"),
    fetchAll("vehicle_catalog_application_years", "*"),
    fetchAll("vehicle_catalog_variants", "variant_id,body_style,display_name"),
    fetchAll("vehicle_catalog_series", "*"),
    fetchAll("vehicle_catalog_models", "*"),
    fetchAll("vehicle_catalog_makes", "*"),
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", sourceIds),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", sourceIds),
    selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", sourceIds),
    selectInChunks("customer_vehicles", "*", "vehicle_catalog_application_id", sourceIds),
    selectInChunks("order_items", "*", "vehicle_catalog_application_id", sourceIds),
    selectInChunks("order_vehicle_snapshots", "*", "vehicle_catalog_application_id", sourceIds),
    selectInChunks("order_wiper_fulfillment", "*", "vehicle_catalog_application_id", sourceIds),
  ]);
  return { applications, years, variants, series, models, makes, products, wipers, provenance, customerVehicles, orderItems, orderSnapshots, orderWipers };
}

function commerceCount(data, applicationId) {
  return data.customerVehicles.filter((row) => row.vehicle_catalog_application_id === applicationId).length +
    data.orderItems.filter((row) => row.vehicle_catalog_application_id === applicationId).length +
    data.orderSnapshots.filter((row) => row.vehicle_catalog_application_id === applicationId).length +
    data.orderWipers.filter((row) => row.vehicle_catalog_application_id === applicationId).length;
}

function canonicalKey(source, modelId, seriesId) { return [modelId, seriesId, source.variant_id, source.powertrain_id, source.year_from, source.year_to].join("|"); }
function sameShape(left, right) { return ["variant_id", "powertrain_id", "year_from", "year_to", "year_status"].every((field) => (left[field] ?? null) === (right[field] ?? null)); }
function productKey(row) { return `${row.product_variant_id}|${row.position}`; }
function provenanceKey(row) { return `${row.source_group}|${row.source_url}`; }
function stripApplication(row) { const { application_id: _applicationId, ...rest } = row; return rest; }
function appendNote(existing, addition) { return [existing, addition].filter(Boolean).join("; "); }
function yearValues(rows = []) { return rows.map((row) => Number(row.model_year)); }
function sameSet(left, right) { return left.length === right.length && left.every((value) => right.includes(value)); }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function lower(value) { return String(value ?? "").trim().toLowerCase(); }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { return Object.fromEntries([...groupBy(values, keyFn)].map(([key, rows]) => [key, rows.length])); }

async function upsertRows(table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await db.from(table).upsert(rows.slice(index, index + 100), { onConflict });
    if (error) throw error;
  }
}

async function fetchAll(table, columns, transform = (query) => query) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await transform(db.from(table).select(columns).range(from, from + 999));
    if (error) throw error;
    output.push(...data);
    if (data.length < 1000) return output;
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

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
