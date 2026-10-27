import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { prepareWiperTechPublication } from "./publish-wipertech-fitments.mjs";
import { isValidSourceWiperLength } from "./wipertech-direct-matcher.mjs";

const SOURCE_FILE = "C:/Users/Sanli/Desktop/database/wipertech/wipertech_可填入_长度唯一.csv";
const OUTPUT = path.resolve(".artifact-work/wipertech/wipertech_cross_ai_review_data.json");

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const [fitments, configurations, wiperSets] = await Promise.all([
  fetchAll(db, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"),
  fetchAll(db, "wiper_configurations", "id,configuration_key"),
  fetchAll(db, "wiper_sets", "driver_length_in,passenger_length_in,set_type,active,visibility_status,content_status,commerce_status,checkout_enabled")
]);

const configurationById = new Map(configurations.map((row) => [row.id, row.configuration_key]));
const currentByApplication = new Map();
for (const row of fitments.filter((item) => item.fitment_status === "published")) {
  const configurationKey = configurationById.get(row.wiper_configuration_id);
  if (!configurationKey) continue;
  currentByApplication.set(row.application_id, {
    configurationKey,
    frontKey: configurationKey.split("/").slice(0, 2).join("/"),
    source: row.source ?? "",
    notes: row.notes ?? ""
  });
}
const currentFrontByApplication = new Map([...currentByApplication].map(([id, row]) => [id, row.frontKey]));
const records = buildUniqueLengthRecords(readCsv(SOURCE_FILE));
const prepared = prepareWiperTechPublication({
  sourceRecords: records,
  sourceSummary: { uniqueLengthRows: records.length, sourceFile: SOURCE_FILE },
  currentFrontByApplication,
  allowPartialConfigurations: true
});
const purchasablePairs = new Set(wiperSets.filter(isPurchasable).map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));

const reviewRows = [];
for (const row of prepared.reviews) {
  if (!["multiple_wipertech_configurations", "incomplete_year_coverage"].includes(row.reason)) continue;
  if (currentByApplication.has(row.applicationId)) continue;
  reviewRows.push(toReviewRow(row, row.reason, currentByApplication.get(row.applicationId), purchasablePairs));
}

const involvedVehicleIds = new Set(reviewRows.flatMap((row) => row.sourceVehicleIds));
const evidenceRows = records.filter((row) => involvedVehicleIds.has(row.vehicleId)).map((row) => ({
  vehicleId: row.vehicleId,
  make: row.make,
  model: row.model,
  series: row.series,
  body: row.body,
  yearStart: row.yearStart,
  yearEnd: row.yearEnd,
  driverIn: row.positions.driver?.sizeInch ?? null,
  passengerIn: row.positions.passenger?.sizeInch ?? null,
  rearIn: row.positions.rear?.sizeInch ?? null,
  driverSku: row.positions.driver?.sku ?? "",
  passengerSku: row.positions.passenger?.sku ?? "",
  rearSku: row.positions.rear?.sku ?? ""
}));

reviewRows.sort((left, right) => left.priority.localeCompare(right.priority)
  || left.make.localeCompare(right.make) || left.model.localeCompare(right.model)
  || left.yearStart - right.yearStart || left.applicationId.localeCompare(right.applicationId));
for (const [index, row] of reviewRows.entries()) row.reviewId = `WT-AI-${String(index + 1).padStart(5, "0")}`;

const counts = countBy(reviewRows, (row) => row.reason);
const payload = {
  generatedAt: new Date().toISOString(),
  productionSnapshot: { publishedApplications: currentByApplication.size },
  sourceFiles: [SOURCE_FILE],
  counts: { total: reviewRows.length, ...counts },
  reviewRows,
  evidenceRows
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ output: OUTPUT, counts: payload.counts, evidenceRows: evidenceRows.length }, null, 2));

