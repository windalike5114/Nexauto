import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

import {
  normalizeCatalogKey,
  normalizeCatalogText,
  parseVehicleCatalogRow
} from "./vehicle-catalog-normalization.mjs";

const DEFAULT_FILE = "C:\\Users\\Sanli\\Downloads\\20261006_小车_machter车型库_三级全量(2).xlsx";
const DEFAULT_SHEET = "车型库全量";
const DEFAULT_SOURCE_CODE = "MACHTER_VEHICLE_CATALOG";
const EXPECTED_HEADERS = ["品牌", "车型", "变体(底盘代号/年款)", "make_id", "model_id", "variant_id"];

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const filePath = path.resolve(args.file ?? DEFAULT_FILE);
const sheetName = String(args.sheet ?? DEFAULT_SHEET);
const sourceCode = String(args["source-code"] ?? DEFAULT_SOURCE_CODE).toUpperCase();
const reportOnly = Boolean(args["report-only"]);
const apply = Boolean(args.apply);

if (!fs.existsSync(filePath)) {
  throw new Error(`Vehicle catalogue source file not found: ${filePath}`);
}

if (!reportOnly && !apply) {
  throw new Error("Choose --report-only to inspect parsing or --apply to stage and publish the canonical catalogue.");
}

const parsed = parseWorkbook(filePath, sheetName);
const report = buildReport(parsed, { filePath, sheetName, sourceCode });
const outputDir = path.join(process.cwd(), "tmp");
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, "vehicle-catalog-v2-report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
printReport(report, reportPath);

if (apply) {
  await applyVehicleCatalog(parsed, report, { filePath, sheetName, sourceCode });
}

function parseWorkbook(inputPath, requestedSheet) {
  const workbook = XLSX.readFile(inputPath, { cellDates: false, raw: false });
  const sheet = workbook.Sheets[requestedSheet];
  if (!sheet) throw new Error(`Worksheet not found: ${requestedSheet}`);

  const rawRows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false
  });
  const headers = (rawRows[0] ?? []).slice(0, EXPECTED_HEADERS.length).map(normalizeCatalogText);

  if (JSON.stringify(headers) !== JSON.stringify(EXPECTED_HEADERS)) {
    throw new Error(`Unexpected vehicle catalogue headers: ${JSON.stringify(headers)}`);
  }

  const records = rawRows.slice(1).map((row, index) => parseVehicleCatalogRow({
    make: row[0],
    model: row[1],
    variant: row[2],
    source_make_id: row[3],
    source_model_id: row[4],
    source_variant_id: row[5]
  }, index + 2));

  return { records, sourceFileHash: sha256File(inputPath) };
}

function buildReport(parsed, options) {
  const statusCounts = countBy(parsed.records, (record) => record.parse_status);
  const accepted = parsed.records.filter((record) => record.parse_status === "accepted");
  const parentEligible = parsed.records.filter((record) => record.parse_status !== "rejected");
  const review = parsed.records.filter((record) => record.parse_status === "review");
  const rejected = parsed.records.filter((record) => record.parse_status === "rejected");
  const canonicalVariantKeys = new Set();
  const canonicalGenerationKeys = new Set();
  const chassisCodes = new Set();

  for (const record of accepted) {
    const value = record.normalized_values;
    const generationKey = `${value.source_model_id}:${value.generation_key}`;
    canonicalGenerationKeys.add(generationKey);

    value.variant_names.forEach((variantName) => {
      canonicalVariantKeys.add(`${generationKey}:${normalizeCatalogKey(variantName)}`);
    });
    value.chassis_codes.forEach((code) => chassisCodes.add(normalizeCatalogKey(code)));
  }

  return {
    source_code: options.sourceCode,
    source_file: options.filePath,
    source_file_hash: parsed.sourceFileHash,
    sheet_name: options.sheetName,
    market: "AU",
    total_rows: parsed.records.length,
    status_counts: statusCounts,
    accepted_rows: accepted.length,
    review_rows: review.length,
    rejected_rows: rejected.length,
    canonical_counts: {
      makes: new Set(parentEligible.map((record) => record.normalized_values.make_key)).size,
      models: new Set(parentEligible.map((record) => `${record.normalized_values.source_make_id}:${record.normalized_values.model_key}`)).size,
      generations: canonicalGenerationKeys.size,
      variants: canonicalVariantKeys.size,
      chassis_codes: chassisCodes.size
    },
    review_sample: review.slice(0, 50).map(summarizeRecord),
    rejected_sample: rejected.slice(0, 50).map(summarizeRecord)
  };
}

