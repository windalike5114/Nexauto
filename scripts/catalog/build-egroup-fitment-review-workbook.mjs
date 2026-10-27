import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "file:///C:/Users/Sanli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const root = process.cwd();
const outputDir = path.join(root, "outputs", "egroup-fitment-reuse-20261024");
const outputPath = path.join(outputDir, "NexAuto_Egroup_剩余适配待审核_2026-10-24.xlsx");
const previewDir = path.join(root, "tmp", "egroup-fitment-review-previews");

const inputs = {
  wiperSearch: path.join(outputDir, "wipertech", "review_queue.csv"),
  productReview: path.join(outputDir, "product-fitment-review-candidates.csv"),
  legacyWiper: path.join(outputDir, "wipertech", "legacy_supplemental_candidates.csv"),
  wiperConflict: path.join(outputDir, "wipertech", "legacy_wipertech_conflicts.csv"),
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = "";
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift() ?? [];
  return rows.filter((r) => r.some((v) => v !== "")).map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""]))
  );
}

async function readCsv(file) {
  return parseCsv(await fs.readFile(file, "utf8"));
}

function colName(n) {
  let s = "";
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  }
  return s;
}

function yearsLabel(r) {
  if (r.years) return r.years;
  const from = r.application_year_from ?? "";
  const to = r.application_year_to ?? "";
  return from && to ? `${from}-${to}` : from || to;
}

function priorityFor(reason) {
  if (reason === "multiple_configurations") return "P0";
  if (reason === "incomplete_year_coverage") return "P1";
  if (reason === "no_make_model_source") return "P2";
  return "P1";
}

const wiperSearchRaw = await readCsv(inputs.wiperSearch);
const productRaw = await readCsv(inputs.productReview);
const legacyRaw = await readCsv(inputs.legacyWiper);
const conflictRaw = await readCsv(inputs.wiperConflict);

const wiperSearchHeaders = [
  "优先级", "application_id", "品牌", "车型", "车系/底盘", "版本", "车身", "适用年份",
  "问题类型", "缺失年份", "候选配置", "WiperTech源车辆ID", "建议检索词", "需补证据",
  "证据URL", "审核结论", "确认配置(主/副/后)", "置信度", "审核人", "审核时间", "审核状态"
];
const wiperSearchRows = wiperSearchRaw.map((r) => [
  priorityFor(r.reason), r.application_id, r.make, r.model, r.series, r.variant, r.body_style, r.years,
  r.reason, r.missing_years, r.candidate_configurations, r.source_vehicle_ids,
  `${r.make} ${r.model} ${r.series} ${r.years} wiper size`,
  r.reason === "no_make_model_source" ? "权威目录或厂家适配页" : r.reason === "incomplete_year_coverage" ? "代际年份边界与同底盘证据" : "车型/车身对应的唯一雨刷配置",
  "", "", "", "", "", "", "待确认"
]);

const legacyHeaders = [
  "优先级", "application_id", "品牌", "车型", "车系/底盘", "发动机", "版本", "适用年份",
  "候选SKU", "主驾(in)", "副驾(in)", "后窗(mm)", "卡扣", "旧配置", "匹配置信度", "匹配依据",
  "原始URL", "问题类型", "建议检索词", "证据URL", "审核结论", "确认配置(主/副/后)",
  "置信度", "审核人", "审核时间", "审核状态"
];
const legacyRows = legacyRaw.map((r) => [
  r.legacyConfidence === "high" ? "P1" : "P2", r.application_id, r.make_name, r.model_name, r.series_name,
  r.engine_name, r.variant_name, yearsLabel(r), r.sku, r.driver_in, r.passenger_in, r.rear_mm,
  r.connector_type, r.legacyFrontKey, r.legacyConfidence, r.matched_on, r.source_url,
  "旧雨刷可补充，但缺少WiperTech直接覆盖", `${r.make_name} ${r.model_name} ${r.series_name} ${yearsLabel(r)} wiper size`,
  "", "", "", "", "", "", "待确认"
]);

