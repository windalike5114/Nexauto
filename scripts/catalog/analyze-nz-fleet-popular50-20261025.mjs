import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { REQUESTED_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const SOURCE_DIR = "C:/Users/Sanli/Downloads";
const OUTPUT_DIR = path.resolve("outputs", "nz-fleet-popular50-20261025");
const aliases = buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
const groupByRank = new Map(REQUESTED_POPULAR_VEHICLE_GROUPS.map((group) => [group.rank, group]));
const lightClasses = new Set(["MA", "MB", "MC", "NA"]);
const files = fs.readdirSync(SOURCE_DIR)
  .filter((name) => /^VehicleYear-(?:19|20)\d{2}\.csv$/i.test(name))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

if (!files.length) throw new Error(`No VehicleYear CSV files found in ${SOURCE_DIR}`);

const totals = blankCounts();
const groupCounts = new Map(REQUESTED_POPULAR_VEHICLE_GROUPS.map((group) => [group.id, {
  rank: group.rank,
  label: group.label,
  all_records: 0,
  light_fleet_1990_2026: 0,
  light_fleet_2000_2026: 0,
  encoding_alias_matches: 0
}]));
const unmatchedLightModels = new Map();
const fileSummaries = [];

for (const [fileIndex, fileName] of files.entries()) {
  const filePath = path.join(SOURCE_DIR, fileName);
  const fileYear = Number(fileName.match(/(\d{4})/)?.[1]);
  const counts = blankCounts();
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let header = null;
  let indexes = null;
  for await (const line of lines) {
    if (!header) {
      header = parseCsvLine(line.replace(/^\uFEFF/, ""));
      indexes = Object.fromEntries(["MAKE", "MODEL", "CLASS", "VEHICLE_TYPE", "VEHICLE_YEAR", "CHASSIS7",
        "INDUSTRY_MODEL_CODE", "MVMA_MODEL_CODE", "SUBMODEL", "VIN11"]
        .map((name) => [name, header.indexOf(name)]));
      if (Object.values(indexes).some((index) => index < 0)) {
        throw new Error(`Required columns missing in ${fileName}`);
      }
      continue;
    }
    if (!line) continue;
    const row = parseCsvLine(line);
    if (row.length < header.length - 2) {
      counts.malformed_rows += 1;
      continue;
    }
    const make = clean(row[indexes.MAKE]);
    const model = clean(row[indexes.MODEL]);
    const vehicleClass = clean(row[indexes.CLASS]).toUpperCase();
    const vehicleYear = Number(row[indexes.VEHICLE_YEAR]) || fileYear;
    const match = resolvePopularGroup({
      make,
      model,
      chassis: clean(row[indexes.CHASSIS7]),
      industryModelCode: clean(row[indexes.INDUSTRY_MODEL_CODE]),
      mvmaModelCode: clean(row[indexes.MVMA_MODEL_CODE]),
      submodel: clean(row[indexes.SUBMODEL]),
      vin: clean(row[indexes.VIN11])
    });
    const group = match?.group;
    const isLight = lightClasses.has(vehicleClass);
    const isAlignedYear = vehicleYear >= 2000 && vehicleYear <= 2026;

    counts.all_records += 1;
    if (group) {
      counts.popular_all_records += 1;
      groupCounts.get(group.id).all_records += 1;
      if (match.method !== "listed_alias") groupCounts.get(group.id).encoding_alias_matches += 1;
    }
    if (!isLight) continue;
    counts.light_fleet_1990_2026 += 1;
    if (group) {
      counts.popular_light_fleet_1990_2026 += 1;
      groupCounts.get(group.id).light_fleet_1990_2026 += 1;
    } else if (make && model) {
      const key = `${make}|${model}`;
      const unmatched = unmatchedLightModels.get(key) ?? { light_fleet_1990_2026: 0, light_fleet_2000_2026: 0 };
      unmatched.light_fleet_1990_2026 += 1;
      if (isAlignedYear) unmatched.light_fleet_2000_2026 += 1;
      unmatchedLightModels.set(key, unmatched);
    }
    if (!isAlignedYear) continue;
    counts.light_fleet_2000_2026 += 1;
    if (group) {
      counts.popular_light_fleet_2000_2026 += 1;
      groupCounts.get(group.id).light_fleet_2000_2026 += 1;
    }
  }
  addCounts(totals, counts);
  fileSummaries.push({ file: fileName, vehicle_year: fileYear, ...counts });
  console.error(`[${fileIndex + 1}/${files.length}] ${fileName}: ${counts.all_records.toLocaleString()} rows`);
}

const groups = [...groupCounts.values()].sort((left, right) => left.rank - right.rank);
const report = {
  generated_at: new Date().toISOString(),
  source: {
    directory: SOURCE_DIR,
    files: files.length,
    first_file: files[0],
    last_file: files.at(-1),
    row_definition: "One supplied Motor Vehicle Register row per vehicle.",
    light_fleet_filter: "CLASS in MA, MB, MC, NA (light passenger and light goods vehicles)."
  },
  totals,
  shares: {
    popular_50_of_all_supplied_records_percent: percent(totals.popular_all_records, totals.all_records),
    popular_50_of_light_fleet_1990_2026_percent: percent(totals.popular_light_fleet_1990_2026, totals.light_fleet_1990_2026),
    popular_50_of_light_fleet_2000_2026_percent: percent(totals.popular_light_fleet_2000_2026, totals.light_fleet_2000_2026)
  },
  popular_groups: groups,
  popular_groups_with_zero_matches: groups.filter((row) => row.light_fleet_1990_2026 === 0).map((row) => row.label),
  top_unmatched_light_models: [...unmatchedLightModels.entries()]
    .map(([key, counts]) => {
      const [make, model] = key.split("|");
      return { make, model, ...counts };
    })
    .sort((left, right) => right.light_fleet_2000_2026 - left.light_fleet_2000_2026)
    .slice(0, 500),
  files: fileSummaries
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeCsv(path.join(OUTPUT_DIR, "popular50-fleet-counts.csv"), groups);
writeCsv(path.join(OUTPUT_DIR, "file-summary.csv"), fileSummaries);
writeCsv(path.join(OUTPUT_DIR, "top-unmatched-light-models.csv"), report.top_unmatched_light_models);
console.log(JSON.stringify({ totals: report.totals, shares: report.shares, zero: report.popular_groups_with_zero_matches }, null, 2));

function blankCounts() {
  return {
    all_records: 0,
    popular_all_records: 0,
    light_fleet_1990_2026: 0,
    popular_light_fleet_1990_2026: 0,
    light_fleet_2000_2026: 0,
    popular_light_fleet_2000_2026: 0,
    malformed_rows: 0
  };
}
function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += source[key] ?? 0;
}
function clean(value) { return String(value ?? "").trim(); }
function resolvePopularGroup({ make, model, chassis, industryModelCode, mvmaModelCode, submodel, vin }) {
  const listed = aliases.get(canonicalModelKey(make, model));
  if (listed) return { group: listed, method: "listed_alias" };
  const makeKey = compact(make);
  const modelKey = compact(model);
  if (makeKey === "mazda" && modelKey === "mazda2") return { group: groupByRank.get(7), method: "fleet_model_encoding" };
  if (makeKey === "mazda" && modelKey === "mazda3") return { group: groupByRank.get(21), method: "fleet_model_encoding" };
  if (makeKey === "lexus" && /^rx\d/.test(modelKey)) return { group: groupByRank.get(49), method: "fleet_model_encoding" };
  if (makeKey === "bmw" && (/^(?:316|318|320|323|325|328|330|335|340)[a-z]*$/.test(modelKey) || modelKey === "m3")) {
    return { group: groupByRank.get(40), method: "fleet_model_encoding" };
  }
  if (makeKey === "toyota" && modelKey === "landcruiser") {
    const identity = compact(`${chassis} ${industryModelCode} ${mvmaModelCode} ${submodel} ${vin}`);
    const pradoPlatform = /(?:prado|(?:kdj|gdj|trj|grj|lj|rzj|vzj)(?:90|95|120|121|125|150|151|155|250|251)|jte[a-z0-9]{0,6}3fj|^gj[xl]s)/i;
    if (pradoPlatform.test(identity)) return { group: groupByRank.get(38), method: "prado_platform_encoding" };
  }
  return null;
}
function compact(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0; }
function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}
function writeCsv(file, rows) {
  const headers = Object.keys(rows[0] ?? {});
  const output = [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))];
  fs.writeFileSync(file, `\uFEFF${output.join("\r\n")}\r\n`);
}
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
