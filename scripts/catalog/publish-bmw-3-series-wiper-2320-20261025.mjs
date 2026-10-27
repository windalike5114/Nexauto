import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs/bmw-3-series-wiper-2320-product-20261025");
const SOURCE_DIR = path.resolve(ROOT, "outputs/bmw-3-series-wiper-productization-20261025");
const DIRECT_FILE = path.join(SOURCE_DIR, "direct-create.jsonl");
const APPLICATION_FILE = path.join(SOURCE_DIR, "application-audit.jsonl");
const APPLY = process.argv.includes("--apply");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
const TARGET = {
  sku: "WPFP2320",
  slug: "wiper-pair-23-20",
  name: 'Premium Front Windscreen Wiper Blade Pair - 23" + 20"',
  set_type: "front_pair",
  driver_length_in: 23,
  passenger_length_in: 20,
  rear_length_in: null,
  active: true,
  visibility_status: "public",
  content_status: "approved",
  commerce_status: "active",
  checkout_enabled: true
};

if (unknownArgs.length) throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
for (const file of [DIRECT_FILE, APPLICATION_FILE]) if (!fs.existsSync(file)) throw new Error(`Missing input: ${file}`);
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const source = validateSource();
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const initial = await inspectProduction(source);
writeReport(initial, source, APPLY ? "apply-preflight" : "report-only");

let applyResult = null;
if (APPLY) {
  if (initial.blockers.length) throw new Error(`Refusing apply: ${initial.blockers.join("; ")}`);
  const fresh = await inspectProduction(source);
  if (fresh.blockers.length) throw new Error(`Fresh apply preflight failed: ${fresh.blockers.join("; ")}`);
  if (fresh.fingerprint !== initial.fingerprint) throw new Error("Production changed between initial and fresh preflight; rerun.");
  const backupDir = writeBackup(fresh, source);
  let created = null;
  if (fresh.action === "create") {
    const id = crypto.randomUUID();
    const payload = { id, ...TARGET, price: fresh.commerce_rule.price, compare_at_price: fresh.commerce_rule.compare_at_price };
    const { data, error } = await db.from("wiper_sets").insert(payload).select("*").single();
    if (error) throw new Error(`Create ${TARGET.sku}: ${error.message}`);
    created = data;
  }
  const readback = await inspectProduction(source);
  const verification = verifyReadback(readback, fresh, created);
  if (!verification.ok) throw new Error(`Readback failed: ${verification.failures.join("; ")}`);
  applyResult = { applied_at: new Date().toISOString(), action: fresh.action, created, backup_dir: rel(backupDir), verification };
  writeJson("applied.json", applyResult);
  writeReport(readback, source, "post-apply", created ? 1 : 0);
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "report-only",
  output_dir: rel(OUTPUT_DIR),
  action: initial.action,
  blockers: initial.blockers.length,
  target_applications: initial.target_totals.applications,
  target_application_years: initial.target_totals.application_years,
  active_23_inch_sources: initial.component_availability["23"].length,
  active_20_inch_sources: initial.component_availability["20"].length,
  planned_wiper_set_writes: initial.action === "create" && !initial.blockers.length ? 1 : 0,
  production_writes: applyResult?.created ? 1 : 0
}, null, 2));

function validateSource() {
  const direct = readJsonl(DIRECT_FILE);
  if (direct.length !== 1) throw new Error(`Expected one direct-create group, found ${direct.length}`);
  const group = direct[0];
  if (Number(group.driver_length_in) !== 23 || Number(group.passenger_length_in) !== 20 || group.front_pair_key !== "23/20") {
    throw new Error("Direct-create target is no longer the single 23/20 front pair.");
  }
  const ids = unique(group.application_ids).sort();
  const audits = readJsonl(APPLICATION_FILE).filter((row) => ids.includes(row.application_id));
  if (audits.length !== ids.length || unique(audits.map((row) => row.application_id)).length !== ids.length) {
    throw new Error("Source application audit does not map one-to-one to direct-create IDs.");
  }
  const invalid = audits.filter((row) => row.classification !== "direct-create" || Number(row.driver_length_in) !== 23
    || Number(row.passenger_length_in) !== 20 || !["23/20/-", "23/20/12"].includes(row.configuration_key));
  if (invalid.length) throw new Error(`Source has ${invalid.length} invalid application rows.`);
  const ay = audits.reduce((sum, row) => sum + row.years.length, 0);
  if (ids.length !== Number(group.applications) || ay !== Number(group.application_years)) throw new Error("Source totals do not reconcile.");
  return {
    group, audits: audits.sort((a, b) => a.application_id.localeCompare(b.application_id)), application_ids: ids,
    applications: ids.length, application_years: ay,
    files: { direct_create: fileIdentity(DIRECT_FILE), application_audit: fileIdentity(APPLICATION_FILE) }
  };
}

