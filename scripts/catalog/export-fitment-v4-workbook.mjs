import fs from "node:fs/promises";
import path from "node:path";

import { SpreadsheetFile, Workbook } from "file:///C:/Users/Sanli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const inputPath = path.resolve(process.argv[2] ?? "tmp/fitment-v4/fitment-v4-manifest.json");
const outputPath = path.resolve(process.argv[3] ?? "outputs/NexAuto_适配映射_V4.xlsx");
const manifest = JSON.parse(await fs.readFile(inputPath, "utf8"));
const workbook = Workbook.create();
const summary = workbook.worksheets.add("摘要");
const published = workbook.worksheets.add("已发布映射");
const review = workbook.worksheets.add("人工复核");
const rules = workbook.worksheets.add("匹配规则");

const columns = [
  "产品线", "车型ID", "品牌", "车型", "底盘", "车身/驱动", "发动机", "起始年", "结束年",
  "商品SKU", "零件号/雨刷组合", "推荐等级", "状态", "匹配规则", "置信度", "来源文件", "来源行", "匹配证据", "人工问题"
];

writeMappingSheet(published, columns, manifest.published, false);
writeMappingSheet(review, columns, manifest.manualReview, true);
writeSummary(summary, manifest);
writeRules(rules, manifest.report.rules);

workbook.recalculate();
const inspection = await workbook.inspect({ kind: "sheet,table", maxChars: 6000, tableMaxRows: 4, tableMaxCols: 8 });
console.log(inspection.ndjson);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const preview = await workbook.render({ sheetName: "摘要", autoCrop: "all", scale: 1, format: "png" });
await fs.writeFile(path.join(path.dirname(outputPath), "NexAuto_适配映射_V4_摘要.png"), new Uint8Array(await preview.arrayBuffer()));
console.log(`Workbook exported: ${outputPath}`);

function writeSummary(sheet, data) {
  sheet.showGridLines = false;
  sheet.tabColor = "#0F766E";
  sheet.getRange("A1:F1").merge();
  sheet.getRange("A1").values = [["NexAuto 配件适配映射 V4"]];
  sheet.getRange("A1:F1").format = {
    fill: "#0F172A",
    font: { color: "#FFFFFF", bold: true, size: 18 },
    verticalAlignment: "center"
  };
  sheet.getRange("A1:F1").format.rowHeight = 34;
  sheet.getRange("A2:F2").merge();
  sheet.getRange("A2").values = [["仅使用新车型库。电池按车身/底盘，滤芯按发动机，雨刷按唯一尺寸证据；不确定记录不对外发布。"]];
  sheet.getRange("A2:F2").format = { fill: "#E2E8F0", font: { color: "#334155", italic: true }, wrapText: true };
  sheet.getRange("A4:F7").values = [
    ["产品线", "已发布关系", "覆盖车型", "待人工复核", "发布条件", "当前处理"],
    ["battery", data.report.published_counts.battery ?? 0, data.report.published_vehicle_counts.battery ?? 0, data.report.review_counts.battery ?? 0, "精确底盘 + 精确车身", "可安全替换旧映射"],
    ["filter", data.report.published_counts.filter ?? 0, data.report.published_vehicle_counts.filter ?? 0, data.report.review_counts.filter ?? 0, "精确发动机 + 底盘/车型", "可安全替换旧映射"],
    ["wiper", data.report.published_counts.wiper ?? 0, data.report.published_vehicle_counts.wiper ?? 0, data.report.review_counts.wiper ?? 0, "同车型年份仅有一个有效尺寸组合", "歧义记录进入复核"]
  ];
  styleTableBlock(sheet.getRange("A4:F7"));
  sheet.tables.add("A4:F7", true, "SummaryTable").style = "TableStyleMedium2";

  const nke = data.report.nke165_check?.[0] ?? {};
  sheet.getRange("A10:F10").merge();
  sheet.getRange("A10").values = [["关键校验：Toyota Corolla NKE165"]];
  sectionHeader(sheet.getRange("A10:F10"));
  sheet.getRange("A11:F12").values = [
    ["车型ID", "底盘", "产品", "结果数", "匹配规则", "结论"],
    [nke.source_vehicle_id ?? "670", nke.chassis ?? "NKE165", nke.product ?? "S34B20R", data.report.nke165_check?.length ?? 0, nke.rule ?? "battery_exact_chassis_body", "仅保留 1 个适配电池"]
  ];
  styleTableBlock(sheet.getRange("A11:F12"));
  sheet.getRange("A12:F12").format.fill = "#DCFCE7";

  sheet.getRange("A15:F15").merge();
  sheet.getRange("A15").values = [["使用说明"]];
  sectionHeader(sheet.getRange("A15:F15"));
  sheet.getRange("A16:F19").values = [
    ["1", "“已发布映射”是可以进入线上查询的关系。", null, null, null, null],
    ["2", "“人工复核”里的记录不会对客户显示，补齐车身/发动机/年份后再导入。", null, null, null, null],
    ["3", "所有新生成商品仍保持 catalog_only 与 checkout_disabled，暂时不能购买。", null, null, null, null],
    ["4", `生成时间：${data.report.generated_at}`, null, null, null, null]
  ];
  for (let row = 16; row <= 19; row += 1) sheet.getRange(`B${row}:F${row}`).merge();
  sheet.getRange("A16:A19").format = { fill: "#0F766E", font: { color: "#FFFFFF", bold: true }, horizontalAlignment: "center" };
  sheet.getRange("B16:F19").format = { fill: "#F8FAFC", wrapText: true };
  sheet.getRange("A1:F19").format.verticalAlignment = "center";
  sheet.getRange("A1:F19").format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
  sheet.getRange("A1:F19").format.autofitRows();
  sheet.getRange("A:A").format.columnWidth = 18;
  sheet.getRange("B:D").format.columnWidth = 20;
  sheet.getRange("E:F").format.columnWidth = 34;
  sheet.freezePanes.freezeRows(2);
}

