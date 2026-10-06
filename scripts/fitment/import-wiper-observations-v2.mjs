import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(process.cwd(), ".env.local"));

if (!args.apply) {
  throw new Error("This importer writes staged V2 observations. Pass --apply after reviewing the preflight report.");
}

const reportPath = path.resolve(args.report ?? path.join(process.cwd(), "tmp", "wiper-source-match-report.json"));
if (!fs.existsSync(reportPath)) throw new Error(`Preflight report not found: ${reportPath}`);
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
if (report.mode !== "read_only_preflight") throw new Error("Unexpected preflight report format.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const canonicalApplications = await loadCanonicalApplications(supabase, report.canonical.source_file_sha256);

for (const sourceReport of report.sources) {
  await importSource(supabase, sourceReport, canonicalApplications, report.configuration_conflicts ?? []);
}

console.log("All V2 wiper observations were staged. No fitment was published automatically.");

async function importSource(client, sourceReport, canonicalApplicationByKey, conflicts) {
  const source = await requireDataSource(client, sourceReport.source_code);
  const existing = await findExistingBatch(client, source.id, sourceReport.source_file_sha256);
  if (existing) {
    throw new Error(`${sourceReport.source_code} file was already imported as batch ${existing.id} (${existing.import_status}).`);
  }

  const sourceRows = collapseSourceRows(sourceReport.rows);
  const acceptedSourceRows = sourceRows.filter((row) => row.parse_status === "accepted").length;
  const reviewSourceRows = sourceRows.length - acceptedSourceRows;
  const { data: batch, error: batchError } = await client.from("catalog_import_batches").insert({
    data_source_id: source.id,
    source_file: path.basename(sourceReport.source_file),
    source_file_hash: sourceReport.source_file_sha256,
    sheet_name: sourceReport.sheet_name,
    import_status: "parsed",
    row_count: sourceRows.length,
    accepted_count: acceptedSourceRows,
    review_count: reviewSourceRows,
    rejected_count: 0,
    metadata: { parser_version: 1, preflight_generated_at: report.generated_at, observations: sourceReport.total_observations }
  }).select("id").single();
  if (batchError) throw batchError;

  try {
    const savedRecords = await insertChunksReturning(client, "catalog_source_records", sourceRows.map((row) => ({
      batch_id: batch.id,
      sheet_name: sourceReport.sheet_name,
      row_number: row.row_number,
      raw_values: { cells: row.raw_values },
      normalized_values: { observations: row.observations },
      parse_status: row.parse_status,
      parse_notes: row.parse_notes,
      source_record_hash: sha256Json(row.raw_values)
    })), 250, "id,row_number");
    const sourceRecordByRow = new Map(savedRecords.map((row) => [row.row_number, row.id]));

    const configurationByKey = await upsertConfigurations(client, sourceReport.rows);
    const observationRows = [];
    const mappingRows = [];
    const fitmentRows = [];
    const reviewRows = [];

    for (const row of sourceReport.rows) {
      const sourceRecordId = sourceRecordByRow.get(row.row_number);
      const target = row.match.suggested_target;
      const canonicalKey = target
        ? `${target.row_number}:${target.application_mapping_index ?? 0}`
        : null;
      const vehicleApplicationId = row.match.status === "matched"
        ? canonicalApplicationByKey.get(canonicalKey) ?? null
        : null;
      const sizeKey = configurationKey(row.normalized_values);
      const configurationId = row.match.status === "matched" ? configurationByKey.get(sizeKey) ?? null : null;
      const accepted = row.match.status === "matched" && vehicleApplicationId && configurationId;

      observationRows.push({
        source_record_id: sourceRecordId,
        observation_index: row.observation_index ?? 0,
        vehicle_application_id: accepted ? vehicleApplicationId : null,
        wiper_configuration_id: accepted ? configurationId : null,
        driver_length_in: row.normalized_values.driver_length_in,
        passenger_length_in: row.normalized_values.passenger_length_in,
        rear_length_in: row.normalized_values.rear_length_in,
        rear_observation_status: row.normalized_values.rear_status,
        observation_status: accepted ? "accepted" : "review",
        raw_driver_value: row.normalized_values.raw_driver_value,
        raw_passenger_value: row.normalized_values.raw_passenger_value,
        raw_rear_value: row.normalized_values.raw_rear_value,
        notes: [...new Set([...(row.parse_notes ?? []), ...(row.match.reasons ?? [])])]
      });

      if (accepted) {
        mappingRows.push({
          source_record_id: sourceRecordId,
          entity_type: "application",
          mapping_index: row.observation_index ?? 0,
          mapping_status: "approved",
          confidence: 0.95,
          vehicle_application_id: vehicleApplicationId,
          match_reasons: row.match.reasons
        });
        fitmentRows.push({
          vehicle_application_id: vehicleApplicationId,
          wiper_configuration_id: configurationId,
          fitment_status: "review",
          confidence: 0.95,
          notes: `Staged from ${sourceReport.source_code}; publication requires conflict review.`
        });
      } else {
        reviewRows.push({
          source_record_id: sourceRecordId,
          issue_type: row.parse_status === "review" ? "wiper_size_or_source_parse" : "vehicle_identity_match",
          severity: row.parse_status === "review" ? "error" : "warning",
          review_status: "open",
          summary: [...new Set([...(row.parse_notes ?? []), ...(row.match.reasons ?? [])])].join(" "),
          payload: { row_number: row.row_number, observation_index: row.observation_index, normalized_values: row.normalized_values, match: row.match }
        });
      }
    }

    await insertChunks(client, "wiper_fitment_observations", observationRows, 250);
    await insertChunks(client, "source_entity_mappings", dedupeBy(mappingRows, (row) => `${row.source_record_id}:${row.entity_type}:${row.mapping_index}`), 250);
    await upsertChunks(client, "vehicle_wiper_fitments", dedupeBy(fitmentRows, (row) => `${row.vehicle_application_id}:${row.wiper_configuration_id}`), 250, "vehicle_application_id,wiper_configuration_id");
    await insertChunks(client, "fitment_review_queue", reviewRows, 250);
    await insertConflictReviews(client, sourceReport, conflicts, sourceRecordByRow);

    const { error: finishError } = await client.from("catalog_import_batches").update({
      import_status: "review",
      completed_at: new Date().toISOString(),
      metadata: {
        parser_version: 1,
        preflight_generated_at: report.generated_at,
        observations: sourceReport.total_observations,
        matched_staged: sourceReport.matched,
        auto_published: 0
      }
    }).eq("id", batch.id);
    if (finishError) throw finishError;
    console.log(`Staged ${sourceReport.source_code}: ${sourceReport.total_observations} observations (${sourceReport.matched} matched).`);
  } catch (error) {
    await client.from("catalog_import_batches").update({
      import_status: "failed",
      completed_at: new Date().toISOString(),
      metadata: { error: error.message, parser_version: 1 }
    }).eq("id", batch.id);
    throw error;
  }
}

async function loadCanonicalApplications(client, fileHash) {
  const source = await requireDataSource(client, "MACHTER_VEHICLE_CATALOG");
  const { data: batch, error: batchError } = await client.from("catalog_import_batches")
    .select("id,import_status")
    .eq("data_source_id", source.id)
    .eq("source_file_hash", fileHash)
    .maybeSingle();
  if (batchError) throw batchError;
  if (!batch) throw new Error("The matching Machter vehicle-catalogue batch must be imported before wiper observations.");

  const records = await selectAll(client.from("catalog_source_records").select("id,row_number").eq("batch_id", batch.id));
  const rowByRecordId = new Map(records.map((row) => [row.id, row.row_number]));
  const mappings = await selectInChunks(client, "source_entity_mappings", "source_record_id", records.map((row) => row.id),
    "source_record_id,mapping_index,vehicle_application_id", { entity_type: "application", mapping_status: "approved" });
  return new Map(mappings.map((mapping) => [
    `${rowByRecordId.get(mapping.source_record_id)}:${mapping.mapping_index}`,
    mapping.vehicle_application_id
  ]));
}

async function upsertConfigurations(client, rows) {
  const values = dedupeBy(rows.filter((row) => row.match.status === "matched").map((row) => row.normalized_values), configurationKey);
  const result = new Map();
  for (const value of values) {
    const { data, error } = await client.rpc("upsert_wiper_configuration", {
      p_driver_length_in: value.driver_length_in,
      p_passenger_length_in: value.passenger_length_in,
      p_rear_length_in: value.rear_length_in
    });
    if (error) throw new Error(`wiper configuration upsert failed: ${error.message}`);
    result.set(configurationKey(value), data);
  }
  return result;
}

async function insertConflictReviews(client, sourceReport, conflicts, sourceRecordByRow) {
  const records = [];
  for (const conflict of conflicts) {
    for (const configuration of conflict.configurations) {
      for (const reference of configuration.records) {
        if (reference.source_code !== sourceReport.source_code) continue;
        records.push({
          source_record_id: sourceRecordByRow.get(reference.row_number),
          issue_type: "wiper_configuration_conflict",
          severity: "warning",
          review_status: "open",
          summary: `Multiple wiper configurations matched canonical source variant ${conflict.source_variant_id}.`,
          payload: conflict
        });
      }
    }
  }
  await insertChunks(client, "fitment_review_queue", records.filter((row) => row.source_record_id), 250);
}

function collapseSourceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const existing = groups.get(row.row_number) ?? {
      row_number: row.row_number,
      raw_values: row.raw_values,
      observations: [],
      parse_status: "accepted",
      parse_notes: []
    };
    existing.observations.push(row.normalized_values);
    if (row.parse_status !== "accepted") existing.parse_status = "review";
    existing.parse_notes.push(...(row.parse_notes ?? []));
    groups.set(row.row_number, existing);
  }
  return [...groups.values()].map((row) => ({ ...row, parse_notes: [...new Set(row.parse_notes)] }));
}

