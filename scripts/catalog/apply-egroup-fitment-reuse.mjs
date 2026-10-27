import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "egroup-fitment-reuse-20261024");
const WIPER_FILE = path.join(OUTPUT_DIR, "wipertech", "high_confidence_candidates.csv");
const PRODUCT_FILE = path.join(OUTPUT_DIR, "product-fitment-safe-candidates.csv");
const WIPER_SOURCE = "WIPERTECH_EGROUP_2026_10_24";
const PRODUCT_SOURCE = "EGROUP_LEGACY_FITMENT_REUSE_2026_10_24";

const args = new Set(process.argv.slice(2));
if (!args.has("--report-only") && !args.has("--apply")) throw new Error("Choose --report-only or --apply.");
loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const wipers = readCsv(WIPER_FILE).map(normalizeWiper);
const products = readCsv(PRODUCT_FILE);
if (wipers.length !== 2882) throw new Error(`Unexpected WiperTech candidate count: ${wipers.length}/2882`);
if (products.length !== 387) throw new Error(`Unexpected product candidate count: ${products.length}/387`);

const production = await loadProduction();
const plan = buildPlan(wipers, products, production);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const reportPath = path.join(OUTPUT_DIR, args.has("--apply") ? "production-apply-report.json" : "production-preflight.json");
writeJson(reportPath, publicReport(plan));
console.log(JSON.stringify(publicReport(plan), null, 2));
if (plan.blockers.length) throw new Error(`Preflight blocked by ${plan.blockers.length} conflict(s).`);

if (args.has("--apply")) {
  const backupDir = createBackup(production);
  const baseline = {
    wiper_fitments: production.wiperFitments.length,
    product_fitments: production.productFitments.length,
  };
  await applyPlan(plan, production);
  const verification = await verify(plan, baseline);
  const applied = { ...publicReport(plan), applied: true, applied_at: new Date().toISOString(), backup_directory: backupDir, verification };
  writeJson(reportPath, applied);
  console.log(JSON.stringify({ applied: true, backupDir, reportPath, verification }, null, 2));
}

async function loadProduction() {
  const [applications, years, wiperConfigurations, wiperBlades, wiperSizes, wiperFitments, productVariants, productFitments] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "application_id,status"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("wiper_configurations", "*"),
    fetchAll("wiper_configuration_blades", "*"),
    fetchAll("wiper_sizes", "*"),
    fetchAll("vehicle_catalog_wiper_fitments", "*"),
    fetchAll("product_variants", "id,sku,active"),
    fetchAll("vehicle_catalog_product_fitments", "*"),
  ]);
  return { applications, years, wiperConfigurations, wiperBlades, wiperSizes, wiperFitments, productVariants, productFitments };
}

