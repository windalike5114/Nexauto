import fs from "node:fs";
import path from "node:path";
import {
  bodyKey,
  brakeFamily,
  chassisTokens,
  compact,
  configEngineMatch,
  driveKey,
  familyScopedDetailedChassisMatch,
  platformCodeMatch
} from "./brake-pad-strict-policy.mjs";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const ROOT = process.cwd();
const GAP_FILE = path.resolve(ROOT, "outputs/brake-priority-unique-references-20261025/unresolved.jsonl");
const SNAPSHOT_FILE = path.resolve(ROOT, "outputs/brake-alias-group-review-round5-20261025/after-snapshot.json");
const OUT = path.resolve(ROOT, "outputs/brake-five-highfleet-plan-20261025");
const TARGETS = new Set([
  "Audi A4 / S4 Avant",
  "Volkswagen Golf",
  "Nissan Navara",
  "Toyota Corolla",
  "Suzuki Swift"
]);

const gaps = readJsonl(GAP_FILE).filter((row) => TARGETS.has(row.group));
const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
const source = readBendixWorkbook();

const applicationById = new Map(snapshot.applications.map((row) => [row.application_id, row]));
const makeById = new Map(snapshot.makes.map((row) => [row.make_id, row]));
const modelById = new Map(snapshot.models.map((row) => [row.model_id, row]));
const seriesById = new Map(snapshot.series.map((row) => [row.series_id, row]));
const variantById = new Map(snapshot.variants.map((row) => [row.variant_id, row]));
const powertrainById = new Map(snapshot.engines.map((row) => [row.powertrain_id, row]));
const engineCodeById = new Map(snapshot.engineCodes.map((row) => [row.engine_code_id, row.code]));
const engineCodesByPowertrain = groupBy(snapshot.powertrainEngineCodes, (row) => row.powertrain_id);

const activeSource = source.uniqueRows.filter((row) =>
  row.position && ["active", "to_be_discontinued"].includes(row.lifecycleStatus));

const analyses = gaps.map(analyzeGap);
const applicationSummary = summarizeApplications(analyses);
const groupSummary = [...groupBy(applicationSummary, (row) => row.group)].map(([group, rows]) => ({
  group,
  gap_applications: rows.length,
  gap_application_years: sum(rows.map((row) => row.application_years)),
  directly_recoverable_applications: rows.filter((row) => row.directly_recoverable).length,
  directly_recoverable_application_years: sum(rows.filter((row) => row.directly_recoverable).map((row) => row.application_years)),
  evidence_multi_applications: rows.filter((row) => row.best_status === "evidence_backed_multi_option").length,
  deterministic_unique_applications: rows.filter((row) => row.best_status === "deterministic_unique").length,
  year_split_applications: rows.filter((row) => row.best_status === "exact_config_partial_years").length,
  no_exact_config_applications: rows.filter((row) => row.best_status === "no_exact_configuration_evidence").length,
  no_local_candidate_applications: rows.filter((row) => row.best_status === "no_local_reference_candidate").length
})).sort((a, b) => b.gap_application_years - a.gap_application_years);

const report = {
  generated_at: new Date().toISOString(),
  policy: "BRAKE_EVIDENCE_BACKED_MULTI_OPTION_PREFLIGHT_V1_2026_10_25",
  sources: {
    gap_file: GAP_FILE,
    snapshot_file: SNAPSHOT_FILE,
    bendix_workbook: source.file,
    bendix_sha256: source.sha256
  },
  rules: [
    "A multiple-reference option is accepted only when Bendix has at least two DB rows matching the same platform, position, body, drive, engine/displacement and every target application year.",
    "A single exact DB is classified separately and can be published deterministically.",
    "Partial-year evidence requires an application-year split or vehicle-catalog correction; it is not extended to uncovered years.",
    "No-candidate and configuration-mismatch applications remain unresolved and are not counted as recoverable."
  ],
  totals: {
    gap_applications: applicationSummary.length,
    gap_application_years: sum(applicationSummary.map((row) => row.application_years)),
    directly_recoverable_applications: applicationSummary.filter((row) => row.directly_recoverable).length,
    directly_recoverable_application_years: sum(applicationSummary.filter((row) => row.directly_recoverable).map((row) => row.application_years)),
    evidence_multi_applications: applicationSummary.filter((row) => row.best_status === "evidence_backed_multi_option").length,
    deterministic_unique_applications: applicationSummary.filter((row) => row.best_status === "deterministic_unique").length
  },
  by_group: groupSummary,
  applications: applicationSummary,
  position_analysis: analyses
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "analysis.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, "position-analysis.csv"), toCsv(analyses.map((row) => ({
  group: row.group,
  application_id: row.application_id,
  series: row.series,
  body: row.body,
  drive: row.drive,
  engine: row.engine,
  years: row.years.join(","),
  position: row.position ?? "",
  review_candidates: row.candidates.join("/"),
  exact_full_year_dbs: row.exact_full_year_dbs.join("/"),
  exact_partial_year_dbs: row.exact_partial_year_dbs.join("/"),
  status: row.status,
  source_rows: row.source_rows.join(",")
}))));

