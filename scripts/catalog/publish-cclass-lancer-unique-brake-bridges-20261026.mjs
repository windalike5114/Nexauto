import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";
import { brakeFamily, chassisTokens, platformCodeMatch } from "./brake-pad-strict-policy.mjs";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const INPUT = path.join(ROOT, "outputs", "extended132-six-brake-gap-diagnosis-20261025", "application-positions.jsonl");
const OUTPUT = path.join(ROOT, "outputs", "cclass-lancer-unique-brake-bridges-20261026");
const SOURCE_CODE = "BENDIX_NZ_VERIFIED_PLATFORM_BRIDGES_V1";
const POLICY = "BENDIX_UNIQUE_PLATFORM_BODY_INVARIANT_BRIDGE_V1_2026_10_26";

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sourceWorkbook = readBendixWorkbook();
const sourceByRow = new Map(sourceWorkbook.uniqueRows.map((row) => [row.sourceRowId, row]));
const input = fs.readFileSync(INPUT, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse)
  .filter((row) => ["Mercedes-Benz C-Class", "Mitsubishi Lancer"].includes(row.popular_group) && row.outcome === "unique_source_candidate");
assert(input.length === 14, `Expected 14 unique application-position rows, got ${input.length}`);
const applicationIds = unique(input.map((row) => row.application_id));

const [applications, years, models, makes, series, references, existingRefs, productFitments, sourceBefore, allBatches] = await Promise.all([
  selectIn("vehicle_catalog_applications", "*", "application_id", applicationIds),
  selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", applicationIds),
  fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"), fetchAll("vehicle_catalog_makes", "make_id,name,status"),
  fetchAll("vehicle_catalog_series", "series_id,code,display_name,status"),
  fetchAll("catalog_part_references", "*", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "bendix_db")),
  selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", applicationIds),
  selectIn("vehicle_catalog_product_fitments", "*", "application_id", applicationIds),
  fetchAll("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)), fetchAll("catalog_import_batches", "*"),
]);
const appById = new Map(applications.map((row) => [row.application_id, row]));
const yearsByApp = groupBy(years, (row) => row.application_id);
const modelById = new Map(models.map((row) => [row.model_id, row]));
const makeById = new Map(makes.map((row) => [row.make_id, row]));
const seriesById = new Map(series.map((row) => [row.series_id, row]));
const refByDb = new Map(references.map((row) => [row.normalized_value, row]));
const refValueById = new Map(references.map((row) => [row.id, row.normalized_value]));
const blockers = [];
const planned = [];

