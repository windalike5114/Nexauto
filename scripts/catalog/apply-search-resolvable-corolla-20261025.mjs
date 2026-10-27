import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "brake-search-resolvable-20261025");
const POLICY = "SEARCH_RESOLVABLE_COROLLA_IDENTITY_AND_OE_V1_2026_10_25";
const SOURCE_CODE = "TOYOTA_EPC_PARTSOUQ_2026";
const SOURCE_ROW = {
  code: SOURCE_CODE,
  name: "Toyota EPC vehicle and OE part evidence via PartSouq",
  source_kind: "market_reference",
  vehicle_identity_priority: 20,
  product_fitment_priority: 20,
  active: true,
  metadata: { product_line: "brake_pad", reference_scheme: "toyota_oe",
    evidence_type: "manufacturer_epc_mirror", retrieved_on: "2026-10-25" },
};
const SCHEME_ROW = { product_type: "brake_pad", code: "toyota_oe", name: "Toyota OE brake pad reference",
  issuer: "Toyota Motor Corporation", active: true,
  metadata: { value_pattern: "^[0-9]{5}-[0-9]{5}$", reference_role: "manufacturer_oe" } };
const AE100G_URL = "https://partsouq.com/en/catalog/genuine/parts?c=Toyota&gid=13377&q=AE100-8031857&ssd=%24%2AKwFZbXxmJCkbCTo1IyIGXwEVNTIsXVJfXkxSYBBIGU5RSDdNHh5DSVBZERUcBAtyRwICHk9WSSw_Ln95AkdIBB9JUE8udw0QW1JdX1pSWFgQEAIICU9WSVtYXgMPEElGTwEISFdNc3kRW1oqQSo9ICF5HgxJDAQISVBcXk8AAAAAB85Uwg%24&vid=0";
const AE100G_IDENTITY_URL = "https://partsouq.com/en/catalog/toyota/diagram/JP/1995/COROLLA/AE100G-AWPNK/category/1/diagram/1302/illustration/130210/vin/AE1000173391";
const CUR10R_URL = "https://partsouq.com/en/catalog/toyota/diagram/EU/2004/COROLLA-VERSO/CUR10R-GWMDYW/catalog/157230/category/1/diagram/1904/illustration/192020";
const CORRECTIONS = [
  { application_id: "ap_703a6d37fcf57f1c7794", series: "AE100G", expected_model: "COROLLA",
    expected_years: range(1995, 2026), desired_years: range(1995, 2000), target_model: "COROLLA",
    evidence_urls: [AE100G_IDENTITY_URL, AE100G_URL], action: "correct_year_range" },
  { application_id: "ap_085a2b2720384058ea78", series: "CUR10R", expected_model: "COROLLA",
    expected_years: range(2004, 2009), desired_years: range(2004, 2005), target_model: "COROLLA Verso",
    evidence_urls: [CUR10R_URL], action: "reassign_model_and_correct_year_range" },
];
const OE_FITMENT = { application_id: "ap_703a6d37fcf57f1c7794", position: "front",
  reference_value: "04491-12560", normalized_value: "0449112560", source_url: AE100G_URL };
const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
if (APPLY && ROLLBACK_ARG) throw new Error("Choose --apply or --rollback=<backup-directory>.");

