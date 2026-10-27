import fs from "node:fs";
import path from "node:path";
import { bodyKey, brakeFamily, configEngineMatch, driveKey } from "./brake-pad-strict-policy.mjs";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "brake-priority-exact-config-analysis-20261025");
const SNAPSHOT = JSON.parse(fs.readFileSync(path.join(ROOT, "outputs", "brake-alias-group-review-round5-20261025", "after-snapshot.json"), "utf8"));
const unresolvedRows = fs.readFileSync(path.join(ROOT, "outputs", "brake-priority-unique-references-20261025", "unresolved.jsonl"), "utf8")
  .split(/\r?\n/).filter(Boolean).map(JSON.parse);
const groupByApplication = new Map(unresolvedRows.map((row) => [row.application_id, row.group]));
const targetIds = new Set(groupByApplication.keys());
const source = readBendixWorkbook();

const makeById = new Map(SNAPSHOT.makes.map((row) => [row.make_id, row]));
const modelById = new Map(SNAPSHOT.models.map((row) => [row.model_id, row]));
const seriesById = new Map(SNAPSHOT.series.map((row) => [row.series_id, row]));
const variantById = new Map(SNAPSHOT.variants.map((row) => [row.variant_id, row]));
const powertrainById = new Map(SNAPSHOT.engines.map((row) => [row.powertrain_id, row]));
const engineCodeById = new Map(SNAPSHOT.engineCodes.map((row) => [row.engine_code_id, row]));
const engineLinksByPowertrain = groupBy(SNAPSHOT.powertrainEngineCodes, (row) => row.powertrain_id);
const yearsByApplication = groupBy(SNAPSHOT.years, (row) => row.application_id);
const sourceByFamilyPosition = groupBy(source.uniqueRows.filter((row) => ["active", "to_be_discontinued"].includes(row.lifecycleStatus) && row.position),
  (row) => `${row.modelFamily}|${row.position}`);

const safe = [];
const unresolved = [];
for (const application of SNAPSHOT.applications.filter((row) => targetIds.has(row.application_id) && row.status === "active")) {
  const model = modelById.get(application.model_id);
  const make = makeById.get(model?.make_id);
  const series = seriesById.get(application.series_id)?.code ?? "";
  const variant = variantById.get(application.variant_id);
  const powertrain = powertrainById.get(application.powertrain_id);
  const engineCodes = unique((engineLinksByPowertrain.get(application.powertrain_id) ?? []).map((row) => engineCodeById.get(row.engine_code_id)?.code));
  const years = (yearsByApplication.get(application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  const family = brakeFamily(make?.name, model?.name);
  for (const position of ["front", "rear"]) {
    const familyRows = sourceByFamilyPosition.get(`${family}|${position}`) ?? [];
    const exact = familyRows.filter((row) => bodyKey(row.bodyStyle) === bodyKey(variant?.body_style)
      && driveKey(row.driveType) === driveKey(variant?.drive_type)
      && exactCodeRoundedDisplacementMatch({ engineCodes, displacementCc: powertrain?.displacement_cc }, row));
    const overlap = exact.filter((row) => years.some((year) => year >= row.yearFrom && year <= row.yearTo));
    const missingYears = years.filter((year) => !overlap.some((row) => year >= row.yearFrom && year <= row.yearTo));
    const candidates = unique(overlap.map((row) => row.bendixReference));
    const record = { group: groupByApplication.get(application.application_id), application_id: application.application_id,
      make: make?.name, model: model?.name, series, body: variant?.body_style, drive: variant?.drive_type,
      engine_codes: engineCodes, displacement_cc: powertrain?.displacement_cc, years, position, candidates,
      source_row_numbers: unique(overlap.map((row) => row.sourceRowId)), missing_years: missingYears };
    if (exact.length && !missingYears.length && candidates.length === 1) safe.push({ ...record, decision: "publish_exact_config_unique_db" });
    else if (exact.length) unresolved.push({ ...record, reason: missingYears.length ? "partial_source_year_coverage" : "multiple_db_after_exact_config" });
  }
}

const safeApplicationYears = new Map();
for (const row of safe) safeApplicationYears.set(row.application_id, row.years.filter((year) => year >= 2000 && year <= 2026).length);
const summary = {
  generated_at: new Date().toISOString(), source_sha256: source.sha256,
  rule: "same make/model + exact engine/displacement + exact body + exact drive + every application year covered + one DB for the position",
  safe_relationships: safe.length, safe_applications: safeApplicationYears.size,
  safe_application_years_2000_2026: [...safeApplicationYears.values()].reduce((sum, value) => sum + value, 0),
  by_group: [...groupBy(safe, (row) => row.group)].map(([group, rows]) => ({ group, relationships: rows.length,
    applications: new Set(rows.map((row) => row.application_id)).size,
    application_years: [...new Map(rows.map((row) => [row.application_id, row.years.filter((year) => year >= 2000 && year <= 2026).length])).values()].reduce((sum, value) => sum + value, 0) }))
    .sort((a, b) => b.application_years - a.application_years || a.group.localeCompare(b.group)),
  unresolved_exact_config_relationships: unresolved.length,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUT, "safe.jsonl"), safe.map(JSON.stringify).join("\n") + (safe.length ? "\n" : ""));
fs.writeFileSync(path.join(OUT, "unresolved.jsonl"), unresolved.map(JSON.stringify).join("\n") + (unresolved.length ? "\n" : ""));
console.log(JSON.stringify(summary, null, 2));

function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupBy(values, keyFn) { const map = new Map(); for (const value of values) { const key = keyFn(value); const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); } return map; }
function exactCodeRoundedDisplacementMatch(application, sourceRow) {
  if (configEngineMatch(application, sourceRow)) return true;
  const appCodes = new Set((application.engineCodes ?? []).map(compact));
  const exactCode = (sourceRow.engineCodes ?? []).some((code) => appCodes.has(compact(code)));
  const appCc = Number(application.displacementCc), sourceCc = Number(sourceRow.displacementCc);
  return exactCode && appCc > 0 && sourceCc > 0 && Math.abs(appCc - sourceCc) <= Math.max(50, sourceCc * 0.05);
}
function compact(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
