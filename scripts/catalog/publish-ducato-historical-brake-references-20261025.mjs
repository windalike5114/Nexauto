import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const SOURCE_CODE = "BENDIX_NZ_HISTORICAL_FITMENT_V1";
const POLICY = "DUCATO_230_244_HISTORICAL_UNIQUE_REFERENCE_V1_2026_10_25";
const INPUT = path.join(ROOT, "outputs", "extended132-six-brake-gap-diagnosis-20261025", "application-positions.csv");
const OUTPUT = path.join(ROOT, "outputs", "ducato-historical-brake-references-20261025");

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const inputRows = XLSX.utils.sheet_to_json(XLSX.readFile(INPUT, { raw: false }).Sheets.Sheet1, { defval: "" })
  .filter((row) => row.popular_group === "Fiat Ducato" && row.outcome === "historical_unique_source_candidate");
assert(inputRows.length === 102, `Expected 102 application-position rows, got ${inputRows.length}`);
const applicationIds = unique(inputRows.map((row) => row.application_id));
assert(applicationIds.length === 51, `Expected 51 applications, got ${applicationIds.length}`);

const [applications, years, series, models, makes, references, existingFitments, productFitments, sourceBefore, batchesBefore] = await Promise.all([
  selectIn("vehicle_catalog_applications", "*", "application_id", applicationIds),
  selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", applicationIds),
  fetchAll("vehicle_catalog_series", "series_id,code,display_name"),
  fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll("vehicle_catalog_makes", "make_id,name,status"),
  fetchAll("catalog_part_references", "*", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "bendix_db").in("normalized_value", ["DB2045", "DB2046"])),
  selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", applicationIds),
  selectIn("vehicle_catalog_product_fitments", "*", "application_id", applicationIds),
  fetchAll("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)),
  fetchAll("catalog_import_batches", "*"),
]);

const sourceWorkbook = readBendixWorkbook();
const appById = new Map(applications.map((row) => [row.application_id, row]));
const yearsByApp = groupBy(years, (row) => row.application_id);
const seriesById = new Map(series.map((row) => [row.series_id, row]));
const modelById = new Map(models.map((row) => [row.model_id, row]));
const makeById = new Map(makes.map((row) => [row.make_id, row]));
const refByDb = new Map(references.map((row) => [row.normalized_value, row]));
const refValueById = new Map(references.map((row) => [row.id, row.normalized_value]));
const blockers = [];
const fitments = [];

