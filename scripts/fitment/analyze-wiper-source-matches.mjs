import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";

import {
  normalizeCatalogKey,
  normalizeCatalogText,
  parseVehicleCatalogRow
} from "./vehicle-catalog-normalization.mjs";
import {
  expandCombinedModels,
  parseSeparateYearFields,
  parseWiperObservation
} from "./wiper-source-normalization.mjs";
import { matchWiperObservation } from "./vehicle-wiper-matcher.mjs";

const DEFAULT_FILES = {
  vehicle: "C:\\Users\\Sanli\\Downloads\\20261006_小车_machter车型库_三级全量(2).xlsx",
  wiperMaster: "C:\\Users\\Sanli\\Downloads\\wiper_master(1).xlsx",
  toyotaNz: "C:\\Users\\Sanli\\Downloads\\Toyota_NZ_Model_Years_V1 (1) (1).xlsx",
  cat078: "C:\\Users\\Sanli\\Desktop\\CAT078.xlsx",
  jpKr: "C:\\Users\\Sanli\\Downloads\\雨刮器型号表（日韩系）1 (1).xlsx"
};

const args = parseArgs(process.argv.slice(2));
const files = {
  vehicle: path.resolve(args.vehicle ?? DEFAULT_FILES.vehicle),
  wiperMaster: path.resolve(args["wiper-master"] ?? DEFAULT_FILES.wiperMaster),
  toyotaNz: path.resolve(args["toyota-nz"] ?? DEFAULT_FILES.toyotaNz),
  cat078: path.resolve(args.cat078 ?? DEFAULT_FILES.cat078),
  jpKr: path.resolve(args["jp-kr"] ?? DEFAULT_FILES.jpKr)
};

for (const [label, filePath] of Object.entries(files)) {
  if (!fs.existsSync(filePath)) throw new Error(`${label} source file not found: ${filePath}`);
}

const canonicalRows = parseCanonicalWorkbook(files.vehicle);
const sources = [
  parseWiperMaster(files.wiperMaster),
  parseToyotaNz(files.toyotaNz),
  parseCat078(files.cat078),
  parseJpKr(files.jpKr)
];

const sourceReports = sources.map((source) => analyzeSource(source, canonicalRows));
const allMatchedRows = sourceReports.flatMap((source) => source.rows.filter((row) => row.match.status === "matched"));
const duplicateGroups = findDuplicateGroups(allMatchedRows);
const conflictGroups = findConfigurationConflicts(allMatchedRows);
const report = {
  generated_at: new Date().toISOString(),
  mode: "read_only_preflight",
  policy: {
    canonical_backbone: "MACHTER_VEHICLE_CATALOG",
    sedan_hatchback_auto_merge: false,
    wiper_length_unit: "inch",
    remote_database_written: false
  },
  canonical: {
    source_file: files.vehicle,
    source_file_sha256: sha256File(files.vehicle),
    accepted_rows: canonicalRows.length,
    distinct_makes: new Set(canonicalRows.map((row) => row.make_key)).size,
    distinct_models: new Set(canonicalRows.map((row) => `${row.make_key}:${row.model_key}`)).size
  },
  summary: {
    observations: sum(sourceReports, "total_observations"),
    source_accepted: sum(sourceReports, "source_accepted"),
    source_review: sum(sourceReports, "source_review"),
    matched: sum(sourceReports, "matched"),
    vehicle_review: sum(sourceReports, "vehicle_review"),
    unmatched: sum(sourceReports, "unmatched"),
    exact_duplicate_groups: duplicateGroups.length,
    conflicting_configuration_groups: conflictGroups.length
  },
  sources: sourceReports,
  exact_duplicate_groups: duplicateGroups.slice(0, 500),
  configuration_conflicts: conflictGroups.slice(0, 500)
};

const outputPath = path.resolve(args.output ?? path.join(process.cwd(), "tmp", "wiper-source-match-report.json"));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