const conflictHeaders = [
  "优先级", "application_id", "品牌", "车型", "车系/底盘", "发动机", "版本", "适用年份",
  "旧SKU", "旧配置", "WiperTech配置", "旧卡扣", "旧数据URL", "匹配依据", "问题类型",
  "证据URL", "审核结论", "确认配置(主/副/后)", "置信度", "审核人", "审核时间", "审核状态"
];
const conflictRows = conflictRaw.map((r) => [
  "P0", r.application_id, r.make_name, r.model_name, r.series_name, r.engine_name, r.variant_name,
  yearsLabel(r), r.sku, r.legacyFrontKey, r.wipertech_front_key, r.connector_type, r.source_url,
  r.matched_on, "旧雨刷与WiperTech长度冲突", "", "", "", "", "", "", "待确认"
]);

const productHeaders = [
  "优先级", "application_id", "品牌", "车型", "车系/底盘", "发动机", "版本", "适用年份",
  "产品类型", "位置", "候选SKU", "源适配ID", "匹配分", "匹配置信度", "匹配方式", "匹配依据",
  "同车型候选数", "待确认原因", "适配范围", "证据URL", "审核结论", "确认SKU", "置信度",
  "审核人", "审核时间", "审核状态"
];
const productRows = productRaw.map((r) => [
  r.position_conflict === "1" || Number(r.sku_candidates_for_application || 0) > 1 ? "P0" : r.match_confidence === "high" ? "P1" : "P2",
  r.application_id, r.make_name, r.model_name, r.series_name, r.engine_name, r.variant_name, yearsLabel(r),
  r.product_type, r.position, r.sku, r.source_fitment_id, Number(r.match_score || 0), r.match_confidence,
  r.match_method, r.matched_on, Number(r.sku_candidates_for_application || 0), r.fitment_status_reason,
  r.fitment_scope, "", "", "", "", "", "", "待确认"
]);

const workbook = Workbook.create();
const font = "Arial";
const colors = {
  navy: "#17365D",
  blue: "#D9EAF7",
  amber: "#FFF2CC",
  paleRed: "#FCE4D6",
  paleGreen: "#E2F0D9",
  gray: "#666666",
  border: "#D9E2F3",
};

function writeRows(sheet, startRow, rows) {
  if (!rows.length) return;
  const cols = rows[0].length;
  const chunkSize = 750;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    sheet.getRangeByIndexes(startRow - 1 + i, 0, chunk.length, cols).values = chunk;
  }
}

function setWidths(sheet, widths) {
  widths.forEach((width, i) => {
    sheet.getRange(`${colName(i + 1)}:${colName(i + 1)}`).format.columnWidth = width;
  });
}

function addReviewSheet(name, title, sourceLabel, headers, rows, inputStartCol, tableName, widths) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  sheet.getRange("A2").values = [[title]];
  sheet.getRange("A2").format.font = { name: font, size: 15, bold: true, color: colors.navy };
  sheet.getRange("A3").values = [[`数据源：${sourceLabel}；记录数：${rows.length}`]];
  sheet.getRange("A3").format.font = { name: font, size: 10, italic: true, color: colors.gray };
  sheet.getRange("A5").write([headers]);
  writeRows(sheet, 6, rows);
  const lastCol = colName(headers.length);
  const lastRow = Math.max(6, 5 + rows.length);
  const header = sheet.getRange(`A5:${lastCol}5`);
  header.format = {
    fill: colors.navy,
    font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
  };
  if (rows.length) {
    const body = sheet.getRange(`A6:${lastCol}${lastRow}`);
    body.format.font = { name: font, size: 9, color: "#222222" };
    body.format.verticalAlignment = "center";
    body.format.wrapText = false;
    const inputRange = sheet.getRange(`${colName(inputStartCol)}6:${lastCol}${lastRow}`);
    inputRange.format.fill = colors.amber;
    const statusCol = lastCol;
    sheet.getRange(`${statusCol}6:${statusCol}${lastRow}`).dataValidation = {
      rule: { type: "list", values: ["待确认", "已确认", "需进一步搜索", "不适用"] }
    };
    sheet.getRange(`${colName(headers.length - 3)}6:${colName(headers.length - 3)}${lastRow}`).dataValidation = {
      rule: { type: "list", values: ["高", "中", "低"] }
    };
    const table = sheet.tables.add(`A5:${lastCol}${lastRow}`, true, tableName);
    table.style = "TableStyleMedium2";
    table.showFilterButton = true;
  }
  sheet.freezePanes.freezeRows(5);
  sheet.freezePanes.freezeColumns(Math.min(4, headers.length));
  setWidths(sheet, widths);
  sheet.getRange("A2:Z3").format.rowHeight = 21;
  sheet.getRange("A5:AZ5").format.rowHeight = 34;
  return { sheet, lastRow, lastCol };
}

