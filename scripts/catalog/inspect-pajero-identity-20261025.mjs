import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
loadEnv(path.join(ROOT, ".env.local"));

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const applicationIds = [
  "ap_877e28c3e364ffaee303",
  "ap_e5975af578d0efa09181",
  "ap_d329a52e9b66f639a2e6",
  "ap_a35b5e148eb1bfedbf3c",
  "ap_796b8a0e45859cfdf4f8",
  "ap_0c5f58cd8f77e8bc01aa",
  "ap_132595a8e3234e510e76",
  "ap_7bf1a6a3d608e21724e4",
  "ap_eeb8fc56303dc38a45af",
];

const tables = [
  ["vehicle_catalog_applications", "application_id"],
  ["vehicle_catalog_application_years", "application_id"],
  ["vehicle_catalog_application_provenance", "application_id"],
  ["vehicle_catalog_product_fitments", "application_id"],
  ["vehicle_catalog_wiper_fitments", "application_id"],
  ["vehicle_catalog_part_reference_fitments", "application_id"],
  ["customer_vehicles", "vehicle_catalog_application_id"],
  ["order_items", "vehicle_catalog_application_id"],
  ["order_vehicle_snapshots", "vehicle_catalog_application_id"],
  ["order_wiper_fulfillment", "vehicle_catalog_application_id"],
];

const report = { generated_at: new Date().toISOString(), production_writes: false, tables: {} };
for (const [table, field] of tables) {
  const { data, error } = await db.from(table).select("*").in(field, applicationIds);
  if (error) {
    report.tables[table] = { error: error.message };
  } else {
    report.tables[table] = { rows: data.length, data };
  }
}

const applicationRows = report.tables.vehicle_catalog_applications.data ?? [];
const modelIds = [...new Set(applicationRows.map((row) => row.model_id).filter(Boolean))];
const seriesIds = [...new Set(applicationRows.map((row) => row.series_id).filter(Boolean))];
const variantIds = [...new Set(applicationRows.map((row) => row.variant_id).filter(Boolean))];
const powertrainIds = [...new Set(applicationRows.map((row) => row.powertrain_id).filter(Boolean))];

for (const [key, table, idField, ids] of [
  ["models", "vehicle_catalog_models", "model_id", modelIds],
  ["series", "vehicle_catalog_series", "series_id", seriesIds],
  ["variants", "vehicle_catalog_variants", "variant_id", variantIds],
  ["powertrains", "vehicle_catalog_powertrains", "powertrain_id", powertrainIds],
]) {
  const { data, error } = ids.length
    ? await db.from(table).select("*").in(idField, ids)
    : { data: [], error: null };
  report[key] = error ? { error: error.message } : data;
}

const outputDir = path.join(ROOT, "outputs", "pajero-identity-inspection-20261025");
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, "report.json");
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ outputPath, counts: Object.fromEntries(Object.entries(report.tables).map(([key, value]) => [key, value.rows ?? value.error])) }, null, 2));

function loadEnv(filename) {
  if (!fs.existsSync(filename)) return;
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
