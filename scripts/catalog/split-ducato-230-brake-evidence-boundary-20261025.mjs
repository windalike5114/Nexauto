import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");
const SOURCE = "DUCATO_230_BENDIX_EVIDENCE_BOUNDARY_20261025";
const INPUT = path.join(ROOT, "outputs", "extended132-six-brake-gap-diagnosis-20261025", "applications.csv");
const OUTPUT = path.join(ROOT, "outputs", "ducato-230-evidence-boundary-split-20261025");
const BOUNDARY = 1997;

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sheet = XLSX.readFile(INPUT, { raw: false });
const input = XLSX.utils.sheet_to_json(sheet.Sheets[sheet.SheetNames[0]], { defval: "" })
  .filter((row) => row.popular_group === "Fiat Ducato" && row.series === "230_" && row.application_outcome === "historical_unique_source_candidate");
const sourceIds = unique(input.map((row) => row.application_id));
assert(sourceIds.length === 42, `Expected 42 Ducato 230_ source applications, got ${sourceIds.length}`);

const [apps, years, provenance, productFitments, wipers, references, allApps, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_applications", "*", "application_id", sourceIds),
  selectIn("vehicle_catalog_application_years", "*", "application_id", sourceIds),
  selectIn("vehicle_catalog_application_provenance", "*", "application_id", sourceIds),
  selectIn("vehicle_catalog_product_fitments", "*", "application_id", sourceIds),
  selectIn("vehicle_catalog_wiper_fitments", "*", "application_id", sourceIds),
  selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", sourceIds),
  fetchAll("vehicle_catalog_applications", "application_id,canonical_key,status"),
  selectIn("customer_vehicles", "*", "vehicle_catalog_application_id", sourceIds),
  selectIn("order_items", "*", "vehicle_catalog_application_id", sourceIds),
  selectIn("order_vehicle_snapshots", "*", "vehicle_catalog_application_id", sourceIds),
  selectIn("order_wiper_fulfillment", "*", "vehicle_catalog_application_id", sourceIds),
]);
assert(apps.length === 42, `Expected 42 live applications, got ${apps.length}`);
assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0,
  "Ducato 230_ source applications have commerce references; automatic split stopped");

const yearsByApp = groupBy(years, (row) => row.application_id);
const provenanceByApp = groupBy(provenance, (row) => row.application_id);
const productsByApp = groupBy(productFitments, (row) => row.application_id);
const wipersByApp = groupBy(wipers, (row) => row.application_id);
const referencesByApp = groupBy(references, (row) => row.application_id);
const canonicalKeys = new Set(allApps.map((row) => row.canonical_key));
const applicationIds = new Set(allApps.map((row) => row.application_id));
const splits = [];

for (const source of apps) {
  assert(source.status === "active", `Inactive source ${source.application_id}`);
  const sourceYears = (yearsByApp.get(source.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  const preYears = sourceYears.filter((year) => year < BOUNDARY);
  const evidenceYears = sourceYears.filter((year) => year >= BOUNDARY);
  if (!preYears.length) {
    assert(evidenceYears.length && evidenceYears.every((year) => year <= 2002), `Unexpected already-scoped years for ${source.application_id}: ${sourceYears}`);
    continue;
  }
  assert(preYears.every((year) => year >= 1994 && year <= 1996) && contiguous(preYears), `Unexpected pre-evidence years for ${source.application_id}: ${preYears}`);
  assert(evidenceYears.every((year) => year >= 1997 && year <= 2002) && contiguous(evidenceYears), `Unexpected evidence years for ${source.application_id}: ${evidenceYears}`);
  const retainedCanonical = canonicalKey(source, preYears[0], preYears.at(-1));
  const childCanonical = canonicalKey(source, evidenceYears[0], evidenceYears.at(-1));
  assert(!canonicalKeys.has(retainedCanonical) || retainedCanonical === source.canonical_key, `Retained canonical collision: ${retainedCanonical}`);
  assert(!canonicalKeys.has(childCanonical), `Child canonical collision: ${childCanonical}`);
  const childId = applicationId(childCanonical);
  assert(!applicationIds.has(childId), `Child ID collision: ${childId}`);
  canonicalKeys.add(childCanonical); applicationIds.add(childId);
  splits.push({ source_application_id: source.application_id, source_preimage: source, source_years: sourceYears,
    retained_years: preYears, retained_canonical_key: retainedCanonical, evidence_years: evidenceYears,
    child: { ...stripTimes(source), application_id: childId, year_from: evidenceYears[0], year_to: evidenceYears.at(-1),
      canonical_key: childCanonical, status: "active", review_status: "approved" },
    provenance: (provenanceByApp.get(source.application_id) ?? []).map((row) => ({ ...row, application_id: childId })),
    product_fitments: (productsByApp.get(source.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: childId,
      notes: append(row.notes, `${SOURCE}; split_from=${source.application_id}; segment=1997-2002`) })),
    wiper_fitments: (wipersByApp.get(source.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: childId,
      notes: append(row.notes, `${SOURCE}; split_from=${source.application_id}; segment=1997-2002`) })),
    reference_fitments: (referencesByApp.get(source.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: childId,
      metadata: { ...(row.metadata ?? {}), copied_by: SOURCE, split_from: source.application_id, segment: "1997-2002" } })),
  });
}

const plan = { generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", source: SOURCE,
  source_applications: splits.length, new_applications: splits.length, retained_application_years: splits.reduce((total, row) => total + row.retained_years.length, 0),
  evidence_application_years: splits.reduce((total, row) => total + row.evidence_years.length, 0), already_scoped_applications: 42 - splits.length,
  copied_rows: { provenance: sum(splits, "provenance"), product_fitments: sum(splits, "product_fitments"),
    wiper_fitments: sum(splits, "wiper_fitments"), reference_fitments: sum(splits, "reference_fitments") },
  commerce_references: 0 };
fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(path.join(OUTPUT, "plan.json"), JSON.stringify({ ...plan, splits }, null, 2));
if (!APPLY) { console.log(JSON.stringify(plan, null, 2)); process.exit(0); }

const backupDir = backup({ apps, years, provenance, productFitments, wipers, references,
  customerVehicles, orderItems, orderSnapshots, orderWipers });
const childIds = splits.map((split) => split.child.application_id);
const splitSourceIds = splits.map((split) => split.source_application_id);
try {
  for (const split of splits) {
    let result = await db.from("vehicle_catalog_application_years").delete().eq("application_id", split.source_application_id).gte("model_year", BOUNDARY);
    if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_applications").update({ year_from: split.retained_years[0], year_to: split.retained_years.at(-1),
      canonical_key: split.retained_canonical_key, review_status: "approved" }).eq("application_id", split.source_application_id);
    if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_applications").insert(split.child); if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_application_years").insert(split.evidence_years.map((model_year) => ({ application_id: split.child.application_id, model_year })));
    if (result.error) throw result.error;
    await upsert("vehicle_catalog_application_provenance", split.provenance, "application_id,source_group,source_url");
    await upsert("vehicle_catalog_product_fitments", split.product_fitments, "application_id,product_variant_id,position");
    await upsert("vehicle_catalog_wiper_fitments", split.wiper_fitments, "application_id,wiper_configuration_id");
    await upsert("vehicle_catalog_part_reference_fitments", split.reference_fitments, "application_id,part_reference_id,position,data_source_id");
  }
  const [liveSourceApps, liveSourceYears, liveChildren, liveChildYears, liveProducts, liveWipers, liveRefs] = await Promise.all([
    selectIn("vehicle_catalog_applications", "*", "application_id", splitSourceIds), selectIn("vehicle_catalog_application_years", "*", "application_id", splitSourceIds),
    selectIn("vehicle_catalog_applications", "*", "application_id", childIds), selectIn("vehicle_catalog_application_years", "*", "application_id", childIds),
    selectIn("vehicle_catalog_product_fitments", "*", "application_id", childIds), selectIn("vehicle_catalog_wiper_fitments", "*", "application_id", childIds),
    selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", childIds),
  ]);
  assert(liveSourceApps.length === splits.length && liveChildren.length === splits.length, "Application readback mismatch");
  assert(liveSourceYears.length === plan.retained_application_years && liveChildYears.length === plan.evidence_application_years, "Year readback mismatch");
  assert(liveProducts.length === plan.copied_rows.product_fitments && liveWipers.length === plan.copied_rows.wiper_fitments
    && liveRefs.length === plan.copied_rows.reference_fitments, "Relationship copy readback mismatch");
  const result = { ...plan, completed_at: new Date().toISOString(), backup_dir: backupDir, verified: true,
    trace_file: path.join(OUTPUT, "application-trace.csv") };
  fs.writeFileSync(path.join(OUTPUT, "application-trace.csv"), ["old_application_id,new_application_id,old_years,new_years",
    ...splits.map((row) => `${row.source_application_id},${row.child.application_id},1994-1996,1997-2002`)].join("\n"));
  fs.writeFileSync(path.join(OUTPUT, "applied.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} catch (error) {
  for (const childId of childIds) await db.from("vehicle_catalog_applications").delete().eq("application_id", childId);
  for (const split of splits) {
    await db.from("vehicle_catalog_application_years").delete().eq("application_id", split.source_application_id);
    await db.from("vehicle_catalog_applications").upsert(split.source_preimage, { onConflict: "application_id" });
    await db.from("vehicle_catalog_application_years").insert(split.source_years.map((model_year) => ({ application_id: split.source_application_id, model_year })));
  }
  throw new Error(`Apply failed and source applications were restored: ${error.message}. Backup=${backupDir}`);
}

function canonicalKey(source, from, to) { return [source.model_id, source.series_id, source.variant_id, source.powertrain_id, from, to].join("|"); }
function applicationId(key) { return `ap_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`; }
function stripTimes(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function append(value, note) { return [value, note].filter(Boolean).join("; "); }
function contiguous(values) { return values.every((value, index) => index === 0 || value === values[index - 1] + 1); }
function unique(values) { return [...new Set(values)]; }
function groupBy(rows, fn) { const out = new Map(); for (const row of rows) { const key = fn(row); if (!out.has(key)) out.set(key, []); out.get(key).push(row); } return out; }
function sum(rows, field) { return rows.reduce((total, row) => total + row[field].length, 0); }
function assert(value, message) { if (!value) throw new Error(message); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function selectIn(table, columns, field, values) { const output = []; for (let i = 0; i < values.length; i += 100) { const { data, error } = await db.from(table).select(columns).in(field, values.slice(i, i + 100)); if (error) throw error; output.push(...(data ?? [])); } return output; }
async function upsert(table, rows, onConflict) { if (!rows.length) return; const { error } = await db.from(table).upsert(rows, { onConflict }); if (error) throw error; }
function backup(tables) { const dir = path.join(ROOT, "tmp", "production-backups", `ducato-230-split-${new Date().toISOString().replace(/[:.]/g, "-")}`); fs.mkdirSync(dir, { recursive: true });
  const manifest = { created_at: new Date().toISOString(), source: SOURCE, tables: {} }; for (const [name, rows] of Object.entries(tables)) { const text = JSON.stringify(rows, null, 2);
    fs.writeFileSync(path.join(dir, `${name}.json`), text); manifest.tables[name] = { rows: rows.length, sha256: crypto.createHash("sha256").update(text).digest("hex") }; }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2)); return dir; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
