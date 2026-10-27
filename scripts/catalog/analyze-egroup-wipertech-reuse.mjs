import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { prepareWiperTechPublication, inspectProduction } from "./publish-wipertech-fitments.mjs";

const ROOT = process.cwd();
const SOURCE_DIR = "C:/Users/Sanli/Desktop/database/wipertech";
const CATALOG_DIR = path.join(ROOT, "outputs", "vehicle-library-egroup-20261024", "package");
const OUTPUT_DIR = path.join(ROOT, "outputs", "egroup-fitment-reuse-20261024", "wipertech");
const LEGACY_WIPER_FILE = path.join(ROOT, "outputs", "egroup-fitment-reuse-20261024", "legacy-source-rematch", "wiper_application_test.csv");

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const complete = prepareWiperTechPublication({ sourceDir: SOURCE_DIR, catalogDir: CATALOG_DIR });
const completeInspection = await inspectProduction(db, complete, { authoritative: true, requirePurchasablePair: false });
const partial = prepareWiperTechPublication({
  sourceDir: SOURCE_DIR,
  catalogDir: CATALOG_DIR,
  currentFrontByApplication: completeInspection.currentFrontByApplication,
  allowPartialConfigurations: true,
});
const partialInspection = await inspectProduction(db, partial, { authoritative: true, requirePurchasablePair: false });

const egroupIds = new Set(partial.applications.map((row) => row.applicationId));
const completeIds = new Set(complete.publishCandidates.map((row) => row.applicationId));
const partialIds = new Set(partial.publishCandidates.map((row) => row.applicationId));
const currentlyPublishedEgroup = completeInspection.currentPublished.filter((row) => egroupIds.has(row.application_id));
const partialOnly = partial.publishCandidates.filter((row) => !completeIds.has(row.applicationId));
const legacyWiper = readCsv(LEGACY_WIPER_FILE);
const legacyGroups = groupBy(legacyWiper, (row) => row.application_id);
const legacyUnique = [];
for (const rows of legacyGroups.values()) {
  const frontKeys = new Set(rows.map((row) => `${Number(row.driver_in)}/${Number(row.passenger_in)}`));
  const bestConfidence = rows.some((row) => row.match_confidence === "high") ? "high"
    : rows.some((row) => row.match_confidence === "medium") ? "medium" : "low";
  if (frontKeys.size !== 1 || bestConfidence === "low") continue;
  const best = rows.find((row) => row.match_confidence === bestConfidence) ?? rows[0];
  legacyUnique.push({ ...best, legacyFrontKey: [...frontKeys][0], legacyConfidence: bestConfidence });
}
const completeByApplication = new Map(complete.publishCandidates.map((row) => [row.applicationId, row]));
const legacySupplemental = legacyUnique.filter((row) => !partialIds.has(row.application_id));
const legacyOverlap = legacyUnique.filter((row) => completeByApplication.has(row.application_id));
const legacyAgreements = legacyOverlap.filter((row) => completeByApplication.get(row.application_id).frontKey === row.legacyFrontKey);
const legacyConflicts = legacyOverlap.filter((row) => completeByApplication.get(row.application_id).frontKey !== row.legacyFrontKey);

const report = {
  generated_at: new Date().toISOString(),
  source: complete.source,
  egroup: {
    applications: partial.applications.length,
    currently_published_wiper_applications: new Set(currentlyPublishedEgroup.map((row) => row.application_id)).size,
  },
  complete_front: {
    high_confidence_candidates: complete.publishCandidates.length,
    application_years: sumApplicationYears(complete.publishCandidates),
    review_applications: complete.reviews.length,
    review_reasons: countBy(complete.reviews, (row) => row.reason),
    rules: countBy(complete.publishCandidates, (row) => row.rule),
  },
  partial_allowed: {
    high_confidence_candidates: partial.publishCandidates.length,
    application_years: sumApplicationYears(partial.publishCandidates),
    additional_over_complete_front: partialOnly.length,
    review_applications: partial.reviews.length,
    review_reasons: countBy(partial.reviews, (row) => row.reason),
    rules: countBy(partial.publishCandidates, (row) => row.rule),
  },
  high_confidence_by_make: countBy(partial.publishCandidates, (row) => row.make),
  candidate_configuration_count: new Set(partial.publishCandidates.map((row) => row.configurationKey)).size,
  production_conflicts: partialInspection.conflictReviews.length,
  legacy_wiper_secondary_source: {
    matched_applications: legacyGroups.size,
    unique_non_low_configuration_applications: legacyUnique.length,
    overlaps_wipertech: legacyOverlap.length,
    agrees_with_wipertech: legacyAgreements.length,
    conflicts_with_wipertech_keep_for_review: legacyConflicts.length,
    supplemental_applications_not_directly_covered_by_wipertech: legacySupplemental.length,
    supplemental_application_years: legacySupplemental.reduce((sum, row) => sum + Number(row.application_year_to) - Number(row.application_year_from) + 1, 0),
  },
  safe_policy: "WiperTech candidates are source-backed. Publish only candidates returned by the direct matcher; keep incomplete-year and multi-configuration results in review.",
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeCsv(path.join(OUTPUT_DIR, "high_confidence_candidates.csv"), partial.publishCandidates.map(flattenCandidate));
writeCsv(path.join(OUTPUT_DIR, "review_queue.csv"), partial.reviews.map(flattenReview));
writeCsv(path.join(OUTPUT_DIR, "legacy_supplemental_candidates.csv"), legacySupplemental);
writeCsv(path.join(OUTPUT_DIR, "legacy_wipertech_conflicts.csv"), legacyConflicts.map((row) => ({
  ...row,
  wipertech_front_key: completeByApplication.get(row.application_id)?.frontKey ?? "",
})));
console.log(JSON.stringify(report, null, 2));

function flattenCandidate(row) {
  return {
    application_id: row.applicationId,
    make: row.make,
    model: row.model,
    series: row.seriesCode,
    variant: row.variantName,
    body_style: row.bodyStyle,
    years: row.years.join("|"),
    application_years: row.years.length,
    configuration: row.configurationKey,
    driver_in: row.driverLengthIn,
    passenger_in: row.passengerLengthIn,
    rear_in: row.rearLengthIn,
    rule: row.rule,
    confidence: row.confidence,
    source_vehicle_ids: row.sourceVehicleIds.join("|"),
  };
}

function flattenReview(row) {
  return {
    application_id: row.applicationId,
    make: row.make,
    model: row.model,
    series: row.seriesCode,
    variant: row.variantName,
    body_style: row.bodyStyle,
    years: row.years.join("|"),
    reason: row.reason,
    missing_years: (row.missingYears ?? []).join("|"),
    candidate_configurations: (row.candidateConfigurationKeys ?? row.candidateFrontKeys ?? []).join("|"),
    source_vehicle_ids: (row.candidateVehicleIds ?? []).join("|"),
  };
}

function writeCsv(file, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  fs.writeFileSync(file, `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`, "utf8");
}
function readCsv(file) {
  const book = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false });
}
function sumApplicationYears(rows) { return rows.reduce((sum, row) => sum + row.years.length, 0); }
function countBy(rows, keyFn) {
  const result = {};
  for (const row of rows) {
    const key = keyFn(row) || "(blank)";
    result[key] = (result[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}
function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = result.get(key) ?? [];
    values.push(row);
    result.set(key, values);
  }
  return result;
}
function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
