import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const SOURCE_CODE = "PAJERO_TO_CHALLENGER_IDENTITY_CORRECTION_2026_10_25";
const OUTPUT_DIR = path.join(ROOT, "outputs", "pajero-to-challenger-identity-correction-20261025");

const MERGES = [
  { source: "ap_877e28c3e364ffaee303", target: "ap_a35b5e148eb1bfedbf3c", series: "K99W" },
  { source: "ap_e5975af578d0efa09181", target: "ap_796b8a0e45859cfdf4f8", series: "KH4W" },
  { source: "ap_d329a52e9b66f639a2e6", target: "ap_0c5f58cd8f77e8bc01aa", series: "KH4W" },
];

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sourceIds = MERGES.map((row) => row.source);
const targetIds = MERGES.map((row) => row.target);
const allIds = [...sourceIds, ...targetIds];

const [applications, years, provenance, products, wipers, references, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_applications", "application_id", allIds),
  selectIn("vehicle_catalog_application_years", "application_id", allIds),
  selectIn("vehicle_catalog_application_provenance", "application_id", allIds),
  selectIn("vehicle_catalog_product_fitments", "application_id", allIds),
  selectIn("vehicle_catalog_wiper_fitments", "application_id", allIds),
  selectIn("vehicle_catalog_part_reference_fitments", "application_id", allIds),
  selectIn("customer_vehicles", "vehicle_catalog_application_id", sourceIds),
  selectIn("order_items", "vehicle_catalog_application_id", sourceIds),
  selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", sourceIds),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", sourceIds),
]);

assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0,
  "A source application has commerce references; transactional manual merge is required");

const applicationById = new Map(applications.map((row) => [row.application_id, row]));
const yearsByApplication = groupBy(years, (row) => row.application_id);
const provenanceByApplication = groupBy(provenance, (row) => row.application_id);
const productsByApplication = groupBy(products, (row) => row.application_id);
const wipersByApplication = groupBy(wipers, (row) => row.application_id);
const referencesByApplication = groupBy(references, (row) => row.application_id);
const sourceSeriesIds = [...new Set(sourceIds.map((id) => required(applicationById.get(id), id).series_id))];
const sourceSeries = await selectIn("vehicle_catalog_series", "series_id", sourceSeriesIds);
const sourceSeriesApplications = await selectIn("vehicle_catalog_applications", "series_id", sourceSeriesIds);

const plan = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? "apply" : "report-only",
  production_writes: APPLY,
  source_code: SOURCE_CODE,
  evidence: {
    official_mitsubishi_service_source: "https://www.mitsubishi-motors.com.au/content/dam/mmal/pdfs/cps-updates/CPS-Pricing-Summary-prior-311216-June-2019.pdf",
    official_mitsubishi_generation_source: "https://www.mitsubishi-motors.com.au/blog/snow-bound-pajero-sport.html",
    conclusion: "Australian/NZ-market K99W and KH4W records belong to Challenger; Pajero Sport remains a separate regional model alias and is not deleted.",
  },
  merges: [],
  series_to_inactivate: [],
  totals: {
    source_applications: MERGES.length,
    source_application_years_2000_2026: 0,
    products_to_insert: 0,
    wipers_to_insert: 0,
    references_to_insert: 0,
    provenance_to_insert: 0,
  },
};

for (const merge of MERGES) {
  const source = required(applicationById.get(merge.source), `source ${merge.source}`);
  const target = required(applicationById.get(merge.target), `target ${merge.target}`);
  assert(source.status === "active", `Source is not active: ${source.application_id}`);
  assert(target.status === "active", `Target is not active: ${target.application_id}`);
  assert(source.model_id === "md_0e7c94758d96f3f1c46f", `Source is no longer Pajero: ${source.application_id}`);
  assert(target.model_id === "md_c049797e1ebfef39beaf", `Target is no longer Challenger: ${target.application_id}`);
  assertSameShape(source, target);
  const sourceYears = (yearsByApplication.get(source.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  const targetYears = (yearsByApplication.get(target.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  assert(JSON.stringify(sourceYears) === JSON.stringify(targetYears), `Year vectors differ: ${source.application_id}`);

  const productsToInsert = missingRows(productsByApplication.get(source.application_id), productsByApplication.get(target.application_id), productKey)
    .map((row) => ({ ...stripTimes(row), application_id: target.application_id, notes: appendNote(row.notes, `${SOURCE_CODE}; merged_from=${source.application_id}`) }));
  const wipersToInsert = missingRows(wipersByApplication.get(source.application_id), wipersByApplication.get(target.application_id), wiperKey)
    .map((row) => ({ ...stripTimes(row), application_id: target.application_id, notes: appendNote(row.notes, `${SOURCE_CODE}; merged_from=${source.application_id}`) }));
  const referencesToInsert = missingRows(referencesByApplication.get(source.application_id), referencesByApplication.get(target.application_id), referenceKey)
    .map((row) => ({ ...stripTimes(row), application_id: target.application_id }));
  const provenanceToInsert = missingRows(provenanceByApplication.get(source.application_id), provenanceByApplication.get(target.application_id), provenanceKey)
    .map((row) => ({ ...row, application_id: target.application_id }));

  plan.totals.source_application_years_2000_2026 += sourceYears.filter((year) => year >= 2000 && year <= 2026).length;
  plan.totals.products_to_insert += productsToInsert.length;
  plan.totals.wipers_to_insert += wipersToInsert.length;
  plan.totals.references_to_insert += referencesToInsert.length;
  plan.totals.provenance_to_insert += provenanceToInsert.length;
  plan.merges.push({ ...merge, source_series_id: source.series_id, target_series_id: target.series_id, years: sourceYears, productsToInsert, wipersToInsert, referencesToInsert, provenanceToInsert });
}

for (const seriesId of sourceSeriesIds) {
  const activeApplications = sourceSeriesApplications.filter((row) => row.series_id === seriesId && row.status === "active");
  assert(activeApplications.every((row) => sourceIds.includes(row.application_id)), `Unexpected active application remains on source series ${seriesId}`);
  plan.series_to_inactivate.push(seriesId);
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, APPLY ? "apply-plan.json" : "preflight.json"), JSON.stringify(plan, null, 2));

let backup_dir = null;
if (APPLY) {
  backup_dir = createBackup({ applications, years, provenance, products, wipers, references, sourceSeries, sourceSeriesApplications, customerVehicles, orderItems, orderSnapshots, orderWipers });
  for (const merge of plan.merges) {
    await upsert("vehicle_catalog_product_fitments", merge.productsToInsert, "application_id,product_variant_id,position");
    await upsert("vehicle_catalog_wiper_fitments", merge.wipersToInsert, "application_id,wiper_configuration_id");
    await upsert("vehicle_catalog_part_reference_fitments", merge.referencesToInsert, "application_id,part_reference_id,position");
    await upsert("vehicle_catalog_application_provenance", merge.provenanceToInsert, "application_id,source_group,source_url");
    const { error } = await db.from("vehicle_catalog_applications").update({ status: "inactive", review_status: "approved" }).eq("application_id", merge.source).eq("status", "active");
    if (error) throw error;
  }
  for (const seriesId of plan.series_to_inactivate) {
    const { error } = await db.from("vehicle_catalog_series").update({ status: "inactive" }).eq("series_id", seriesId).eq("status", "active");
    if (error) throw error;
  }
}

const verification = APPLY ? await verify(plan) : null;
const report = { ...plan, backup_dir, verification };
const reportPath = path.join(OUTPUT_DIR, APPLY ? "applied.json" : "report.json");
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ reportPath, backup_dir, totals: plan.totals, series_to_inactivate: plan.series_to_inactivate, verification }, null, 2));