loadEnv(path.join(ROOT, ".env.local"));
assert(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK_ARG) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const initial = await prepare();
writeReport(initial, "report-only");
console.log(JSON.stringify(summary(initial, "report-only"), null, 2));
if (!APPLY) process.exit(0);
assert(!initial.blockers.length, `Preflight blockers: ${JSON.stringify(initial.blockers)}`);
const fresh = await prepare();
assert(!fresh.blockers.length, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(initial.plan_hash === fresh.plan_hash, "Fresh plan changed; no writes issued.");
const backup = createBackup(fresh);
try {
  await applyPlan(fresh);
  const verification = await verify(fresh);
  const result = { ...summary(fresh, "apply"), backup_directory: relative(backup), verification };
  writeJson(path.join(OUT, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}

async function prepare() {
  const ids = CORRECTIONS.map((row) => row.application_id);
  const [applications, years, allModels, allSeries, allApplications, productFitments, wiperFitments, referenceFitments,
    provenance, customerVehicles, orderItems, orderSnapshots, orderWipers, source, scheme, oeReference,
    protectedProducts, protectedReferenceProducts] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids),
    selectIn("vehicle_catalog_application_years", "application_id", ids),
    fetchAll("vehicle_catalog_models"), fetchAll("vehicle_catalog_series"), fetchAll("vehicle_catalog_applications"),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids),
    selectIn("vehicle_catalog_wiper_fitments", "application_id", ids),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    selectIn("vehicle_catalog_application_provenance", "application_id", ids),
    selectIn("customer_vehicles", "vehicle_catalog_application_id", ids),
    selectIn("order_items", "vehicle_catalog_application_id", ids),
    selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", ids),
    selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", ids),
    fetchMaybe("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE)),
    fetchMaybe("catalog_reference_schemes", (query) => query.eq("product_type", "brake_pad").eq("code", "toyota_oe")),
    fetchMaybe("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "toyota_oe")
      .eq("normalized_value", OE_FITMENT.normalized_value)),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids),
    fetchAll("catalog_part_reference_products"),
  ]);
  const blockers = [];
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const modelById = new Map(allModels.map((row) => [row.model_id, row]));
  const seriesById = new Map(allSeries.map((row) => [row.series_id, row]));
  const yearsByApp = Map.groupBy(years, (row) => row.application_id);
  const commerce = [...customerVehicles, ...orderItems, ...orderSnapshots, ...orderWipers];
  if (commerce.length) blockers.push({ reason: "commerce_rows_reference_target", rows: commerce.length });
  const plan = [];
  for (const spec of CORRECTIONS) {
    const app = appById.get(spec.application_id);
    if (!app) { blockers.push({ application_id: spec.application_id, reason: "missing_application" }); continue; }
    const currentModel = modelById.get(app.model_id);
    const currentSeries = seriesById.get(app.series_id);
    const targetModels = allModels.filter((row) => row.make_id === currentModel?.make_id && row.normalized_name === spec.target_model.toUpperCase() && row.status === "active");
    const targetModel = targetModels[0];
    const actualYears = (yearsByApp.get(app.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    if (currentModel?.normalized_name !== spec.expected_model.toUpperCase()) blockers.push({ application_id: spec.application_id, reason: "model_mismatch", actual: currentModel?.name });
    if (currentSeries?.normalized_code !== spec.series) blockers.push({ application_id: spec.application_id, reason: "series_mismatch", actual: currentSeries?.code });
    if (!arrayEqual(actualYears, spec.expected_years) || app.year_from !== spec.expected_years[0] || app.year_to !== spec.expected_years.at(-1)) {
      blockers.push({ application_id: spec.application_id, reason: "year_mismatch", actualYears, rowRange: [app.year_from, app.year_to] });
    }
    if (targetModels.length !== 1) blockers.push({ application_id: spec.application_id, reason: "target_model_not_unique", targetModels });
    if (spec.target_model !== spec.expected_model) {
      const seriesUsage = allApplications.filter((row) => row.series_id === app.series_id);
      if (seriesUsage.length !== 1 || seriesUsage[0].application_id !== app.application_id) blockers.push({ application_id: spec.application_id, reason: "series_is_shared", seriesUsage });
    }
    const canonical_key = [targetModel?.model_id, app.series_id, app.variant_id, app.powertrain_id,
      spec.desired_years[0], spec.desired_years.at(-1)].join("|");
    const collisions = allApplications.filter((row) => row.application_id !== app.application_id && row.canonical_key === canonical_key && row.status === "active");
    if (collisions.length) blockers.push({ application_id: spec.application_id, reason: "canonical_collision", collisions: collisions.map((row) => row.application_id) });
    plan.push({ ...spec, before: app, current_model_id: app.model_id, target_model_id: targetModel?.model_id,
      series_id: app.series_id, current_series_model_id: currentSeries?.model_id, canonical_key,
      removed_years: actualYears.filter((year) => !spec.desired_years.includes(year)) });
  }
  const publicPlan = plan.map(({ before, current_series_model_id, ...row }) => row);
  return { generated_at: new Date().toISOString(), blockers, plan, public_plan: publicPlan,
    backup_rows: { applications, years, series: allSeries.filter((row) => plan.some((item) => item.series_id === row.series_id)),
      productFitments, wiperFitments, referenceFitments, provenance, source: source ? [source] : [], scheme: scheme ? [scheme] : [],
      oeReference: oeReference ? [oeReference] : [], protectedReferenceProducts },
    source, scheme, oeReference, product_hash: semanticHash(protectedProducts),
    reference_product_hash: semanticHash(protectedReferenceProducts), plan_hash: stableHash(publicPlan) };
}

async function applyPlan(plan) {
  let result = await db.from("catalog_data_sources").upsert(SOURCE_ROW, { onConflict: "code" });
  if (result.error) throw result.error;
  result = await db.from("catalog_reference_schemes").upsert(SCHEME_ROW, { onConflict: "product_type,code" });
  if (result.error) throw result.error;
  result = await db.from("catalog_part_references").upsert({ product_type: "brake_pad", reference_scheme: "toyota_oe",
    reference_value: OE_FITMENT.reference_value, normalized_value: OE_FITMENT.normalized_value, lifecycle_status: "unknown",
    metadata: { manufacturer: "Toyota", evidence_url: OE_FITMENT.source_url, policy_version: POLICY } },
  { onConflict: "product_type,reference_scheme,normalized_value" });
  if (result.error) throw result.error;
  const [source, reference] = await Promise.all([
    fetchOne("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE)),
    fetchOne("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "toyota_oe")
      .eq("normalized_value", OE_FITMENT.normalized_value)),
  ]);
  for (const item of plan.plan) {
    if (item.target_model_id !== item.current_model_id) {
      result = await db.from("vehicle_catalog_series").update({ model_id: item.target_model_id })
        .eq("series_id", item.series_id).eq("model_id", item.current_series_model_id);
      if (result.error) throw result.error;
    }
    result = await db.from("vehicle_catalog_application_years").delete().eq("application_id", item.application_id).in("model_year", item.removed_years);
    if (result.error) throw result.error;
    result = await db.from("vehicle_catalog_applications").update({ model_id: item.target_model_id,
      year_from: item.desired_years[0], year_to: item.desired_years.at(-1), canonical_key: item.canonical_key, review_status: "approved" })
      .eq("application_id", item.application_id).eq("canonical_key", item.before.canonical_key).select("application_id");
    if (result.error) throw result.error;
    assert(result.data?.length === 1, `Concurrent application change ${item.application_id}`);
    const provenanceRows = item.evidence_urls.map((url) => ({ application_id: item.application_id,
      source_group: POLICY, source_url: url, raw_record_count: 1, first_collected_at: new Date().toISOString(), last_collected_at: new Date().toISOString() }));
    result = await db.from("vehicle_catalog_application_provenance").upsert(provenanceRows,
      { onConflict: "application_id,source_group,source_url" });
    if (result.error) throw result.error;
  }
  result = await db.from("vehicle_catalog_part_reference_fitments").upsert({ application_id: OE_FITMENT.application_id,
    part_reference_id: reference.id, position: OE_FITMENT.position, data_source_id: source.id, fitment_status: "published", confidence: "exact",
    source_row_numbers: [1], match_reasons: ["exact_ae100g_chassis", "exact_5a_fe_engine", "toyota_epc_front_pad"],
    metadata: { policy_version: POLICY, source_code: SOURCE_CODE, evidence_url: OE_FITMENT.source_url,
      fitment_scope: "AE100G 5A-FE 1995-2000", product_write: false } },
  { onConflict: "application_id,part_reference_id,position,data_source_id" });
  if (result.error) throw result.error;
}

async function verify(plan) {
  const ids = plan.plan.map((row) => row.application_id);
  const [apps, years, series, productFitments, refProducts, source, reference, oeFitment] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    selectIn("vehicle_catalog_series", "series_id", plan.plan.map((row) => row.series_id)),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids), fetchAll("catalog_part_reference_products"),
    fetchOne("catalog_data_sources", (query) => query.eq("code", SOURCE_CODE)),
    fetchOne("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "toyota_oe")
      .eq("normalized_value", OE_FITMENT.normalized_value)),
    fetchMany("vehicle_catalog_part_reference_fitments", (query) => query.eq("application_id", OE_FITMENT.application_id).eq("position", "front")),
  ]);
  const failures = [];
  for (const item of plan.plan) {
    const app = apps.find((row) => row.application_id === item.application_id);
    const actualYears = years.filter((row) => row.application_id === item.application_id).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    const currentSeries = series.find((row) => row.series_id === item.series_id);
    if (!app || app.model_id !== item.target_model_id || app.year_from !== item.desired_years[0] || app.year_to !== item.desired_years.at(-1)
      || app.canonical_key !== item.canonical_key || app.review_status !== "approved" || !arrayEqual(actualYears, item.desired_years)
      || currentSeries?.model_id !== item.target_model_id) failures.push({ application_id: item.application_id, app, actualYears, currentSeries });
  }
  const fitment = oeFitment.find((row) => row.part_reference_id === reference.id && row.data_source_id === source.id
    && row.fitment_status === "published" && row.confidence === "exact");
  if (!fitment) failures.push({ reason: "missing_oe_fitment" });
  assert(!failures.length, `Readback failures: ${JSON.stringify(failures)}`);
  assert(semanticHash(productFitments) === plan.product_hash, "Protected product fitment layer changed.");
  assert(semanticHash(refProducts) === plan.reference_product_hash, "Protected product-reference links changed.");
  return { ok: true, verified_at: new Date().toISOString(), applications_corrected: plan.plan.length,
    invalid_application_years_removed_2000_2026: plan.plan.reduce((sum, row) => sum + row.removed_years.filter((year) => year >= 2000 && year <= 2026).length, 0),
    reference_fitments_published: 1, product_layer_unchanged: true, reference_product_links_unchanged: true };
}

