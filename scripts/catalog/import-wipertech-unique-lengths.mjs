import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { prepareWiperTechPublication, inspectProduction } from "./publish-wipertech-fitments.mjs";
import { APPROVED_FRONT_WIPER_LENGTHS, APPROVED_REAR_WIPER_LENGTHS, isValidSourceWiperLength } from "./wipertech-direct-matcher.mjs";

const SOURCE_CODE = "WIPERTECH_AUTHORITATIVE_LENGTH_2026_10_23";
const SOURCE_FILE = "C:/Users/Sanli/Desktop/database/wipertech/wipertech_可填入_长度唯一.csv";
const OUTPUT_DIR = path.resolve("outputs/wipertech-unique-length-import-20261023");

if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) throw new Error("Choose --report-only or --apply.");
loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const sourceRows = readCsv(SOURCE_FILE);
const { records, validation } = buildUniqueLengthRecords(sourceRows);
const sourceSummary = { uniqueLengthRows: sourceRows.length, validRecords: records.length, sourceFile: SOURCE_FILE };
const prepared = prepareWiperTechPublication({
  sourceRecords: records,
  sourceSummary,
  allowPartialConfigurations: true
});
const inspection = await inspectProduction(db, prepared, { authoritative: true, requirePurchasablePair: false });
preserveCurrentRearWhenFrontStillMatches(inspection);
const report = buildReport(prepared, inspection, validation);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "wipertech_unique_length_import_report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--apply")) {
  const result = await apply(db, inspection, report);
  fs.writeFileSync(path.join(OUTPUT_DIR, "wipertech_unique_length_import_applied.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}

function buildUniqueLengthRecords(rows) {
  const records = [];
  const skipped = [];
  const partialFront = [];
  const rearOnly = [];
  const nonCommerceFront = [];
  const nonCommerceRear = [];
  const contextConfigurations = new Map();
  for (const [index, row] of rows.entries()) {
    const rawDriver = numberOrNull(row.front_driver_size);
    const rawPassenger = numberOrNull(row.front_passenger_size);
    const rawRear = numberOrNull(row.rear_size);
    const driver = isValidSourceWiperLength(rawDriver) ? rawDriver : null;
    const passenger = isValidSourceWiperLength(rawPassenger) ? rawPassenger : null;
    const rear = isValidSourceWiperLength(rawRear) ? rawRear : null;
    const yearStart = numberOrNull(row.year_from);
    const yearEnd = numberOrNull(row.year_to);
    const reasons = [];
    if (!yearStart || !yearEnd || yearStart > yearEnd) reasons.push("invalid_year_range");
    if (!String(row.make ?? "").trim() || !String(row.model ?? "").trim()) reasons.push("missing_make_or_model");
    if (driver === null && passenger === null && rear === null) reasons.push("no_valid_length_positions");
    if (rawDriver !== null && driver === null) reasons.push("invalid_driver_length");
    if (rawPassenger !== null && passenger === null) reasons.push("invalid_passenger_length");
    if (rawRear !== null && rear === null) reasons.push("invalid_rear_length");
    if (reasons.length) {
      skipped.push({ rowNumber: index + 2, reasons, row });
      continue;
    }
    if (driver === null || passenger === null) partialFront.push(index + 2);
    if (driver === null && passenger === null && rear !== null) rearOnly.push(index + 2);
    if ((driver !== null && !APPROVED_FRONT_WIPER_LENGTHS.has(driver)) || (passenger !== null && !APPROVED_FRONT_WIPER_LENGTHS.has(passenger))) nonCommerceFront.push(index + 2);
    if (rear !== null && !APPROVED_REAR_WIPER_LENGTHS.has(rear)) nonCommerceRear.push(index + 2);
    const contextKey = [row.make, row.model, row.chassis, row.body, yearStart, yearEnd].map((value) => String(value ?? "").trim().toLowerCase()).join("|");
    const configurationKey = `${driver ?? "-"}/${passenger ?? "-"}/${rear ?? "-"}`;
    const configurations = contextConfigurations.get(contextKey) ?? new Set();
    configurations.add(configurationKey);
    contextConfigurations.set(contextKey, configurations);
    records.push({
      vehicleId: `unique_row_${index + 2}`,
      make: String(row.make).trim(),
      model: String(row.model).trim(),
      series: String(row.chassis ?? "").trim(),
      body: String(row.body ?? "").trim(),
      yearStart,
      yearEnd,
      positions: {
        driver: { sizeInch: driver, sku: String(row.front_driver_blade ?? "").trim() },
        passenger: { sizeInch: passenger, sku: String(row.front_passenger_blade ?? "").trim() },
        rear: rear === null ? null : { sizeInch: rear, sku: String(row.rear_blade ?? "").trim() }
      }
    });
  }
  const conflicts = [...contextConfigurations.entries()].filter(([, values]) => values.size > 1)
    .map(([contextKey, values]) => ({ contextKey, configurations: [...values] }));
  if (conflicts.length) throw new Error(`Unique-length source contains ${conflicts.length} same-context length conflicts.`);
  return {
    records,
    validation: {
      acceptedRows: records.length,
      skippedInvalidRows: skipped.length,
      partialFrontRowsRetained: partialFront.length,
      rearOnlyRowsRetained: rearOnly.length,
      rowsWithNonCommerceFrontLengthsRetained: nonCommerceFront.length,
      rowsWithNonCommerceRearLengthsRetained: nonCommerceRear.length,
      contextConflicts: conflicts.length,
      skippedReasonCounts: countBy(skipped.flatMap((item) => item.reasons.map((reason) => ({ reason }))), (item) => item.reason)
    }
  };
}

function buildReport(prepared, inspection, validation) {
  const beforeIds = new Set(inspection.currentPublished.map((row) => row.application_id));
  const additions = inspection.publishable.filter((row) => !beforeIds.has(row.applicationId));
  const replacements = inspection.publishable.filter((row) => {
    const current = inspection.currentConfigurationByApplication.get(row.applicationId);
    return current && current !== row.configurationKey;
  });
  const corroborated = inspection.publishable.filter((row) => inspection.currentConfigurationByApplication.get(row.applicationId) === row.configurationKey).length;
  return {
    source: prepared.source,
    validation,
    productionBefore: { publishedApplications: beforeIds.size, publishedRows: inspection.currentPublished.length },
    matching: {
      highConfidenceCandidates: prepared.publishCandidates.length,
      publishableApplications: inspection.publishable.length,
      corroboratedExistingApplications: corroborated,
      newlyCoveredApplications: additions.length,
      authoritativeReplacements: replacements.length,
      replacementChanges: countBy(replacements, (row) => classifyReplacement(inspection.currentConfigurationByApplication.get(row.applicationId), row.configurationKey)),
      newlyCoveredConfigurationTypes: countBy(additions, (row) => classifyConfiguration(row.configurationKey)),
      protectedExistingConflicts: inspection.conflictReviews.length,
      protectedExistingRearConflicts: 0,
      sellablePairMissing: inspection.commerceReviews.length,
      unresolvedApplications: prepared.reviews.length,
      rules: countBy(inspection.publishable, (row) => row.rule),
      unresolvedReasons: countBy(prepared.reviews, (row) => row.reason)
    }
  };
}

function classifyReplacement(currentKey, nextKey) {
  const current = String(currentKey).split("/");
  const next = String(nextKey).split("/");
  if (current.slice(0, 2).join("/") !== next.slice(0, 2).join("/")) return "front_changed";
  if (current[2] !== "-" && next[2] === "-") return "rear_removed_as_ambiguous_or_missing";
  if (current[2] === "-" && next[2] !== "-") return "rear_added";
  if (current[2] !== next[2]) return "rear_changed";
  return "other";
}
function classifyConfiguration(key) {
  const [driver, passenger, rear] = String(key).split("/");
  if (driver === "-" && passenger === "-" && rear !== "-") return "rear_only";
  if (driver === "-" || passenger === "-") return "partial_front";
  return rear === "-" ? "complete_front_no_rear" : "complete_front_with_rear";
}

function preserveCurrentRearWhenFrontStillMatches(inspection) {
  inspection.publishable = inspection.publishable.map((row) => {
    if (row.rearLengthIn !== null) return row;
    const currentKey = inspection.currentConfigurationByApplication.get(row.applicationId);
    if (!currentKey) return row;
    const [currentDriver, currentPassenger, currentRear] = currentKey.split("/");
    if (`${currentDriver}/${currentPassenger}` !== row.frontKey || currentRear === "-") return row;
    return {
      ...row,
      rearLengthIn: Number(currentRear),
      configurationKey: `${row.frontKey}/${currentRear}`,
      rearResolution: "preserved_current_when_wipertech_rear_undetermined"
    };
  });
}

async function apply(client, inspection, report) {
  const backupDir = await writeBackup(client);
  const configurationByKey = new Map(inspection.configurations.map((row) => [row.configuration_key, row.id]));
  for (const row of inspection.publishable) {
    if (configurationByKey.has(row.configurationKey)) continue;
    const { data, error } = await client.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: row.driverLengthIn,
      p_passenger_length_in: row.passengerLengthIn,
      p_rear_length_in: row.rearLengthIn
    });
    if (error) throw error;
    configurationByKey.set(row.configurationKey, data);
  }
  const applicationIds = inspection.publishable.map((row) => row.applicationId);
  for (const ids of chunks(applicationIds, 200)) {
    const { error } = await client.from("vehicle_catalog_wiper_fitments")
      .update({ fitment_status: "review", updated_at: new Date().toISOString() })
      .in("application_id", ids).eq("fitment_status", "published");
    if (error) throw error;
  }
  const payload = inspection.publishable.map((row) => ({
    application_id: row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: `source=wipertech_可填入_长度唯一.csv; authority=wipertech; rule=${row.rule}; confidence=${row.confidence}; commerce_independent=true; source_rows=${row.sourceVehicleIds.join(",")}`,
    updated_at: new Date().toISOString()
  }));
  for (const rows of chunks(payload, 200)) {
    const { error } = await client.from("vehicle_catalog_wiper_fitments").upsert(rows, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
  const configurationIds = [...new Set(payload.map((row) => row.wiper_configuration_id))];
  for (const ids of chunks(configurationIds, 200)) {
    const { error } = await client.from("wiper_configurations").update({ configuration_status: "published" }).in("id", ids);
    if (error) throw error;
  }
  const published = [];
  for (const ids of chunks(applicationIds, 200)) {
    const { data, error } = await client.from("vehicle_catalog_wiper_fitments")
      .select("application_id,wiper_configuration_id,fitment_status,source").in("application_id", ids).eq("fitment_status", "published");
    if (error) throw error;
    published.push(...data);
  }
  const byApplication = groupBy(published, (row) => row.application_id);
  const duplicates = [...byApplication.values()].filter((rows) => rows.length !== 1);
  if (published.length !== applicationIds.length || duplicates.length) throw new Error(`Verification failed: published=${published.length}/${applicationIds.length}, duplicates=${duplicates.length}`);
  const { count, error } = await client.from("vehicle_catalog_wiper_fitments").select("*", { count: "exact", head: true }).eq("fitment_status", "published");
  if (error) throw error;
  return {
    appliedAt: new Date().toISOString(),
    backupDir,
    importedApplications: payload.length,
    newlyCoveredApplications: report.matching.newlyCoveredApplications,
    replacedExistingApplications: report.matching.authoritativeReplacements,
    totalPublishedApplications: count,
    duplicatePublishedApplications: 0,
    missingApplications: 0
  };
}

async function writeBackup(client) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `wipertech-unique-length-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const table of ["vehicle_catalog_wiper_fitments", "wiper_configurations", "wiper_configuration_blades"]) {
    fs.writeFileSync(path.join(directory, `${table}.json`), JSON.stringify(await fetchAll(client, table, "*"), null, 2));
  }
  return directory;
}

function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function numberOrNull(value) { if (value === "" || value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function countBy(rows, keyFn) { const output = {}; for (const row of rows) { const key = keyFn(row); output[key] = (output[key] ?? 0) + 1; } return output; }
function groupBy(rows, keyFn) { const result = new Map(); for (const row of rows) { const key = keyFn(row); const values = result.get(key) ?? []; values.push(row); result.set(key, values); } return result; }
function chunks(rows, size) { const result = []; for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size)); return result; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
async function fetchAll(client, table, columns) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await client.from(table).select(columns).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