async function verify(currentPlan) {
  const [sourceApps, targetApps, seriesRows, targetProducts, targetWipers, targetReferences] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", sourceIds),
    selectIn("vehicle_catalog_applications", "application_id", targetIds),
    selectIn("vehicle_catalog_series", "series_id", currentPlan.series_to_inactivate),
    selectIn("vehicle_catalog_product_fitments", "application_id", targetIds),
    selectIn("vehicle_catalog_wiper_fitments", "application_id", targetIds),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", targetIds),
  ]);
  const productKeys = new Set(targetProducts.map((row) => `${row.application_id}|${productKey(row)}`));
  const wiperKeys = new Set(targetWipers.map((row) => `${row.application_id}|${wiperKey(row)}`));
  const referenceKeys = new Set(targetReferences.map((row) => `${row.application_id}|${referenceKey(row)}`));
  const checks = {
    sources_inactive: sourceApps.length === sourceIds.length && sourceApps.every((row) => row.status === "inactive"),
    targets_active: targetApps.length === targetIds.length && targetApps.every((row) => row.status === "active"),
    source_series_inactive: seriesRows.length === currentPlan.series_to_inactivate.length && seriesRows.every((row) => row.status === "inactive"),
    products_merged: currentPlan.merges.every((item) => item.productsToInsert.every((row) => productKeys.has(`${item.target}|${productKey(row)}`))),
    wipers_merged: currentPlan.merges.every((item) => item.wipersToInsert.every((row) => wiperKeys.has(`${item.target}|${wiperKey(row)}`))),
    references_merged: currentPlan.merges.every((item) => item.referencesToInsert.every((row) => referenceKeys.has(`${item.target}|${referenceKey(row)}`))),
  };
  assert(Object.values(checks).every(Boolean), "Post-apply verification failed");
  return { ok: true, ...checks };
}

function assertSameShape(source, target) {
  for (const field of ["variant_id", "powertrain_id", "year_from", "year_to"]) {
    assert(source[field] === target[field], `Shape mismatch ${source.application_id} -> ${target.application_id}: ${field}`);
  }
}

function missingRows(source = [], target = [], keyFn) {
  const targetKeys = new Set(target.map(keyFn));
  return source.filter((row) => !targetKeys.has(keyFn(row)));
}
function productKey(row) { return `${row.product_variant_id}|${row.position}`; }
function wiperKey(row) { return row.wiper_configuration_id; }
function referenceKey(row) { return `${row.part_reference_id}|${row.position}`; }
function provenanceKey(row) { return `${row.source_group}|${row.source_url}`; }
function stripTimes(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function appendNote(value, note) { return [value, note].filter(Boolean).join("; "); }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }
function required(value, label) { assert(value, `Missing ${label}`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function selectIn(table, field, values) {
  if (!values.length) return [];
  const { data, error } = await db.from(table).select("*").in(field, values);
  if (error) throw error;
  return data;
}
async function upsert(table, rows, onConflict) {
  if (!rows.length) return;
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) throw error;
}
function createBackup(tables) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "tmp", "production-backups", `pajero-to-challenger-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { created_at: new Date().toISOString(), source_code: SOURCE_CODE, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const contents = JSON.stringify(rows, null, 2);
    const file = `${name}.json`;
    fs.writeFileSync(path.join(dir, file), contents);
    manifest.tables[name] = { rows: rows.length, file, sha256: crypto.createHash("sha256").update(contents).digest("hex") };
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}
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
