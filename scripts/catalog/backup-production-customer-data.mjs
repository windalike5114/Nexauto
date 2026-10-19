import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(path.join(process.cwd(), ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase production credentials.");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(process.cwd(), "tmp", "production-backups", `customer-data-${stamp}`);
fs.mkdirSync(outputDir, { recursive: true });

const tables = [
  "customer_profiles",
  "customer_addresses",
  "customer_vehicles",
  "orders",
  "order_items",
  "order_vehicle_snapshots",
  "order_wiper_fulfillment",
  "order_claim_events",
  "email_events",
  "contact_enquiries",
  "stripe_webhook_events",
  "system_audit_events"
];

const manifest = { created_at: new Date().toISOString(), project_url: url, tables: {}, auth_users: {} };
for (const table of tables) {
  try {
    const rows = await selectAll(supabase.from(table).select("*"));
    const filename = `${table}.json`;
    const content = JSON.stringify(rows, null, 2);
    fs.writeFileSync(path.join(outputDir, filename), content);
    manifest.tables[table] = { rows: rows.length, file: filename, sha256: sha256(content) };
  } catch (error) {
    manifest.tables[table] = { rows: null, error: error.message };
  }
}

const authUsers = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  authUsers.push(...data.users);
  if (!data.nextPage || data.users.length === 0) break;
}
const authContent = JSON.stringify(authUsers, null, 2);
fs.writeFileSync(path.join(outputDir, "auth_users.json"), authContent);
manifest.auth_users = { rows: authUsers.length, file: "auth_users.json", sha256: sha256(authContent) };

fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Customer-data backup created: ${outputDir}`);
console.log(`Auth users: ${manifest.auth_users.rows}`);
for (const [table, info] of Object.entries(manifest.tables)) console.log(`${table}: ${info.rows ?? `unavailable (${info.error})`}`);

async function selectAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(name in process.env)) process.env[name] = value;
  }
}
