import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const POSITIONS = ["driver", "passenger", "rear"];

export function cleanText(value) {
  return value === null || value === undefined
    ? ""
    : String(value).normalize("NFKC").replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
}

export function normalKey(value) {
  return cleanText(value).toLocaleLowerCase("en-NZ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function parseYearRange(value) {
  const years = [...cleanText(value).matchAll(/(?:18|19|20|21)\d{2}|3000/g)].map((match) => Number(match[0]));
  if (!years.length) return { yearStart: null, yearEnd: null };
  const rawEnd = years[1] ?? years[0];
  return { yearStart: years[0], yearEnd: rawEnd >= 3000 ? null : rawEnd };
}

export function buildWiperTechRecords(vehicles, products, mappings) {
  const productsById = new Map(products.map((row) => [cleanText(row.product_id), {
    productId: cleanText(row.product_id), sku: cleanText(row.sku), sizeInch: numberOrNull(row.size_inch),
    sizeMm: numberOrNull(row.size_mm), bayonet: cleanText(row.bayonet)
  }]));
  const mappedByVehicle = new Map();
  for (const mapping of mappings) {
    const product = productsById.get(cleanText(mapping.product_id));
    const position = cleanText(mapping.position).toLowerCase();
    if (!product || !POSITIONS.includes(position)) continue;
    const vehicleId = cleanText(mapping.vehicle_id);
    const group = mappedByVehicle.get(vehicleId) ?? { driver: [], passenger: [], rear: [] };
    group[position].push(product);
    mappedByVehicle.set(vehicleId, group);
  }

  const anomalies = [];
  const records = vehicles.map((vehicle) => {
    const vehicleId = cleanText(vehicle.vehicle_id);
    const mapped = mappedByVehicle.get(vehicleId) ?? { driver: [], passenger: [], rear: [] };
    const positions = {};
    for (const position of POSITIONS) {
      const unique = dedupeBy(mapped[position], (row) => `${row.sizeInch}:${row.sizeMm}`);
      positions[position] = unique.length === 1 ? unique[0] : null;
      if (unique.length > 1) anomalies.push({ vehicleId, position, products: unique });
    }
    return {
      vehicleId,
      make: cleanText(vehicle.make), model: cleanText(vehicle.model), series: cleanText(vehicle.series), body: cleanText(vehicle.body),
      makeKey: normalKey(vehicle.make), modelKey: normalKey(vehicle.model),
      yearStart: numberOrNull(vehicle.year_from), yearEnd: numberOrNull(vehicle.year_to),
      positions
    };
  });
  return { records, anomalies };
}

export function matchWiperTechRow(target, sourceRows) {
  const targetPrepared = prepareTarget(target);
  const candidates = sourceRows.filter((row) => row.makeKey === targetPrepared.makeKey
    && row.modelKey === targetPrepared.modelKey && yearsOverlap(targetPrepared, row));
  if (!candidates.length) return noMatch("未匹配-品牌车型年份");

  const exactYear = candidates.filter((row) => row.yearStart === targetPrepared.yearStart && nullableEnd(row.yearEnd) === nullableEnd(targetPrepared.yearEnd));
  let pool = exactYear.length ? exactYear : candidates;
  const contextual = pool.filter((row) => contextMatches(targetPrepared.contextKey, row));
  if (contextual.length) pool = contextual;

  const complete = pool.filter(hasCompleteFront);
  if (!complete.length) return reviewMatch("待审核-WiperTech前尺寸不完整", pool);
  const byConfig = groupBy(complete, configurationKey);
  if (byConfig.size !== 1) return reviewMatch("待审核-多个WiperTech尺寸", complete, [...byConfig.keys()]);

  const [configKey, supportingRows] = [...byConfig.entries()][0];
  const config = configurationFromRecord(supportingRows[0]);
  const currentFront = `${numberOrNull(target.driverIn) ?? "-"}/${numberOrNull(target.passengerIn) ?? "-"}`;
  const sourceFront = `${config.driverIn}/${config.passengerIn}`;
  const frontAgrees = currentFront === sourceFront;
  const basis = [exactYear.length ? "exact_year" : "overlap_year", contextual.length ? "series_or_body" : ""].filter(Boolean);

  if (exactYear.length || contextual.length) {
    return {
      status: exactYear.length && contextual.length ? "已应用-精确年份+车身/底盘" : exactYear.length ? "已应用-精确年份" : "已应用-车身/底盘",
      action: "apply_all", confidence: "high", frontAgrees, configKey, config, supportingRows, basis
    };
  }
  if (frontAgrees && config.rearIn !== null) {
    return { status: "已补后窗-前尺寸一致", action: "apply_rear", confidence: "medium", frontAgrees, configKey, config, supportingRows, basis: ["overlap_year", "front_corroborated"] };
  }
  if (frontAgrees) {
    return { status: "仅验证-前尺寸一致", action: "no_change", confidence: "medium", frontAgrees, configKey, config, supportingRows, basis: ["overlap_year", "front_corroborated"] };
  }
  return { status: "待审核-区间唯一但前尺寸冲突", action: "review", confidence: "low", frontAgrees, configKey, config, supportingRows, basis: ["overlap_year"] };
}

export function enrichWiperRows(targetRows, sourceRows) {
  const enriched = [];
  const review = [];
  const statusCounts = {};
  let changedRows = 0;
  let frontOverrides = 0;
  let rearFills = 0;

  for (const [index, row] of targetRows.entries()) {
    const target = {
      make: row["品牌"], model: row["车型"], yearRange: row["年份(规范)"], context: row["商品链接"],
      driverMm: row["驾驶位(mm)"], driverIn: row["驾驶位(寸)"], passengerMm: row["副驾(mm)"], passengerIn: row["副驾(寸)"],
      rearMm: row["后窗(mm)"], rearIn: row["后窗(寸)"]
    };
    const decision = matchWiperTechRow(target, sourceRows);
    statusCounts[decision.status] = (statusCounts[decision.status] ?? 0) + 1;
    const output = { ...row };
    const original = { driverMm: target.driverMm, driverIn: target.driverIn, passengerMm: target.passengerMm, passengerIn: target.passengerIn, rearMm: target.rearMm, rearIn: target.rearIn };
    let changed = false;

    if (decision.action === "apply_all") {
      output["驾驶位(mm)"] = decision.config.driverMm;
      output["驾驶位(寸)"] = decision.config.driverIn;
      output["副驾(mm)"] = decision.config.passengerMm;
      output["副驾(寸)"] = decision.config.passengerIn;
      if (decision.config.rearIn !== null) {
        output["后窗(mm)"] = decision.config.rearMm;
        output["后窗(寸)"] = decision.config.rearIn;
        if (numberOrNull(target.rearIn) !== decision.config.rearIn) rearFills += 1;
      }
      changed = !sameSize(original.driverIn, decision.config.driverIn) || !sameSize(original.passengerIn, decision.config.passengerIn)
        || (decision.config.rearIn !== null && !sameSize(original.rearIn, decision.config.rearIn));
      if (!decision.frontAgrees) frontOverrides += 1;
    } else if (decision.action === "apply_rear") {
      output["后窗(mm)"] = decision.config.rearMm;
      output["后窗(寸)"] = decision.config.rearIn;
      changed = !sameSize(original.rearIn, decision.config.rearIn);
      if (changed) rearFills += 1;
    }
    if (changed) changedRows += 1;

    output["尺寸来源"] = decision.action === "apply_all" ? "WiperTech" : decision.action === "apply_rear" ? "OG Wipers（前）+ WiperTech（后）" : "OG Wipers";
    output["WiperTech匹配状态"] = decision.status;
    output["WiperTech车辆ID"] = decision.supportingRows?.map((item) => item.vehicleId).join(",") ?? "";
    output["WiperTech匹配依据"] = decision.basis?.join("+") ?? "";
    output["WiperTech驾驶位SKU"] = skuList(decision.supportingRows, "driver");
    output["WiperTech副驾SKU"] = skuList(decision.supportingRows, "passenger");
    output["WiperTech后窗SKU"] = skuList(decision.supportingRows, "rear");
    for (const [label, value] of Object.entries({
      "原驾驶位(mm)": original.driverMm, "原驾驶位(寸)": original.driverIn, "原副驾(mm)": original.passengerMm,
      "原副驾(寸)": original.passengerIn, "原后窗(mm)": original.rearMm, "原后窗(寸)": original.rearIn
    })) output[label] = changed ? value : "";
    enriched.push(output);

    if (decision.action === "review") {
      review.push({
        "主表行号": index + 2, "品牌": target.make, "车型": target.model, "年份": target.yearRange, "状态": decision.status,
        "当前配置(驾驶/副驾/后窗)": `${target.driverIn || "-"}/${target.passengerIn || "-"}/${target.rearIn || "-"}`,
        "WiperTech候选配置": decision.configKey || decision.candidateConfigs?.join(" | ") || "",
        "WiperTech车辆ID": decision.supportingRows?.map((item) => item.vehicleId).join(",") ?? "",
        "商品链接": target.context
      });
    }
  }
  return { enriched, review, summary: { targetRows: targetRows.length, changedRows, frontOverrides, rearFills, reviewRows: review.length, statusCounts } };
}

export function sourceRecordToRow(record) {
  return {
    vehicle_id: record.vehicleId, make: record.make, model: record.model, series: record.series, body: record.body,
    year_from: record.yearStart, year_to: record.yearEnd,
    driver_sku: record.positions.driver?.sku ?? "", driver_mm: record.positions.driver?.sizeMm ?? "", driver_in: record.positions.driver?.sizeInch ?? "",
    passenger_sku: record.positions.passenger?.sku ?? "", passenger_mm: record.positions.passenger?.sizeMm ?? "", passenger_in: record.positions.passenger?.sizeInch ?? "",
    rear_sku: record.positions.rear?.sku ?? "", rear_mm: record.positions.rear?.sizeMm ?? "", rear_in: record.positions.rear?.sizeInch ?? ""
  };
}

function prepareTarget(target) {
  const years = parseYearRange(target.yearRange);
  return { ...target, makeKey: normalKey(target.make), modelKey: normalKey(target.model), contextKey: normalKey(target.context), ...years };
}
function yearsOverlap(left, right) {
  if (left.yearStart === null || right.yearStart === null) return false;
  return Math.max(left.yearStart, right.yearStart) <= Math.min(nullableEnd(left.yearEnd), nullableEnd(right.yearEnd));
}
function nullableEnd(value) { return value === null || value === undefined || value === "" || Number(value) >= 3000 ? 9999 : Number(value); }
function contextMatches(contextKey, row) {
  return [row.series, row.body].map(normalKey).filter((value) => value.length >= 2)
    .some((value) => new RegExp(`(^| )${escapeRegex(value)}( |$)`).test(contextKey));
}
function hasCompleteFront(row) { return numberOrNull(row.positions.driver?.sizeInch) !== null && numberOrNull(row.positions.passenger?.sizeInch) !== null; }
function configurationKey(row) {
  const config = configurationFromRecord(row);
  return `${config.driverIn}/${config.passengerIn}/${config.rearIn ?? "-"}`;
}
function configurationFromRecord(row) {
  return {
    driverMm: row.positions.driver.sizeMm, driverIn: row.positions.driver.sizeInch,
    passengerMm: row.positions.passenger.sizeMm, passengerIn: row.positions.passenger.sizeInch,
    rearMm: row.positions.rear?.sizeMm ?? null, rearIn: row.positions.rear?.sizeInch ?? null
  };
}
function noMatch(status) { return { status, action: "no_change", confidence: "none", supportingRows: [], basis: [] }; }
function reviewMatch(status, supportingRows, candidateConfigs = []) { return { status, action: "review", confidence: "low", supportingRows, candidateConfigs, basis: [] }; }
function sameSize(left, right) { return numberOrNull(left) === numberOrNull(right); }
function skuList(rows = [], position) { return [...new Set(rows.map((row) => row.positions[position]?.sku).filter(Boolean))].sort().join(","); }
function numberOrNull(value) { const text = cleanText(value); if (!text) return null; const number = Number(text); return Number.isFinite(number) ? number : null; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function groupBy(rows, keyFn) { const result = new Map(); for (const row of rows) { const key = keyFn(row); const group = result.get(key) ?? []; group.push(row); result.set(key, group); } return result; }
function dedupeBy(rows, keyFn) { return [...new Map(rows.map((row) => [keyFn(row), row])).values()]; }
function readRows(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function writeCsv(file, rows) { const sheet = XLSX.utils.json_to_sheet(rows); fs.writeFileSync(file, XLSX.utils.sheet_to_csv(sheet)); }
function parseArgs(argv) { const result = {}; for (let index = 0; index < argv.length; index += 1) { if (!argv[index].startsWith("--")) continue; result[argv[index].slice(2)] = argv[index + 1]; index += 1; } return result; }

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = path.resolve(args.source ?? "C:/Users/Sanli/Desktop/database/wipertech");
  const targetFile = path.resolve(args.target ?? "C:/Users/Sanli/Desktop/database/wiper_fitment.xlsx");
  const outputDir = path.resolve(args.output ?? "outputs/wipertech-enrichment-20261022");
  fs.mkdirSync(outputDir, { recursive: true });

  const vehicles = readRows(path.join(sourceDir, "wipertech_vehicles.csv"));
  const products = readRows(path.join(sourceDir, "wipertech_wipers.csv"));
  const mappings = readRows(path.join(sourceDir, "wipertech_mapping.csv"));
  const { records, anomalies } = buildWiperTechRecords(vehicles, products, mappings);
  if (anomalies.length) throw new Error(`WiperTech has ${anomalies.length} conflicting vehicle-position mappings.`);

  const targetBook = XLSX.readFile(targetFile, { raw: true, cellDates: true });
  const mainSheetName = "雨刮适配全量";
  const targetRows = XLSX.utils.sheet_to_json(targetBook.Sheets[mainSheetName], { defval: "", raw: true });
  const { enriched, review, summary } = enrichWiperRows(targetRows, records);
  const sourceRows = records.map(sourceRecordToRow);
  const workbookSheets = Object.fromEntries(targetBook.SheetNames.map((sheetName) => [sheetName,
    XLSX.utils.sheet_to_json(targetBook.Sheets[sheetName], { header: 1, defval: "", raw: true })]));

  writeCsv(path.join(outputDir, "wipertech_fitment_extract.csv"), sourceRows);
  writeCsv(path.join(outputDir, "wipertech_match_review.csv"), review);
  fs.writeFileSync(path.join(outputDir, "wipertech_enriched_data.json"), JSON.stringify({ workbookSheets, enriched, review, sourceRows, summary }, null, 2));
  fs.writeFileSync(path.join(outputDir, "wipertech_enrichment_summary.json"), JSON.stringify({
    source: { vehicles: vehicles.length, products: products.length, mappings: mappings.length, anomalies: anomalies.length }, ...summary
  }, null, 2));
  console.log(JSON.stringify({ outputDir, source: { vehicles: vehicles.length, products: products.length, mappings: mappings.length }, ...summary }, null, 2));
}
