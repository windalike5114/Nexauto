import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { SOURCE_CODE } from "./publish-wipertech-fitments.mjs";
import { APPROVED_FRONT_WIPER_LENGTHS, APPROVED_REAR_WIPER_LENGTHS } from "./wipertech-direct-matcher.mjs";

const AUTHORITATIVE_SOURCE_CODE = "WIPERTECH_AUTHORITATIVE_LENGTH_2026_10_23";
const CROSS_AI_SOURCE_CODE = "WIPERTECH_CROSS_AI_REVIEW_2026_10_22";
const CROSS_AI_MEDIUM_LOW_SOURCE_CODE = "WIPERTECH_CROSS_AI_ML_NO_CONFLICT_2026_10_23";
const EQUIVALENT_APPLICATION_SOURCE_CODE = "WIPERTECH_EQUIVALENT_APPLICATION_2026_10_23";
const EQUIVALENT_FRONT_ONLY_SOURCE_CODE = "WIPERTECH_EQUIVALENT_FRONT_ONLY_2026_10_23";
const COLLAPSED_SPLIT_SOURCE_CODE = "WIPERTECH_CROSS_AI_COLLAPSED_SPLIT_2026_10_23";
const VERIFIED_CHASSIS_BRIDGE_SOURCE_CODE = "WIPERTECH_VERIFIED_CHASSIS_BRIDGE_2026_10_23";

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const published = await fetchAllPublished(db);
const [configurations, blades, sizes, sourceObservations] = await Promise.all([
  fetchAll(db, "wiper_configurations", "id,configuration_key,configuration_status,rear_status"),
  fetchAll(db, "wiper_configuration_blades", "wiper_configuration_id,position,length_in"),
  fetchAll(db, "wiper_sizes", "position_scope,length_in,active"),
  fetchAll(db, "wipertech_length_observations", "source_file_hash,source_row_number,driver_length_in,passenger_length_in,rear_length_in,configuration_key,wiper_configuration_id,observation_status")
]);
const counts = new Map();
for (const row of published) counts.set(row.application_id, (counts.get(row.application_id) ?? 0) + 1);
const duplicates = [...counts.entries()].filter(([, count]) => count > 1);
const reviewRows = (await fetchAll(db, "fitment_review_queue", "issue_type,review_status"))
  .filter((row) => row.issue_type.startsWith("wipertech_direct_") && row.review_status === "open");
const configurationById = new Map(configurations.map((row) => [row.id, row]));
const bladesByConfiguration = groupBy(blades, (row) => row.wiper_configuration_id);
const authoritative = published.filter((row) => row.source === AUTHORITATIVE_SOURCE_CODE);
const authoritativeConfigs = authoritative.map((row) => configurationById.get(row.wiper_configuration_id)).filter(Boolean);
const invalidConfigurations = authoritativeConfigs.filter((configuration) => {
  const expected = configuration.configuration_key.split("/");
  const actual = new Map((bladesByConfiguration.get(configuration.id) ?? []).map((blade) => [blade.position, String(blade.length_in)]));
  return [["driver", expected[0]], ["passenger", expected[1]], ["rear", expected[2]]]
    .some(([position, length]) => length === "-" ? actual.has(position) : actual.get(position) !== length);
});

