import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

import {
  compactPartKey,
  normalKey,
  parseVehicleRow
} from "./catalog-v3-normalization.mjs";

export const VEHICLE_LIBRARY_SOURCE_CODE = "NEXAUTO_VEHICLE_LIBRARY_V4";
export const VEHICLE_LIBRARY_APPLICATION_PREFIX = "NEXAUTO_V4:";
export const LEGACY_SELECTOR_APPLICATION_PATTERN = "NEXAUTO_V3:%";

const EXPECTED_HEADERS = [
  "source_vehicle_id",
  "品牌",
  "车型",
  "底盘代号",
  "车款变体",
  "发动机",
  "起始年份",
  "结束年份"
];

export function prepareVehicleLibrary(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) throw new Error("The vehicle library is empty.");
  const headers = matrix[0].map((value) => String(value ?? "").replace(/^\uFEFF/, "").trim());
  if (headers.length !== EXPECTED_HEADERS.length || headers.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new Error(`Unexpected vehicle library headers. Expected: ${EXPECTED_HEADERS.join(" | ")}`);
  }

  const rows = matrix.slice(1).map((row, index) => {
    const parsed = parseVehicleRow(row, index + 2);
    return {
      ...parsed,
      generation_key: normalKey(`vehicle-library-v4 ${parsed.generation_name}`)
    };
  });

  const duplicateSourceIds = duplicateValues(rows.map((row) => row.source_vehicle_id).filter(Boolean));
  const rejected = rows.filter((row) => row.parse_status === "rejected");
  const review = rows.filter((row) => row.parse_status === "review");
  if (duplicateSourceIds.length) throw new Error(`Duplicate source_vehicle_id values: ${duplicateSourceIds.slice(0, 10).join(", ")}`);
  if (rejected.length || review.length) {
    const first = [...rejected, ...review][0];
    throw new Error(`Vehicle library contains ${rejected.length} rejected and ${review.length} review rows. First issue: row ${first.row_number} (${first.parse_notes.join(", ")}).`);
  }

  const makes = dedupe(rows.map((row) => ({ name: row.make, normalized_name: row.make_key })), (row) => row.normalized_name);
  const modelDefinitions = dedupe(rows.map((row) => ({ make_key: row.make_key, name: row.model, normalized_name: row.model_key })), (row) => `${row.make_key}:${row.normalized_name}`);
  const generationDefinitions = dedupe(rows.map((row) => ({
    make_key: row.make_key,
    model_key: row.model_key,
    name: row.generation_name,
    normalized_name: row.generation_key,
    year_start: row.year_start,
    year_end: row.year_end
  })), (row) => `${row.make_key}:${row.model_key}:${row.normalized_name}`);
  const variantDefinitions = dedupe(rows.map((row) => ({
    make_key: row.make_key,
    model_key: row.model_key,
    generation_key: row.generation_key,
    name: row.variant_name,
    normalized_name: row.variant_key,
    body_style: row.body_style,
    engine_code: row.engine_code
  })), (row) => `${row.make_key}:${row.model_key}:${row.generation_key}:${row.normalized_name}`);

  const applicationGroups = groupBy(rows, (row) => applicationIdentity(row));
  const applications = [...applicationGroups.entries()].map(([identity, sourceRows]) => ({
    identity,
    source_vehicle_ids: sourceRows.map((row) => row.source_vehicle_id).sort(),
    row: sourceRows[0]
  }));
  const chassisCodes = dedupe(rows.flatMap((row) => row.chassis_codes.map((code) => ({ code, normalized_code: compactPartKey(code) }))), (row) => row.normalized_code);

  return {
    rows,
    makes,
    modelDefinitions,
    generationDefinitions,
    variantDefinitions,
    applications,
    chassisCodes,
    report: {
      source_rows: rows.length,
      unique_source_vehicle_ids: rows.length,
      duplicate_configuration_rows: rows.length - applications.length,
      makes: makes.length,
      models: modelDefinitions.length,
      generations: generationDefinitions.length,
      variants: variantDefinitions.length,
      applications: applications.length,
      chassis_codes: chassisCodes.length,
      earliest_year: Math.min(...rows.map((row) => row.year_start)),
      latest_year: Math.max(...rows.map((row) => row.year_end))
    }
  };
}