async function inspectProduction(sourceRows) {
  const [sets, applications, years, fitments] = await Promise.all([
    fetchAll("wiper_sets", "*"),
    selectIn("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status", "application_id", sourceRows.application_ids),
    selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", sourceRows.application_ids),
    fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes,created_at,updated_at")
  ]);
  const targetFitments = fitments.filter((row) => sourceRows.application_ids.includes(row.application_id));
  const configurationIds = unique(targetFitments.map((row) => row.wiper_configuration_id));
  const modelIds = unique(applications.map((row) => row.model_id));
  const seriesIds = unique(applications.map((row) => row.series_id));
  const variantIds = unique(applications.map((row) => row.variant_id));
  const [configurations, blades, models, series, variants] = await Promise.all([
    selectIn("wiper_configurations", "*", "id", configurationIds),
    selectIn("wiper_configuration_blades", "*", "wiper_configuration_id", configurationIds),
    selectIn("vehicle_catalog_models", "model_id,make_id,name,status", "model_id", modelIds),
    selectIn("vehicle_catalog_series", "series_id,model_id,code,display_name,status", "series_id", seriesIds),
    selectIn("vehicle_catalog_variants", "variant_id,display_name,body_style", "variant_id", variantIds)
  ]);
  const makeIds = unique(models.map((row) => row.make_id));
  const makes = await selectIn("vehicle_catalog_makes", "make_id,name,status", "make_id", makeIds);

  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const fitmentsByApp = groupBy(targetFitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const configById = new Map(configurations.map((row) => [row.id, row]));
  const bladesByConfig = groupBy(blades, (row) => row.wiper_configuration_id);
  const modelById = new Map(models.map((row) => [row.model_id, row]));
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(series.map((row) => [row.series_id, row]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));

  const application_checks = sourceRows.audits.map((expected) => {
    const app = appById.get(expected.application_id);
    const model = modelById.get(app?.model_id);
    const make = makeById.get(model?.make_id);
    const seriesRow = seriesById.get(app?.series_id);
    const variant = variantById.get(app?.variant_id);
    const liveYears = unique((yearsByApp.get(expected.application_id) ?? []).map((row) => Number(row.model_year)))
      .filter((year) => year >= 2000 && year <= 2026).sort((a, b) => a - b);
    const published = fitmentsByApp.get(expected.application_id) ?? [];
    const configuration = published.length === 1 ? configById.get(published[0].wiper_configuration_id) : null;
    const configBlades = configuration ? (bladesByConfig.get(configuration.id) ?? []) : [];
    const bladeMap = Object.fromEntries(configBlades.map((row) => [row.position, Number(row.length_in)]));
    const expectedRear = expected.configuration_key.endsWith("/12") ? 12 : null;
    const failures = [];
    if (!app) failures.push("application_missing");
    else if (app.status !== "active") failures.push(`application_status:${app.status}`);
    if (upper(make?.name) !== "BMW" || !["3", "3 SERIES"].includes(upper(model?.name))) failures.push("identity_not_bmw_3_series");
    if (upper(seriesRow?.code) !== upper(expected.series_code)) failures.push("series_changed");
    if (upper(variant?.body_style) !== upper(expected.body_style)) failures.push("body_changed");
    if (JSON.stringify(liveYears) !== JSON.stringify(expected.years)) failures.push("years_changed");
    if (published.length !== 1) failures.push(`published_fitment_count:${published.length}`);
    if (!configuration) failures.push("configuration_missing");
    else {
      if (configuration.configuration_status !== "published") failures.push(`configuration_status:${configuration.configuration_status}`);
      if (configuration.configuration_key !== expected.configuration_key) failures.push("configuration_key_changed");
      if (bladeMap.driver !== 23 || bladeMap.passenger !== 20) failures.push("front_blades_not_23_20");
      if (expectedRear === null && Object.hasOwn(bladeMap, "rear")) failures.push("unexpected_rear_blade");
      if (expectedRear !== null && bladeMap.rear !== expectedRear) failures.push("rear_blade_changed");
      if (unique(configBlades.map((row) => row.position)).length !== configBlades.length) failures.push("duplicate_blade_position");
    }
    return {
      application_id: expected.application_id, ok: failures.length === 0, failures,
      identity: { make: make?.name ?? null, model: model?.name ?? null, series: seriesRow?.code ?? null, body: variant?.body_style ?? null },
      years: liveYears, published_fitments: published, configuration, blades: configBlades
    };
  });

  const sellable = sets.filter(isSellableFrontPair);
  const exact = sets.filter((row) => row.set_type === "front_pair" && samePair(row, 23, 20));
  const exactSellable = exact.filter(isSellableFrontPair);
  const skuRows = sets.filter((row) => row.sku === TARGET.sku);
  const slugRows = sets.filter((row) => row.slug === TARGET.slug);
  const component_availability = Object.fromEntries([23, 20].map((length) => [String(length), sellable
    .filter((row) => Number(row.driver_length_in) === length || Number(row.passenger_length_in) === length)
    .map(compactSet)]));
  const commerce_rule = deriveCommerceRule(sellable, sets);
  const globalPublishedByApp = groupBy(fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const globalDuplicateIds = [...globalPublishedByApp.entries()].filter(([, rows]) => rows.length > 1).map(([id]) => id).sort();
  const targetDuplicateIds = sourceRows.application_ids.filter((id) => (globalPublishedByApp.get(id) ?? []).length > 1);
  const blockers = [];
  for (const row of application_checks.filter((item) => !item.ok)) blockers.push(`application:${row.application_id}:${row.failures.join(",")}`);
  if (!component_availability["23"].length) blockers.push("no_active_sellable_23_inch_component_evidence");
  if (!component_availability["20"].length) blockers.push("no_active_sellable_20_inch_component_evidence");
  if (exact.length > 1) blockers.push(`duplicate_exact_23_20_sets:${exact.length}`);
  if (exact.length === 1 && exactSellable.length !== 1) blockers.push("exact_23_20_set_exists_but_is_not_sellable");
  if (skuRows.some((row) => !samePair(row, 23, 20))) blockers.push("sku_collision");
  if (slugRows.some((row) => !samePair(row, 23, 20))) blockers.push("slug_collision");
  if (!commerce_rule.ok) blockers.push(...commerce_rule.blockers);
  if (targetDuplicateIds.length) blockers.push(`target_duplicate_published_fitments:${targetDuplicateIds.length}`);
  const action = exactSellable.length === 1 ? "already-present-noop" : "create";
  const inventoryColumns = sets.length ? Object.keys(sets[0]).filter((key) => /stock|inventory/i.test(key)) : [];
  const snapshot = {
    fetched_at: new Date().toISOString(), wiper_sets: sets, applications, years, fitments: targetFitments,
    configurations, blades, makes, models, series, variants
  };
  const fingerprint = sha256(JSON.stringify({ sets, applications, years, targetFitments, configurations, blades }));
  return {
    generated_at: new Date().toISOString(), fingerprint, action, blockers, application_checks,
    target_totals: { applications: sourceRows.applications, application_years: sourceRows.application_years },
    exact_sets: exact.map(compactSet), component_availability, commerce_rule,
    schema_inventory_policy: inventoryColumns.length
      ? { inventory_columns: inventoryColumns, conclusion: "blocked_unless_existing_rule_is_deterministic" }
      : { inventory_columns: [], conclusion: "wiper_sets_has_no_stock_quantity; active/public/approved/commerce-active/checkout-enabled is the current sellable inventory gate" },
    duplicate_audit: { global_published_duplicate_application_ids: globalDuplicateIds, target_duplicate_application_ids: targetDuplicateIds },
    snapshot
  };
}

function deriveCommerceRule(sellable, allSets) {
  const priceDistribution = distribution(sellable.map((row) => Number(row.price)));
  const compareDistribution = distribution(sellable.map((row) => row.compare_at_price === null ? null : Number(row.compare_at_price)));
  const price = dominant(priceDistribution);
  const compare = dominant(compareDistribution);
  const blockers = [];
  if (price === null) blockers.push("no_deterministic_sellable_front_pair_price");
  if (compare === undefined) blockers.push("no_deterministic_sellable_front_pair_compare_at_price");
  const inventoryColumns = allSets.length ? Object.keys(allSets[0]).filter((key) => /stock|inventory/i.test(key)) : [];
  if (inventoryColumns.length) blockers.push(`unhandled_wiper_set_inventory_columns:${inventoryColumns.join(",")}`);
  return {
    ok: blockers.length === 0, blockers, price, compare_at_price: compare,
    price_distribution: priceDistribution, compare_at_price_distribution: compareDistribution,
    lifecycle: { active: true, visibility_status: "public", content_status: "approved", commerce_status: "active", checkout_enabled: true },
    source: "dominant values among current sellable front_pair rows; lifecycle is the repository sellable gate"
  };
}

function writeReport(preflight, sourceRows, mode, productionWrites = 0) {
  const safe = preflight.blockers.length === 0;
  const plannedWrites = safe && preflight.action === "create" ? 1 : 0;
  writeJson("preflight-summary.json", {
    generated_at: new Date().toISOString(), mode, production_writes: productionWrites, safe_to_apply: safe,
    action: preflight.action, blockers: preflight.blockers,
    target: TARGET, target_applications: preflight.target_totals.applications,
    target_application_years: preflight.target_totals.application_years,
    expected_wiper_set_writes: plannedWrites, expected_product_uplift_application_years: safe ? preflight.target_totals.application_years : 0,
    component_availability: { "23": preflight.component_availability["23"].length, "20": preflight.component_availability["20"].length },
    commerce_rule: preflight.commerce_rule, schema_inventory_policy: preflight.schema_inventory_policy,
    exact_sets_before: preflight.exact_sets, duplicate_audit: preflight.duplicate_audit,
    safeguards: ["No wiper knowledge configuration, blade row, or vehicle fitment is written.", "Default mode is report-only; --apply is required.", "Apply repeats the full production preflight and aborts on snapshot drift."]
  });
  writeJsonl("application-preflight.jsonl", preflight.application_checks);
  writeJson("create-plan.json", {
    action: preflight.action, table: "wiper_sets", rows: plannedWrites,
    payload: { ...TARGET, price: preflight.commerce_rule.price, compare_at_price: preflight.commerce_rule.compare_at_price },
    implicit_link_semantics: "Published 23/20 front configurations become product-covered by exact active sellable front-pair dimensions; no fitment row is changed."
  });
  writeJson("backup-plan.json", backupDocument(preflight, sourceRows));
  writeJson("rollback-plan.json", rollbackDocument(preflight));
  writeJson("readback-verification.json", {
    performed: mode === "post-apply", expected: {
      exact_sellable_23_20_sets: 1, sku: TARGET.sku, slug: TARGET.slug,
      target_applications_product_covered: preflight.target_totals.applications,
      target_application_years_product_covered: preflight.target_totals.application_years,
      target_knowledge_rows_modified: 0
    }, observed: mode === "post-apply" ? {
      exact_sellable_23_20_sets: preflight.exact_sets.filter(isSellableFrontPair).length,
      target_applications_valid: preflight.application_checks.filter((row) => row.ok).length,
      target_application_years: preflight.target_totals.application_years,
      target_duplicate_published_fitments: preflight.duplicate_audit.target_duplicate_application_ids.length
    } : null
  });
  writeJson("source-audit.json", { source: sourceRows.files, source_group: sourceRows.group, production_fetched_at: preflight.snapshot.fetched_at, production_fingerprint: preflight.fingerprint });
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), [
    "BMW 3 Series 23/20 wiper product creation preflight - 2026-10-25", "",
    `Mode: ${mode}. Production writes this run: ${productionWrites}.`,
    `Target: ${preflight.target_totals.applications} applications / ${preflight.target_totals.application_years} AY.`,
    `Action: ${preflight.action}; blockers: ${preflight.blockers.length}; expected writes: ${plannedWrites}.`,
    `23-inch active sellable component evidence: ${preflight.component_availability["23"].length} set(s).`,
    `20-inch active sellable component evidence: ${preflight.component_availability["20"].length} set(s).`,
    "The current wiper_sets schema has no stock quantity; sellability is represented by lifecycle/checkout state.",
    "No wiper configuration, blade, or fitment knowledge row is modified.", "",
    "Report-only: node scripts/catalog/publish-bmw-3-series-wiper-2320-20261025.mjs",
    "Apply (explicit only): node scripts/catalog/publish-bmw-3-series-wiper-2320-20261025.mjs --apply", ""
  ].join("\n"), "utf8");
}