function createBackup(plan) {
  const directory = path.join(ROOT, "tmp", "production-backups", `search-resolvable-corolla-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, rows] of Object.entries(plan.backup_rows)) writeJson(path.join(directory, `${name}.json`), rows);
  writeJson(path.join(directory, "manifest.json"), { policy: POLICY, created_at: new Date().toISOString(),
    rollback_command: `node scripts/catalog/apply-search-resolvable-corolla-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("search-resolvable-corolla-"), "Invalid rollback directory.");
  const applications = readJson(path.join(directory, "applications.json"));
  const years = readJson(path.join(directory, "years.json"));
  const series = readJson(path.join(directory, "series.json"));
  const provenance = readJson(path.join(directory, "provenance.json"));
  const refsBefore = readJson(path.join(directory, "referenceFitments.json"));
  const sourceBefore = readJson(path.join(directory, "source.json"));
  const schemeBefore = readJson(path.join(directory, "scheme.json"));
  const oeBefore = readJson(path.join(directory, "oeReference.json"));
  const ids = applications.map((row) => row.application_id);
  let result = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (result.error) throw result.error;
  if (refsBefore.length) { result = await db.from("vehicle_catalog_part_reference_fitments").insert(refsBefore); if (result.error) throw result.error; }
  result = await db.from("vehicle_catalog_application_provenance").delete().in("application_id", ids).eq("source_group", POLICY); if (result.error) throw result.error;
  if (provenance.length) { result = await db.from("vehicle_catalog_application_provenance").upsert(provenance, { onConflict: "application_id,source_group,source_url" }); if (result.error) throw result.error; }
  result = await db.from("vehicle_catalog_application_years").delete().in("application_id", ids); if (result.error) throw result.error;
  if (years.length) { result = await db.from("vehicle_catalog_application_years").insert(years); if (result.error) throw result.error; }
  for (const row of series) { result = await db.from("vehicle_catalog_series").update({ model_id: row.model_id }).eq("series_id", row.series_id); if (result.error) throw result.error; }
  for (const row of applications) { result = await db.from("vehicle_catalog_applications").update(stripTimestamps(row)).eq("application_id", row.application_id); if (result.error) throw result.error; }
  const currentOe = await fetchMaybe("catalog_part_references", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "toyota_oe")
    .eq("normalized_value", OE_FITMENT.normalized_value));
  if (oeBefore.length) { result = await db.from("catalog_part_references").upsert(oeBefore, { onConflict: "product_type,reference_scheme,normalized_value" }); if (result.error) throw result.error; }
  else if (currentOe) { result = await db.from("catalog_part_references").delete().eq("id", currentOe.id); if (result.error) throw result.error; }
  if (sourceBefore.length) { result = await db.from("catalog_data_sources").upsert(sourceBefore, { onConflict: "code" }); if (result.error) throw result.error; }
  else { result = await db.from("catalog_data_sources").delete().eq("code", SOURCE_CODE); if (result.error) throw result.error; }
  if (schemeBefore.length) { result = await db.from("catalog_reference_schemes").upsert(schemeBefore, { onConflict: "product_type,code" }); if (result.error) throw result.error; }
  else { result = await db.from("catalog_reference_schemes").delete().eq("product_type", "brake_pad").eq("code", "toyota_oe"); if (result.error) throw result.error; }
  const output = { verified: true, automatic, rolled_back_at: new Date().toISOString() };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), output);
  return output;
}