console.log(JSON.stringify({ output: OUT, totals: report.totals, by_group: groupSummary }, null, 2));

function analyzeGap(gap) {
  const application = applicationById.get(gap.application_id);
  if (!application) return { ...gap, status: "application_missing_from_snapshot", exact_full_year_dbs: [], exact_partial_year_dbs: [], source_rows: [] };
  const model = modelById.get(application.model_id);
  const make = makeById.get(model?.make_id);
  const series = seriesById.get(application.series_id);
  const vehicleVariant = variantById.get(application.variant_id);
  const powertrain = powertrainById.get(application.powertrain_id);
  const engineCodes = (engineCodesByPowertrain.get(application.powertrain_id) ?? [])
    .map((row) => engineCodeById.get(row.engine_code_id)).filter(Boolean).map(compact);
  const app = {
    make: make?.name ?? gap.make,
    model: model?.name ?? gap.model,
    family: brakeFamily(make?.name ?? gap.make, model?.name ?? gap.model),
    series: series?.code ?? series?.display_name ?? gap.series,
    body: vehicleVariant?.body_style ?? gap.body,
    drive: vehicleVariant?.drive_type ?? "",
    engine: powertrain?.display_name ?? "",
    displacementCc: Number(powertrain?.displacement_cc) || null,
    engineCodes,
    years: gap.years.map(Number)
  };
  if (!gap.position || !gap.candidates.length) {
    return { ...gap, ...app, status: "no_local_reference_candidate", exact_full_year_dbs: [], exact_partial_year_dbs: [], source_rows: [] };
  }

  const candidateSet = new Set(gap.candidates);
  const platformRows = activeSource.filter((row) =>
    row.modelFamily === app.family
    && row.position === gap.position
    && candidateSet.has(row.bendixReference)
    && chassisTokens(row).some((token) => platformCodeMatch(app.family, app.series, token)
      || familyScopedDetailedChassisMatch(app.series, token)));
  const exactConfigRows = platformRows.filter((row) =>
    (!bodyKey(row.bodyStyle) || bodyKey(row.bodyStyle) === bodyKey(app.body))
    && (!driveKey(row.driveType) || driveKey(row.driveType) === driveKey(app.drive))
    && configEngineMatch(app, row));
  const byDb = groupBy(exactConfigRows, (row) => row.bendixReference);
  const exactFullYearDbs = [];
  const exactPartialYearDbs = [];
  for (const [db, rows] of byDb) {
    const covered = app.years.filter((year) => rows.some((row) => year >= row.yearFrom && year <= row.yearTo));
    if (covered.length === app.years.length) exactFullYearDbs.push(db);
    else if (covered.length) exactPartialYearDbs.push(db);
  }
  exactFullYearDbs.sort();
  exactPartialYearDbs.sort();
  const status = exactFullYearDbs.length > 1
    ? "evidence_backed_multi_option"
    : exactFullYearDbs.length === 1
      ? "deterministic_unique"
      : exactPartialYearDbs.length
        ? "exact_config_partial_years"
        : "no_exact_configuration_evidence";
  const usedRows = exactConfigRows.filter((row) => exactFullYearDbs.includes(row.bendixReference)
    || exactPartialYearDbs.includes(row.bendixReference));
  return {
    ...gap,
    ...app,
    status,
    exact_full_year_dbs: exactFullYearDbs,
    exact_partial_year_dbs: exactPartialYearDbs,
    source_rows: [...new Set(usedRows.map((row) => row.sourceRowId))].sort((a, b) => a - b)
  };
}

function summarizeApplications(rows) {
  return [...groupBy(rows, (row) => row.application_id)].map(([applicationId, items]) => {
    const priority = ["evidence_backed_multi_option", "deterministic_unique", "exact_config_partial_years", "no_exact_configuration_evidence", "no_local_reference_candidate"];
    const bestStatus = priority.find((status) => items.some((row) => row.status === status)) ?? items[0].status;
    const representative = items[0];
    return {
      group: representative.group,
      application_id: applicationId,
      series: representative.series,
      body: representative.body,
      drive: representative.drive,
      engine: representative.engine,
      years: representative.years,
      application_years: representative.years.length,
      best_status: bestStatus,
      directly_recoverable: ["evidence_backed_multi_option", "deterministic_unique"].includes(bestStatus),
      positions: items.map((row) => ({
        position: row.position,
        status: row.status,
        exact_full_year_dbs: row.exact_full_year_dbs,
        exact_partial_year_dbs: row.exact_partial_year_dbs,
        source_rows: row.source_rows
      }))
    };
  }).sort((a, b) => a.group.localeCompare(b.group) || a.series.localeCompare(b.series) || a.application_id.localeCompare(b.application_id));
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function groupBy(rows, keyFn) {
  const output = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!output.has(key)) output.set(key, []);
    output.get(key).push(row);
  }
  return output;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${headers.map(quote).join(",")}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(",")).join("\n")}\n`;
}