function backupDocument(preflight, sourceRows) {
  return {
    generated_at: new Date().toISOString(), mode: "preimage-plan", full_target_snapshot_on_apply: true,
    source_files: sourceRows.files, production_fingerprint: preflight.fingerprint,
    tables: {
      wiper_sets: { selector: "all rows (needed for global duplicate, commerce-rule, and component checks)", rows: preflight.snapshot.wiper_sets.length, touched: preflight.action === "create" },
      vehicle_catalog_applications: { ids: sourceRows.application_ids, rows: preflight.snapshot.applications.length, touched: false },
      vehicle_catalog_application_years: { application_ids: sourceRows.application_ids, rows: preflight.snapshot.years.length, touched: false },
      vehicle_catalog_wiper_fitments: { application_ids: sourceRows.application_ids, rows: preflight.snapshot.fitments.length, touched: false },
      wiper_configurations: { ids: preflight.snapshot.configurations.map((row) => row.id), rows: preflight.snapshot.configurations.length, touched: false },
      wiper_configuration_blades: { configuration_ids: unique(preflight.snapshot.blades.map((row) => row.wiper_configuration_id)), rows: preflight.snapshot.blades.length, touched: false }
    },
    preimage: preflight.snapshot
  };
}

function rollbackDocument(preflight) {
  return {
    applies_only_if_created: true, table: "wiper_sets",
    key: { sku: TARGET.sku, slug: TARGET.slug, dimensions: "23/20/null" },
    expected_created_postimage: { ...TARGET, price: preflight.commerce_rule.price, compare_at_price: preflight.commerce_rule.compare_at_price },
    procedure: [
      "Locate the row by recorded created id plus SKU and slug.",
      "Verify the full row still matches expected_created_postimage and inspect order_items/order_wiper_fulfillment references.",
      "Delete only that newly created row if it is unchanged and unreferenced; otherwise restore manually from backup evidence."
    ],
    knowledge_tables_to_restore: []
  };
}

