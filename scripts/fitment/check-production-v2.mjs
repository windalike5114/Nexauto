import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(path.join(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing production Supabase configuration.");

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const tables = [
  "vehicle_applications",
  "wiper_length_fitments",
  "vehicle_makes",
  "vehicle_models",
  "vehicle_generations",
  "vehicle_variants",
  "vehicle_chassis_codes",
  "vehicle_fitment_applications",
  "vehicle_entity_aliases",
  "source_entity_mappings",
  "catalog_data_sources",
  "catalog_import_batches",
  "catalog_source_records",
  "wiper_fitment_observations",
  "wiper_configurations",
  "wiper_configuration_blades",
  "vehicle_wiper_fitments",
  "fitment_review_queue"
];

for (const table of tables) {
  const { data, count, error } = await supabase.from(table).select("id", { count: "exact" }).limit(1);
  console.log(JSON.stringify({
    table,
    exists: !error,
    count: error ? null : count,
    sample_rows: data?.length ?? null,
    error_code: error?.code ?? null,
    error_message: error?.message ?? null
  }));
}

const probes = [
  ["wiper_configurations", "id,configuration_key,rear_status,configuration_status"],
  ["wiper_fitment_observations", "id,source_record_id,observation_index,observation_status"],
  ["vehicle_fitment_applications", "id,generation_id,variant_id,fitment_status"],
  ["source_entity_mappings", "id,source_record_id,entity_type,mapping_index"]
];

for (const [table, columns] of probes) {
  const { data, error } = await supabase.from(table).select(columns).limit(1);
  console.log(JSON.stringify({
    probe: table,
    columns,
    valid: !error,
    sample_rows: data?.length ?? null,
    error_code: error?.code ?? null,
    error_message: error?.message ?? null
  }));
}

const { data: sources, error: sourcesError } = await supabase
  .from("catalog_data_sources")
  .select("code,name,active")
  .order("code");
console.log(JSON.stringify({
  probe: "catalog_data_sources_rows",
  valid: !sourcesError,
  rows: sources ?? [],
  error_code: sourcesError?.code ?? null,
  error_message: sourcesError?.message ?? null
}));

const statusChecks = [
  ["vehicle_fitment_applications", "fitment_status", "published"],
  ["vehicle_wiper_fitments", "fitment_status", "published"],
  ["wiper_configurations", "configuration_status", "published"],
  ["wiper_fitment_observations", "observation_status", "accepted"],
  ["fitment_review_queue", "review_status", "open"]
];
for (const [table, column, value] of statusChecks) {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  console.log(JSON.stringify({ status_check: `${table}.${column}=${value}`, count, error: error?.message ?? null }));
}

const { data: batches, error: batchesError } = await supabase
  .from("catalog_import_batches")
  .select("id,source_file,import_status,row_count,accepted_count,review_count,rejected_count,metadata,created_at,completed_at")
  .order("created_at");
console.log(JSON.stringify({ probe: "catalog_import_batches_rows", valid: !batchesError, rows: batches ?? [], error: batchesError?.message ?? null }));

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