console.log(`Wiper source match report written to ${outputPath}`);
console.log(`Canonical accepted rows: ${canonicalRows.length}`);
console.log(`Summary: ${JSON.stringify(report.summary)}`);
for (const source of sourceReports) {
  console.log(`${source.source_code}: ${JSON.stringify({
    observations: source.total_observations,
    source_accepted: source.source_accepted,
    source_review: source.source_review,
    matched: source.matched,
    vehicle_review: source.vehicle_review,
    unmatched: source.unmatched
  })}`);
}

function parseCanonicalWorkbook(filePath) {
  const rows = readSheet(filePath, "车型库全量");
  return rows.slice(1)
    .map((row, index) => parseVehicleCatalogRow({
      make: row[0],
      model: row[1],
      variant: row[2],
      source_make_id: row[3],
      source_model_id: row[4],
      source_variant_id: row[5]
    }, index + 2))
    .filter((record) => record.parse_status === "accepted")
    .map((record) => ({
      row_number: record.row_number,
      ...record.normalized_values
    }));
}

function parseWiperMaster(filePath) {
  const rows = readSheet(filePath, "主表(2148行)");
  const observations = rows.slice(1).filter((row) => normalizeCatalogText(row[0]) || normalizeCatalogText(row[1])).map((row, index) => (
    parseWiperObservation({
      source_code: "WIPER_MASTER",
      row_number: index + 2,
      make: row[0],
      model: row[1],
      detail: row[2],
      year_range: row[3],
      driver: row[4],
      passenger: row[5],
      rear: row[6],
      unit: "mm",
      evidence: {
        rear_source: row[7],
        evidence_grade: row[8],
        original_evidence_grade: row[9],
        corroboration: row[10],
        notes: row[16]
      },
      raw_values: row.slice(0, 17)
    })
  ));
  return source("WIPER_MASTER", filePath, "主表(2148行)", observations);
}

function parseToyotaNz(filePath) {
  const rows = readSheet(filePath, "Toyota_Versions_NZ");
  const observations = rows.slice(1).filter((row) => normalizeCatalogText(row[0]) || normalizeCatalogText(row[1])).map((row, index) => (
    parseWiperObservation({
      source_code: "TOYOTA_NZ_MODEL_YEARS",
      row_number: index + 2,
      make: row[0],
      model: row[1],
      detail: row[2],
      date_range: parseSeparateYearFields(row[3], row[4]),
      year_range: `${row[3]}-${row[4]}`,
      driver: row[5],
      passenger: row[6],
      rear: row[7],
      unit: "in",
      chassis_codes: normalizeCatalogText(row[2]) ? [normalizeCatalogText(row[2]).toUpperCase()] : [],
      evidence: { connector: row[8], sku_front: row[9], sku_rear: row[10], notes: row[11] },
      raw_values: row.slice(0, 12)
    })
  ));
  return source("TOYOTA_NZ_MODEL_YEARS", filePath, "Toyota_Versions_NZ", observations);
}

function parseCat078(filePath) {
  const rows = readSheet(filePath, "Sheet1");
  const observations = [];
  let currentMake = "";

  for (let index = 2; index < rows.length; index += 1) {
    const row = rows[index];
    const first = normalizeCatalogText(row[0]);
    if (!first || /^make\s*&\s*model$/i.test(first)) continue;

    const hasOtherValues = row.slice(1, 8).some((value) => normalizeCatalogText(value));
    if (!hasOtherValues) {
      currentMake = normalizeCatMake(first);
      continue;
    }

    for (const model of expandCombinedModels(first)) {
      observations.push(parseWiperObservation({
        source_code: "CAT078",
        row_number: index + 1,
        make: currentMake,
        model,
        detail: "",
        date_range: parseSeparateYearFields(row[1], row[2]),
        year_range: `${row[1]}-${row[2]}`,
        driver: normalizeCatalogText(row[3]) || row[5],
        passenger: normalizeCatalogText(row[4]) || row[6],
        rear: row[7],
        unit: "in",
        evidence: { blade_source: normalizeCatalogText(row[3]) || normalizeCatalogText(row[4]) ? "FlexBlade" : "Complete Blade" },
        raw_values: row.slice(0, 8)
      }));
    }
  }
  return source("CAT078", filePath, "Sheet1", observations);
}

