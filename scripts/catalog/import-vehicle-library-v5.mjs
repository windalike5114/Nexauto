import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { applyVehicleCatalogSafety } from "./vehicle-catalog-safety.mjs";

const DEFAULT_PACKAGE_DIR = "C:\\Users\\Sanli\\Documents\\Codex\\2026-10-21\\referenced-chatgpt-conversation-this-is-an\\outputs\\NexAutoParts_车型库数据包\\nexautoparts_vehicle_database";
const RELEASE_ID = "nexauto-vehicle-catalog-v5";
const FILES = {
  makes: ["make.csv", "vehicle_catalog_makes"], models: ["model.csv", "vehicle_catalog_models"],
  series: ["series.csv", "vehicle_catalog_series"], variants: ["variant.csv", "vehicle_catalog_variants"],
  powertrains: ["powertrain.csv", "vehicle_catalog_powertrains"], engineCodes: ["engine_code.csv", "vehicle_catalog_engine_codes"],
  powertrainEngineCodes: ["powertrain_engine_code.csv", "vehicle_catalog_powertrain_engine_codes"],
  applications: ["vehicle_application.csv", "vehicle_catalog_applications"],
  applicationYears: ["application_year.csv", "vehicle_catalog_application_years"],
  provenance: ["application_provenance.csv", "vehicle_catalog_application_provenance"],
  reviewIssues: ["review_issue.csv", "vehicle_catalog_review_issues"], sourceFailures: ["source_failure.csv", "vehicle_catalog_source_failures"]
};
const DELETE_ORDER = [
  "vehicle_catalog_wiper_fitments", "vehicle_catalog_product_fitments", "vehicle_catalog_application_provenance",
  "vehicle_catalog_application_years", "vehicle_catalog_review_issues", "vehicle_catalog_source_failures",
  "vehicle_catalog_powertrain_engine_codes", "vehicle_catalog_applications", "vehicle_catalog_engine_codes",
  "vehicle_catalog_powertrains", "vehicle_catalog_variants", "vehicle_catalog_series", "vehicle_catalog_models", "vehicle_catalog_makes"
];
const PRIMARY_KEYS = {
  vehicle_catalog_releases: "release_id", vehicle_catalog_makes: "make_id", vehicle_catalog_models: "model_id",
  vehicle_catalog_series: "series_id", vehicle_catalog_variants: "variant_id", vehicle_catalog_powertrains: "powertrain_id",
  vehicle_catalog_engine_codes: "engine_code_id", vehicle_catalog_powertrain_engine_codes: "powertrain_id",
  vehicle_catalog_applications: "application_id", vehicle_catalog_application_years: "application_id",
  vehicle_catalog_application_provenance: "application_id", vehicle_catalog_review_issues: "issue_id",
  vehicle_catalog_source_failures: "failure_id", vehicle_catalog_product_fitments: "application_id", vehicle_catalog_wiper_fitments: "application_id"
};