function summary(plan, mode) { return { generated_at: plan.generated_at, mode, policy: POLICY, production_writes: mode === "apply",
  applications_corrected: plan.plan.length,
  invalid_application_years_removed_2000_2026: plan.plan.reduce((sum, row) => sum + row.removed_years.filter((year) => year >= 2000 && year <= 2026).length, 0),
  model_reassignments: plan.plan.filter((row) => row.target_model_id !== row.current_model_id).length,
  exact_oe_reference_fitments: 1, product_writes: 0, blockers: plan.blockers, plan_sha256: plan.plan_hash }; }
function writeReport(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight.json"), summary(plan, mode)); writeJson(path.join(OUT, "plan.json"), plan.public_plan); }
function stripTimestamps(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function range(from, to) { return Array.from({ length: to - from + 1 }, (_, index) => from + index); }
function arrayEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function assert(value, message) { if (!value) throw new Error(message); }
function relative(value) { return path.relative(ROOT, value).replaceAll("\\", "/"); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(rows) { return stableHash(rows.map((row) => stripTimestamps(row))); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function fetchMany(table, filter) { const { data, error } = await filter(db.from(table).select("*")); if (error) throw error; return data ?? []; }
async function fetchOne(table, filter) { const { data, error } = await filter(db.from(table).select("*")).single(); if (error) throw error; return data; }
async function fetchMaybe(table, filter) { const { data, error } = await filter(db.from(table).select("*")).maybeSingle(); if (error) throw error; return data ?? null; }
async function selectIn(table, field, values) { if (!values.length) return []; const output = []; for (let index = 0; index < values.length; index += 50) { const { data, error } = await db.from(table).select("*").in(field, values.slice(index, index + 50)); if (error) throw error; output.push(...(data ?? [])); } return output; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
