import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(process.cwd(), ".env.local"));
for (const name of ["report", "source", "screen", "output"]) {
  if (!args[name]) throw new Error(`Missing --${name}.`);
}

const report = JSON.parse(fs.readFileSync(path.resolve(args.report), "utf8"));
const sourceWorkbook = XLSX.readFile(path.resolve(args.source), { raw: false });
const screenWorkbook = XLSX.readFile(path.resolve(args.screen), { raw: false });
const outputPath = path.resolve(args.output);
const sourceRows = XLSX.utils.sheet_to_json(sourceWorkbook.Sheets["主表(2148行)"], {
  header: 1,
  defval: "",
  raw: false
});
const screenedByRow = new Map([
  "A_已安全匹配",
  "B_可自动确认",
  "C_数据库自动整理",
  "D_实车人工确认",
  "E_外源资料补充"
].flatMap((sheetName) => XLSX.utils.sheet_to_json(screenWorkbook.Sheets[sheetName], { defval: "" }))
  .map((row) => [Number(row.source_row), row]));

const blocked = report.blocked ?? [];
const conflictRows = blocked.filter((row) => String(row.block_reasons).includes("trusted_configuration_conflict"));
const productRows = blocked.filter((row) => String(row.block_reasons).includes("active_front_product_missing"));
const applicationIds = [...new Set(blocked.map((row) => row.vehicle_application_id).filter(Boolean))];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Database credentials are not configured.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: applications, error } = await db.from("vehicle_fitment_applications")
  .select(`
    id,year_start,year_end,
    vehicle_variants(name,body_style),
    vehicle_generations(
      name,
      vehicle_chassis_assignments(is_primary,vehicle_chassis_codes(code)),
      vehicle_models(name,vehicle_makes(name))
    )
  `)
  .in("id", applicationIds);
if (error) throw error;
const applicationById = new Map((applications ?? []).map((row) => [row.id, row]));

const reviewTasks = conflictRows.map((row, index) => buildConflictTask(row, index + 1));
const productTasks = productRows.map((row, index) => buildProductTask(row, index + 1));
const workbook = XLSX.utils.book_new();
addSheet(workbook, "说明", [
  { 项目: "已先上线", 内容: `${report.counts.publishable_applications} 个无冲突车型应用已经发布，不需要等待本表。` },
  { 项目: "车型确认任务", 内容: `${reviewTasks.length} 个；每行只需填写“确认结果”和必要的正确字段。` },
  { 项目: "商品补充任务", 内容: `${productTasks.length} 个；数据本身不需要复核，只需决定是否建立可售商品。` },
  { 项目: "推荐填写", 内容: "若不同尺寸属于不同版本，填“拆分”，并补充各自 Body/Chassis 或年份；若其中一套错误，填“保留”，并写正确尺寸。" },
  { 项目: "可直接回复", 内容: "例如：W-001 拆分，BA=22/20，BF=24/18；W-002 保留 26/18/12。" }
]);
addSheet(workbook, "只需确认", reviewTasks);
addSheet(workbook, "商品待补充", productTasks);
XLSX.writeFile(workbook, outputPath, { compression: true });

console.log(JSON.stringify({
  output: outputPath,
  published_first: report.counts.publishable_applications,
  simple_review_tasks: reviewTasks.length,
  source_rows_in_review_tasks: new Set(conflictRows.flatMap(sourceRowNumbers)).size,
  product_tasks: productTasks.length
}, null, 2));

function buildConflictTask(blockedRow, number) {
  const identity = applicationIdentity(applicationById.get(blockedRow.vehicle_application_id));
  const rows = sourceRowNumbers(blockedRow);
  return {
    任务编号: `W-${String(number).padStart(3, "0")}`,
    品牌: identity.make,
    车型: identity.model,
    当前代际或底盘: identity.generationChassis,
    当前车身: identity.variantBody,
    当前年份: identity.years,
    需要修改的位置: "Body / Chassis / 年份与雨刮尺寸的对应关系",
    当前差异: rows.map(sourceSummary).join("\n"),
    只需确认: "每套尺寸分别属于哪个 Body/Chassis 或年份？若只有一套正确，请说明保留哪一套。",
    "确认结果（拆分/保留/修改）": "",
    "正确Body/Chassis": "",
    正确年份范围: "",
    "正确尺寸（Driver/Passenger/Rear）": "",
    备注: ""
  };
}

function buildProductTask(blockedRow, number) {
  const identity = applicationIdentity(applicationById.get(blockedRow.vehicle_application_id));
  const rows = sourceRowNumbers(blockedRow);
  return {
    任务编号: `P-${String(number).padStart(3, "0")}`,
    品牌: identity.make,
    车型: identity.model,
    Body或Chassis: `${identity.generationChassis} / ${identity.variantBody}`,
    年份: identity.years,
    缺少的前雨刮组合: blockedRow.configuration_key,
    来源行: rows.join("、"),
    需要确认: "是否建立这个尺寸组合的可售商品？",
    "是否创建商品（是/否）": "",
    SKU: "",
    价格: "",
    库存或采购说明: ""
  };
}

function sourceSummary(rowNumber) {
  const raw = sourceRows[rowNumber - 1] ?? [];
  const screened = screenedByRow.get(rowNumber) ?? {};
  return [
    `源表${rowNumber}行`,
    raw[2] || "未注明Body/Chassis",
    raw[3] || `${screened.source_year_start ?? "?"}-${screened.source_year_end ?? "ON"}`,
    `${raw[4] || "-"}/${raw[5] || "-"}/${raw[6] || "-"} mm`,
    `标准尺寸 ${screened.configuration_key || "未转换"}`
  ].join("｜");
}

function sourceRowNumbers(blockedRow) {
  return String(blockedRow.supporting_wiper_master_rows ?? "")
    .split(" | ")
    .map(Number)
    .filter(Number.isFinite);
}

function applicationIdentity(application) {
  const generation = single(application?.vehicle_generations);
  const model = single(generation?.vehicle_models);
  const make = single(model?.vehicle_makes);
  const variant = single(application?.vehicle_variants);
  const chassis = (generation?.vehicle_chassis_assignments ?? [])
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
    .map((assignment) => single(assignment.vehicle_chassis_codes)?.code)
    .filter(Boolean);
  return {
    make: make?.name ?? "",
    model: model?.name ?? "",
    generationChassis: [generation?.name, [...new Set(chassis)].join(" / ")].filter(Boolean).join(" · "),
    variantBody: [variant?.name, variant?.body_style].filter((value) => value && value !== "unknown").join(" · ") || "未注明",
    years: formatYears(application?.year_start, application?.year_end)
  };
}

function formatYears(start, end) {
  if (!start) return "未注明";
  return `${start}-${end ?? "ON"}`;
}

function single(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function addSheet(target, name, rows) {
  const values = rows.length ? rows : [{ 状态: "当前无任务" }];
  const sheet = XLSX.utils.json_to_sheet(values);
  sheet["!autofilter"] = { ref: sheet["!ref"] };
  sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  const headers = Object.keys(values[0]);
  sheet["!cols"] = headers.map((header) => ({
    wch: Math.min(80, Math.max(14, header.length * 2, ...values.slice(0, 100).map((row) => String(row[header] ?? "").length)))
  }));
  XLSX.utils.book_append_sheet(target, sheet, name);
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return parsed;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
