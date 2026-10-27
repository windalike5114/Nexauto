import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { canonicalModelKey, isValidSourceWiperLength } from "./wipertech-direct-matcher.mjs";
import { EXPANDED_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const SOURCE_FILE = "C:/Users/Sanli/Desktop/database/wipertech/wipertech_可填入_长度唯一.csv";
const COVERAGE_REPORT = path.resolve("outputs/wiper-popular-coverage-20261024/wiper_coverage_report.json");
const OUTPUT_FILE = path.resolve("outputs/wiper-popular-coverage-20261024/wiper_granularity_analysis.json");
const POPULAR_INDEX = buildPopularAliasIndex(EXPANDED_POPULAR_VEHICLE_GROUPS);

const rows = readCsv(SOURCE_FILE).map(normalize).filter((row) => row.configurationKey);
const modelYears = expandModelYears(rows, 2015, 2026);
const all = summarize(modelYears);
const popular = summarize(new Map([...modelYears].filter(([key]) => POPULAR_INDEX.has(key.split("|").slice(0, -1).join("|")))));
const coverage = JSON.parse(fs.readFileSync(COVERAGE_REPORT, "utf8"));
const report = {
  sourceRows: rows.length,
  nexAutoGranularity: {
    activeApplications: coverage.production.activeApplications,
    activeApplicationYears: coverage.production.activeApplicationYears,
    modelYears: coverage.production.modelYears,
    averageApplicationsPerModelYear: round(coverage.production.activeApplicationYears / coverage.production.modelYears),
    popularApplicationYears: coverage.popular2015To2026.applicationYears,
    popularModelYears: coverage.popular2015To2026.modelYears,
    popularAverageApplicationsPerModelYear: round(coverage.popular2015To2026.applicationYears / coverage.popular2015To2026.modelYears)
  },
  wiperTech2015To2026: all,
  popularWiperTech2015To2026: popular,
  caveat: "Unique front size within make/model/year supports coarse propagation only when generation/chassis/body evidence does not contradict it."
};
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

function normalize(row) {
  const driver = length(row.front_driver_size);
  const passenger = length(row.front_passenger_size);
  const rear = length(row.rear_size);
  const hasAny = driver !== null || passenger !== null || rear !== null;
  return {
    modelKey: canonicalModelKey(row.make, row.model),
    make: String(row.make ?? "").trim(), model: String(row.model ?? "").trim(),
    chassis: String(row.chassis ?? "").trim(), body: String(row.body ?? "").trim(),
    yearFrom: Number(row.year_from), yearTo: Number(row.year_to),
    frontKey: driver !== null || passenger !== null ? `${driver ?? "-"}/${passenger ?? "-"}` : null,
    configurationKey: hasAny ? `${driver ?? "-"}/${passenger ?? "-"}/${rear ?? "-"}` : null
  };
}
function expandModelYears(rows, minYear, maxYear) {
  const groups = new Map();
  for (const row of rows) {
    for (let year = Math.max(minYear, row.yearFrom); year <= Math.min(maxYear, row.yearTo); year += 1) {
      const key = `${row.modelKey}|${year}`;
      const group = groups.get(key) ?? { make: row.make, model: row.model, year, frontKeys: new Set(), configurationKeys: new Set(), contexts: new Set() };
      if (row.frontKey) group.frontKeys.add(row.frontKey);
      group.configurationKeys.add(row.configurationKey);
      group.contexts.add(`${row.chassis}|${row.body}`);
      groups.set(key, group);
    }
  }
  return groups;
}
function summarize(groups) {
  const values = [...groups.values()];
  const withFront = values.filter((group) => group.frontKeys.size > 0);
  const uniqueFront = withFront.filter((group) => group.frontKeys.size === 1);
  const multipleFront = withFront.filter((group) => group.frontKeys.size > 1);
  const uniqueFull = values.filter((group) => group.configurationKeys.size === 1);
  return {
    modelYearsWithWiperTechData: values.length,
    modelYearsWithFrontData: withFront.length,
    uniqueFrontModelYears: uniqueFront.length,
    uniqueFrontPercent: percent(uniqueFront.length, withFront.length),
    multipleFrontModelYears: multipleFront.length,
    multipleFrontPercent: percent(multipleFront.length, withFront.length),
    uniqueFullConfigurationModelYears: uniqueFull.length,
    uniqueFullConfigurationPercent: percent(uniqueFull.length, values.length),
    multipleFrontExamples: multipleFront.slice(0, 20).map((group) => ({ make: group.make, model: group.model, year: group.year, fronts: [...group.frontKeys], contexts: group.contexts.size }))
  };
}
function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function length(value) { return isValidSourceWiperLength(value) ? Number(value) : null; }
function percent(n, d) { return d ? Number((100 * n / d).toFixed(1)) : 0; }
function round(value) { return Number(value.toFixed(1)); }