for (const row of input) {
  const app = appById.get(row.application_id);
  const model = modelById.get(app?.model_id); const make = makeById.get(model?.make_id); const appSeries = seriesById.get(app?.series_id);
  const appYears = (yearsByApp.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
  const scopedYears = appYears.filter((year) => year >= 2000 && year <= 2026);
  const sourceIds = String(row.source_rows).split(",").filter(Boolean).map(Number);
  const evidenceRows = sourceIds.map((id) => sourceByRow.get(id)).filter(Boolean);
  const expectedFamily = brakeFamily(make?.name, model?.name);
  const candidate = String(row.candidate_db).trim();
  const platformMatched = evidenceRows.every((source) => chassisTokens(source).some((token) =>
    platformCodeMatch(expectedFamily, appSeries?.code ?? appSeries?.display_name ?? "", token)));
  const conflicts = existingRefs.filter((item) => item.application_id === row.application_id && item.position === row.position
    && item.fitment_status === "published" && refValueById.get(item.part_reference_id) !== candidate);
  const checks = [
    [app?.status === "active", "application inactive or missing"],
    [upper(make?.name) === upper(row.make) && upper(model?.name) === upper(row.model), "vehicle identity changed"],
    [upper(appSeries?.code ?? appSeries?.display_name) === upper(row.series), "series changed"],
    [scopedYears.length === Number(row.application_years), "scoped application years changed"],
    [Boolean(refByDb.get(candidate)), "reference missing"],
    [sourceIds.length > 0 && evidenceRows.length === sourceIds.length, "source rows missing"],
    [evidenceRows.every((source) => source.bendixReference === candidate && source.position === row.position), "source DB/position mismatch"],
    [evidenceRows.every((source) => ["active", "to_be_discontinued"].includes(source.lifecycleStatus)), "source lifecycle is not publishable"],
    [evidenceRows.every((source) => source.modelFamily === expectedFamily), "source family mismatch"],
    [platformMatched, "source platform does not match live chassis"],
    [appYears.every((year) => evidenceRows.some((source) => year >= source.yearFrom && year <= source.yearTo)), "source years do not cover application"],
    [conflicts.length === 0, "different published reference exists"],
  ];
  for (const [pass, reason] of checks) if (!pass) blockers.push({ application_id: row.application_id, position: row.position, candidate, reason,
    live_years: appYears, scoped_years: scopedYears, expected_scoped_year_count: row.application_years, source_ranges: evidenceRows.map((source) => `${source.yearFrom}-${source.yearTo}`) });
  planned.push({ application_id: row.application_id, part_reference_id: refByDb.get(candidate)?.id, position: row.position,
    fitment_status: "published", confidence: "exact", source_row_numbers: sourceIds,
    match_reasons: ["unique_db_after_platform_year_configuration_filters", "body_classification_invariant_on_same_brake_platform"],
    metadata: { policy_version: POLICY, candidate_db: [candidate], exact_knowledge_coverage: true,
      parent_source: "BENDIX_NZ_FULL_FITMENT_V1", source_platforms: unique(evidenceRows.map((source) => source.seriesName)),
      source_engine_codes: unique(evidenceRows.flatMap((source) => source.engineCodes)), source_bodies: unique(evidenceRows.map((source) => source.bodyStyle)) } });
}
assert(blockers.length === 0, `Preflight blockers: ${JSON.stringify(blockers)}`);
assert(new Set(planned.map((row) => `${row.application_id}|${row.position}`)).size === planned.length, "Duplicate application-position plan");
const applicationYears = new Set(applicationIds.flatMap((id) => (yearsByApp.get(id) ?? [])
  .filter((row) => Number(row.model_year) >= 2000 && Number(row.model_year) <= 2026).map((row) => `${id}|${row.model_year}`)));
assert(applicationYears.size === 25, `Expected 25 application-years, got ${applicationYears.size}`);
const productHash = hash(productFitments);
const summary = { generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", source_code: SOURCE_CODE,
  policy: POLICY, applications: applicationIds.length, application_positions: planned.length, application_years: applicationYears.size,
  by_group: countBy(input, (row) => row.popular_group), by_reference: countBy(input, (row) => row.candidate_db), blockers, product_writes: 0 };
fs.mkdirSync(OUTPUT, { recursive: true }); fs.writeFileSync(path.join(OUTPUT, "plan.json"), JSON.stringify({ ...summary, planned }, null, 2));
if (!APPLY) { console.log(JSON.stringify(summary, null, 2)); process.exit(0); }

const backupDir = backup({ sourceBefore, sourceBatches: allBatches.filter((batch) => sourceBefore.some((source) => source.id === batch.data_source_id)),
  existingRefs, productFitments });
let source; let batch; let createdSource = false;
try {
  if (!sourceBefore.length) {
    const result = await db.from("catalog_data_sources").insert({ code: SOURCE_CODE, name: "Bendix NZ verified platform bridge fitments V1",
      source_kind: "product_catalogue", vehicle_identity_priority: 100, product_fitment_priority: 12, active: true,
      metadata: { product_line: "brake_pad", reference_scheme: "bendix_db", market: "NZ", parent_source: "BENDIX_NZ_FULL_FITMENT_V1",
        source_confidence: "highest", policy_version: POLICY } }).select("*").single();
    if (result.error) throw result.error; source = result.data; createdSource = true;
  } else { assert(sourceBefore.length === 1, "Bridge source is not unique"); source = sourceBefore[0]; }
  const oldBatch = allBatches.find((item) => item.data_source_id === source.id && item.source_file_hash === sourceWorkbook.sha256);
  const batchPayload = { data_source_id: source.id, source_file: path.basename(sourceWorkbook.file), source_file_hash: sourceWorkbook.sha256,
    sheet_name: sourceWorkbook.sheetName, import_status: "review", row_count: sourceWorkbook.rawRowCount, accepted_count: planned.length,
    review_count: 0, rejected_count: 0, imported_by: "scripts/catalog/publish-cclass-lancer-unique-brake-bridges-20261026.mjs",
    metadata: { policy_version: POLICY, target_models: ["Mercedes-Benz C-Class", "Mitsubishi Lancer"] } };
  if (oldBatch) { const result = await db.from("catalog_import_batches").update(batchPayload).eq("id", oldBatch.id).select("*").single(); if (result.error) throw result.error; batch = result.data; }
  else { const result = await db.from("catalog_import_batches").insert(batchPayload).select("*").single(); if (result.error) throw result.error; batch = result.data; }
  const payload = planned.map((row) => ({ ...row, data_source_id: source.id, import_batch_id: batch.id }));
  const write = await db.from("vehicle_catalog_part_reference_fitments").upsert(payload, { onConflict: "application_id,part_reference_id,position,data_source_id" });
  if (write.error) throw write.error;
  const completedAt = new Date().toISOString(); const complete = await db.from("catalog_import_batches").update({ import_status: "published", completed_at: completedAt }).eq("id", batch.id); if (complete.error) throw complete.error;
  const stored = await fetchAll("vehicle_catalog_part_reference_fitments", "*", (query) => query.eq("data_source_id", source.id));
  assert(stored.length === planned.length, `Readback count mismatch: ${stored.length}`);
  const productsAfter = await selectIn("vehicle_catalog_product_fitments", "*", "application_id", applicationIds);
  assert(hash(productsAfter) === productHash, "Product fitments changed");
  const result = { ...summary, completed_at: completedAt, backup_dir: backupDir, data_source_id: source.id,
    import_batch_id: batch.id, stored_fitments: stored.length, verified: true };
  fs.writeFileSync(path.join(OUTPUT, "applied.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (source?.id) await db.from("vehicle_catalog_part_reference_fitments").delete().eq("data_source_id", source.id);
  if (batch?.id && !allBatches.some((item) => item.id === batch.id)) await db.from("catalog_import_batches").delete().eq("id", batch.id);
  if (createdSource && source?.id) await db.from("catalog_data_sources").delete().eq("id", source.id);
  throw new Error(`Apply failed; newly created bridge rows were removed. ${error.message}. Backup=${backupDir}`);
}

function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function unique(values) { return [...new Set(values)]; }
function groupBy(rows, fn) { const out = new Map(); for (const row of rows) { const key = fn(row); if (!out.has(key)) out.set(key, []); out.get(key).push(row); } return out; }
function countBy(rows, fn) { const out = {}; for (const row of rows) { const key = fn(row); out[key] = (out[key] ?? 0) + 1; } return out; }
function hash(rows) { return crypto.createHash("sha256").update(JSON.stringify([...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest("hex"); }
function assert(value, message) { if (!value) throw new Error(message); }
async function fetchAll(table, columns, filter = (query) => query) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function selectIn(table, columns, field, values) { const output = []; for (let index = 0; index < values.length; index += 100) { const { data, error } = await db.from(table).select(columns).in(field, values.slice(index, index + 100)); if (error) throw error; output.push(...(data ?? [])); } return output; }
function backup(tables) { const dir = path.join(ROOT, "tmp", "production-backups", `cclass-lancer-brake-bridges-${new Date().toISOString().replace(/[:.]/g, "-")}`); fs.mkdirSync(dir, { recursive: true });
  const manifest = { created_at: new Date().toISOString(), policy: POLICY, tables: {} }; for (const [name, rows] of Object.entries(tables)) { const text = JSON.stringify(rows, null, 2); fs.writeFileSync(path.join(dir, `${name}.json`), text); manifest.tables[name] = { rows: rows.length, sha256: crypto.createHash("sha256").update(text).digest("hex") }; }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2)); return dir; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