export function prepareVehicleLibraryV5(packageDir) {
  const data = {};
  for (const [key, [file]] of Object.entries(FILES)) {
    const filePath = path.join(packageDir, file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing package file: ${file}`);
    data[key] = readCsv(filePath).map(normalizeRow);
  }
  const safetyCorrections = applyVehicleCatalogSafety(data);
  validatePackage(data);
  const sourceReport = JSON.parse(fs.readFileSync(path.join(packageDir, "processing_report.json"), "utf8"));
  const report = {
    release_id: RELEASE_ID, package_dir: packageDir, package_sha256: hashPackage(packageDir),
    counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])),
    expected_counts: sourceReport.output_counts ?? {},
    earliest_year: data.applicationYears.reduce((minimum, row) => Math.min(minimum, row.model_year), 2100),
    latest_year: data.applicationYears.reduce((maximum, row) => Math.max(maximum, row.model_year), 1886),
    safety_corrections: safetyCorrections
  };
  return { data, report };
}

function validatePackage(data) {
  const ids = {
    makes: uniqueIds(data.makes, "make_id"), models: uniqueIds(data.models, "model_id"),
    series: uniqueIds(data.series, "series_id"), variants: uniqueIds(data.variants, "variant_id"),
    powertrains: uniqueIds(data.powertrains, "powertrain_id"), engineCodes: uniqueIds(data.engineCodes, "engine_code_id"),
    applications: uniqueIds(data.applications, "application_id")
  };
  for (const row of data.models) assertReference(ids.makes, row.make_id, `model ${row.model_id}`);
  for (const row of data.series) assertReference(ids.models, row.model_id, `series ${row.series_id}`);
  for (const row of data.powertrains) assertReference(ids.makes, row.make_id, `powertrain ${row.powertrain_id}`);
  for (const row of data.engineCodes) assertReference(ids.makes, row.make_id, `engine code ${row.engine_code_id}`);
  for (const row of data.powertrainEngineCodes) {
    assertReference(ids.powertrains, row.powertrain_id, "powertrain engine code");
    assertReference(ids.engineCodes, row.engine_code_id, "powertrain engine code");
  }
  for (const row of data.applications) {
    assertReference(ids.models, row.model_id, `application ${row.application_id}`);
    if (row.series_id) assertReference(ids.series, row.series_id, `application ${row.application_id}`);
    assertReference(ids.variants, row.variant_id, `application ${row.application_id}`);
    assertReference(ids.powertrains, row.powertrain_id, `application ${row.application_id}`);
    if (row.year_from < 1886 || row.year_to < row.year_from || row.year_to > 2100) throw new Error(`Invalid year range for ${row.application_id}.`);
  }
  const yearKeys = new Set();
  for (const row of data.applicationYears) {
    assertReference(ids.applications, row.application_id, "application year");
    const key = `${row.application_id}:${row.model_year}`;
    if (yearKeys.has(key)) throw new Error(`Duplicate application year ${key}.`);
    yearKeys.add(key);
  }
  for (const row of data.provenance) assertReference(ids.applications, row.application_id, "application provenance");
}

async function applyPackage(prepared) {
  loadEnv(path.join(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials are missing.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  await assertSchemaReady(db);
  for (const table of DELETE_ORDER) await deleteAll(db, table);
  await deleteAll(db, "vehicle_catalog_releases");
  for (const [keyName, [, table]] of Object.entries(FILES)) {
    process.stdout.write(`Importing ${table} (${prepared.data[keyName].length})...\n`);
    await insertChunks(db, table, prepared.data[keyName]);
  }
  await insertChunks(db, "vehicle_catalog_releases", [{
    release_id: RELEASE_ID, package_sha256: prepared.report.package_sha256,
    source_name: "NexAutoParts normalized vehicle database package", counts: prepared.report.counts, active: true
  }]);
  const verification = {};
  for (const [keyName, [, table]] of Object.entries(FILES)) {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
    if (error) throw error;
    verification[keyName] = count ?? 0;
    if (verification[keyName] !== prepared.data[keyName].length) throw new Error(`Count mismatch for ${table}: ${verification[keyName]}/${prepared.data[keyName].length}`);
  }
  process.stdout.write(`${JSON.stringify({ imported: true, verification }, null, 2)}\n`);
}

async function assertSchemaReady(db) {
  const { error } = await db.from("vehicle_catalog_releases").select("release_id").limit(1);
  if (error) throw new Error(`V5 schema is not ready. Apply 20261024_vehicle_catalog_v5.sql first: ${error.message}`);
}
async function deleteAll(db, table) {
  const { error } = await db.from(table).delete().not(PRIMARY_KEYS[table], "is", null);
  if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
}
async function insertChunks(db, table, rows, size = 500) {
  for (let start = 0; start < rows.length; start += size) {
    const { error } = await db.from(table).insert(rows.slice(start, start + size));
    if (error) throw new Error(`Could not import ${table} at row ${start + 1}: ${error.message}`);
  }
}

function normalizeRow(row) {
  const numeric = new Set(["year_from","year_to","model_year","displacement_cc","cylinder_count","valve_count","raw_record_count","gross_weight_ton"]);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === "") return [key, null];
    if (numeric.has(key)) return [key, Number(value)];
    if (key === "is_primary") return [key, value === "1" || String(value).toLowerCase() === "true"];
    return [key, value];
  }));
}
function uniqueIds(rows, key) {
  const values = new Set();
  for (const row of rows) {
    if (!row[key]) throw new Error(`Missing ${key}.`);
    if (values.has(row[key])) throw new Error(`Duplicate ${key}: ${row[key]}`);
    values.add(row[key]);
  }
  return values;
}
function assertReference(ids, id, label) { if (!ids.has(id)) throw new Error(`Missing reference ${id} for ${label}.`); }
function readCsv(file) {
  const workbook = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
}
function hashPackage(packageDir) {
  const hash = crypto.createHash("sha256");
  for (const [file] of Object.values(FILES)) hash.update(fs.readFileSync(path.join(packageDir, file)));
  return hash.digest("hex");
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const args = new Set(process.argv.slice(2));
const packageArgIndex = process.argv.indexOf("--package");
const packageDir = path.resolve(packageArgIndex >= 0 ? process.argv[packageArgIndex + 1] : DEFAULT_PACKAGE_DIR);
const prepared = prepareVehicleLibraryV5(packageDir);
process.stdout.write(`${JSON.stringify(prepared.report, null, 2)}\n`);
if (args.has("--apply")) await applyPackage(prepared);
else if (!args.has("--report-only")) throw new Error("Choose --report-only or --apply.");