for (const row of inputRows) {
  const app = appById.get(row.application_id);
  const appSeries = seriesById.get(app?.series_id);
  const model = modelById.get(app?.model_id);
  const make = makeById.get(model?.make_id);
  const appYears = (yearsByApp.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
  const scopedYears = appYears.filter((year) => year >= 2000 && year <= 2026);
  const dbValue = String(row.candidate_db).trim();
  const expectedDb = row.position === "front" ? "DB2045" : row.position === "rear" ? "DB2046" : "";
  const seriesToken = String(appSeries?.code ?? appSeries?.display_name ?? "").replace(/[^0-9]/g, "");
  const evidenceRows = sourceWorkbook.uniqueRows.filter((item) => item.bendixReference === dbValue && item.position === row.position
    && ["discontinued", "superseded"].includes(item.lifecycleStatus) && item.seriesKey.endsWith(seriesToken));
  const sourceRowNumbers = unique(evidenceRows.map((item) => item.sourceRowId)).sort((a, b) => a - b);
  const differentPublished = existingFitments.filter((item) => item.application_id === row.application_id
    && item.position === row.position && item.fitment_status === "published"
    && refValueById.get(item.part_reference_id) && refValueById.get(item.part_reference_id) !== dbValue);
  const checks = [
    [app?.status === "active", "application inactive or missing"],
    [upper(make?.name) === "FIAT" && upper(model?.name) === "DUCATO", "vehicle identity changed"],
    [["230_", "244_"].includes(appSeries?.code ?? appSeries?.display_name), "series is not 230_ or 244_"],
    [scopedYears.length === Number(row.application_years), "scoped application years changed"],
    [dbValue === expectedDb, "unexpected position/reference mapping"],
    [Boolean(refByDb.get(dbValue)), "reference row missing"],
    [sourceRowNumbers.length > 0 && evidenceRows.length === sourceRowNumbers.length, "source rows missing"],
    [evidenceRows.every((item) => item.bendixReference === dbValue && item.position === row.position), "source row DB/position mismatch"],
    [evidenceRows.every((item) => ["discontinued", "superseded"].includes(item.lifecycleStatus)), "source row is not historical"],
    [appYears.every((year) => evidenceRows.some((item) => year >= item.yearFrom && year <= item.yearTo)), "historical source does not cover every year"],
    [differentPublished.length === 0, "different published reference exists"],
  ];
  for (const [pass, reason] of checks) if (!pass) blockers.push({ application_id: row.application_id, position: row.position, reason,
    live_years: appYears, scoped_years: scopedYears, source_ranges: evidenceRows.map((item) => `${item.yearFrom}-${item.yearTo}`) });
  fitments.push({
    application_id: row.application_id,
    part_reference_id: refByDb.get(dbValue)?.id,
    position: row.position,
    fitment_status: "published",
    confidence: "exact",
    source_row_numbers: sourceRowNumbers,
    match_reasons: ["historical_catalogue_unique_full_year_coverage", `platform_${appSeries?.code ?? appSeries?.display_name}`],
    metadata: { policy_version: POLICY, historical_reference: true, lifecycle_affects_sale_not_fitment: true,
      candidate_db: [dbValue], source_lifecycle: unique(evidenceRows.map((item) => item.lifecycleStatus)), exact_knowledge_coverage: true },
  });
}

assert(blockers.length === 0, `Preflight blockers: ${JSON.stringify(blockers.slice(0, 20))}`);
assert(new Set(fitments.map((row) => `${row.application_id}|${row.position}`)).size === fitments.length, "Duplicate application-position plan");
const applicationYears = new Set(applicationIds.flatMap((applicationId) =>
  (yearsByApp.get(applicationId) ?? []).filter((row) => Number(row.model_year) >= 2000 && Number(row.model_year) <= 2026)
    .map((row) => `${applicationId}|${row.model_year}`)));
assert(applicationYears.size === 176, `Expected 176 application-years, got ${applicationYears.size}`);
const productHashBefore = hash(productFitments);
const plan = { generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", policy: POLICY,
  source_code: SOURCE_CODE, source_file: sourceWorkbook.file, source_file_hash: sourceWorkbook.sha256,
  applications: applicationIds.length, application_positions: fitments.length, application_years: applicationYears.size,
  references: countBy(fitments, (row) => refValueById.get(row.part_reference_id)), blockers, product_writes: 0 };
fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(path.join(OUTPUT, "plan.json"), JSON.stringify({ ...plan, fitments }, null, 2));

if (!APPLY) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}

const backupDir = backup({ sourceBefore, batchesBefore: batchesBefore.filter((row) => sourceBefore.some((source) => source.id === row.data_source_id)),
  existingTargetFitments: existingFitments, productFitments });
