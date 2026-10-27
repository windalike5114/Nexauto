import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const backupArg = process.argv.find((value) => value.startsWith("--backup="))?.slice("--backup=".length);
if (!backupArg) throw new Error("Pass --backup=<exact backup directory>");
const ROOT = process.cwd();
const BACKUP_DIR = path.resolve(backupArg);
const MANIFEST_FILE = path.join(BACKUP_DIR, "manifest.json");
if (!fs.existsSync(MANIFEST_FILE)) throw new Error(`Missing manifest: ${MANIFEST_FILE}`);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
if (manifest.source_code !== "BENDIX_NZ_FULL_FITMENT_V1") throw new Error("Backup source code mismatch");

const tables = {};
for (const [name, entry] of Object.entries(manifest.tables)) {
  const filename = path.join(BACKUP_DIR, entry.filename);
  const contents = fs.readFileSync(filename, "utf8");
  const digest = crypto.createHash("sha256").update(contents).digest("hex");
  if (digest !== entry.sha256) throw new Error(`Backup checksum mismatch: ${name}`);
  tables[name] = JSON.parse(contents);
  if (tables[name].length !== entry.rows) throw new Error(`Backup row count mismatch: ${name}`);
}

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const currentFitments = await fetchAll("vehicle_catalog_part_reference_fitments", "*",
  (query) => query.eq("data_source_id", manifest.data_source_id));
const report = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? "apply" : "report-only",
  backup_dir: BACKUP_DIR,
  data_source_id: manifest.data_source_id,
  current_fitments: currentFitments.length,
  restore_fitments: tables.fitments.length,
  rows_to_remove: Math.max(0, currentFitments.length - tables.fitments.length),
};
console.log(JSON.stringify(report, null, 2));
if (!APPLY) process.exit(0);

const { error: deleteError } = await db.from("vehicle_catalog_part_reference_fitments")
  .delete().eq("data_source_id", manifest.data_source_id);
if (deleteError) throw deleteError;
await upsert("catalog_part_references", tables.references,
  "product_type,reference_scheme,normalized_value");
await upsert("catalog_part_reference_products", tables.productLinks,
  "part_reference_id,product_variant_id,relation_type");
await upsert("catalog_import_batches", tables.batches, "id");
await upsert("vehicle_catalog_part_reference_fitments", tables.fitments,
  "application_id,part_reference_id,position,data_source_id");

const restored = await fetchAll("vehicle_catalog_part_reference_fitments", "*",
  (query) => query.eq("data_source_id", manifest.data_source_id));
if (restored.length !== tables.fitments.length) {
  throw new Error(`Rollback readback mismatch: expected ${tables.fitments.length}, received ${restored.length}`);
}
const backupKeys = new Set(tables.fitments.map(fitmentKey));
const restoredKeys = new Set(restored.map(fitmentKey));
if (backupKeys.size !== restoredKeys.size || [...backupKeys].some((key) => !restoredKeys.has(key))) {
  throw new Error("Rollback key-set verification failed");
}
const result = { ...report, completed_at: new Date().toISOString(), verified: true, restored_fitments: restored.length };
fs.writeFileSync(path.join(BACKUP_DIR, "rollback-result.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));

function fitmentKey(row) {
  return `${row.application_id}|${row.part_reference_id}|${row.position}|${row.data_source_id}`;
}
async function fetchAll(table, columns, filter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
async function upsert(table, rows, onConflict) {
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await db.from(table).upsert(rows.slice(index, index + 200), { onConflict });
    if (error) throw error;
  }
}
function loadEnv(filename) {
  for (const line of fs.readFileSync(filename, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