function writeMappingSheet(sheet, headers, rows, includeIssue) {
  sheet.showGridLines = false;
  sheet.tabColor = includeIssue ? "#D97706" : "#16A34A";
  const matrix = [headers, ...rows.map((row) => [
    row.category,
    row.source_vehicle_id,
    row.make,
    row.model,
    row.chassis,
    row.body,
    row.engine,
    row.year_start,
    row.year_end,
    row.product_sku,
    row.product_part_number || row.configuration_key || "",
    row.recommendation_level,
    row.mapping_status,
    row.match_rule,
    row.confidence,
    row.source_file,
    Array.isArray(row.source_row_numbers) ? row.source_row_numbers.join(",") : row.source_row_numbers,
    Array.isArray(row.match_reasons) ? row.match_reasons.join(", ") : row.match_reasons,
    includeIssue ? row.issue : ""
  ])];
  const endRow = Math.max(matrix.length, 1);
  const range = sheet.getRange(`A1:S${endRow}`);
  range.values = matrix;
  range.format.verticalAlignment = "center";
  range.format.borders = { preset: "all", style: "thin", color: "#E2E8F0" };
  range.format.wrapText = true;
  sheet.getRange("A1:S1").format = { fill: includeIssue ? "#92400E" : "#166534", font: { color: "#FFFFFF", bold: true }, wrapText: true };
  sheet.getRange("A1:S1").format.rowHeight = 30;
  sheet.getRange(`H2:I${endRow}`).setNumberFormat("0");
  sheet.getRange(`O2:O${endRow}`).setNumberFormat("0.00");
  sheet.tables.add(`A1:S${endRow}`, true, includeIssue ? "ReviewTable" : "PublishedTable").style = includeIssue ? "TableStyleMedium9" : "TableStyleMedium4";
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(4);
  const widths = [12, 10, 14, 18, 18, 24, 40, 10, 10, 24, 24, 20, 12, 34, 10, 32, 16, 42, 38];
  widths.forEach((width, index) => sheet.getRange(`${columnName(index + 1)}:${columnName(index + 1)}`).format.columnWidth = width);
  sheet.getRange(`A1:S${Math.min(endRow, 200)}`).format.autofitRows();
}

function writeRules(sheet, ruleMap) {
  sheet.showGridLines = false;
  sheet.tabColor = "#2563EB";
  sheet.getRange("A1:E1").merge();
  sheet.getRange("A1").values = [["产品线专属适配规则"]];
  sheet.getRange("A1:E1").format = { fill: "#1E3A8A", font: { color: "#FFFFFF", bold: true, size: 16 } };
  sheet.getRange("A3:E7").values = [
    ["产品线", "自动发布硬条件", "冲突时", "缺字段时", "原因"],
    ["电池", ruleMap.battery, "底盘、车身、燃油或驱动冲突即拒绝", "进入人工复核", "同一车型不同车身/动力可能使用不同电池"],
    ["滤芯", ruleMap.filter, "发动机或来源底盘冲突即拒绝", "缺发动机进入人工复核", "滤芯首先由发动机决定"],
    ["雨刷", ruleMap.wiper, "同一窗口出现多个尺寸即不发布", "要求补车身或精确年份", "Sedan/Hatchback/Wagon 及改款可能不同"],
    ["通用", "品牌一致且年份区间有交集；不使用旧 mapping_long 的宽泛前缀结果", "不做模糊继承", "只保留证据充分结果", "优先避免错误适配"]
  ];
  styleTableBlock(sheet.getRange("A3:E7"));
  sheet.tables.add("A3:E7", true, "RulesTable").style = "TableStyleMedium2";
  sheet.getRange("A9:E9").merge();
  sheet.getRange("A9").values = [["人工补数建议"]];
  sectionHeader(sheet.getRange("A9:E9"));
  sheet.getRange("A10:E13").values = [
    ["优先级", "产品线", "需要补充", "建议格式", "完成后动作"],
    [1, "电池", "精确底盘、车身、燃油/动力", "例：NKE165 | Sedan | Hybrid | FWD", "重新运行 V4 映射"],
    [2, "滤芯", "发动机代码", "例：1NZ-FXE（不要只写 1.5L）", "重新运行 V4 映射"],
    [3, "雨刷", "车身及改款分界年份", "例：Sedan | 2013–2017 | 26/14", "建立车身级雨刷证据"]
  ];
  styleTableBlock(sheet.getRange("A10:E13"));
  sheet.tables.add("A10:E13", true, "ActionsTable").style = "TableStyleMedium9";
  sheet.getRange("A1:E13").format.wrapText = true;
  sheet.getRange("A1:E13").format.verticalAlignment = "center";
  sheet.getRange("A:A").format.columnWidth = 14;
  sheet.getRange("B:B").format.columnWidth = 46;
  sheet.getRange("C:E").format.columnWidth = 36;
  sheet.getRange("A1:E13").format.autofitRows();
  sheet.freezePanes.freezeRows(1);
}

function styleTableBlock(range) {
  range.format.borders = { preset: "all", style: "thin", color: "#CBD5E1" };
  range.format.wrapText = true;
  range.format.verticalAlignment = "center";
  range.getRow(0).format = { fill: "#0F766E", font: { color: "#FFFFFF", bold: true } };
}

function sectionHeader(range) {
  range.format = { fill: "#0F766E", font: { color: "#FFFFFF", bold: true, size: 12 } };
}

function columnName(index) {
  let result = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}