function configurationKey(value) {
  return `${value.driver_length_in}/${value.passenger_length_in}/${value.rear_length_in ?? "-"}`;
}

async function requireDataSource(client, code) {
  const { data, error } = await client.from("catalog_data_sources").select("id,code").eq("code", code).eq("active", true).single();
  if (error) throw new Error(`V2 schema or source ${code} is unavailable: ${error.message}`);
  return data;
}

async function findExistingBatch(client, dataSourceId, fileHash) {
  const { data, error } = await client.from("catalog_import_batches").select("id,import_status")
    .eq("data_source_id", dataSourceId).eq("source_file_hash", fileHash).maybeSingle();
  if (error) throw error;
  return data;
}

async function insertChunks(client, table, rows, size) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).insert(rows.slice(index, index + size));
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function insertChunksReturning(client, table, rows, size, columns) {
  const saved = [];
  for (let index = 0; index < rows.length; index += size) {
    const { data, error } = await client.from(table).insert(rows.slice(index, index + size)).select(columns);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
    saved.push(...(data ?? []));
  }
  return saved;
}

async function upsertChunks(client, table, rows, size, onConflict) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + size), { onConflict, ignoreDuplicates: true });
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

async function selectInChunks(client, table, column, values, select, equals = {}) {
  const rows = [];
  for (let index = 0; index < values.length; index += 200) {
    let query = client.from(table).select(select).in(column, values.slice(index, index + 200));
    for (const [key, value] of Object.entries(equals)) query = query.eq(key, value);
    const data = await selectAll(query);
    rows.push(...data);
  }
  return rows;
}

function dedupeBy(rows, keyFn) {
  return [...new Map(rows.map((row) => [keyFn(row), row])).values()];
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