function buildPlan(wiperRows, productRows, production) {
  const blockers = [];
  const activeApplicationIds = new Set(production.applications.filter((row) => row.status === "active").map((row) => row.application_id));
  const yearsByApplication = groupBy(production.years, (row) => row.application_id);
  const configurationById = new Map(production.wiperConfigurations.map((row) => [row.id, row]));
  const configurationByKey = new Map(production.wiperConfigurations.map((row) => [row.configuration_key, row]));
  const publishedWipersByApplication = groupBy(production.wiperFitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const productVariantsBySku = groupBy(production.productVariants, (row) => row.sku);
  const productSkuById = new Map(production.productVariants.map((row) => [row.id, row.sku]));
  const publishedProductsByApplicationPosition = groupBy(production.productFitments.filter((row) => row.fitment_status === "published"), (row) => `${row.application_id}|${row.position}`);
  const wiperPayload = [];
  const productPayload = [];
  const wiperExistingSame = [];
  const productExistingSame = [];

  for (const row of wiperRows) {
    if (!activeApplicationIds.has(row.application_id)) blockers.push({ type: "INACTIVE_OR_MISSING_APPLICATION", product_type: "wiper", application_id: row.application_id });
    if (!(yearsByApplication.get(row.application_id) ?? []).length) blockers.push({ type: "MISSING_APPLICATION_YEARS", product_type: "wiper", application_id: row.application_id });
    const existing = publishedWipersByApplication.get(row.application_id) ?? [];
    const existingKeys = existing.map((fitment) => configurationById.get(fitment.wiper_configuration_id)?.configuration_key).filter(Boolean);
    const different = existingKeys.filter((key) => key !== row.configuration);
    if (different.length) blockers.push({ type: "PUBLISHED_WIPER_CONFLICT", application_id: row.application_id, intended: row.configuration, existing: different });
    if (existingKeys.includes(row.configuration)) wiperExistingSame.push(row);
    else wiperPayload.push(row);
  }

  for (const row of productRows) {
    if (!activeApplicationIds.has(row.application_id)) blockers.push({ type: "INACTIVE_OR_MISSING_APPLICATION", product_type: row.product_type, application_id: row.application_id });
    if (!(yearsByApplication.get(row.application_id) ?? []).length) blockers.push({ type: "MISSING_APPLICATION_YEARS", product_type: row.product_type, application_id: row.application_id });
    const variants = productVariantsBySku.get(row.sku) ?? [];
    if (variants.length !== 1) {
      blockers.push({ type: "PRODUCT_SKU_NOT_UNIQUE", sku: row.sku, count: variants.length });
      continue;
    }
    if (variants[0].active !== true) blockers.push({ type: "INACTIVE_PRODUCT_VARIANT", sku: row.sku, product_variant_id: variants[0].id });
    const existing = publishedProductsByApplicationPosition.get(`${row.application_id}|${row.position}`) ?? [];
    const existingSkus = existing.map((fitment) => productSkuById.get(fitment.product_variant_id)).filter(Boolean);
    const different = existingSkus.filter((sku) => sku !== row.sku);
    if (different.length) blockers.push({ type: "PUBLISHED_PRODUCT_CONFLICT", product_type: row.product_type, application_id: row.application_id, position: row.position, intended: row.sku, existing: different });
    if (existingSkus.includes(row.sku)) productExistingSame.push(row);
    else productPayload.push({ ...row, product_variant_id: variants[0].id });
  }

  const duplicateWiperTargets = duplicates(wiperRows, (row) => row.application_id);
  const duplicateProductTargets = duplicates(productRows, (row) => `${row.application_id}|${row.position}`);
  if (duplicateWiperTargets.length) blockers.push({ type: "DUPLICATE_WIPER_TARGET", keys: duplicateWiperTargets });
  if (duplicateProductTargets.length) blockers.push({ type: "DUPLICATE_PRODUCT_TARGET", keys: duplicateProductTargets });

  const uniqueConfigurations = [...new Set(wiperRows.map((row) => row.configuration))];
  const newConfigurations = uniqueConfigurations.filter((key) => !configurationByKey.has(key));
  const wiperApplicationYears = sumYears(new Set(wiperRows.map((row) => row.application_id)), yearsByApplication);
  const brakeRows = productRows.filter((row) => row.product_type === "brake_pad");
  const oilRows = productRows.filter((row) => row.product_type === "oil_filter");
  const report = {
    generated_at: new Date().toISOString(),
    source_files: {
      wiper: fileIdentity(WIPER_FILE),
      product: fileIdentity(PRODUCT_FILE),
    },
    baseline: {
      wiper_fitments: production.wiperFitments.length,
      product_fitments: production.productFitments.length,
    },
    wiper: {
      intended_applications: wiperRows.length,
      intended_application_years: wiperApplicationYears,
      configurations: uniqueConfigurations.length,
      new_configurations: newConfigurations.length,
      already_published_same_configuration: wiperExistingSame.length,
      rows_to_insert: wiperPayload.length,
      complete_front: wiperRows.filter((row) => row.driver_in !== null && row.passenger_in !== null).length,
      partial_front_or_rear_only: wiperRows.filter((row) => row.driver_in === null || row.passenger_in === null).length,
    },
    brake_pad: {
      intended_rows: brakeRows.length,
      intended_applications: new Set(brakeRows.map((row) => row.application_id)).size,
      intended_application_years: sumYears(new Set(brakeRows.map((row) => row.application_id)), yearsByApplication),
    },
    oil_filter: {
      intended_rows: oilRows.length,
      intended_applications: new Set(oilRows.map((row) => row.application_id)).size,
      intended_application_years: sumYears(new Set(oilRows.map((row) => row.application_id)), yearsByApplication),
    },
    product_rows_to_insert: productPayload.length,
    product_rows_already_published_same_sku: productExistingSame.length,
  };
  return { blockers, report, wiperRows, productRows, wiperPayload, productPayload, newConfigurations };
}

async function applyPlan(plan, production) {
  const configurationIds = new Map(production.wiperConfigurations.map((row) => [row.configuration_key, row.id]));
  for (const row of plan.wiperRows) {
    if (configurationIds.has(row.configuration)) continue;
    const { data, error } = await db.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: row.driver_in,
      p_passenger_length_in: row.passenger_in,
      p_rear_length_in: row.rear_in,
    });
    if (error) throw new Error(`Could not create wiper configuration ${row.configuration}: ${error.message}`);
    configurationIds.set(row.configuration, data);
  }
  const now = new Date().toISOString();
  const wiperFitments = plan.wiperRows.map((row) => ({
    application_id: row.application_id,
    wiper_configuration_id: configurationIds.get(row.configuration),
    fitment_status: "published",
    source: WIPER_SOURCE,
    notes: [
      `rule=${row.rule}`,
      `confidence=${row.confidence}`,
      `source_vehicle_ids=${row.source_vehicle_ids}`,
      `configuration=${row.configuration}`,
      row.driver_in === null || row.passenger_in === null ? "partial_configuration=true" : "partial_configuration=false",
      row.rear_in === null ? "rear=unknown_or_not_supplied" : `rear=${row.rear_in}`,
    ].join("; "),
    updated_at: now,
  }));
  await upsertRows("vehicle_catalog_wiper_fitments", wiperFitments, "application_id,wiper_configuration_id");
  const configurationIdValues = [...new Set(wiperFitments.map((row) => row.wiper_configuration_id))];
  for (const ids of chunks(configurationIdValues, 200)) {
    const { error } = await db.from("wiper_configurations").update({ configuration_status: "published", updated_at: now }).in("id", ids);
    if (error) throw error;
  }

  const productFitments = plan.productPayload.map((row) => ({
    application_id: row.application_id,
    product_variant_id: row.product_variant_id,
    position: row.position,
    fitment_status: "published",
    source: PRODUCT_SOURCE,
    notes: [
      `product_type=${row.product_type}`,
      `confidence=${row.match_confidence}`,
      `score=${row.match_score}`,
      `method=${row.match_method}`,
      `matched_on=${row.matched_on}`,
      `source_fitment=${row.source_fitment_id}`,
      `source_row=${row.source_row}`,
      `publication=${row.fitment_status_reason}`,
    ].join("; "),
    updated_at: now,
  }));
  await upsertRows("vehicle_catalog_product_fitments", productFitments, "application_id,product_variant_id,position");
}