let createdSource = false;
let source;
let batch;
try {
  if (!sourceBefore.length) {
    const result = await db.from("catalog_data_sources").insert({ code: SOURCE_CODE,
      name: "Bendix NZ historical brake pad fitment knowledge V1", source_kind: "product_catalogue",
      vehicle_identity_priority: 100, product_fitment_priority: 11, active: true,
      metadata: { product_line: "brake_pad", reference_scheme: "bendix_db", market: "NZ", source_confidence: "highest",
        historical_knowledge_only: true, parent_source: "BENDIX_NZ_FULL_FITMENT_V1", policy_version: POLICY } }).select("*").single();
    if (result.error) throw result.error;
    source = result.data; createdSource = true;
  } else {
    assert(sourceBefore.length === 1, "Historical source is not unique"); source = sourceBefore[0];
  }
  const existingBatch = batchesBefore.find((row) => row.data_source_id === source.id && row.source_file_hash === sourceWorkbook.sha256);
  const batchPayload = { data_source_id: source.id, source_file: path.basename(sourceWorkbook.file), source_file_hash: sourceWorkbook.sha256,
    sheet_name: sourceWorkbook.sheetName, import_status: "review", row_count: sourceWorkbook.rawRowCount,
    accepted_count: fitments.length, review_count: 0, rejected_count: 0,
    imported_by: "scripts/catalog/publish-ducato-historical-brake-references-20261025.mjs",
    metadata: { policy_version: POLICY, scope: "FIAT DUCATO 230_/244_ historical unique full-year reference knowledge" } };
  if (existingBatch) {
    const result = await db.from("catalog_import_batches").update(batchPayload).eq("id", existingBatch.id).select("*").single();
    if (result.error) throw result.error; batch = result.data;
  } else {
    const result = await db.from("catalog_import_batches").insert(batchPayload).select("*").single();
    if (result.error) throw result.error; batch = result.data;
  }
  const payload = fitments.map((row) => ({ ...row, data_source_id: source.id, import_batch_id: batch.id }));
  for (const part of chunks(payload, 200)) {
    const result = await db.from("vehicle_catalog_part_reference_fitments").upsert(part,
      { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (result.error) throw result.error;
  }
  const completedAt = new Date().toISOString();
  const done = await db.from("catalog_import_batches").update({ import_status: "published", completed_at: completedAt }).eq("id", batch.id);
  if (done.error) throw done.error;
  const stored = await fetchAll("vehicle_catalog_part_reference_fitments", "*", (query) => query.eq("data_source_id", source.id));
  assert(stored.length === fitments.length, `Readback count mismatch: ${stored.length}`);
  const productAfter = await selectIn("vehicle_catalog_product_fitments", "*", "application_id", applicationIds);
  assert(hash(productAfter) === productHashBefore, "Product fitments changed");
  const result = { ...plan, completed_at: completedAt, backup_dir: backupDir, data_source_id: source.id,
    import_batch_id: batch.id, verified: true, stored_fitments: stored.length };
  fs.writeFileSync(path.join(OUTPUT, "applied.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (source?.id) await db.from("vehicle_catalog_part_reference_fitments").delete().eq("data_source_id", source.id);
  if (batch?.id && !batchesBefore.some((row) => row.id === batch.id)) await db.from("catalog_import_batches").delete().eq("id", batch.id);
  if (createdSource && source?.id) await db.from("catalog_data_sources").delete().eq("id", source.id);
  throw new Error(`Apply failed; newly created historical-source rows were removed. ${error.message}. Backup=${backupDir}`);
}

function backup(tables) { const dir = path.join(ROOT, "tmp", "production-backups", `ducato-historical-brakes-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(dir, { recursive: true }); const manifest = { created_at: new Date().toISOString(), policy: POLICY, tables: {} };
  for (const [name, rows] of Object.entries(tables)) { const text = JSON.stringify(rows, null, 2); fs.writeFileSync(path.join(dir, `${name}.json`), text);
    manifest.tables[name] = { rows: rows.length, sha256: crypto.createHash("sha256").update(text).digest("hex") }; }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2)); return dir; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function unique(values) { return [...new Set(values)]; }
function groupBy(rows, fn) { const out = new Map(); for (const row of rows) { const key = fn(row); if (!out.has(key)) out.set(key, []); out.get(key).push(row); } return out; }
function countBy(rows, fn) { const out = {}; for (const row of rows) { const key = fn(row); out[key] = (out[key] ?? 0) + 1; } return out; }
function hash(value) { const normalized = Array.isArray(value) ? [...value].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value;
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex"); }
function chunks(rows, size) { const out = []; for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size)); return out; }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function fetchAll(table, columns, filter = (query) => query) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function selectIn(table, columns, field, values) { const output = []; for (const part of chunks(values, 100)) { const { data, error } = await db.from(table).select(columns).in(field, part); if (error) throw error; output.push(...(data ?? [])); } return output; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
