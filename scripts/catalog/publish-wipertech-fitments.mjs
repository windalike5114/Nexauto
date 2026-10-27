import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { buildWiperTechRecords } from "./enrich-wipertech-fitments.mjs";
import { canonicalModelKey, resolveWiperTechApplication, resolveWiperTechPartialApplication } from "./wipertech-direct-matcher.mjs";
import { EXPANDED_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

export const SOURCE_CODE = "WIPERTECH_DIRECT_2026_10_22";
const DEFAULT_SOURCE_DIR = "C:/Users/Sanli/Desktop/database/wipertech";
const DEFAULT_CATALOG_DIR = "C:/Users/Sanli/Documents/Codex/2026-10-21/referenced-chatgpt-conversation-this-is-an/outputs/NexAutoParts_车型库数据包/nexautoparts_vehicle_database";
const DEFAULT_OUTPUT_DIR = "outputs/wipertech-enrichment-20261022";
const POPULAR_INDEX = buildPopularAliasIndex(EXPANDED_POPULAR_VEHICLE_GROUPS);

export function prepareWiperTechPublication({ sourceDir = DEFAULT_SOURCE_DIR, catalogDir = DEFAULT_CATALOG_DIR, currentFrontByApplication = new Map(), sourceRecords = null, sourceSummary = null, allowPartialConfigurations = false } = {}) {
  let records;
  let source;
  if (sourceRecords) {
    records = sourceRecords;
    source = sourceSummary ?? { vehicles: sourceRecords.length, products: null, mappings: null };
  } else {
    const vehicles = readCsv(path.join(sourceDir, "wipertech_vehicles.csv"));
    const products = readCsv(path.join(sourceDir, "wipertech_wipers.csv"));
    const mappings = readCsv(path.join(sourceDir, "wipertech_mapping.csv"));
    const built = buildWiperTechRecords(vehicles, products, mappings);
    if (built.anomalies.length) throw new Error(`WiperTech contains ${built.anomalies.length} conflicting vehicle-position mappings.`);
    records = built.records;
    source = { vehicles: vehicles.length, products: products.length, mappings: mappings.length };
  }

  const makes = byId(readCsv(path.join(catalogDir, "make.csv")), "make_id");
  const models = byId(readCsv(path.join(catalogDir, "model.csv")), "model_id");
  const series = byId(readCsv(path.join(catalogDir, "series.csv")), "series_id");
  const variants = byId(readCsv(path.join(catalogDir, "variant.csv")), "variant_id");
  const yearsByApplication = groupBy(readCsv(path.join(catalogDir, "application_year.csv")), (row) => row.application_id);
  const applications = readCsv(path.join(catalogDir, "vehicle_application.csv"))
    .filter((row) => row.status === "active")
    .map((row) => {
      const model = models.get(row.model_id);
      const make = makes.get(model?.make_id);
      const generation = series.get(row.series_id);
      const variant = variants.get(row.variant_id);
      return {
        applicationId: row.application_id,
        make: make?.name ?? "",
        model: model?.name ?? "",
        seriesCode: generation?.code ?? "",
        seriesName: generation?.display_name ?? "",
        variantName: variant?.display_name ?? "",
        bodyStyle: variant?.body_style ?? "",
        years: (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year)),
        currentFrontKey: currentFrontByApplication.get(row.application_id) ?? null
      };
    });

  const sourceByModel = groupBy(records, (row) => canonicalModelKey(row.make, row.model));
  const publishCandidates = [];
  const reviews = [];
  const resolver = allowPartialConfigurations ? resolveWiperTechPartialApplication : resolveWiperTechApplication;
  for (const application of applications) {
    const decision = resolver(application, sourceByModel.get(canonicalModelKey(application.make, application.model)) ?? []);
    const compactApplication = { ...application };
    if (decision.status === "published") {
      publishCandidates.push({
        ...compactApplication,
        configurationKey: decision.configurationKey,
        frontKey: decision.frontKey,
        driverLengthIn: decision.driverLengthIn,
        passengerLengthIn: decision.passengerLengthIn,
        rearLengthIn: decision.rearLengthIn,
        rule: decision.rule,
        confidence: decision.confidence,
        sourceVehicleIds: decision.sourceVehicleIds
      });
    } else {
      reviews.push({
        ...compactApplication,
        reason: decision.reason,
        missingYears: decision.missingYears ?? [],
        candidateFrontKeys: decision.candidateFrontKeys ?? [],
        candidateConfigurationKeys: decision.candidateConfigurationKeys ?? [],
        candidateVehicleIds: decision.candidateVehicleIds ?? []
      });
    }
  }
  return { applications, publishCandidates, reviews, source };
}

