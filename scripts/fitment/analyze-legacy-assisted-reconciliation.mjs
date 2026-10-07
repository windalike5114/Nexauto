import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

import {
  extractChassisCodes,
  inferBodyStyles,
  normalizeCatalogKey,
  normalizeCatalogText
} from "./vehicle-catalog-normalization.mjs";
import { canonicalMakeKey } from "./vehicle-wiper-matcher.mjs";
import { isSafeVersionSuffix } from "./legacy-vehicle-mapping.mjs";

loadEnvFile(path.join(process.cwd(), ".env.local"));

const [workbookArg, outputArg] = process.argv.slice(2);
if (!workbookArg || !outputArg) {
  throw new Error("Usage: node scripts/fitment/analyze-legacy-assisted-reconciliation.mjs <screening.xlsx> <output.xlsx>");
}
const workbookPath = path.resolve(workbookArg);
const outputPath = path.resolve(outputArg);
if (!fs.existsSync(workbookPath)) throw new Error("Screening workbook is required.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Database credentials are not configured.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const workbook = XLSX.readFile(workbookPath, { raw: false });
const cleanup = XLSX.utils.sheet_to_json(workbook.Sheets["C_数据库自动整理"], { defval: "" });
const legacyApplications = await selectAll(db.from("vehicle_applications")
  .select("id,year_start,year_end,start_raw,end_raw,active,vehicle_makes(name),vehicle_models(name),wiper_length_fitments(driver_length_in,passenger_length_in,rear_length_in)")
  .eq("active", true));
const legacyMaps = await selectAll(db.from("legacy_vehicle_application_map")
  .select("legacy_vehicle_application_id,vehicle_fitment_application_id,mapping_status")
  .eq("mapping_status", "approved"));
const canonicalApplications = await selectAll(db.from("vehicle_fitment_applications").select("id,active,fitment_status"));

const canonicalApplicationIds = new Set(canonicalApplications
  .filter((row) => row.active && row.fitment_status === "published")
  .map((row) => row.id));
const canonicalByLegacyId = new Map(legacyMaps
  .filter((row) => canonicalApplicationIds.has(row.vehicle_fitment_application_id))
  .map((row) => [row.legacy_vehicle_application_id, row.vehicle_fitment_application_id]));

const legacy = legacyApplications.map((row) => {
  const make = single(row.vehicle_makes)?.name ?? "";
  const model = single(row.vehicle_models)?.name ?? "";
  const fitment = row.wiper_length_fitments?.[0] ?? null;
  const detail = `${model} ${row.start_raw ?? ""} ${row.end_raw ?? ""}`;
  return {
    id: row.id,
    canonical_application_id: canonicalByLegacyId.get(row.id) ?? null,
    make,
    make_key: canonicalMakeKey(make),
    model,
    model_key: normalizeCatalogKey(model),
    year_start: row.year_start,
    year_end: row.year_end,
    driver: toNumber(fitment?.driver_length_in),
    passenger: toNumber(fitment?.passenger_length_in),
    rear: toNumber(fitment?.rear_length_in),
    bodies: inferBodyStyles(detail),
    chassis: extractChassisCodes(detail)
  };
});

const results = cleanup.map((row) => assess(row, legacy));
const recovered = results.filter((row) => row.legacy_assisted_status === "unique");
const unresolved = results.filter((row) => row.legacy_assisted_status !== "unique");
const byOriginalCategory = countBy(recovered, (row) => row.review_category);
const unresolvedReasons = countBy(unresolved, (row) => row.legacy_assisted_status);

const output = XLSX.utils.book_new();
addSheet(output, "汇总", [
  { 项目: "数据库自动整理总数", 数量: cleanup.length },
  { 项目: "老库辅助唯一匹配", 数量: recovered.length },
  { 项目: "仍未唯一匹配", 数量: unresolved.length },
  ...Object.entries(byOriginalCategory).map(([category, count]) => ({ 项目: `回收_${category}`, 数量: count })),
  ...Object.entries(unresolvedReasons).map(([reason, count]) => ({ 项目: `未回收_${reason}`, 数量: count }))
]);
addSheet(output, "老库辅助唯一匹配", recovered);
addSheet(output, "仍待自动整理", unresolved);
XLSX.writeFile(output, outputPath, { compression: true });

console.log(JSON.stringify({
  total: cleanup.length,
  recovered: recovered.length,
  unresolved: unresolved.length,
  recovered_by_original_category: byOriginalCategory,
  unresolved_reasons: unresolvedReasons,
  output: outputPath
}, null, 2));

function assess(row, applications) {
  const sourceMake = normalizeCatalogText(row.source_make);
  const sourceModel = normalizeCatalogText(row.source_model);
  const sourceDetail = normalizeCatalogText(row.source_body_chassis);
  const sourceBodies = inferBodyStyles(`${sourceModel} ${sourceDetail}`);
  const sourceChassis = extractChassisCodes(sourceDetail);
  const sourceConfig = [toNumber(row.normalized_driver_in), toNumber(row.normalized_passenger_in), nullableNumber(row.normalized_rear_in)];
  const eligibleCategory = ["multiple_vehicle_candidates", "canonical_model_missing", "application_mapping_missing"]
    .includes(row.review_category);
  const candidates = applications.filter((application) => (
    eligibleCategory
    && sourceConfig[0]
    && sourceConfig[1]
    && application.canonical_application_id
    && application.make_key === canonicalMakeKey(sourceMake)
    && safeModelMatch(sourceModel, application.model)
    && rangesOverlap(row.source_year_start, row.source_year_end, application.year_start, application.year_end)
    && sameConfiguration(sourceConfig, [application.driver, application.passenger, application.rear])
    && compatibleSignals(sourceBodies, sourceChassis, application.bodies, application.chassis)
  ));
  const targetIds = [...new Set(candidates.map((candidate) => candidate.canonical_application_id))];
  const status = !eligibleCategory
    ? "category_not_safe_for_assisted_mapping"
    : !sourceConfig[0] || !sourceConfig[1]
      ? "invalid_front_configuration"
      : targetIds.length === 1
        ? "unique"
        : targetIds.length > 1 ? "multiple_targets" : "no_target";
  return {
    ...row,
    legacy_assisted_status: status,
    legacy_candidate_count: candidates.length,
    canonical_target_count: targetIds.length,
    legacy_application_ids: candidates.map((candidate) => candidate.id).join(" | "),
    assisted_application_id: targetIds.length === 1 ? targetIds[0] : ""
  };
}

function safeModelMatch(sourceModel, legacyModel) {
  const source = normalizeCatalogText(sourceModel);
  const legacy = normalizeCatalogText(legacyModel);
  const sourceKey = normalizeCatalogKey(source);
  const legacyKey = normalizeCatalogKey(legacy);
  if (!sourceKey || !legacyKey) return false;
  if (sourceKey === legacyKey) return true;
  if (!legacyKey.startsWith(`${sourceKey} `)) return false;
  return isSafeVersionSuffix(legacy.slice(source.length).trim());
}

function rangesOverlap(leftStart, leftEnd, rightStart, rightEnd) {
  const aStart = toNumber(leftStart);
  const bStart = toNumber(rightStart);
  if (!aStart || !bStart) return false;
  return aStart <= (toNumber(rightEnd) ?? 9999) && bStart <= (toNumber(leftEnd) ?? 9999);
}

function sameConfiguration(left, right) {
  return left.every((value, index) => value === right[index]);
}

function compatibleSignals(sourceBodies, sourceChassis, targetBodies, targetChassis) {
  if (sourceBodies.length && targetBodies.length && !intersects(sourceBodies, targetBodies)) return false;
  if (sourceChassis.length && targetChassis.length && !intersects(sourceChassis, targetChassis)) return false;
  return true;
}

function intersects(left, right) {
  const keys = new Set(left.map(normalizeCatalogKey));
  return right.some((value) => keys.has(normalizeCatalogKey(value)));
}

function single(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nullableNumber(value) {
  return value === "" || value === null || value === undefined ? null : toNumber(value);
}

async function selectAll(query, size = 500) {
  const rows = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query.range(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function addSheet(workbook, name, rows) {
  const values = rows.length ? rows : [{ 状态: "当前无记录" }];
  const sheet = XLSX.utils.json_to_sheet(values);
  sheet["!autofilter"] = { ref: sheet["!ref"] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