export function readVehicleLibrary(sourcePath) {
  const contents = fs.readFileSync(sourcePath);
  const workbook = path.extname(sourcePath).toLowerCase() === ".csv"
    ? XLSX.read(contents.toString("utf8").replace(/^\uFEFF/, ""), { type: "string", raw: false })
    : XLSX.read(contents, { type: "buffer", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "", raw: false });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourcePath = args.source ? path.resolve(String(args.source)) : null;
  const reportOnly = Boolean(args["report-only"]);
  const apply = Boolean(args.apply);
  const cleanupOld = Boolean(args["cleanup-old"]);
  if (!sourcePath && !cleanupOld) throw new Error("Provide --source <vehicle-library.csv>.");
  if (!reportOnly && !apply && !cleanupOld) throw new Error("Choose --report-only, --apply, or --cleanup-old.");

  const prepared = sourcePath ? prepareVehicleLibrary(readVehicleLibrary(sourcePath)) : null;
  if (prepared) {
    const reportPath = writeReport(prepared.report, sourcePath);
    console.log(JSON.stringify({ report: prepared.report, report_path: reportPath }, null, 2));
  }
  if (reportOnly) return;

  loadEnvFile(path.join(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (apply) {
    if (!prepared || !sourcePath) throw new Error("--apply requires --source.");
    await stageVehicleLibrary(supabase, prepared, sourcePath);
  }
  if (cleanupOld) await cleanupLegacySelectorApplications(supabase);
}

async function stageVehicleLibrary(supabase, prepared, sourcePath) {
  const backupDir = await backupSelectorData(supabase, "before-v4-stage");
  const sourceHash = sha256File(sourcePath);
  await upsertRows(supabase, "catalog_data_sources", [{
    code: VEHICLE_LIBRARY_SOURCE_CODE,
    name: "NexAuto latest vehicle library",
    source_kind: "vehicle_catalogue",
    vehicle_identity_priority: 1,
    product_fitment_priority: 100,
    active: true,
    metadata: { market: "NZ", role: "vehicle_backbone", version: 4 }
  }], "code");
  const { data: source, error: sourceError } = await supabase.from("catalog_data_sources").select("id").eq("code", VEHICLE_LIBRARY_SOURCE_CODE).single();
  if (sourceError) throw sourceError;

  let { data: batch, error: batchError } = await supabase
    .from("catalog_import_batches")
    .select("id")
    .eq("data_source_id", source.id)
    .eq("source_file_hash", sourceHash)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) {
    const created = await supabase.from("catalog_import_batches").insert({
      data_source_id: source.id,
      source_file: path.basename(sourcePath),
      source_file_hash: sourceHash,
      sheet_name: "vehicles",
      import_status: "parsed",
      row_count: prepared.rows.length,
      accepted_count: prepared.rows.length,
      review_count: 0,
      rejected_count: 0,
      metadata: { parser_version: 4, market: "NZ", replacement_mode: true }
    }).select("id").single();
    if (created.error) throw created.error;
    batch = created.data;
  } else {
    const resumed = await supabase.from("catalog_import_batches").update({ import_status: "parsed", completed_at: null }).eq("id", batch.id);
    if (resumed.error) throw resumed.error;
  }

  console.log("Staging makes and models...");
  await upsertRows(supabase, "vehicle_makes", prepared.makes, "normalized_name");
  const makes = await selectAll(supabase.from("vehicle_makes").select("id,name,normalized_name"));
  const makeByKey = new Map(makes.map((row) => [row.normalized_name, row]));
  const modelRows = prepared.modelDefinitions.map((row) => ({
    make_id: required(makeByKey.get(row.make_key), `make ${row.make_key}`).id,
    name: row.name,
    normalized_name: row.normalized_name
  }));
  await upsertRows(supabase, "vehicle_models", modelRows, "make_id,normalized_name");
  const models = await selectAll(supabase.from("vehicle_models").select("id,make_id,name,normalized_name"));
  const modelByKey = new Map(models.map((row) => [`${row.make_id}:${row.normalized_name}`, row]));

  console.log("Staging generations and variants...");
  const generationRows = prepared.generationDefinitions.map((row) => {
    const make = required(makeByKey.get(row.make_key), `make ${row.make_key}`);
    const model = required(modelByKey.get(`${make.id}:${row.model_key}`), `model ${row.make_key}/${row.model_key}`);
    return {
      model_id: model.id,
      name: row.name,
      normalized_name: row.normalized_name,
      year_start: row.year_start,
      year_end: row.year_end,
      active: true,
      metadata: { source: VEHICLE_LIBRARY_SOURCE_CODE, version: 4 }
    };
  });
  await upsertRows(supabase, "vehicle_generations", generationRows, "model_id,normalized_name");
  const generations = await selectAll(supabase.from("vehicle_generations").select("id,model_id,normalized_name").eq("metadata->>source", VEHICLE_LIBRARY_SOURCE_CODE));
  const generationByKey = new Map(generations.map((row) => [`${row.model_id}:${row.normalized_name}`, row]));
  const variantRows = prepared.variantDefinitions.map((row) => {
    const make = required(makeByKey.get(row.make_key), `make ${row.make_key}`);
    const model = required(modelByKey.get(`${make.id}:${row.model_key}`), `model ${row.make_key}/${row.model_key}`);
    const generation = required(generationByKey.get(`${model.id}:${row.generation_key}`), `generation ${row.generation_key}`);
    return {
      generation_id: generation.id,
      name: row.name,
      normalized_name: row.normalized_name,
      body_style: row.body_style,
      engine_code: row.engine_code,
      active: true,
      metadata: { source: VEHICLE_LIBRARY_SOURCE_CODE, version: 4 }
    };
  });
  await upsertRows(supabase, "vehicle_variants", variantRows, "generation_id,normalized_name");
  const generationIds = generations.map((row) => row.id);
  const variants = await selectInChunks(supabase, "vehicle_variants", "id,generation_id,normalized_name", "generation_id", generationIds);
  const variantByKey = new Map(variants.map((row) => [`${row.generation_id}:${row.normalized_name}`, row]));

  const entityBySourceId = new Map();
  for (const row of prepared.rows) {
    const make = required(makeByKey.get(row.make_key), `make ${row.make_key}`);
    const model = required(modelByKey.get(`${make.id}:${row.model_key}`), `model ${row.model_key}`);
    const generation = required(generationByKey.get(`${model.id}:${row.generation_key}`), `generation ${row.generation_key}`);
    const variant = required(variantByKey.get(`${generation.id}:${row.variant_key}`), `variant ${row.variant_key}`);
    entityBySourceId.set(row.source_vehicle_id, { make, model, generation, variant });
  }

  console.log("Staging chassis codes and assignments...");
  await upsertRows(supabase, "vehicle_chassis_codes", prepared.chassisCodes, "normalized_code");
  const chassisCodes = await selectAll(supabase.from("vehicle_chassis_codes").select("id,normalized_code"));
  const chassisByKey = new Map(chassisCodes.map((row) => [row.normalized_code, row]));
  const chassisAssignments = dedupe(prepared.rows.flatMap((row) => {
    const entity = required(entityBySourceId.get(row.source_vehicle_id), `vehicle ${row.source_vehicle_id}`);
    return row.chassis_codes.map((code, index) => ({
      chassis_code_id: required(chassisByKey.get(compactPartKey(code)), `chassis ${code}`).id,
      generation_id: entity.generation.id,
      variant_id: entity.variant.id,
      is_primary: index === 0
    }));
  }), (row) => `${row.chassis_code_id}:${row.generation_id}:${row.variant_id}`);
  const existingAssignments = await selectInChunks(supabase, "vehicle_chassis_assignments", "chassis_code_id,generation_id,variant_id", "generation_id", generationIds);
  const existingAssignmentKeys = new Set(existingAssignments.map((row) => `${row.chassis_code_id}:${row.generation_id}:${row.variant_id ?? ""}`));
  await insertRows(supabase, "vehicle_chassis_assignments", chassisAssignments.filter((row) => !existingAssignmentKeys.has(`${row.chassis_code_id}:${row.generation_id}:${row.variant_id}`)));

  console.log("Staging deduplicated vehicle applications...");
  const applicationRows = prepared.applications.map((group) => {
    const entity = required(entityBySourceId.get(group.row.source_vehicle_id), `vehicle ${group.row.source_vehicle_id}`);
    return {
      source_application_key: `${VEHICLE_LIBRARY_APPLICATION_PREFIX}${shortHash(group.identity)}`,
      generation_id: entity.generation.id,
      variant_id: entity.variant.id,
      market: "NZ",
      steering_side: "RHD",
      year_start: group.row.year_start,
      year_end: group.row.year_end,
      fitment_status: "published",
      active: true,
      metadata: {
        source: VEHICLE_LIBRARY_SOURCE_CODE,
        source_vehicle_ids: group.source_vehicle_ids,
        source_row_count: group.source_vehicle_ids.length,
        version: 4
      }
    };
  });
  await upsertRows(supabase, "vehicle_fitment_applications", applicationRows, "source_application_key");

  console.log("Staging source-id aliases...");
  const aliases = prepared.rows.map((row) => ({
    data_source_id: source.id,
    entity_type: "variant",
    alias_kind: "source_id",
    alias_scope_key: VEHICLE_LIBRARY_SOURCE_CODE,
    alias: row.source_vehicle_id,
    normalized_alias: normalKey(row.source_vehicle_id),
    market: "NZ",
    variant_id: required(entityBySourceId.get(row.source_vehicle_id), `vehicle ${row.source_vehicle_id}`).variant.id,
    alias_index: 0
  }));
  await upsertRows(supabase, "vehicle_entity_aliases", aliases, "data_source_id,entity_type,alias_kind,alias_scope_key,normalized_alias,market,alias_index");

  const completed = await supabase.from("catalog_import_batches").update({
    import_status: "published",
    completed_at: new Date().toISOString(),
    metadata: { parser_version: 4, market: "NZ", replacement_mode: true, backup_dir: backupDir, counts: prepared.report }
  }).eq("id", batch.id);
  if (completed.error) throw completed.error;

  const staged = await selectAll(supabase.from("vehicle_fitment_applications").select("id,fitment_status,active").like("source_application_key", `${VEHICLE_LIBRARY_APPLICATION_PREFIX}%`));
  if (staged.length !== prepared.applications.length || staged.some((row) => row.fitment_status !== "published" || row.active !== true)) {
    throw new Error(`Staged vehicle verification failed. Expected ${prepared.applications.length}, found ${staged.length}.`);
  }
  console.log(JSON.stringify({ status: "staged", applications: staged.length, source_rows: prepared.rows.length, backup_dir: backupDir }, null, 2));
}

async function cleanupLegacySelectorApplications(supabase) {
  const backupDir = await backupSelectorData(supabase, "before-v3-cleanup");
  const oldApplications = await selectAll(supabase.from("vehicle_fitment_applications").select("id").like("source_application_key", LEGACY_SELECTOR_APPLICATION_PATTERN));
  if (oldApplications.length) {
    const { error } = await supabase.from("vehicle_fitment_applications").delete().like("source_application_key", LEGACY_SELECTOR_APPLICATION_PATTERN);
    if (error) throw error;
  }
  const remaining = await selectAll(supabase.from("vehicle_fitment_applications").select("id").like("source_application_key", LEGACY_SELECTOR_APPLICATION_PATTERN));
  if (remaining.length) throw new Error(`Legacy selector cleanup failed; ${remaining.length} applications remain.`);
  const current = await selectAll(supabase.from("vehicle_fitment_applications").select("id").like("source_application_key", `${VEHICLE_LIBRARY_APPLICATION_PREFIX}%`).eq("fitment_status", "published").eq("active", true));
  console.log(JSON.stringify({ status: "legacy-selector-cleared", deleted_applications: oldApplications.length, current_applications: current.length, backup_dir: backupDir }, null, 2));
}

async function backupSelectorData(supabase, label) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(process.cwd(), "tmp", "production-backups", `vehicle-library-${label}-${timestamp}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const tables = ["vehicle_makes", "vehicle_models", "vehicle_generations", "vehicle_variants", "vehicle_chassis_codes", "vehicle_chassis_assignments", "vehicle_fitment_applications", "vehicle_wiper_fitments", "vehicle_product_fitments"];
  for (const table of tables) {
    const rows = await selectAll(supabase.from(table).select("*"));
    fs.writeFileSync(path.join(outputDir, `${table}.json`), JSON.stringify(rows));
    console.log(`Backup ${table}: ${rows.length}`);
  }
  return outputDir;
}

function writeReport(report, sourcePath) {
  const outputDir = path.join(process.cwd(), "tmp", "vehicle-library-import");
  fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, "vehicle-library-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ generated_at: new Date().toISOString(), source_file: path.basename(sourcePath), source_sha256: sha256File(sourcePath), ...report }, null, 2));
  return reportPath;
}

function applicationIdentity(row) {
  return [row.make_key, row.model_key, row.generation_key, row.variant_key, row.year_start, row.year_end].join("|");
}

function shortHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function dedupe(rows, keyFn) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = keyFn(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  return grouped;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

async function upsertRows(supabase, table, rows, onConflict, chunkSize = 500) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + chunkSize), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    if (rows.length > chunkSize && (index === 0 || index + chunkSize >= rows.length || ((index / chunkSize) + 1) % 10 === 0)) {
      console.log(`${table}: ${Math.min(index + chunkSize, rows.length)}/${rows.length}`);
    }
  }
}

async function insertRows(supabase, table, rows, chunkSize = 500) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const { error } = await supabase.from(table).insert(rows.slice(index, index + chunkSize));
    if (error) throw new Error(`${table}: ${error.message}`);
    if (rows.length > chunkSize && (index === 0 || index + chunkSize >= rows.length || ((index / chunkSize) + 1) % 10 === 0)) {
      console.log(`${table}: ${Math.min(index + chunkSize, rows.length)}/${rows.length}`);
    }
  }
}

async function selectAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function selectInChunks(supabase, table, columns, field, values, chunkSize = 250) {
  const rows = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    const selected = await selectAll(supabase.from(table).select(columns).in(field, chunk));
    rows.push(...selected);
  }
  return rows;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