async function verify(plan, baseline) {
  const configurationRows = await fetchAll("wiper_configurations", "id,configuration_key,configuration_status");
  const configurationById = new Map(configurationRows.map((row) => [row.id, row]));
  const wiperRows = await selectInChunks("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", "application_id", plan.wiperRows.map((row) => row.application_id));
  const publishedByApp = groupBy(wiperRows.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const intendedConfigByApp = new Map(plan.wiperRows.map((row) => [row.application_id, row.configuration]));
  const wiperFailures = [];
  for (const [applicationId, configuration] of intendedConfigByApp) {
    const published = publishedByApp.get(applicationId) ?? [];
    const keys = published.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key).filter(Boolean);
    if (published.length !== 1 || keys[0] !== configuration) wiperFailures.push({ application_id: applicationId, intended: configuration, published: keys });
  }
  if (wiperFailures.length) throw new Error(`Wiper verification failed for ${wiperFailures.length} application(s).`);

  const productRows = await selectInChunks("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status,source", "application_id", plan.productRows.map((row) => row.application_id));
  const variantRows = await fetchAll("product_variants", "id,sku");
  const skuById = new Map(variantRows.map((row) => [row.id, row.sku]));
  const publishedProductKeys = new Set(productRows.filter((row) => row.fitment_status === "published").map((row) => `${row.application_id}|${row.position}|${skuById.get(row.product_variant_id)}`));
  const missingProducts = plan.productRows.filter((row) => !publishedProductKeys.has(`${row.application_id}|${row.position}|${row.sku}`));
  if (missingProducts.length) throw new Error(`Product verification missing ${missingProducts.length} intended fitment(s).`);

  const after = {
    wiper_fitments: await exactCount("vehicle_catalog_wiper_fitments"),
    product_fitments: await exactCount("vehicle_catalog_product_fitments"),
  };
  const expectedWiperIncrease = plan.wiperPayload.length;
  const expectedProductIncrease = plan.productPayload.length;
  if (after.wiper_fitments !== baseline.wiper_fitments + expectedWiperIncrease) throw new Error(`Unexpected wiper fitment count: ${after.wiper_fitments}/${baseline.wiper_fitments + expectedWiperIncrease}`);
  if (after.product_fitments !== baseline.product_fitments + expectedProductIncrease) throw new Error(`Unexpected product fitment count: ${after.product_fitments}/${baseline.product_fitments + expectedProductIncrease}`);
  return {
    ok: true,
    verified_wiper_applications: intendedConfigByApp.size,
    duplicate_published_wiper_applications: 0,
    verified_product_fitments: plan.productRows.length,
    missing_product_fitments: 0,
    before: baseline,
    after,
    inserted: { wiper_fitments: expectedWiperIncrease, product_fitments: expectedProductIncrease },
  };
}