function summarizeRecord(record) {
  return {
    row_number: record.row_number,
    make: record.raw_values.make,
    model: record.raw_values.model,
    variant: record.raw_values.variant,
    source_variant_id: record.raw_values.source_variant_id,
    notes: record.parse_notes
  };
}

function printReport(report, reportPath) {
  console.log(`Vehicle catalogue report written to ${reportPath}`);
  console.log(`Rows: ${report.total_rows}`);
  console.log(`Accepted: ${report.accepted_rows}`);
  console.log(`Review: ${report.review_rows}`);
  console.log(`Rejected: ${report.rejected_rows}`);
  console.log(`Canonical counts: ${JSON.stringify(report.canonical_counts)}`);

  if (report.review_sample.length) {
    console.log(`Review sample: ${JSON.stringify(report.review_sample.slice(0, 5))}`);
  }
  if (report.rejected_sample.length) {
    console.log(`Rejected sample: ${JSON.stringify(report.rejected_sample.slice(0, 5))}`);
  }
}

async function applyVehicleCatalog(parsed, report, options) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const source = await requireDataSource(supabase, options.sourceCode);
  const existingBatch = await findExistingBatch(supabase, source.id, parsed.sourceFileHash);
  if (existingBatch) {
    throw new Error(`This source file was already imported as batch ${existingBatch.id} (${existingBatch.import_status}).`);
  }

  const { data: batch, error: batchError } = await supabase
    .from("catalog_import_batches")
    .insert({
      data_source_id: source.id,
      source_file: path.basename(options.filePath),
      source_file_hash: parsed.sourceFileHash,
      sheet_name: options.sheetName,
      import_status: "parsed",
      row_count: report.total_rows,
      accepted_count: report.accepted_rows,
      review_count: report.review_rows,
      rejected_count: report.rejected_rows,
      metadata: { market: "AU", steering_side: "RHD", parser_version: 1 }
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  try {
    const sourceRecords = parsed.records.map((record) => ({
      batch_id: batch.id,
      sheet_name: options.sheetName,
      row_number: record.row_number,
      raw_values: record.raw_values,
      normalized_values: record.normalized_values,
      parse_status: record.parse_status,
      parse_notes: record.parse_notes,
      source_record_hash: sha256Json(record.raw_values)
    }));
    const savedSourceRecords = await insertChunksReturning(
      supabase,
      "catalog_source_records",
      sourceRecords,
      300,
      "id,row_number"
    );
    const sourceRecordByRow = new Map(savedSourceRecords.map((record) => [record.row_number, record.id]));

    await insertReviewItems(supabase, parsed.records, sourceRecordByRow);
    const canonical = await publishCanonicalEntities(
      supabase,
      parsed.records.filter((record) => record.parse_status !== "rejected"),
      sourceRecordByRow,
      source.id,
      options.sourceCode
    );

    const { error: completeError } = await supabase
      .from("catalog_import_batches")
      .update({
        import_status: report.review_rows || report.rejected_rows ? "review" : "published",
        completed_at: new Date().toISOString(),
        metadata: {
          market: "AU",
          steering_side: "RHD",
          parser_version: 1,
          published_counts: canonical
        }
      })
      .eq("id", batch.id);
    if (completeError) throw completeError;

    console.log(`Imported vehicle catalogue batch ${batch.id}`);
    console.log(`Published canonical entities: ${JSON.stringify(canonical)}`);
  } catch (error) {
    await supabase
      .from("catalog_import_batches")
      .update({
        import_status: "failed",
        completed_at: new Date().toISOString(),
        metadata: { market: "AU", parser_version: 1, error: error.message }
      })
      .eq("id", batch.id);
    throw error;
  }
}

async function publishCanonicalEntities(supabase, records, sourceRecordByRow, dataSourceId, sourceCode) {
  const acceptedRecords = records.filter((record) => record.parse_status === "accepted");
  const makeRows = dedupeBy(records.map((record) => ({
    name: record.normalized_values.make,
    normalized_name: record.normalized_values.make_key
  })), (row) => row.normalized_name);
  await upsertChunks(supabase, "vehicle_makes", makeRows, 300, "normalized_name");

  const { data: makes, error: makesError } = await supabase
    .from("vehicle_makes")
    .select("id,name,normalized_name")
    .in("normalized_name", makeRows.map((row) => row.normalized_name));
  if (makesError) throw makesError;
  const makeByKey = new Map(makes.map((row) => [row.normalized_name, row]));

  const modelRows = dedupeBy(records.map((record) => {
    const value = record.normalized_values;
    const make = makeByKey.get(value.make_key);
    return {
      make_id: make.id,
      name: value.model,
      normalized_name: value.model_key
    };
  }), (row) => `${row.make_id}:${row.normalized_name}`);
  await upsertChunks(supabase, "vehicle_models", modelRows, 300, "make_id,normalized_name");

  const modelMakeIds = new Set(makeRows.map((row) => makeByKey.get(row.normalized_name).id));
  const allModels = await selectAll(supabase.from("vehicle_models").select("id,make_id,name,normalized_name"));
  const models = allModels.filter((row) => modelMakeIds.has(row.make_id));
  const modelByKey = new Map(models.map((row) => [`${row.make_id}:${row.normalized_name}`, row]));

  const generationRows = dedupeBy(acceptedRecords.map((record) => {
    const value = record.normalized_values;
    const make = makeByKey.get(value.make_key);
    const model = modelByKey.get(`${make.id}:${value.model_key}`);
    return {
      model_id: model.id,
      name: value.generation_name,
      normalized_name: value.generation_key,
      year_start: value.year_start,
      year_end: value.year_end,
      active: true,
      metadata: { source_code: sourceCode, source_model_id: value.source_model_id }
    };
  }), (row) => `${row.model_id}:${row.normalized_name}`);
  await upsertChunks(supabase, "vehicle_generations", generationRows, 300, "model_id,normalized_name");

  const allGenerations = await selectAll(
    supabase.from("vehicle_generations").select("id,model_id,name,normalized_name,year_start,year_end")
  );
  const relevantModelIds = new Set(models.map((row) => row.id));
  const generations = allGenerations.filter((row) => relevantModelIds.has(row.model_id));
  const generationByKey = new Map(generations.map((row) => [`${row.model_id}:${row.normalized_name}`, row]));

  const recordEntities = new Map();
  for (const record of records) {
    const value = record.normalized_values;
    const make = makeByKey.get(value.make_key);
    const model = modelByKey.get(`${make.id}:${value.model_key}`);
    recordEntities.set(record.row_number, {
      make,
      model,
      generation: null,
      variants: [],
      applications: [],
      chassis: []
    });
  }

  const variantRows = [];
  for (const record of acceptedRecords) {
    const value = record.normalized_values;
    const entities = recordEntities.get(record.row_number);
    const model = entities.model;
    const generation = generationByKey.get(`${model.id}:${value.generation_key}`);
    entities.generation = generation;

    value.variant_names.forEach((variantName, index) => {
      variantRows.push({
        generation_id: generation.id,
        name: variantName,
        normalized_name: normalizeCatalogKey(variantName),
        body_style: value.body_styles[index] ?? "unknown",
        active: true,
        metadata: {
          source_code: sourceCode,
          source_variant_id: value.source_variant_id,
          source_descriptor: value.variant_descriptor
        }
      });
    });
  }
  const uniqueVariantRows = dedupeBy(variantRows, (row) => `${row.generation_id}:${row.normalized_name}`);
  await upsertChunks(supabase, "vehicle_variants", uniqueVariantRows, 300, "generation_id,normalized_name");

  const allVariants = await selectAll(
    supabase.from("vehicle_variants").select("id,generation_id,name,normalized_name,body_style")
  );
  const relevantGenerationIds = new Set(generations.map((row) => row.id));
  const variants = allVariants.filter((row) => relevantGenerationIds.has(row.generation_id));
  const variantByKey = new Map(variants.map((row) => [`${row.generation_id}:${row.normalized_name}`, row]));

  const applicationRows = [];
  for (const record of acceptedRecords) {
    const value = record.normalized_values;
    const entities = recordEntities.get(record.row_number);
    entities.variants = value.variant_names.map((name) => (
      variantByKey.get(`${entities.generation.id}:${normalizeCatalogKey(name)}`)
    ));

    for (const variant of entities.variants) {
      applicationRows.push({
        generation_id: entities.generation.id,
        variant_id: variant.id,
        market: value.market,
        steering_side: value.steering_side,
        year_start: value.year_start,
        month_start: value.month_start,
        year_end: value.year_end,
        month_end: value.month_end,
        fitment_status: "published",
        active: true,
        metadata: {
          source_code: sourceCode,
          source_record_id: sourceRecordByRow.get(record.row_number),
          source_variant_id: value.source_variant_id
        }
      });
    }
  }

  const existingApplications = await selectAll(
    supabase.from("vehicle_fitment_applications")
      .select("id,generation_id,variant_id,market,steering_side,year_start,month_start,year_end,month_end")
  );
  const existingApplicationKeys = new Set(existingApplications.map(applicationKey));
  const applicationsToInsert = dedupeBy(applicationRows, applicationKey)
    .filter((row) => !existingApplicationKeys.has(applicationKey(row)));
  await insertChunks(supabase, "vehicle_fitment_applications", applicationsToInsert, 300);

  const allApplications = await selectAll(
    supabase.from("vehicle_fitment_applications")
      .select("id,generation_id,variant_id,market,steering_side,year_start,month_start,year_end,month_end")
  );
  const applicationByKey = new Map(allApplications.map((row) => [applicationKey(row), row]));
  for (const record of acceptedRecords) {
    const value = record.normalized_values;
    const entities = recordEntities.get(record.row_number);
    entities.applications = entities.variants.map((variant) => applicationByKey.get(applicationKey({
      generation_id: entities.generation.id,
      variant_id: variant.id,
      market: value.market,
      steering_side: value.steering_side,
      year_start: value.year_start,
      month_start: value.month_start,
      year_end: value.year_end,
      month_end: value.month_end
    })));
  }

  const chassisRows = dedupeBy(acceptedRecords.flatMap((record) => record.normalized_values.chassis_codes.map((code) => ({
    code,
    normalized_code: normalizeCatalogKey(code)
  }))), (row) => row.normalized_code);
  await upsertChunks(supabase, "vehicle_chassis_codes", chassisRows, 300, "normalized_code");
  const allChassis = await selectAll(supabase.from("vehicle_chassis_codes").select("id,code,normalized_code"));
  const chassisByKey = new Map(allChassis.map((row) => [row.normalized_code, row]));

  const assignmentRows = [];
  for (const record of acceptedRecords) {
    const entities = recordEntities.get(record.row_number);
    entities.chassis = record.normalized_values.chassis_codes.map((code) => chassisByKey.get(normalizeCatalogKey(code)));
    entities.chassis.forEach((chassis, index) => assignmentRows.push({
      chassis_code_id: chassis.id,
      generation_id: entities.generation.id,
      variant_id: null,
      is_primary: index === 0,
      notes: `Imported from ${sourceCode}`
    }));
  }
  const existingAssignments = await selectAll(
    supabase.from("vehicle_chassis_assignments").select("chassis_code_id,generation_id,variant_id")
  );
  const existingAssignmentKeys = new Set(existingAssignments.map(chassisAssignmentKey));
  const assignmentsToInsert = dedupeBy(assignmentRows, chassisAssignmentKey)
    .filter((row) => !existingAssignmentKeys.has(chassisAssignmentKey(row)));
  await insertChunks(supabase, "vehicle_chassis_assignments", assignmentsToInsert, 300);

  await upsertAliases(supabase, records, recordEntities, dataSourceId);
  await insertMappings(supabase, records, recordEntities, sourceRecordByRow);

  return {
    makes: makeRows.length,
    models: modelRows.length,
    generations: generationRows.length,
    variants: uniqueVariantRows.length,
    applications: dedupeBy(applicationRows, applicationKey).length,
    chassis_codes: chassisRows.length,
    source_mappings: records.length
  };
}

async function upsertAliases(supabase, records, recordEntities, dataSourceId) {
  const aliases = [];

  for (const record of records) {
    const value = record.normalized_values;
    const entities = recordEntities.get(record.row_number);
    aliases.push(
      aliasRow(dataSourceId, "make", "source_id", "*", value.source_make_id, "AU", 0, { make_id: entities.make.id }),
      aliasRow(dataSourceId, "make", "name", "*", value.make, "AU", 0, { make_id: entities.make.id }),
      aliasRow(dataSourceId, "model", "source_id", entities.make.id, value.source_model_id, "AU", 0, { model_id: entities.model.id }),
      aliasRow(dataSourceId, "model", "name", entities.make.id, value.model, "AU", 0, { model_id: entities.model.id })
    );

    if (!entities.generation) continue;

    aliases.push(aliasRow(
      dataSourceId,
      "generation",
      "descriptor",
      entities.model.id,
      value.variant_descriptor,
      "AU",
      0,
      { generation_id: entities.generation.id }
    ));

    entities.variants.forEach((variant, index) => {
      aliases.push(
        aliasRow(dataSourceId, "variant", "source_id", entities.generation.id, value.source_variant_id, "AU", index, {
          variant_id: variant.id
        }),
        aliasRow(dataSourceId, "variant", "descriptor", entities.generation.id, value.variant_descriptor, "AU", index, {
          variant_id: variant.id
        })
      );
    });

    entities.chassis.forEach((chassis, index) => aliases.push(
      aliasRow(dataSourceId, "chassis", "chassis", entities.generation.id, value.chassis_codes[index], "AU", index, {
        chassis_code_id: chassis.id
      })
    ));
  }

  const uniqueAliases = dedupeBy(aliases, (row) => [
    row.data_source_id,
    row.entity_type,
    row.alias_kind,
    row.alias_scope_key,
    row.normalized_alias,
    row.market,
    row.alias_index
  ].join(":"));
  await upsertChunks(
    supabase,
    "vehicle_entity_aliases",
    uniqueAliases,
    300,
    "data_source_id,entity_type,alias_kind,alias_scope_key,normalized_alias,market,alias_index"
  );
}

function aliasRow(dataSourceId, entityType, aliasKind, scope, alias, market, aliasIndex, target) {
  return {
    data_source_id: dataSourceId,
    entity_type: entityType,
    alias_kind: aliasKind,
    alias_index: aliasIndex,
    alias_scope_key: String(scope),
    alias,
    normalized_alias: normalizeCatalogKey(alias),
    market,
    ...target
  };
}

async function insertMappings(supabase, records, recordEntities, sourceRecordByRow) {
  const mappings = [];

  for (const record of records) {
    const entities = recordEntities.get(record.row_number);
    const sourceRecordId = sourceRecordByRow.get(record.row_number);
    mappings.push(
      mappingRow(sourceRecordId, "make", 0, 1, { make_id: entities.make.id }),
      mappingRow(sourceRecordId, "model", 0, 1, { model_id: entities.model.id })
    );

    if (!entities.generation) continue;

    mappings.push(mappingRow(
      sourceRecordId,
      "generation",
      0,
      0.98,
      { generation_id: entities.generation.id }
    ));

    entities.variants.forEach((variant, index) => mappings.push(
      mappingRow(sourceRecordId, "variant", index, 0.95, { variant_id: variant.id })
    ));
    entities.applications.forEach((application, index) => mappings.push(
      mappingRow(sourceRecordId, "application", index, 0.95, { vehicle_application_id: application.id })
    ));
    entities.chassis.forEach((chassis, index) => mappings.push(
      mappingRow(sourceRecordId, "chassis", index, 0.9, { chassis_code_id: chassis.id })
    ));
  }

  await insertChunks(supabase, "source_entity_mappings", mappings, 300);
}

function mappingRow(sourceRecordId, entityType, mappingIndex, confidence, target) {
  return {
    source_record_id: sourceRecordId,
    entity_type: entityType,
    mapping_index: mappingIndex,
    mapping_status: "approved",
    confidence,
    match_reasons: ["authoritative source identifier", "normalized parent hierarchy"],
    ...target
  };
}

async function insertReviewItems(supabase, records, sourceRecordByRow) {
  const rows = records
    .filter((record) => record.parse_status === "review" || record.parse_status === "rejected")
    .map((record) => ({
      source_record_id: sourceRecordByRow.get(record.row_number),
      issue_type: record.parse_status === "rejected" ? "vehicle_identity_incomplete" : "vehicle_variant_incomplete",
      severity: record.parse_status === "rejected" ? "error" : "warning",
      review_status: "open",
      summary: record.parse_notes.join(" "),
      payload: {
        row_number: record.row_number,
        raw_values: record.raw_values,
        normalized_values: record.normalized_values
      }
    }));
  await insertChunks(supabase, "fitment_review_queue", rows, 300);
}

async function requireDataSource(supabase, code) {
  const { data, error } = await supabase
    .from("catalog_data_sources")
    .select("id,code")
    .eq("code", code)
    .eq("active", true)
    .single();
  if (error) {
    throw new Error(`V2 catalogue schema is unavailable or source ${code} is missing: ${error.message}`);
  }
  return data;
}

async function findExistingBatch(supabase, dataSourceId, fileHash) {
  const { data, error } = await supabase
    .from("catalog_import_batches")
    .select("id,import_status")
    .eq("data_source_id", dataSourceId)
    .eq("source_file_hash", fileHash)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function applicationKey(row) {
  return [
    row.generation_id,
    row.variant_id ?? "",
    row.market,
    row.steering_side,
    row.year_start ?? "",
    row.month_start ?? "",
    row.year_end ?? "",
    row.month_end ?? ""
  ].join(":");
}

function chassisAssignmentKey(row) {
  return `${row.chassis_code_id}:${row.generation_id}:${row.variant_id ?? ""}`;
}

async function insertChunks(supabase, table, rows, size) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await supabase.from(table).insert(rows.slice(index, index + size));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function insertChunksReturning(supabase, table, rows, size, columns) {
  const saved = [];
  for (let index = 0; index < rows.length; index += size) {
    const { data, error } = await supabase
      .from(table)
      .insert(rows.slice(index, index + size))
      .select(columns);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    saved.push(...(data ?? []));
  }
  return saved;
}

async function upsertChunks(supabase, table, rows, size, onConflict) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(index, index + size), { onConflict, ignoreDuplicates: false });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function selectAll(query, size = 1000) {
  const rows = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query.range(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

function dedupeBy(rows, getKey) {
  return [...new Map(rows.map((row) => [getKey(row), row])).values()];
}

function countBy(rows, getKey) {
  const counts = {};
  for (const row of rows) {
    const key = getKey(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sha256File(inputPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(inputPath)).digest("hex");
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}
