import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const tables = [
  "fitment_import_batches",
  "fitment_import_rows",
  "vehicle_makes",
  "vehicle_models",
  "vehicle_applications",
  "wiper_length_fitments",
  "wiper_connector_fitments"
];

const counts = {};
for (const table of tables) {
  counts[table] = await countRows(table);
}

console.log(JSON.stringify(counts, null, 2));

const { data: samples, error } = await supabase
  .from("wiper_length_fitments")
  .select(`
    driver_length_in,
    passenger_length_in,
    rear_length_in,
    driver_length_source,
    passenger_length_source,
    vehicle_applications (
      start_raw,
      end_raw,
      vehicle_makes (name),
      vehicle_models (name)
    )
  `)
  .order("created_at", { ascending: true })
  .limit(5);

if (error) throw error;

console.log(JSON.stringify(samples, null, 2));

async function countRows(table) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) throw error;
  return count;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
