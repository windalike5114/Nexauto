import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnv(path.join(process.cwd(), ".env.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase service credentials are missing.");

const apply = process.argv.includes("--apply");
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputIndex = process.argv.indexOf("--output");
const outputDir = path.resolve(
  outputIndex >= 0
    ? process.argv[outputIndex + 1]
    : path.join(process.cwd(), "tmp", "production-backups", `legacy-vehicle-catalog-${stamp}`)
);

const legacyTables = [
  ["legacy_vehicle_application_map", "legacy_vehicle_application_id"],
  ["vehicle_product_fitment_evidence", "id"],
  ["source_entity_mappings", "id"],
  ["wiper_fitment_observations", "id"],
  ["vehicle_wiper_fitments", "id"],
  ["vehicle_product_fitments", "id"],
  ["vehicle_fitment_applications", "id"],
  ["vehicle_entity_aliases", "id"],
  ["vehicle_chassis_assignments", "id"],
  ["vehicle_variants", "id"],
  ["vehicle_generations", "id"],
  ["vehicle_chassis_codes", "id"],
  ["wiper_connector_fitments", "id"],
  ["wiper_length_fitments", "id"],
  ["vehicle_applications", "id"],
  ["vehicle_models", "id"],
  ["vehicle_makes", "id"]
];

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
await assertV5Ready(db);
fs.mkdirSync(outputDir, { recursive: true });

const manifest = {
  generated_at: new Date().toISOString(),
  project_host: new URL(url).host,
  purpose: "Backup before retiring the pre-V5 vehicle catalog",
  applied: false,
  tables: {}
};

for (const [table, primaryKey] of legacyTables) {
  const rows = await selectAll(db, table, primaryKey);
  const json = `${JSON.stringify(rows, null, 2)}\n`;
  const file = `${table}.json`;
  fs.writeFileSync(path.join(outputDir, file), json);
  manifest.tables[table] = {
    rows: rows.length,
    file,
    sha256: crypto.createHash("sha256").update(json).digest("hex")
  };
  process.stdout.write(`Backed up ${table}: ${rows.length}\n`);
}

fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Backup written to ${outputDir}\n`);

if (!apply) {
  process.stdout.write("Backup-only run complete. Pass --apply to clear the legacy catalog after backup.\n");
  process.exit(0);
}

for (const [table, primaryKey] of legacyTables) {
  await deleteInBatches(db, table, primaryKey);
  process.stdout.write(`Cleared ${table}\n`);
}

const remaining = {};
for (const [table] of legacyTables) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Could not verify ${table}: ${error.message}`);
  remaining[table] = count ?? 0;
}
if (Object.values(remaining).some((count) => count !== 0)) {
  throw new Error(`Legacy catalog cleanup was incomplete: ${JSON.stringify(remaining)}`);
}

manifest.applied = true;
manifest.applied_at = new Date().toISOString();
manifest.remaining_rows = remaining;
fs.writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ retired: true, backup: outputDir, remaining }, null, 2)}\n`);

async function assertV5Ready(client) {
  const { data: release, error: releaseError } = await client
    .from("vehicle_catalog_releases")
    .select("release_id,active")
    .eq("release_id", "nexauto-vehicle-catalog-v5")
    .eq("active", true)
    .maybeSingle();
  if (releaseError || !release) throw new Error("The active V5 catalog release was not found.");

  for (const table of ["vehicle_catalog_makes", "vehicle_catalog_models", "vehicle_catalog_applications", "vehicle_catalog_application_years"]) {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error || !count) throw new Error(`V5 readiness check failed for ${table}: ${error?.message ?? "empty table"}`);
  }
}

async function selectAll(client, table, primaryKey, size = 1000) {
  const rows = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order(primaryKey, { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`Could not back up ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

async function deleteInBatches(client, table, primaryKey, size = 200) {
  let deleted = 0;
  for (;;) {
    const { data, error: selectError } = await client
      .from(table)
      .select(primaryKey)
      .order(primaryKey, { ascending: true })
      .limit(size);
    if (selectError) throw new Error(`Could not read ${table} for cleanup: ${selectError.message}`);
    if (!data?.length) return;

    const ids = data.map((row) => row[primaryKey]);
    const { error: deleteError } = await client.from(table).delete().in(primaryKey, ids);
    if (deleteError) throw new Error(`Could not clear ${table}: ${deleteError.message}`);
    deleted += ids.length;
    if (deleted % 2000 === 0) process.stdout.write(`Clearing ${table}: ${deleted}\n`);
  }
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