function parseJpKr(filePath) {
  const rows = readSheet(filePath, "工作表1");
  const observations = [];
  let currentMake = "";
  let currentModel = "";

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (normalizeCatalogText(row[0])) currentMake = normalizeCatalogText(row[0]);
    if (normalizeCatalogText(row[1])) currentModel = normalizeCatalogText(row[1]);
    if (!currentMake || !currentModel || !row.slice(2, 7).some((value) => normalizeCatalogText(value))) continue;

    observations.push(parseWiperObservation({
      source_code: "JP_KR_WIPER_TABLE",
      row_number: index + 1,
      make: currentMake,
      model: currentModel,
      detail: row[2],
      year_range: row[2],
      driver: row[3],
      passenger: row[4],
      rear: row[5],
      unit: "in",
      evidence: { notes: row[6] },
      raw_values: row.slice(0, 7)
    }));
  }
  return source("JP_KR_WIPER_TABLE", filePath, "工作表1", observations);
}

function analyzeSource(sourceData, canonicalRows) {
  const rowOccurrences = new Map();
  const rows = sourceData.observations.map((observation) => {
    const observationIndex = rowOccurrences.get(observation.row_number) ?? 0;
    rowOccurrences.set(observation.row_number, observationIndex + 1);
    return {
    source_code: sourceData.source_code,
    row_number: observation.row_number,
    observation_index: observationIndex,
    raw_values: observation.raw_values,
    normalized_values: observation.normalized_values,
    parse_status: observation.parse_status,
    parse_notes: observation.parse_notes,
    match: matchWiperObservation(observation, canonicalRows)
  };
  });
  const counts = countBy(rows, (row) => row.match.status);
  return {
    source_code: sourceData.source_code,
    source_file: sourceData.file_path,
    source_file_sha256: sha256File(sourceData.file_path),
    sheet_name: sourceData.sheet_name,
    total_observations: rows.length,
    source_accepted: rows.filter((row) => row.parse_status === "accepted").length,
    source_review: rows.filter((row) => row.parse_status === "review").length,
    matched: counts.matched ?? 0,
    vehicle_review: counts.review ?? 0,
    unmatched: counts.unmatched ?? 0,
    rows
  };
}

function findDuplicateGroups(rows) {
  const groups = groupBy(rows, (row) => {
    const value = row.normalized_values;
    const target = row.match.suggested_target;
    return [
      target.source_variant_id,
      value.driver_length_in,
      value.passenger_length_in,
      value.rear_length_in ?? ""
    ].join(":");
  });

  return [...groups.entries()]
    .filter(([, items]) => new Set(items.map((item) => item.source_code)).size > 1)
    .map(([signature, items]) => ({
      signature,
      source_codes: [...new Set(items.map((item) => item.source_code))],
      records: items.map(referenceRow)
    }));
}

function findConfigurationConflicts(rows) {
  const groups = groupBy(rows, (row) => row.match.suggested_target.source_variant_id);
  return [...groups.entries()].map(([sourceVariantId, items]) => {
    const configurations = groupBy(items, (item) => {
      const value = item.normalized_values;
      return `${value.driver_length_in}/${value.passenger_length_in}/${value.rear_length_in ?? "-"}`;
    });
    return {
      source_variant_id: sourceVariantId,
      configurations: [...configurations.entries()].map(([sizes, records]) => ({ sizes, records: records.map(referenceRow) }))
    };
  }).filter((group) => group.configurations.length > 1);
}

function referenceRow(row) {
  return { source_code: row.source_code, row_number: row.row_number };
}

function readSheet(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Worksheet not found: ${sheetName} in ${filePath}`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "", raw: false });
}

function source(sourceCode, filePath, sheetName, observations) {
  return { source_code: sourceCode, file_path: filePath, sheet_name: sheetName, observations };
}

function normalizeCatMake(value) {
  return normalizeCatalogText(value).replace(/\s+cont\.$/i, "");
}

function groupBy(values, keyFn) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const items = groups.get(key) ?? [];
    items.push(value);
    groups.set(key, items);
  }
  return groups;
}

function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = keyFn(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sum(values, key) {
  return values.reduce((total, value) => total + value[key], 0);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    result[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return result;
}