function toReviewRow(row, reason, current, purchasablePairs) {
  const years = [...new Set((row.years ?? []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const configurationFrontKeys = (row.candidateConfigurationKeys ?? []).map((key) => String(key).split("/").slice(0, 2).join("/"));
  const candidateFrontKeys = row.candidateFrontKeys?.length
    ? row.candidateFrontKeys
    : configurationFrontKeys.length ? [...new Set(configurationFrontKeys)].sort() : [row.frontKey].filter(Boolean);
  const sourceVehicleIds = row.candidateVehicleIds?.length ? row.candidateVehicleIds : row.sourceVehicleIds ?? [];
  const recommendation = recommendationFor(reason);
  return {
    reviewId: "",
    priority: reason === "published_front_conflict" ? "P0" : reason === "multiple_wipertech_configurations" ? "P1" : "P2",
    reason,
    reasonZh: reasonLabel(reason),
    applicationId: row.applicationId,
    make: row.make,
    model: row.model,
    yearStart: years[0] ?? null,
    yearEnd: years.at(-1) ?? null,
    years,
    seriesCode: row.seriesCode ?? "",
    seriesName: row.seriesName ?? "",
    variantName: row.variantName ?? "",
    bodyStyle: row.bodyStyle ?? "",
    currentConfiguration: current?.configurationKey ?? "",
    currentSource: current?.source ?? "",
    wiperTechRecommendedConfiguration: row.configurationKey ?? "",
    candidateFrontKeys,
    missingYears: row.missingYears ?? [],
    sourceVehicleIds,
    sellableFrontPair: row.frontKey ? purchasablePairs.has(pairKey(...row.frontKey.split("/"))) : null,
    matchRule: row.rule ?? "",
    recommendation,
    reviewQuestion: reviewQuestionFor(reason, { ...row, candidateFrontKeys }, current)
  };
}

function recommendationFor(reason) {
  if (reason === "published_front_conflict") return "独立核验车型代际后，在“采用WiperTech”与“保留现网”中选择；不得仅按来源权威性覆盖。";
  if (reason === "multiple_wipertech_configurations") return "确认WiperTech平台代码与NexAuto底盘号的对应关系；确认后按NexAuto年份应用唯一尺寸。";
  if (reason === "incomplete_year_coverage") return "确认WiperTech平台代码是否对应NexAuto底盘号；底盘确认后忽略WiperTech年份，按NexAuto年份应用。";
  return "尺寸适配可成立，但发布前需补齐或启用对应前挡商品组合。";
}

function reviewQuestionFor(reason, row, current) {
  const vehicle = `${row.make} ${row.model} ${row.years?.[0] ?? "?"}-${row.years?.at(-1) ?? "?"}`;
  if (reason === "published_front_conflict") return `${vehicle}（${row.seriesCode || row.bodyStyle || "无代际信息"}）：现网 ${current?.configurationKey ?? "无"} 与 WiperTech ${row.configurationKey} 冲突。请核验哪一组适用于该完整application。`;
  if (reason === "multiple_wipertech_configurations") return `${vehicle}：WiperTech候选 ${row.candidateFrontKeys?.join(", ") || "无"}。请确认哪个WiperTech平台/车身对应NexAuto底盘 ${row.seriesCode || "未提供"}。`;
  if (reason === "incomplete_year_coverage") return `${vehicle}：WiperTech范围外年份 ${row.missingYears?.join(", ") || "未列出"}。请确认WiperTech平台是否对应NexAuto底盘 ${row.seriesCode || "未提供"}；确认后以NexAuto年份为准。`;
  return `${vehicle}：适配尺寸 ${row.configurationKey} 当前无可售前挡组合。请确认商品组合是否应建立/启用。`;
}

function reasonLabel(reason) {
  return ({
    published_front_conflict: "现网与WiperTech冲突",
    multiple_wipertech_configurations: "WiperTech存在多个候选尺寸",
    incomplete_year_coverage: "WiperTech年份覆盖不完整",
    sellable_front_pair_missing: "缺少可售前挡组合"
  })[reason] ?? reason;
}
function isPurchasable(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function pairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function countBy(rows, keyFn) { const out = {}; for (const row of rows) { const key = keyFn(row); out[key] = (out[key] ?? 0) + 1; } return out; }
function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function buildUniqueLengthRecords(rows) {
  const records = [];
  for (const [index, row] of rows.entries()) {
    const rawDriver = numberOrNull(row.front_driver_size);
    const rawPassenger = numberOrNull(row.front_passenger_size);
    const rawRear = numberOrNull(row.rear_size);
    const driver = isValidSourceWiperLength(rawDriver) ? rawDriver : null;
    const passenger = isValidSourceWiperLength(rawPassenger) ? rawPassenger : null;
    const rear = isValidSourceWiperLength(rawRear) ? rawRear : null;
    const yearStart = numberOrNull(row.year_from);
    const yearEnd = numberOrNull(row.year_to);
    if (!String(row.make ?? "").trim() || !String(row.model ?? "").trim() || !yearStart || !yearEnd || yearStart > yearEnd) continue;
    if (driver === null && passenger === null && rear === null) continue;
    records.push({
      vehicleId: `unique_row_${index + 2}`,
      make: String(row.make).trim(), model: String(row.model).trim(),
      series: String(row.chassis ?? "").trim(), body: String(row.body ?? "").trim(),
      yearStart, yearEnd,
      positions: {
        driver: { sizeInch: driver, sku: String(row.front_driver_blade ?? "").trim() },
        passenger: { sizeInch: passenger, sku: String(row.front_passenger_blade ?? "").trim() },
        rear: rear === null ? null : { sizeInch: rear, sku: String(row.rear_blade ?? "").trim() }
      }
    });
  }
  return records;
}
function numberOrNull(value) { const number = Number(value); return value === "" || value === null || value === undefined || !Number.isFinite(number) ? null : number; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
async function fetchAll(client, table, columns) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await client.from(table).select(columns).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
