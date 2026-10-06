import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(path.join(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing production Supabase configuration.");

const outputPath = path.resolve(
  process.argv[2] ?? path.join(process.cwd(), "tmp", `production-vehicle-backup-${new Date().toISOString().slice(0, 10)}.json`)
);
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const tables = ["vehicle_makes", "vehicle_models", "vehicle_applications", "wiper_length_fitments"];
const backup = {
  generated_at: new Date().toISOString(),
  project_host: new URL(url).host,
  tables: {}
};

for (const table of tables) {
  const rows = await selectAll(supabase.from(table).select("*"));
  backup.tables[table] = rows;
  console.log(`${table}: ${rows.length}`);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2));
console.log(`Production vehicle backup written to ${outputPath}`);

async function selectAll(query, size = 1000) {
  const rows = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query.range(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
