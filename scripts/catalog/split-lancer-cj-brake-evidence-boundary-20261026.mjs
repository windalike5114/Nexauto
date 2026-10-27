import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd(); const APPLY = process.argv.includes("--apply");
const SOURCE = "LANCER_CJ_BENDIX_REAR_EVIDENCE_BOUNDARY_20261026"; const BOUNDARY = 1996;
const IDS = ["ap_d2f2925fffa6e8a6bd3a", "ap_b5375e61777d52442e73"];
const OUT = path.join(ROOT, "outputs", "lancer-cj-evidence-boundary-split-20261026");
loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const [apps, years, provenance, products, wipers, refs, allApps, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_applications", "*", "application_id", IDS), selectIn("vehicle_catalog_application_years", "*", "application_id", IDS),
  selectIn("vehicle_catalog_application_provenance", "*", "application_id", IDS), selectIn("vehicle_catalog_product_fitments", "*", "application_id", IDS),
  selectIn("vehicle_catalog_wiper_fitments", "*", "application_id", IDS), selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", IDS),
  fetchAll("vehicle_catalog_applications", "application_id,canonical_key"), selectIn("customer_vehicles", "*", "vehicle_catalog_application_id", IDS),
  selectIn("order_items", "*", "vehicle_catalog_application_id", IDS), selectIn("order_vehicle_snapshots", "*", "vehicle_catalog_application_id", IDS),
  selectIn("order_wiper_fulfillment", "*", "vehicle_catalog_application_id", IDS),
]);
assert(apps.length === 2, `Expected 2 applications, got ${apps.length}`);
assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0, "Commerce references exist; split stopped");
const yearsByApp = groupBy(years, (row) => row.application_id); const byProv = groupBy(provenance, (row) => row.application_id);
const byProducts = groupBy(products, (row) => row.application_id); const byWipers = groupBy(wipers, (row) => row.application_id); const byRefs = groupBy(refs, (row) => row.application_id);
const canonicalKeys = new Set(allApps.map((row) => row.canonical_key)); const appIds = new Set(allApps.map((row) => row.application_id)); const splits = [];
for (const app of apps) {
  const liveYears = (yearsByApp.get(app.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  assert(JSON.stringify(liveYears) === JSON.stringify([1995, 1996, 1997, 1998, 1999, 2000]), `Years changed for ${app.application_id}`);
  const retainedYears = [1995]; const childYears = [1996, 1997, 1998, 1999, 2000];
  const retainedKey = key(app, 1995, 1995); const childKey = key(app, 1996, 2000); const childId = id(childKey);
  assert(!canonicalKeys.has(retainedKey) || retainedKey === app.canonical_key, `Retained key collision ${retainedKey}`);
  assert(!canonicalKeys.has(childKey) && !appIds.has(childId), `Child collision ${childId}`); canonicalKeys.add(childKey); appIds.add(childId);
  splits.push({ source: app, liveYears, retainedYears, retainedKey, childYears,
    child: { ...stripTimes(app), application_id: childId, year_from: 1996, year_to: 2000, canonical_key: childKey, review_status: "approved" },
    provenance: (byProv.get(app.application_id) ?? []).map((row) => ({ ...row, application_id: childId })),
    products: (byProducts.get(app.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: childId, notes: append(row.notes, `${SOURCE}; split_from=${app.application_id}`) })),
    wipers: (byWipers.get(app.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: childId, notes: append(row.notes, `${SOURCE}; split_from=${app.application_id}`) })),
    refs: (byRefs.get(app.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: childId,
      metadata: { ...(row.metadata ?? {}), copied_by: SOURCE, split_from: app.application_id } })),
  });
}
const plan = { generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", source: SOURCE, applications: 2,
  new_applications: 2, retained_application_years: 2, evidence_application_years: 10,
  copied_rows: { provenance: total("provenance"), products: total("products"), wipers: total("wipers"), refs: total("refs") }, commerce_references: 0 };
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "plan.json"), JSON.stringify({ ...plan, splits }, null, 2));
if (!APPLY) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }
const backupDir = backup({ apps, years, provenance, products, wipers, refs, customerVehicles, orderItems, orderSnapshots, orderWipers });
const childIds = splits.map((row) => row.child.application_id);
try {
  for (const split of splits) {
    let result = await db.from("vehicle_catalog_application_years").delete().eq("application_id", split.source.application_id).gte("model_year", BOUNDARY); if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_applications").update({ year_from: 1995, year_to: 1995, canonical_key: split.retainedKey, review_status: "approved" }).eq("application_id", split.source.application_id); if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_applications").insert(split.child); if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_application_years").insert(split.childYears.map((model_year) => ({ application_id: split.child.application_id, model_year }))); if (result.error) throw result.error;
    await upsert("vehicle_catalog_application_provenance", split.provenance, "application_id,source_group,source_url");
    await upsert("vehicle_catalog_product_fitments", split.products, "application_id,product_variant_id,position");
    await upsert("vehicle_catalog_wiper_fitments", split.wipers, "application_id,wiper_configuration_id");
    await upsert("vehicle_catalog_part_reference_fitments", split.refs, "application_id,part_reference_id,position,data_source_id");
  }
  const [sourceYears, children, childYears, childProducts, childWipers, childRefs] = await Promise.all([
    selectIn("vehicle_catalog_application_years", "*", "application_id", IDS), selectIn("vehicle_catalog_applications", "*", "application_id", childIds),
    selectIn("vehicle_catalog_application_years", "*", "application_id", childIds), selectIn("vehicle_catalog_product_fitments", "*", "application_id", childIds),
    selectIn("vehicle_catalog_wiper_fitments", "*", "application_id", childIds), selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", childIds),
  ]);
  assert(sourceYears.length === 2 && children.length === 2 && childYears.length === 10, "Application/year readback mismatch");
  assert(childProducts.length === plan.copied_rows.products && childWipers.length === plan.copied_rows.wipers && childRefs.length === plan.copied_rows.refs, "Relationship readback mismatch");
  const result = { ...plan, completed_at: new Date().toISOString(), backup_dir: backupDir, verified: true };
  fs.writeFileSync(path.join(OUT, "application-trace.csv"), ["old_application_id,new_application_id,old_years,new_years", ...splits.map((row) => `${row.source.application_id},${row.child.application_id},1995,1996-2000`)].join("\n"));
  fs.writeFileSync(path.join(OUT, "applied.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const childId of childIds) await db.from("vehicle_catalog_applications").delete().eq("application_id", childId);
  for (const split of splits) { await db.from("vehicle_catalog_application_years").delete().eq("application_id", split.source.application_id);
    await db.from("vehicle_catalog_applications").upsert(split.source, { onConflict: "application_id" });
    await db.from("vehicle_catalog_application_years").insert(split.liveYears.map((model_year) => ({ application_id: split.source.application_id, model_year }))); }
  throw new Error(`Apply failed and rolled back: ${error.message}. Backup=${backupDir}`);
}

function total(field) { return splits.reduce((sum, row) => sum + row[field].length, 0); }
function key(app, from, to) { return [app.model_id, app.series_id, app.variant_id, app.powertrain_id, from, to].join("|"); }
function id(value) { return `ap_${crypto.createHash("sha256").update(value).digest("hex").slice(0, 20)}`; }
function stripTimes(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function append(value, note) { return [value, note].filter(Boolean).join("; "); }
function groupBy(rows, fn) { const out = new Map(); for (const row of rows) { const k = fn(row); if (!out.has(k)) out.set(k, []); out.get(k).push(row); } return out; }
function assert(value, message) { if (!value) throw new Error(message); }
async function fetchAll(table, columns) { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) return out; } }
async function selectIn(table, columns, field, values) { const out = []; for (let i = 0; i < values.length; i += 100) { const { data, error } = await db.from(table).select(columns).in(field, values.slice(i, i + 100)); if (error) throw error; out.push(...(data ?? [])); } return out; }
async function upsert(table, rows, onConflict) { if (!rows.length) return; const { error } = await db.from(table).upsert(rows, { onConflict }); if (error) throw error; }
function backup(tables) { const dir = path.join(ROOT, "tmp", "production-backups", `lancer-cj-split-${new Date().toISOString().replace(/[:.]/g, "-")}`); fs.mkdirSync(dir, { recursive: true }); const manifest = { created_at: new Date().toISOString(), source: SOURCE, tables: {} };
  for (const [name, rows] of Object.entries(tables)) { const text = JSON.stringify(rows, null, 2); fs.writeFileSync(path.join(dir, `${name}.json`), text); manifest.tables[name] = { rows: rows.length, sha256: crypto.createHash("sha256").update(text).digest("hex") }; }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2)); return dir; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
