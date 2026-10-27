import fs from "node:fs";
import path from "node:path";

const INPUT = path.resolve("outputs", "nz-fleet-popular50-20261025", "top-unmatched-light-models.csv");
const REPORT = JSON.parse(fs.readFileSync(path.resolve("outputs", "nz-fleet-popular50-20261025", "report.json"), "utf8"));
const OUTPUT_DIR = path.resolve("outputs", "nz-fleet-popular-expansion-20261025");
const rows = readCsv(INPUT).map((row) => ({
  key: `${row.make}|${row.model}`,
  make: row.make,
  model: row.model,
  count: Number(row.light_fleet_2000_2026)
})).filter((row) => row.count > 0);
const byKey = new Map(rows.map((row) => [row.key, row]));
const denominator = REPORT.totals.light_fleet_2000_2026;
const baseCount = REPORT.totals.popular_light_fleet_2000_2026;

const aliasDefinitions = [
  { label: "Honda Jazz / Fit", target: "Honda Jazz", keys: ["HONDA|FIT"] },
  { label: "Nissan Qashqai / Dualis", target: "Nissan Qashqai", keys: ["NISSAN|DUALIS"] },
  { label: "Hyundai Tucson / ix35", target: "Hyundai Tucson", keys: ["HYUNDAI|IX35"] }
];
const aliasAdditions = aliasDefinitions.map((definition) => ({
  ...definition,
  fleet_count: sumKeys(definition.keys)
}));
const consumed = new Set(aliasDefinitions.flatMap((definition) => definition.keys));
const baseAfterAliases = baseCount + aliasAdditions.reduce((sum, row) => sum + row.fleet_count, 0);

const mergedDefinitions = [
  { label: "Mazda Atenza / Mazda 6", keys: ["MAZDA|ATENZA", "MAZDA|MAZDA6"] },
  { label: "Ford Escape / Kuga", keys: ["FORD|ESCAPE", "FORD|KUGA"] },
  { label: "Suzuki Vitara / Grand Vitara", keys: ["SUZUKI|VITARA", "SUZUKI|GRAND VITARA"] },
  { label: "Honda HR-V / Vezel", keys: ["HONDA|HR-V", "HONDA|VEZEL"] },
  { label: "Nissan March / Micra", keys: ["NISSAN|MARCH", "NISSAN|MICRA"] },
  { label: "Nissan Caravan / NV350", keys: ["NISSAN|CARAVAN", "NISSAN|NV350"] },
  { label: "MINI hatch family", keys: ["BMW|MINI", "MINI|COOPER", "MINI|HATCH"] },
  { label: "GWM / Haval H6", keys: ["GWM|HAVAL H6", "HAVAL|H6"] },
  { label: "GWM / Haval Jolion", keys: ["GWM|HAVAL JOLION", "HAVAL|JOLION"] },
  { label: "Mercedes-Benz C-Class", keys: ["MERCEDES-BENZ|C-CLASS", "MERCEDES-BENZ|C"] }
];

const candidates = [];
for (const definition of mergedDefinitions) {
  const matchedKeys = definition.keys.filter((key) => byKey.has(key) && !consumed.has(key));
  if (!matchedKeys.length) continue;
  matchedKeys.forEach((key) => consumed.add(key));
  candidates.push({ label: definition.label, source_models: matchedKeys.join(" / "), fleet_count: sumKeys(matchedKeys), grouping: "verified_market_family" });
}
for (const row of rows) {
  if (consumed.has(row.key)) continue;
  consumed.add(row.key);
  candidates.push({ label: `${title(row.make)} ${title(row.model)}`, source_models: row.key, fleet_count: row.count, grouping: "exact_fleet_model" });
}
candidates.sort((left, right) => right.fleet_count - left.fleet_count || left.label.localeCompare(right.label));

let cumulative = baseAfterAliases;
let reached75 = false;
let reached80 = false;
const prioritized = [];
for (const [index, row] of candidates.entries()) {
  cumulative += row.fleet_count;
  const share = percent(cumulative, denominator);
  const tier = !reached75 ? "to_75_percent" : !reached80 ? "75_to_80_percent" : "beyond_80_percent";
  if (share >= 75) reached75 = true;
  if (share >= 80) reached80 = true;
  prioritized.push({ priority: index + 1, ...row, cumulative_fleet: cumulative, cumulative_share_percent: share, tier });
  if (reached80) break;
}

const to75 = prioritized.filter((row) => row.tier === "to_75_percent");
const to80 = prioritized.filter((row) => row.tier !== "beyond_80_percent");
const report = {
  generated_at: new Date().toISOString(),
  denominator,
  current_popular_50: { fleet_count: baseCount, share_percent: percent(baseCount, denominator) },
  existing_group_alias_expansion: {
    additions: aliasAdditions,
    fleet_gain: baseAfterAliases - baseCount,
    fleet_count: baseAfterAliases,
    share_percent: percent(baseAfterAliases, denominator)
  },
  target_75: {
    new_model_groups: to75.length,
    resulting_total_groups: 50 + to75.length,
    fleet_count: to75.at(-1)?.cumulative_fleet ?? baseAfterAliases,
    share_percent: to75.at(-1)?.cumulative_share_percent ?? percent(baseAfterAliases, denominator),
    last_group: to75.at(-1)?.label ?? null
  },
  target_80: {
    new_model_groups: to80.length,
    resulting_total_groups: 50 + to80.length,
    fleet_count: to80.at(-1)?.cumulative_fleet ?? baseAfterAliases,
    share_percent: to80.at(-1)?.cumulative_share_percent ?? percent(baseAfterAliases, denominator),
    last_group: to80.at(-1)?.label ?? null
  },
  prioritized_groups: prioritized
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeCsv(path.join(OUTPUT_DIR, "popular-expansion-priority.csv"), prioritized);
writeCsv(path.join(OUTPUT_DIR, "existing50-alias-expansion.csv"), aliasAdditions);
console.log(JSON.stringify({
  current: report.current_popular_50,
  afterAliases: report.existing_group_alias_expansion,
  target75: report.target_75,
  target80: report.target_80,
  top30: prioritized.slice(0, 30)
}, null, 2));

function sumKeys(keys) { return keys.reduce((sum, key) => sum + (byKey.get(key)?.count ?? 0), 0); }
function percent(numerator, denominatorValue) { return Number((100 * numerator / denominatorValue).toFixed(2)); }
function title(value) { return value.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()); }
function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}
function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}
function writeCsv(file, rowsToWrite) {
  const headers = Object.keys(rowsToWrite[0] ?? {});
  const lines = [headers.join(","), ...rowsToWrite.map((row) => headers.map((header) => csvCell(row[header])).join(","))];
  fs.writeFileSync(file, `\uFEFF${lines.join("\r\n")}\r\n`);
}
function csvCell(value) {
  const text = value === null || value === undefined ? "" : Array.isArray(value) ? value.join(" / ") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