function writeBackup(preflight, sourceRows) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const dir = path.join(OUTPUT_DIR, "backups", `preimage-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "backup.json"), `${JSON.stringify(backupDocument(preflight, sourceRows), null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(dir, "rollback-plan.json"), `${JSON.stringify(rollbackDocument(preflight), null, 2)}\n`, "utf8");
  return dir;
}

function verifyReadback(readback, before, created) {
  const exactSellable = readback.exact_sets.filter(isSellableFrontPair);
  const failures = [...readback.blockers];
  if (exactSellable.length !== 1) failures.push(`exact_sellable_count:${exactSellable.length}`);
  const row = exactSellable[0];
  if (row && (row.sku !== TARGET.sku || row.slug !== TARGET.slug || Number(row.price) !== before.commerce_rule.price
    || nullableNumber(row.compare_at_price) !== before.commerce_rule.compare_at_price)) failures.push("created_row_mismatch");
  if (created && row?.id !== created.id) failures.push("created_id_readback_mismatch");
  if (readback.duplicate_audit.global_published_duplicate_application_ids.join("|") !== before.duplicate_audit.global_published_duplicate_application_ids.join("|")) {
    failures.push("global_published_duplicate_set_changed");
  }
  return {
    ok: failures.length === 0, failures, exact_set: row ?? null,
    applications_verified: readback.application_checks.filter((item) => item.ok).length,
    application_years_covered: failures.length ? 0 : readback.target_totals.application_years,
    knowledge_writes: 0
  };
}

function compactSet(row) {
  return {
    id: row.id, sku: row.sku, slug: row.slug, name: row.name, set_type: row.set_type,
    driver_length_in: Number(row.driver_length_in), passenger_length_in: Number(row.passenger_length_in),
    rear_length_in: nullableNumber(row.rear_length_in), price: Number(row.price), compare_at_price: nullableNumber(row.compare_at_price),
    active: row.active === true, visibility_status: row.visibility_status, content_status: row.content_status,
    commerce_status: row.commerce_status, checkout_enabled: row.checkout_enabled === true
  };
}
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
  && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function samePair(row, a, b) { return [Number(row.driver_length_in), Number(row.passenger_length_in)].sort((x, y) => y - x).join("/") === [a, b].sort((x, y) => y - x).join("/"); }
function distribution(values) { return [...groupBy(values, (value) => JSON.stringify(value)).values()].map((rows) => ({ value: rows[0], count: rows.length })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))); }
function dominant(rows) { return rows.length && (rows.length === 1 || rows[0].count > rows[1].count) ? rows[0].value : undefined; }
function nullableNumber(value) { return value === null || value === undefined ? null : Number(value); }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); const list = map.get(key) ?? []; list.push(row); map.set(key, list); } return map; }
function rel(file) { return path.relative(ROOT, file).replaceAll("\\", "/"); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: rel(file), bytes: bytes.length, sha256: sha256(bytes), modified_at: fs.statSync(file).mtime.toISOString() }; }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJson(name, value) { fs.writeFileSync(path.join(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeJsonl(name, rows) { fs.writeFileSync(path.join(OUTPUT_DIR, name), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8"); }

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
async function selectIn(table, columns, field, values) {
  const rows = [];
  for (let index = 0; index < values.length; index += 50) {
    const batch = values.slice(index, index + 50);
    if (!batch.length) continue;
    const { data, error } = await db.from(table).select(columns).in(field, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
