import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

import { mapLegacyApplication } from "./legacy-vehicle-mapping.mjs";

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(process.cwd(), ".env.local"));
if (!args["report-only"] && !args.apply) throw new Error("Choose --report-only or --apply.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const canonical = await loadCanonicalSource(client);
const applications = await loadLegacyApplications(client);
const mappings = applications.map((application) => (
  mapLegacyApplication(application, canonical.rows, canonical.applicationByKey)
));
const conflicts = findConfigurationConflicts(mappings);
const conflictedApplicationIds = new Set(conflicts.map((conflict) => conflict.vehicle_fitment_application_id));
const safeMappings = mappings.filter((mapping) => (
  mapping.status === "matched" && !conflictedApplicationIds.has(mapping.vehicle_fitment_application_id)
));
const report = buildReport(mappings, applications.length, conflicts, safeMappings.length);
const outputPath = path.resolve(args.output ?? path.join(process.cwd(), "tmp", "legacy-vehicle-application-map-report.json"));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

console.log(`Legacy vehicle mapping report written to ${outputPath}`);
console.log(`Applications: ${report.total}`);
console.log(`Matched: ${report.matched}`);
console.log(`Review: ${report.review}`);
console.log(`Unmatched: ${report.unmatched}`);

if (args.apply) {
  await upsertChunks(client, "legacy_vehicle_application_map", safeMappings.map((mapping) => ({
    legacy_vehicle_application_id: mapping.legacy_vehicle_application_id,
    vehicle_fitment_application_id: mapping.vehicle_fitment_application_id,
    mapping_status: "approved",
    confidence: mapping.confidence,
    notes: mapping.reasons.join(" "),
    reviewed_at: new Date().toISOString()
  })), 250, "legacy_vehicle_application_id");
  console.log(`Applied ${safeMappings.length} approved legacy-to-canonical mappings. No legacy records were changed or deleted.`);
}

async function loadCanonicalSource(supabase) {
  const { data: source, error: sourceError } = await supabase.from("catalog_data_sources")
    .select("id").eq("code", "MACHTER_VEHICLE_CATALOG").eq("active", true).single();
  if (sourceError) throw sourceError;
  const { data: batch, error: batchError } = await supabase.from("catalog_import_batches")
    .select("id,source_file_hash").eq("data_source_id", source.id).order("created_at", { ascending: false }).limit(1).single();
  if (batchError) throw batchError;
  const records = await selectAll(supabase.from("catalog_source_records")
    .select("id,row_number,normalized_values,parse_status").eq("batch_id", batch.id));
  const accepted = records.filter((record) => record.parse_status === "accepted");
  const rowByRecordId = new Map(accepted.map((record) => [record.id, record.row_number]));
  const applicationMappings = await selectInChunks(supabase, "source_entity_mappings", "source_record_id", [...rowByRecordId.keys()],
    "source_record_id,mapping_index,vehicle_application_id", { entity_type: "application", mapping_status: "approved" });
  return {
    rows: accepted.map((record) => ({ row_number: record.row_number, ...record.normalized_values })),
    applicationByKey: new Map(applicationMappings.map((mapping) => [
      `${rowByRecordId.get(mapping.source_record_id)}:${mapping.mapping_index}`,
      mapping.vehicle_application_id
    ]))
  };
}

async function loadLegacyApplications(supabase) {
  const rows = await selectAll(supabase.from("vehicle_applications")
    .select("id,year_start,month_start,year_end,month_end,start_raw,end_raw,vehicle_makes(name),vehicle_models(id,name),wiper_length_fitments(driver_length_in,passenger_length_in,rear_length_in)")
    .eq("active", true));
  return rows.map((row) => {
    const make = single(row.vehicle_makes);
    const model = single(row.vehicle_models);
    const fitment = row.wiper_length_fitments?.[0] ?? null;
    return {
      id: row.id,
      model_id: model?.id ?? null,
      make: make?.name ?? "",
      model: model?.name ?? "",
      year_start: row.year_start,
      month_start: row.month_start,
      year_end: row.year_end,
      month_end: row.month_end,
      start_raw: row.start_raw,
      end_raw: row.end_raw,
      driver_length_in: toNumber(fitment?.driver_length_in),
      passenger_length_in: toNumber(fitment?.passenger_length_in),
      rear_length_in: toNumber(fitment?.rear_length_in)
    };
  });
}

function buildReport(mappings, total, conflicts, safeToApply) {
  const count = (status) => mappings.filter((mapping) => mapping.status === status).length;
  const modelMapped = mappings.filter((mapping) => mapping.canonical_model);
  return {
    generated_at: new Date().toISOString(),
    mode: "legacy_to_machter_canonical_mapping",
    policy: {
      canonical_source: "MACHTER_VEHICLE_CATALOG",
      writes_are_additive: true,
      legacy_records_changed: false,
      automatic_status: "approved matches only"
    },
    total,
    status_counts: Object.fromEntries([...new Set(mappings.map((mapping) => mapping.status))]
      .map((status) => [status, count(status)])),
    model_mapping: {
      mapped_applications: modelMapped.length,
      unmapped_applications: total - modelMapped.length,
      mapped_legacy_models: new Set(modelMapped.map((mapping) => mapping.legacy_model_id)).size,
      unmapped_legacy_models: new Set(mappings.filter((mapping) => !mapping.canonical_model).map((mapping) => mapping.legacy_model_id)).size
    },
    safe_to_apply: safeToApply,
    configuration_conflicts: conflicts,
    matched: count("matched"),
    review: count("review") + count("source_review"),
    unmatched: count("unmatched"),
    matched_sample: mappings.filter((mapping) => mapping.status === "matched").slice(0, 50),
    review_sample: mappings.filter((mapping) => mapping.status !== "matched").slice(0, 100)
  };
}

function findConfigurationConflicts(mappings) {
  const grouped = new Map();
  for (const mapping of mappings.filter((entry) => entry.status === "matched")) {
    const targetId = mapping.vehicle_fitment_application_id;
    const configurations = grouped.get(targetId) ?? new Map();
    const key = mapping.wiper_configuration.map((value) => value ?? "-").join("/");
    const applications = configurations.get(key) ?? [];
    applications.push(mapping.legacy_vehicle_application_id);
    configurations.set(key, applications);
    grouped.set(targetId, configurations);
  }
  return [...grouped.entries()]
    .filter(([, configurations]) => configurations.size > 1)
    .map(([vehicleFitmentApplicationId, configurations]) => ({
      vehicle_fitment_application_id: vehicleFitmentApplicationId,
      configurations: [...configurations.entries()].map(([configuration, legacyApplicationIds]) => ({
        configuration,
        legacy_application_ids: legacyApplicationIds
      }))
    }));
}

function single(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function upsertChunks(supabase, table, rows, size, onConflict) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await supabase.from(table).upsert(rows.slice(index, index + size), { onConflict });
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

async function selectInChunks(supabase, table, column, values, select, equals = {}) {
  const rows = [];
  for (let index = 0; index < values.length; index += 200) {
    let query = supabase.from(table).select(select).in(column, values.slice(index, index + 200));
    for (const [key, value] of Object.entries(equals)) query = query.eq(key, value);
    rows.push(...await selectAll(query));
  }
  return rows;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return parsed;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