const report = {
  publishedRows: published.length,
  publishedApplications: counts.size,
  wiperTechPublished: published.filter((row) => row.source === SOURCE_CODE).length,
  wiperTechUniqueLengthPublished: published.filter((row) => row.source === "WIPERTECH_UNIQUE_LENGTH_2026_10_23").length,
  wiperTechAuthoritativePublished: authoritative.length,
  wiperTechCrossAIReviewedPublished: published.filter((row) => row.source === CROSS_AI_SOURCE_CODE).length,
  wiperTechCrossAIMediumLowPublished: published.filter((row) => row.source === CROSS_AI_MEDIUM_LOW_SOURCE_CODE).length,
  wiperTechCollapsedSplitPublished: published.filter((row) => row.source === COLLAPSED_SPLIT_SOURCE_CODE).length,
  wiperTechVerifiedChassisBridgePublished: published.filter((row) => row.source === VERIFIED_CHASSIS_BRIDGE_SOURCE_CODE).length,
  wiperTechEquivalentApplicationPublished: published.filter((row) => row.source === EQUIVALENT_APPLICATION_SOURCE_CODE).length,
  wiperTechEquivalentFrontOnlyPublished: published.filter((row) => row.source === EQUIVALENT_FRONT_ONLY_SOURCE_CODE).length,
  wiperTechPublishedTotal: published.filter((row) => [SOURCE_CODE, "WIPERTECH_UNIQUE_LENGTH_2026_10_23", AUTHORITATIVE_SOURCE_CODE, CROSS_AI_SOURCE_CODE, CROSS_AI_MEDIUM_LOW_SOURCE_CODE, EQUIVALENT_APPLICATION_SOURCE_CODE, EQUIVALENT_FRONT_ONLY_SOURCE_CODE, COLLAPSED_SPLIT_SOURCE_CODE, VERIFIED_CHASSIS_BRIDGE_SOURCE_CODE].includes(row.source)).length,
  authoritativeData: {
    partialFrontApplications: authoritativeConfigs.filter((row) => row.configuration_key.split("/").slice(0, 2).includes("-")).length,
    rearOnlyApplications: authoritativeConfigs.filter((row) => row.configuration_key.startsWith("-/-/") && !row.configuration_key.endsWith("/-")).length,
    nonCommerceFrontLengthApplications: authoritativeConfigs.filter((row) => row.configuration_key.split("/").slice(0, 2).some((value) => value !== "-" && !APPROVED_FRONT_WIPER_LENGTHS.has(Number(value)))).length,
    nonCommerceRearLengthApplications: authoritativeConfigs.filter((row) => {
      const value = row.configuration_key.split("/")[2];
      return value !== "-" && !APPROVED_REAR_WIPER_LENGTHS.has(Number(value));
    }).length,
    invalidBladeRows: invalidConfigurations.length,
    storedFrontSizes: sizes.filter((row) => row.position_scope === "front").map((row) => Number(row.length_in)).sort((a, b) => a - b),
    storedRearSizes: sizes.filter((row) => row.position_scope === "rear").map((row) => Number(row.length_in)).sort((a, b) => a - b)
  },
  sourceArchive: {
    storedRows: sourceObservations.length,
    acceptedRows: sourceObservations.filter((row) => row.observation_status === "accepted").length,
    skippedRows: sourceObservations.filter((row) => row.observation_status === "skipped").length,
    partialFrontRows: sourceObservations.filter((row) => row.observation_status === "accepted" && (row.driver_length_in === null || row.passenger_length_in === null)).length,
    rearOnlyRows: sourceObservations.filter((row) => row.driver_length_in === null && row.passenger_length_in === null && row.rear_length_in !== null).length,
    acceptedRowsMissingConfigurationLink: sourceObservations.filter((row) => row.observation_status === "accepted" && !row.wiper_configuration_id).length,
    frontLengths: uniqueSortedNumbers(sourceObservations.flatMap((row) => [row.driver_length_in, row.passenger_length_in])),
    rearLengths: uniqueSortedNumbers(sourceObservations.map((row) => row.rear_length_in))
  },
  duplicatePublishedApplications: duplicates.length,
  openWiperTechReviewGroups: reviewRows.length,
  openWiperTechReviewGroupsByType: countBy(reviewRows, (row) => row.issue_type)
};
if (duplicates.length) throw new Error(`Found ${duplicates.length} applications with multiple published wiper configurations.`);
if (invalidConfigurations.length) throw new Error(`Found ${invalidConfigurations.length} configurations whose blade rows do not match their configuration key.`);
console.log(JSON.stringify(report, null, 2));

async function fetchAllPublished(client) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("vehicle_catalog_wiper_fitments")
      .select("application_id,wiper_configuration_id,fitment_status,source")
      .eq("fitment_status", "published")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function fetchAll(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  return result;
}

function uniqueSortedNumbers(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined).map(Number))].sort((a, b) => a - b);
}

function countBy(rows, keyFn) {
  const output = {};
  for (const row of rows) {
    const key = keyFn(row);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
