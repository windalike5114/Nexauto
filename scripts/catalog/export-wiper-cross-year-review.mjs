import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const artifactRequire = createRequire(pathToFileURL(path.join(process.cwd(), ".artifact-work", "wiper-review", "package.json")));
const artifactTool = await import(pathToFileURL(artifactRequire.resolve("@oai/artifact-tool")).href);
const { FileBlob, SpreadsheetFile, Workbook } = artifactTool;

const inputPath = path.resolve(process.argv[2] ?? "tmp/fitment-v4/fitment-v4-manifest.json");
const outputPath = path.resolve(process.argv[3] ?? "outputs/NexAuto_雨刷交叉年份人工审核.xlsx");
const previewDir = path.resolve(process.argv[4] ?? ".artifact-work/wiper-review/previews");
const manifest = JSON.parse(await fs.readFile(inputPath, "utf8"));
const reviewRows = manifest.manualReview.filter((row) => row.category === "wiper");
const suggestedCount = reviewRows.filter((row) => row.suggested_configuration_key).length;
const lastRow = reviewRows.length + 5;

const workbook = Workbook.create();
const review = workbook.worksheets.add("雨刷审核");
const guide = workbook.worksheets.add("填写说明");

writeReviewSheet(review, reviewRows, lastRow);
writeGuideSheet(guide, manifest, reviewRows.length, suggestedCount, lastRow);

workbook.recalculate();
review.getRange("O6").values = [["接受建议"]];
review.getRange("S6").values = [["供应商目录测试"]];
workbook.recalculate();
const workflowCheck = await workbook.inspect({ kind: "table", range: "雨刷审核!K5:U6", include: "values,formulas", tableMaxRows: 2, tableMaxCols: 11, maxChars: 3000 });
if (!workflowCheck.ndjson.includes("可导入")) throw new Error("Workflow verification failed: accepting a suggestion with evidence did not become import-ready.");
review.getRange("O6").values = [[""]];
review.getRange("S6").values = [[""]];
workbook.recalculate();
const tableCheck = await workbook.inspect({
  kind: "table",
  range: `雨刷审核!A1:U${Math.min(lastRow, 16)}`,
  include: "values,formulas",
  tableMaxRows: 16,
  tableMaxCols: 21,
  maxChars: 12000
});
console.log(tableCheck.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan"
});
console.log(errors.ndjson);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, fileName, range] of [
  ["雨刷审核", "wiper-review.png", "A1:U18"],
  ["填写说明", "wiper-review-guide.png", "A1:F18"]
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  await fs.writeFile(path.join(previewDir, fileName), new Uint8Array(await preview.arrayBuffer()));
}
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const reopened = await SpreadsheetFile.importXlsx(await FileBlob.load(outputPath));
const savedCheck = await reopened.inspect({ kind: "table", range: "填写说明!A4:F15", include: "values,formulas", tableMaxRows: 12, tableMaxCols: 6, maxChars: 5000 });
if (!savedCheck.ndjson.includes("交叉年份待审核") || !savedCheck.ndjson.includes("184")) throw new Error("Saved workbook verification failed.");
console.log(JSON.stringify({ outputPath, reviewRows: reviewRows.length, suggestedCount, unresolvedSuggestions: reviewRows.length - suggestedCount }, null, 2));