export async function inspectProduction(db, prepared, { authoritative = false, requirePurchasablePair = true } = {}) {
  const [fitments, configurations, wiperSets, productionApplications] = await Promise.all([
    fetchAll(db, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes,created_at,updated_at"),
    fetchAll(db, "wiper_configurations", "id,configuration_key,configuration_status,rear_status,name,notes,created_at,updated_at"),
    fetchAll(db, "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"),
    fetchAll(db, "vehicle_catalog_applications", "application_id,status")
  ]);
  const configurationById = new Map(configurations.map((row) => [row.id, row]));
  const currentPublished = fitments.filter((row) => row.fitment_status === "published");
  const currentFrontByApplication = new Map();
  const currentConfigurationByApplication = new Map();
  for (const row of currentPublished) {
    const key = configurationById.get(row.wiper_configuration_id)?.configuration_key;
    if (key) {
      currentFrontByApplication.set(row.application_id, key.split("/").slice(0, 2).join("/"));
      currentConfigurationByApplication.set(row.application_id, key);
    }
  }
  const purchasablePairs = new Set(wiperSets.filter(isPurchasableFrontPair).map((row) => commercePairKey(row.driver_length_in, row.passenger_length_in)));
  const activeProductionApplicationIds = new Set(productionApplications.filter((row) => row.status === "active").map((row) => row.application_id));
  const missingProductionApplications = prepared.publishCandidates.filter((row) => !activeProductionApplicationIds.has(row.applicationId));
  if (missingProductionApplications.length) throw new Error(`${missingProductionApplications.length} WiperTech candidates do not exist as active production applications.`);
  const publishable = [];
  const commerceReviews = [];
  const conflictReviews = [];
  for (const row of prepared.publishCandidates) {
    const currentFrontKey = currentFrontByApplication.get(row.applicationId);
    if (!authoritative && currentFrontKey && currentFrontKey !== row.frontKey) conflictReviews.push({ ...row, reason: "published_front_conflict", currentFrontKey });
    else if (!requirePurchasablePair || purchasablePairs.has(commercePairKey(row.driverLengthIn, row.passengerLengthIn))) publishable.push(row);
    else commerceReviews.push({ ...row, reason: "sellable_front_pair_missing" });
  }
  return { fitments, configurations, wiperSets, currentPublished, currentFrontByApplication, currentConfigurationByApplication, purchasablePairs, publishable, commerceReviews, conflictReviews, productionApplications };
}

async function applyPublication(db, prepared, inspection, outputDir) {
  const backupDir = await writeProductionBackup(db);
  const configurationByKey = new Map(inspection.configurations.map((row) => [row.configuration_key, row.id]));
  for (const row of inspection.publishable) {
    if (configurationByKey.has(row.configurationKey)) continue;
    const { data, error } = await db.rpc("upsert_wiper_configuration", {
      p_driver_length_in: row.driverLengthIn,
      p_passenger_length_in: row.passengerLengthIn,
      p_rear_length_in: row.rearLengthIn
    });
    if (error) throw error;
    configurationByKey.set(row.configurationKey, data);
  }

  const applicationIds = inspection.publishable.map((row) => row.applicationId);
  for (const ids of chunks(applicationIds, 200)) {
    const { error } = await db.from("vehicle_catalog_wiper_fitments")
      .update({ fitment_status: "review", updated_at: new Date().toISOString() })
      .in("application_id", ids).eq("fitment_status", "published");
    if (error) throw error;
  }

  const payload = inspection.publishable.map((row) => ({
    application_id: row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: `rule=${row.rule}; confidence=${row.confidence}; WiperTech vehicle IDs=${row.sourceVehicleIds.join(",")}`,
    updated_at: new Date().toISOString()
  }));
  await upsertRows(db, "vehicle_catalog_wiper_fitments", payload, "application_id,wiper_configuration_id");

  const publishedConfigurationIds = [...new Set(payload.map((row) => row.wiper_configuration_id))];
  for (const ids of chunks(publishedConfigurationIds, 200)) {
    const { error } = await db.from("wiper_configurations").update({ configuration_status: "published" }).in("id", ids);
    if (error) throw error;
  }

  const allReviews = [...prepared.reviews, ...inspection.commerceReviews, ...inspection.conflictReviews];
  await replaceReviewQueue(db, allReviews);
  const verification = await verifyProduction(db, applicationIds, payload);
  fs.writeFileSync(path.join(outputDir, "wipertech_publication_applied.json"), JSON.stringify({ appliedAt: new Date().toISOString(), backupDir, verification }, null, 2));
  return { backupDir, verification };
}

async function replaceReviewQueue(db, reviews) {
  const { error: dismissError } = await db.from("fitment_review_queue")
    .update({ review_status: "dismissed", resolution_notes: `Superseded by ${SOURCE_CODE}`, reviewed_at: new Date().toISOString() })
    .like("issue_type", "wipertech_direct_%").in("review_status", ["open", "in_progress"]);
  if (dismissError) throw dismissError;
  const groups = groupBy(reviews, (row) => `${row.reason}|${canonicalModelKey(row.make, row.model)}`);
  const queueRows = [...groups.values()].map((rows) => ({
    issue_type: `wipertech_direct_${rows[0].reason}`,
    severity: rows[0].reason === "multiple_front_configurations" ? "warning" : "info",
    review_status: "open",
    summary: `${rows[0].make} ${rows[0].model}: ${rows.length} applications require ${rows[0].reason}`,
    payload: {
      source: SOURCE_CODE,
      make: rows[0].make,
      model: rows[0].model,
      reason: rows[0].reason,
      application_count: rows.length,
      applications: rows.slice(0, 100).map(compactReviewRow),
      truncated: rows.length > 100
    }
  }));
  await insertRows(db, "fitment_review_queue", queueRows);
}

async function verifyProduction(db, intendedApplicationIds, payload) {
  const rows = [];
  for (const ids of chunks(intendedApplicationIds, 200)) {
    const { data, error } = await db.from("vehicle_catalog_wiper_fitments")
      .select("application_id,wiper_configuration_id,fitment_status,source").in("application_id", ids);
    if (error) throw error;
    rows.push(...data);
  }
  const published = rows.filter((row) => row.fitment_status === "published");
  const byApplication = groupBy(published, (row) => row.application_id);
  const duplicates = [...byApplication.entries()].filter(([, values]) => values.length !== 1).map(([applicationId, values]) => ({ applicationId, count: values.length }));
  const publishedKeys = new Set(published.map((row) => `${row.application_id}|${row.wiper_configuration_id}`));
  const missing = payload.filter((row) => !publishedKeys.has(`${row.application_id}|${row.wiper_configuration_id}`));
  if (duplicates.length || missing.length) throw new Error(`Production verification failed: duplicates=${duplicates.length}, missing=${missing.length}`);
  const { count, error } = await db.from("vehicle_catalog_wiper_fitments").select("*", { count: "exact", head: true }).eq("fitment_status", "published");
  if (error) throw error;
  return { intendedApplications: intendedApplicationIds.length, verifiedPublished: published.length, totalPublished: count, duplicateApplications: 0, missingApplications: 0 };
}

async function writeProductionBackup(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp", "production-backups", `wipertech-direct-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const tables = ["vehicle_catalog_wiper_fitments", "wiper_configurations", "wiper_configuration_blades", "fitment_review_queue"];
  for (const table of tables) {
    const rows = await fetchAll(db, table, "*");
    fs.writeFileSync(path.join(directory, `${table}.json`), JSON.stringify(rows, null, 2));
  }
  return directory;
}

function buildReport(prepared, inspection) {
  const publishableIds = new Set(inspection.publishable.map((row) => row.applicationId));
  const beforeIds = new Set(inspection.currentPublished.map((row) => row.application_id));
  const afterIds = new Set([...beforeIds, ...publishableIds]);
  const rules = countBy(inspection.publishable, (row) => row.rule);
  const allReviews = [...prepared.reviews, ...inspection.commerceReviews, ...inspection.conflictReviews];
  const reviewReasons = countBy(allReviews, (row) => row.reason);
  const additions = inspection.publishable.filter((row) => !beforeIds.has(row.applicationId));
  return {
    source: prepared.source,
    catalogue: { activeApplications: prepared.applications.length },
    matching: {
      highConfidenceCandidates: prepared.publishCandidates.length,
      publishableApplications: inspection.publishable.length,
      corroboratedExistingApplications: inspection.publishable.length - additions.length,
      newlyCoveredApplications: additions.length,
      protectedExistingConflicts: inspection.conflictReviews.length,
      reviewApplications: allReviews.length,
      rules,
      reviewReasons
    },
    productionBefore: { publishedApplications: beforeIds.size, publishedRows: inspection.currentPublished.length, purchasablePairs: inspection.purchasablePairs.size },
    popularCoverage2015To2026: {
      before: coverage(prepared.applications, beforeIds),
      after: coverage(prepared.applications, afterIds)
    }
  };
}

function coverage(applications, publishedIds) {
  const byModelYear = new Map();
  for (const application of applications) {
    const key = canonicalModelKey(application.make, application.model);
    const popularGroup = POPULAR_INDEX.get(key);
    if (!popularGroup) continue;
    for (const year of application.years.filter((item) => item >= 2015 && item <= 2026)) {
      const groupKey = `${popularGroup.id}|${year}`;
      const ids = byModelYear.get(groupKey) ?? new Set();
      ids.add(application.applicationId);
      byModelYear.set(groupKey, ids);
    }
  }
  let any = 0, full = 0, applicationYears = 0, publishedApplicationYears = 0;
  const missingModelYears = [];
  for (const [modelYear, ids] of byModelYear) {
    const published = [...ids].filter((id) => publishedIds.has(id)).length;
    any += Number(published > 0);
    full += Number(published === ids.size);
    applicationYears += ids.size;
    publishedApplicationYears += published;
    if (published === 0) missingModelYears.push(modelYear);
  }
  return {
    modelYears: byModelYear.size,
    anyPublishedModelYears: any,
    anyPublishedPercent: percent(any, byModelYear.size),
    fullyPublishedModelYears: full,
    fullyPublishedPercent: percent(full, byModelYear.size),
    applicationYears,
    publishedApplicationYears,
    applicationYearPercent: percent(publishedApplicationYears, applicationYears),
    missingModelYears
  };
}

function currentFrontMap(inspection) { return inspection.currentFrontByApplication; }
function isPurchasableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function commercePairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function compactReviewRow(row) { return { application_id: row.applicationId, years: row.years, series: row.seriesCode, variant: row.variantName, body_style: row.bodyStyle, current_front: row.currentFrontKey, candidates: row.candidateFrontKeys ?? [row.frontKey].filter(Boolean), missing_years: row.missingYears ?? [], source_vehicle_ids: row.candidateVehicleIds ?? row.sourceVehicleIds ?? [] }; }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(1)) : 0; }
function countBy(rows, keyFn) { const out = {}; for (const row of rows) { const key = keyFn(row); out[key] = (out[key] ?? 0) + 1; } return out; }
function groupBy(rows, keyFn) { const result = new Map(); for (const row of rows) { const key = keyFn(row); const group = result.get(key) ?? []; group.push(row); result.set(key, group); } return result; }
function byId(rows, key) { return new Map(rows.map((row) => [row[key], row])); }
function chunks(rows, size) { const result = []; for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size)); return result; }
function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }

async function fetchAll(db, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}
async function insertRows(db, table, rows) { for (const chunk of chunks(rows, 200)) { const { error } = await db.from(table).insert(chunk); if (error) throw error; } }
async function upsertRows(db, table, rows, onConflict) { for (const chunk of chunks(rows, 200)) { const { error } = await db.from(table).upsert(chunk, { onConflict }); if (error) throw error; } }

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) throw new Error("Choose --report-only or --apply.");
  loadEnv(path.resolve(".env.local"));
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const initial = prepareWiperTechPublication();
  const initialInspection = await inspectProduction(db, initial);
  const prepared = prepareWiperTechPublication({ currentFrontByApplication: currentFrontMap(initialInspection) });
  const inspection = await inspectProduction(db, prepared);
  const report = buildReport(prepared, inspection);
  const outputDir = path.resolve(DEFAULT_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "wipertech_publication_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--apply")) {
    const result = await applyPublication(db, prepared, inspection, outputDir);
    console.log(JSON.stringify({ applied: true, ...result }, null, 2));
  }
}