const summary = workbook.worksheets.add("摘要");
summary.showGridLines = false;
summary.tabColor = colors.navy;
summary.getRange("A2").values = [["Egroup 新增车型适配复用与待审核队列"]];
summary.getRange("A2").format.font = { name: font, size: 16, bold: true, color: colors.navy };
summary.getRange("A3").values = [["生产写入日期：2026-10-24｜权威源优先：WiperTech｜黄色列为审核人可编辑字段"]];
summary.getRange("A3").format.font = { name: font, size: 10, italic: true, color: colors.gray };
summary.getRange("A5:D5").values = [["已发布项目", "新增记录", "覆盖application", "覆盖application-year"]];
summary.getRange("A6:D8").values = [
  ["WiperTech雨刷", 2882, 2882, 16839],
  ["刹车片", 204, 181, 1422],
  ["机油滤芯", 183, 183, 1354],
];
summary.getRange("A10:D10").values = [["待审核队列", "记录数", "优先处理", "处理原则"]];
summary.getRange("A11:D14").values = [
  ["雨刷待搜索", wiperSearchRows.length, "P0/P1", "补齐权威证据或明确代际年份"],
  ["旧雨刷待确认", legacyRows.length, "P1", "确认底盘/车身后再复用"],
  ["雨刷冲突", conflictRows.length, "P0", "WiperTech默认优先，除非有更强证据"],
  ["产品适配待确认", productRows.length, "P0/P1", "多候选、位置或发动机差异需确认"],
];
summary.getRange("F5:H5").values = [["覆盖指标", "分子", "覆盖率"]];
summary.getRange("F6:H8").values = [
  ["Egroup雨刷application", 2882, 2882 / 8370],
  ["Egroup雨刷application-year", 16839, 16839 / 55384],
  ["Egroup车型库application总数", 8370, 1],
];
summary.getRange("H6:H8").format.numberFormat = "0.0%";
summary.getRange("A5:D5").format = summary.getRange("A10:D10").format = summary.getRange("F5:H5").format = {
  fill: colors.navy,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
summary.getRange("A6:D8").format.font = summary.getRange("A11:D14").format.font = summary.getRange("F6:H8").format.font = { name: font, size: 10 };
summary.getRange("B6:D14").format.numberFormat = "#,##0";
summary.getRange("A16:H16").values = [["发布边界", "说明", "", "", "", "", "", ""]];
summary.getRange("A16:H16").format = { fill: colors.blue, font: { name: font, size: 10, bold: true, color: colors.navy } };
summary.getRange("A17:H20").values = [
  ["已发布", "WiperTech直接高置信度命中；允许主/副单侧或仅后窗的部分配置；安全的刹车片/滤芯唯一候选。", "", "", "", "", "", ""],
  ["未发布", "旧雨刷补充候选、旧数据与WiperTech冲突、产品多候选/中低置信度数据。", "", "", "", "", "", ""],
  ["车型库纠错", "本轮未自动确认新的车型库错误；如审核发现底盘、车身或年份边界错误，填入“车型库需纠错”。", "", "", "", "", "", ""],
  ["生产校验", "雨刷2882个application和产品387条均已复核存在；重复发布配置0，缺失0。", "", "", "", "", "", ""],
];
summary.getRange("A17:H20").format.font = { name: font, size: 10 };
summary.getRange("A17:H20").format.wrapText = false;
setWidths(summary, [20, 74, 18, 22, 3, 30, 16, 14]);

addReviewSheet(
  "雨刷待搜索", "WiperTech 未能直接发布的车型", "wipertech/review_queue.csv",
  wiperSearchHeaders, wiperSearchRows, 15, "WiperSearchQueue",
  [8, 23, 14, 19, 18, 20, 14, 24, 22, 22, 25, 24, 42, 30, 34, 26, 23, 10, 12, 18, 13]
);
addReviewSheet(
  "旧雨刷待确认", "旧雨刷数据可补充但需确认底盘/车身", "wipertech/legacy_supplemental_candidates.csv",
  legacyHeaders, legacyRows, 20, "LegacyWiperReview",
  [8, 23, 14, 18, 18, 35, 22, 14, 13, 10, 10, 11, 9, 12, 12, 26, 44, 35, 42, 34, 26, 23, 10, 12, 18, 13]
);
addReviewSheet(
  "雨刷冲突", "旧雨刷数据与WiperTech配置冲突", "wipertech/legacy_wipertech_conflicts.csv",
  conflictHeaders, conflictRows, 16, "WiperConflictReview",
  [8, 23, 14, 18, 18, 35, 22, 14, 13, 12, 16, 9, 44, 26, 30, 34, 26, 23, 10, 12, 18, 13]
);
addReviewSheet(
  "产品适配待确认", "刹车片与滤芯的非唯一/非高置信度候选", "product-fitment-review-candidates.csv",
  productHeaders, productRows, 20, "ProductFitmentReview",
  [8, 23, 14, 18, 18, 36, 22, 14, 14, 9, 14, 18, 10, 12, 13, 30, 13, 36, 24, 34, 26, 16, 10, 12, 18, 13]
);

const corrections = workbook.worksheets.add("车型库需纠错");
corrections.showGridLines = false;
corrections.getRange("A2").values = [["车型库纠错记录"]];
corrections.getRange("A2").format.font = { name: font, size: 15, bold: true, color: colors.navy };
corrections.getRange("A3").values = [["本轮未自动确认新的车型库错误。审核其他队列时，如发现底盘、车身、代际或年份边界错误，请在下表登记。"]];
corrections.getRange("A3").format.font = { name: font, size: 10, italic: true, color: colors.gray };
const correctionHeaders = ["application_id", "品牌", "车型", "当前车系/底盘", "当前年份", "错误类型", "建议修正", "证据URL", "影响适配", "审核人", "审核时间", "状态"];
corrections.getRange("A5").write([correctionHeaders]);
corrections.getRange("A6:L55").format.fill = colors.amber;
corrections.getRange("L6:L55").dataValidation = { rule: { type: "list", values: ["待确认", "已确认", "已修改", "不修改"] } };
corrections.getRange("A5:L5").format = {
  fill: colors.navy,
  font: { name: font, size: 10, bold: true, color: "#FFFFFF" },
  horizontalAlignment: "center",
  verticalAlignment: "center",
  wrapText: true,
  borders: { preset: "inside", style: "thin", color: "#FFFFFF" },
};
corrections.getRange("A6:L55").format.font = { name: font, size: 9 };
corrections.freezePanes.freezeRows(5);
corrections.freezePanes.freezeColumns(3);
setWidths(corrections, [23, 14, 18, 20, 16, 22, 42, 38, 32, 12, 18, 13]);

workbook.recalculate();

const summaryCheck = await workbook.inspect({
  kind: "table",
  range: "摘要!A1:H20",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 8,
  maxChars: 8000,
});
console.log(summaryCheck.ndjson);

const errorCheck = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errorCheck.ndjson);

await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range] of [
  ["摘要", "A1:H20"],
  ["雨刷待搜索", "A1:U18"],
  ["旧雨刷待确认", "A1:Z18"],
  ["雨刷冲突", "A1:V18"],
  ["产品适配待确认", "A1:Z18"],
  ["车型库需纠错", "A1:L18"],
]) {
  const image = await workbook.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheetName}.png`), new Uint8Array(await image.arrayBuffer()));
}

await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const stat = await fs.stat(outputPath);
console.log(JSON.stringify({
  outputPath,
  sizeBytes: stat.size,
  counts: {
    wiperSearch: wiperSearchRows.length,
    legacyWiper: legacyRows.length,
    wiperConflicts: conflictRows.length,
    productReview: productRows.length,
  },
}, null, 2));