function writeReviewSheet(sheet, rows, endRow) {
  sheet.showGridLines = false;
  sheet.tabColor = "#C2410C";
  sheet.getRange("A2:U2").format.borders = { bottom: { style: "thin", color: "#94A3B8" } };
  sheet.getRange("A2").values = [["雨刷交叉年份人工审核"]];
  sheet.getRange("A2").format.font = { name: "Arial", size: 15, bold: true, color: "#0F172A" };
  sheet.getRange("A3").values = [["黄色列由人工填写。程序建议仅用于辅助判断，不会自动发布。确认时优先使用底盘代号、车型代际或供应商证据。"]];
  sheet.getRange("A3:U3").format = { font: { name: "Arial", size: 10, italic: true, color: "#475569" } };

  const headers = [
    "车型ID", "品牌", "车型", "底盘代号", "车身/驱动", "发动机", "车型起始年", "车型结束年",
    "候选尺寸", "来源年份证据", "程序建议", "建议置信度", "建议依据", "必须确认",
    "人工决定", "确认驾驶位(英寸)", "确认副驾(英寸)", "确认后雨刷(英寸)", "证据来源", "审核备注", "导入状态"
  ];
  const values = rows.map((row) => [
    String(row.source_vehicle_id ?? ""), row.make, row.model, row.chassis, row.body, row.engine,
    numberOrBlank(row.year_start), numberOrBlank(row.year_end), row.configuration_key ?? "", row.candidate_ranges ?? "",
    row.suggested_configuration_key ?? "", numberOrBlank(row.suggestion_confidence), humanSuggestionReason(row.suggestion_reason),
    "底盘或车型代际", "", "", "", "", "", "", ""
  ]);
  sheet.getRange(`A5:U${endRow}`).values = [headers, ...values];
  sheet.getRange(`U6`).formulas = [[statusFormula(6)]];
  if (endRow > 6) sheet.getRange(`U6:U${endRow}`).fillDown();

  const all = sheet.getRange(`A5:U${endRow}`);
  all.format.font = { name: "Arial", size: 10, color: "#0F172A" };
  all.format.verticalAlignment = "center";
  all.format.borders = { insideHorizontal: { style: "thin", color: "#E2E8F0" } };
  sheet.getRange("A5:U5").format = { fill: "#334155", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
  sheet.getRange("A5:U5").format.rowHeight = 34;
  sheet.getRange(`O6:T${endRow}`).format.fill = "#FEF3C7";
  sheet.getRange(`I6:N${endRow}`).format.fill = "#F1F5F9";
  sheet.getRange(`U6:U${endRow}`).format.fill = "#F8FAFC";
  sheet.getRange(`G6:H${endRow}`).setNumberFormat("0");
  sheet.getRange(`L6:L${endRow}`).setNumberFormat("0%");
  sheet.getRange(`P6:R${endRow}`).setNumberFormat("0");
  sheet.getRange(`A6:U${endRow}`).format.rowHeight = 32;
  sheet.getRange(`E6:F${endRow}`).format.wrapText = true;
  sheet.getRange(`I6:N${endRow}`).format.wrapText = true;
  sheet.getRange(`S6:T${endRow}`).format.wrapText = true;

  sheet.getRange(`O6:O${endRow}`).dataValidation = { rule: { type: "list", values: ["接受建议", "手动填写", "无适配", "暂无法确认"] } };
  sheet.getRange(`P6:Q${endRow}`).dataValidation = { rule: { type: "list", values: ["14", "15", "16", "17", "18", "19", "20", "21", "22", "24", "26", "28", "30"] } };
  sheet.getRange(`R6:R${endRow}`).dataValidation = { rule: { type: "list", values: ["8", "10", "11", "12", "13", "14", "15", "16"] } };
  sheet.getRange(`U6:U${endRow}`).conditionalFormats.add("containsText", { text: "可导入", format: { fill: "#DCFCE7", font: { bold: true, color: "#166534" } } });
  sheet.getRange(`U6:U${endRow}`).conditionalFormats.add("containsText", { text: "缺少", format: { fill: "#FEE2E2", font: { bold: true, color: "#991B1B" } } });
  sheet.getRange(`U6:U${endRow}`).conditionalFormats.add("containsText", { text: "待处理", format: { fill: "#FEF3C7", font: { bold: true, color: "#92400E" } } });
  sheet.getRange(`U6:U${endRow}`).conditionalFormats.add("containsText", { text: "不发布", format: { fill: "#E2E8F0", font: { bold: true, color: "#334155" } } });

  const table = sheet.tables.add(`A5:U${endRow}`, true, "WiperReviewTable");
  table.style = "TableStyleMedium2";
  table.showBandedColumns = false;
  sheet.freezePanes.freezeRows(5);
  sheet.freezePanes.freezeColumns(4);

  const widths = [11, 14, 18, 22, 24, 42, 11, 11, 24, 42, 16, 12, 32, 20, 16, 16, 16, 17, 30, 32, 16];
  widths.forEach((width, index) => sheet.getRange(`${columnName(index + 1)}:${columnName(index + 1)}`).format.columnWidth = width);
}

function writeGuideSheet(sheet, manifest, reviewCount, suggestedCount, reviewLastRow) {
  sheet.showGridLines = false;
  sheet.tabColor = "#0F766E";
  sheet.getRange("A2").values = [["雨刷审核填写说明"]];
  sheet.getRange("A2").format.font = { name: "Arial", size: 15, bold: true, color: "#0F172A" };
  sheet.getRange("A2:F2").format.borders = { bottom: { style: "thin", color: "#94A3B8" } };
  sheet.getRange("A4:B8").values = [
    ["项目", "数量"],
    ["交叉年份待审核", reviewCount],
    ["已有程序建议", suggestedCount],
    ["没有唯一建议", reviewCount - suggestedCount],
    ["当前可导入", ""]
  ];
  sheet.getRange("B8").formulas = [[`=COUNTIFS('雨刷审核'!$U$6:$U$${reviewLastRow},"可导入")`]];
  sheet.getRange("A4:B8").format.font = { name: "Arial", size: 10, color: "#0F172A" };
  sheet.getRange("A4:B4").format = { fill: "#0F766E", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center" };
  sheet.getRange("A5:A8").format.font.bold = true;
  sheet.getRange("A4:B8").format.borders = { preset: "outside", style: "thin", color: "#CBD5E1" };

  sheet.getRange("A11:F11").values = [["人工决定", "驾驶位", "副驾", "后雨刷", "证据来源", "系统处理"]];
  sheet.getRange("A12:F15").values = [
    ["接受建议", "无需填写", "无需填写", "如有后雨刷需填写", "必须填写", "按程序建议尺寸导入"],
    ["手动填写", "必须填写", "必须填写", "无后雨刷可留空", "必须填写", "按人工尺寸导入"],
    ["无适配", "留空", "留空", "留空", "建议填写", "不发布雨刷关系"],
    ["暂无法确认", "留空", "留空", "留空", "可填写待查来源", "继续保留待审核"]
  ];
  sheet.getRange("A11:F15").format.font = { name: "Arial", size: 10, color: "#0F172A" };
  sheet.getRange("A11:F11").format = { fill: "#334155", font: { name: "Arial", size: 10, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", wrapText: true };
  sheet.getRange("A12:E15").format.fill = "#FEF3C7";
  sheet.getRange("A11:F15").format.wrapText = true;
  sheet.getRange("A11:F15").format.verticalAlignment = "center";
  sheet.getRange("A11:F15").format.borders = { insideHorizontal: { style: "thin", color: "#E2E8F0" } };

  sheet.getRange("A18:F18").values = [["判断顺序", "1. 底盘代号", "2. 车型代际", "3. 车身形式", "4. 准确年份", "5. 供应商或实车证据"]];
  sheet.getRange("A18:F18").format = { fill: "#E2E8F0", font: { name: "Arial", size: 10, bold: true, color: "#334155" }, wrapText: true };
  sheet.getRange("A20:F20").values = [["来源", "wiper_clean.csv", "车型库", "NEXAUTO_V3", `生成时间 ${manifest.report.generated_at}`, "尺寸单位：英寸"]];
  sheet.getRange("A20:F20").format = { font: { name: "Arial", size: 9, italic: true, color: "#64748B" } };
  sheet.getRange("A:A").format.columnWidth = 18;
  sheet.getRange("B:E").format.columnWidth = 26;
  sheet.getRange("F:F").format.columnWidth = 32;
  sheet.getRange("A1:F20").format.verticalAlignment = "center";
  sheet.getRange("A11:F15").format.autofitRows();
}

function statusFormula(row) {
  return `=IF(O${row}="接受建议",IF(AND(K${row}<>"",S${row}<>""),"可导入","缺少建议或证据"),IF(O${row}="手动填写",IF(AND(ISNUMBER(P${row}),ISNUMBER(Q${row}),S${row}<>""),"可导入","缺少尺寸或证据"),IF(O${row}="无适配","不发布","待处理")))`;
}

function humanSuggestionReason(reason) {
  if (reason === "generation_start_matches_wiper_range_start") return "车型代际起始年与雨刷来源起始年一致";
  if (reason === "nearest_generation_start_year") return "最接近车型代际起始年";
  return "";
}

function numberOrBlank(value) {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function columnName(index) {
  let result = "";
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
}