function createBackup(production) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `egroup-fitment-reuse-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const tables = {
    vehicle_catalog_wiper_fitments: production.wiperFitments,
    vehicle_catalog_product_fitments: production.productFitments,
    wiper_configurations: production.wiperConfigurations,
    wiper_configuration_blades: production.wiperBlades,
    wiper_sizes: production.wiperSizes,
  };
  const manifest = { created_at: new Date().toISOString(), purpose: "Pre-apply full backup for Egroup fitment reuse", sources: { wiper: fileIdentity(WIPER_FILE), product: fileIdentity(PRODUCT_FILE) }, tables: {} };
  for (const [table, rows] of Object.entries(tables)) {
    const content = JSON.stringify(rows, null, 2);
    const filename = `${table}.json`;
    fs.writeFileSync(path.join(directory, filename), content);
    manifest.tables[table] = { rows: rows.length, file: filename, sha256: sha256(content) };
  }
  writeJson(path.join(directory, "manifest.json"), manifest);
  return directory;
}

function normalizeWiper(row) {
  const nullableNumber = (value) => value === "" || value === null || value === undefined ? null : Number(value);
  const driver = nullableNumber(row.driver_in);
  const passenger = nullableNumber(row.passenger_in);
  const rear = nullableNumber(row.rear_in);
  // CSV readers may interpret a rear-only key such as -/-/6 as a date. The
  // three typed length columns are authoritative, so always rebuild the key.
  const configuration = `${driver ?? "-"}/${passenger ?? "-"}/${rear ?? "-"}`;
  return { ...row, configuration, driver_in: driver, passenger_in: passenger, rear_in: rear, confidence: Number(row.confidence), application_years: Number(row.application_years) };
}
function publicReport(plan) { return { ...plan.report, blocker_count: plan.blockers.length, blockers: plan.blockers }; }
function sumYears(applicationIds, yearsByApplication) { let total = 0; for (const id of applicationIds) total += (yearsByApplication.get(id) ?? []).length; return total; }
function duplicates(rows, keyFn) { const groups = groupBy(rows, keyFn); return [...groups.entries()].filter(([, values]) => values.length > 1).map(([key]) => key); }
function fileIdentity(file) { const buffer = fs.readFileSync(file); return { path: file, size: buffer.length, sha256: sha256(buffer) }; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function chunks(rows, size) { const result = []; for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size)); return result; }
function groupBy(rows, keyFn) { const result = new Map(); for (const row of rows) { const key = keyFn(row); const values = result.get(key) ?? []; values.push(row); result.set(key, values); } return result; }
function readCsv(file) { const book = XLSX.readFile(file, { raw: false }); return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false }); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
async function selectInChunks(table, columns, field, values) {
  const rows = [];
  for (const valueChunk of chunks([...new Set(values)], 150)) {
    const { data, error } = await db.from(table).select(columns).in(field, valueChunk);
    if (error) throw new Error(`Could not verify ${table}: ${error.message}`);
    rows.push(...data);
  }
  return rows;
}
async function upsertRows(table, rows, onConflict) {
  for (const rowChunk of chunks(rows, 200)) {
    const { error } = await db.from(table).upsert(rowChunk, { onConflict });
    if (error) throw new Error(`Could not upsert ${table}: ${error.message}`);
  }
}
async function exactCount(table) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}
function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
