import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "extended132-model-toyota-vitz-yaris-wiper-productization-20261025");
const BASELINE_FILE = path.resolve(ROOT, "outputs", "popular-extended132-product-gaps-20261025", "coverage-by-model.json");
const PERIOD = { from: 2000, to: 2026 };
const GROUP = "Toyota Vitz / Yaris";

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase read credentials.");
}
if (!fs.existsSync(BASELINE_FILE)) throw new Error(`Missing baseline: ${BASELINE_FILE}`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const baselineDocument = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
const baseline = baselineDocument.groups.find((row) => row.popular_group === GROUP);
if (!baseline) throw new Error(`Baseline group not found: ${GROUP}`);
if (baseline.wiper_product_without_knowledge_gap_years !== 124) {
  throw new Error(`Expected 124 product-only AY, found ${baseline.wiper_product_without_knowledge_gap_years}`);
}

const specs = [
  ["makes", "vehicle_catalog_makes", "make_id,name,status"],
  ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
  ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"],
  ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
  ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status,year_from,year_to"],
  ["years", "vehicle_catalog_application_years", "application_id,model_year"],
  ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
  ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"],
  ["wiperSets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"],
];

const values = await Promise.all(specs.map(([, table, columns]) => fetchAll(table, columns)));
const data = Object.fromEntries(specs.map(([name], index) => [name, values[index]]));
const tableCounts = Object.fromEntries(specs.map(([, table], index) => [table, values[index].length]));

const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
const modelById = new Map(data.models.map((row) => [row.model_id, row]));
const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
const configById = new Map(data.configurations.map((row) => [row.id, row]));
const yearsByApplication = groupBy(data.years, (row) => row.application_id);
const fitmentsByApplication = groupBy(
  data.fitments.filter((row) => row.fitment_status === "published"),
  (row) => row.application_id,
);

const targetApplications = data.applications
  .filter((row) => row.status === "active")
  .map((row) => {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    if (upper(make?.name) !== "TOYOTA" || !["VITZ", "YARIS"].includes(upper(model?.name))) return null;
    const years = uniqueNumbers((yearsByApplication.get(row.application_id) ?? []).map((item) => item.model_year))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to)
      .sort((a, b) => a - b);
    if (!years.length) return null;
    const series = seriesById.get(row.series_id);
    const variant = variantById.get(row.variant_id);
    const publishedFitments = fitmentsByApplication.get(row.application_id) ?? [];
    const publishedConfigurations = publishedFitments.map((fitment) => ({
      configuration_id: fitment.wiper_configuration_id,
      configuration_key: configById.get(fitment.wiper_configuration_id)?.configuration_key ?? null,
      configuration_status: configById.get(fitment.wiper_configuration_id)?.configuration_status ?? null,
      rear_status: configById.get(fitment.wiper_configuration_id)?.rear_status ?? null,
      source: fitment.source,
    }));
    return {
      application_id: row.application_id,
      make: upper(make?.name),
      model: upper(model?.name),
      series_code: upper(series?.code),
      series_name: String(series?.display_name ?? "").trim(),
      body_style: String(variant?.body_style ?? "").trim(),
      variant: String(variant?.display_name ?? "").trim(),
      years,
      application_years: years.length,
      published_configurations: publishedConfigurations,
    };
  })
  .filter(Boolean);

const allSetAudits = data.wiperSets.map(auditSet);
const applicationAudit = targetApplications.map((application) => classifyApplication(application, allSetAudits));
const productOnly = applicationAudit.filter((row) => row.knowledge_published && !row.sellable_product_covered);

const productOnlyAy = sum(productOnly, (row) => row.application_years);
if (productOnlyAy !== baseline.wiper_product_without_knowledge_gap_years) {
  throw new Error(`Live product-only AY ${productOnlyAy} does not reconcile to baseline ${baseline.wiper_product_without_knowledge_gap_years}`);
}

const directLink = productOnly.filter((row) => row.commercial_action === "link_existing_sellable_front_pair");
const directCreate = productOnly.filter((row) => row.commercial_action === "create_sellable_front_pair");
const procurement = productOnly.filter((row) => row.commercial_action === "procure_or_activate_exact_front_pair");
const incomplete = productOnly.filter((row) => row.commercial_action === "blocked_incomplete_published_front_configuration");
const review = productOnly.filter((row) => row.commercial_action === "review_duplicate_or_invalid_published_configuration");

const configurationSummary = [...aggregateBy(productOnly, (row) => `${row.model}|${row.configuration_key ?? "<multiple>"}`).values()]
  .map((rows) => summarizeConfiguration(rows, allSetAudits));

const knownPositionInventory = {
  driver: positionInventory(productOnly, "driver_length_in", allSetAudits, "driver_length_in"),
  passenger: positionInventory(productOnly, "passenger_length_in", allSetAudits, "passenger_length_in"),
  rear: positionInventory(productOnly, "rear_length_in", allSetAudits, "rear_length_in"),
};

const summary = {
  generated_at: new Date().toISOString(),
  mode: "report-only",
  production_writes: false,
  period: PERIOD,
  group: GROUP,
  baseline: {
    source: path.relative(ROOT, BASELINE_FILE).replaceAll("\\", "/"),
    rank: baseline.rank,
    applications_total: baseline.applications_total,
    application_years_total: baseline.application_years_total,
    wiper_knowledge_application_years_covered: baseline.wiper_knowledge_application_years_covered,
    wiper_knowledge_application_years_missing: baseline.wiper_knowledge_application_years_missing,
    wiper_product_application_years_covered: baseline.wiper_product_application_years_covered,
    wiper_product_application_years_missing: baseline.wiper_product_application_years_missing,
    product_only_application_years: baseline.wiper_product_without_knowledge_gap_years,
    extended132_denominator_application_years: baselineDocument.totals.wiper_product.application_years_total,
  },
  live_reconciliation: {
    scoped_active_applications: targetApplications.length,
    scoped_application_years: sum(targetApplications, (row) => row.application_years),
    product_only_applications: productOnly.length,
    product_only_application_years: productOnlyAy,
    product_only_pp_of_extended132: round(productOnlyAy / baselineDocument.totals.wiper_product.application_years_total * 100, 4),
  },
  action_counts: actionCounts(productOnly),
  conclusion: {
    directly_linkable_application_years: sum(directLink, (row) => row.application_years),
    directly_creatable_application_years: sum(directCreate, (row) => row.application_years),
    procurement_or_activation_application_years: sum(procurement, (row) => row.application_years),
    blocked_by_incomplete_published_front_configuration_application_years: sum(incomplete, (row) => row.application_years),
    review_application_years: sum(review, (row) => row.application_years),
    safe_product_uplift_application_years: sum([...directLink, ...directCreate, ...procurement], (row) => row.application_years),
    safe_product_uplift_pp: round(sum([...directLink, ...directCreate, ...procurement], (row) => row.application_years) / baselineDocument.totals.wiper_product.application_years_total * 100, 4),
    note: "A published partial configuration counts as knowledge, but it cannot define a sellable front pair. Product availability must not fill a missing blade size.",
  },
  published_configuration_summary: configurationSummary,
  known_blade_inventory_by_position: knownPositionInventory,
  sources: {
    production_read_only_tables: tableCounts,
    product_gate: "front_pair + active + public + approved + commerce active + checkout enabled",
  },
  outputs: {
    application_audit: "application-audit.jsonl",
    configuration_summary: "configuration-summary.jsonl",
    ready_to_link: "ready-to-link.jsonl",
    products_to_create: "products-to-create.jsonl",
    procurement_needs: "procurement-needs.jsonl",
    incomplete_configuration_blockers: "incomplete-configuration-blockers.jsonl",
    review: "review.jsonl",
    wiper_set_audit: "wiper-set-audit.json",
  },
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJson("summary.json", summary);
writeJsonl("application-audit.jsonl", productOnly);
writeJsonl("configuration-summary.jsonl", configurationSummary);
writeJsonl("ready-to-link.jsonl", directLink);
writeJsonl("products-to-create.jsonl", directCreate);
writeJsonl("procurement-needs.jsonl", procurement);
writeJsonl("incomplete-configuration-blockers.jsonl", incomplete);
writeJsonl("review.jsonl", review);
writeJson("wiper-set-audit.json", {
  all_sets: allSetAudits,
  sets_relevant_to_known_product_only_positions: allSetAudits.filter((set) =>
    knownPositionInventory.driver.some((item) => set.driver_length_in === item.blade_length_in)
      || knownPositionInventory.passenger.some((item) => set.passenger_length_in === item.blade_length_in)
      || knownPositionInventory.rear.some((item) => set.rear_length_in === item.blade_length_in)),
});
fs.writeFileSync(path.join(OUTPUT_DIR, "README.md"), readme(summary), "utf8");

console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT_DIR), ...summary.live_reconciliation, ...summary.conclusion }, null, 2));

function classifyApplication(application, sets) {
  const published = application.published_configurations;
  if (published.length !== 1 || !published[0].configuration_key) {
    return {
      ...application,
      knowledge_published: published.length > 0,
      configuration_key: null,
      driver_length_in: null,
      passenger_length_in: null,
      rear_length_in: null,
      matching_wiper_sets: [],
      matching_sellable_wiper_sets: [],
      sellable_product_covered: false,
      commercial_action: "review_duplicate_or_invalid_published_configuration",
      reason: published.length > 1 ? "multiple_published_wiper_fitments" : "published_configuration_missing_key",
    };
  }
  const configurationKey = published[0].configuration_key;
  const [driver, passenger, rear] = configurationKey.split("/").map(parseLength);
  const completeFront = driver !== null && passenger !== null;
  const matchingSets = completeFront
    ? sets.filter((set) => set.set_type === "front_pair" && set.driver_length_in === driver && set.passenger_length_in === passenger)
    : [];
  const sellableSets = matchingSets.filter((set) => set.sellable);
  let commercialAction;
  let reason;
  if (!completeFront) {
    commercialAction = "blocked_incomplete_published_front_configuration";
    reason = driver === null && passenger === null ? "both_front_lengths_missing" : "one_front_length_missing";
  } else if (sellableSets.length) {
    commercialAction = "link_existing_sellable_front_pair";
    reason = "exact_active_sellable_front_pair_exists";
  } else if (matchingSets.length) {
    commercialAction = "procure_or_activate_exact_front_pair";
    reason = "exact_front_pair_exists_but_is_not_sellable";
  } else {
    commercialAction = "create_sellable_front_pair";
    reason = "complete_published_front_pair_has_no_existing_wiper_set";
  }
  return {
    ...application,
    knowledge_published: true,
    configuration_key: configurationKey,
    driver_length_in: driver,
    passenger_length_in: passenger,
    rear_length_in: rear,
    front_configuration_complete: completeFront,
    matching_wiper_sets: matchingSets,
    matching_sellable_wiper_sets: sellableSets,
    sellable_product_covered: sellableSets.length > 0,
    commercial_action: commercialAction,
    reason,
  };
}

function summarizeConfiguration(rows, sets) {
  const first = rows[0];
  return {
    model: first.model,
    configuration_key: first.configuration_key,
    driver_length_in: first.driver_length_in,
    passenger_length_in: first.passenger_length_in,
    rear_length_in: first.rear_length_in,
    front_configuration_complete: first.front_configuration_complete,
    series_codes: uniqueStrings(rows.map((row) => row.series_code)),
    application_ids: rows.map((row) => row.application_id).sort(),
    applications: rows.length,
    application_years: sum(rows, (row) => row.application_years),
    years: uniqueNumbers(rows.flatMap((row) => row.years)).sort((a, b) => a - b),
    commercial_action: first.commercial_action,
    reason: first.reason,
    exact_matching_wiper_sets: first.matching_wiper_sets,
    sellable_exact_matching_wiper_sets: first.matching_sellable_wiper_sets,
    sets_with_exact_known_driver_length: first.driver_length_in === null ? [] : sets.filter((set) => set.driver_length_in === first.driver_length_in),
    sets_with_exact_known_passenger_length: first.passenger_length_in === null ? [] : sets.filter((set) => set.passenger_length_in === first.passenger_length_in),
    sets_with_exact_known_rear_length: first.rear_length_in === null ? [] : sets.filter((set) => set.rear_length_in === first.rear_length_in),
  };
}

function positionInventory(rows, applicationField, sets, setField) {
  return uniqueNumbers(rows.map((row) => row[applicationField])).sort((a, b) => a - b).map((length) => ({
    blade_length_in: length,
    exact_position_wiper_sets: sets.filter((set) => set[setField] === length),
  }));
}

function auditSet(row) {
  return {
    id: row.id,
    sku: row.sku,
    set_type: row.set_type,
    driver_length_in: numberOrNull(row.driver_length_in),
    passenger_length_in: numberOrNull(row.passenger_length_in),
    rear_length_in: numberOrNull(row.rear_length_in),
    active: row.active === true,
    visibility_status: row.visibility_status,
    content_status: row.content_status,
    commerce_status: row.commerce_status,
    checkout_enabled: row.checkout_enabled === true,
    sellable: row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
      && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true,
  };
}

function actionCounts(rows) {
  const groups = aggregateBy(rows, (row) => row.commercial_action);
  return Object.fromEntries([...groups.entries()].map(([key, values]) => [key, {
    applications: values.length,
    application_years: sum(values, (row) => row.application_years),
  }]));
}

function readme(summaryDocument) {
  const c = summaryDocument.conclusion;
  return [
    "# Toyota Vitz / Yaris wiper productization audit — 2026-10-25",
    "",
    "Report-only current-production readback. No fitment or product row is changed.",
    "",
    `- Product-only baseline: **${summaryDocument.live_reconciliation.product_only_application_years} application-years**.`,
    `- Directly linkable: **${c.directly_linkable_application_years} AY**.`,
    `- Directly creatable from complete published front sizes: **${c.directly_creatable_application_years} AY**.`,
    `- Exact existing set needing procurement/activation: **${c.procurement_or_activation_application_years} AY**.`,
    `- Blocked by incomplete published front sizes: **${c.blocked_by_incomplete_published_front_configuration_application_years} AY**.`,
    `- Safe product uplift without changing knowledge: **${c.safe_product_uplift_application_years} AY (${c.safe_product_uplift_pp} pp of 46,676)**.`,
    "",
    "A published partial configuration remains knowledge coverage, but it cannot be converted into a sellable front pair by guessing a missing blade length. The blocker queue is therefore not a procurement authorization.",
    "",
    "Rerun from repository root:",
    "",
    "`node scripts/catalog/report-toyota-vitz-yaris-wiper-productization-20261025.mjs`",
    "",
  ].join("\n");
}

async function fetchAll(table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data: rows, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(rows ?? []));
    if (!rows || rows.length < 1000) return output;
  }
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function parseLength(value) { return value && value !== "-" ? numberOrNull(value) : null; }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function sum(rows, selector) { return rows.reduce((total, row) => total + selector(row), 0); }
function round(value, digits) { return Number(value.toFixed(digits)); }
function uniqueNumbers(values) {
  return [...new Set(values
    .filter((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0)
    .map(Number))];
}
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }
function aggregateBy(rows, keyFn) { return groupBy(rows, keyFn); }
function writeJson(fileName, value) { fs.writeFileSync(path.join(OUTPUT_DIR, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeJsonl(fileName, rows) { fs.writeFileSync(path.join(OUTPUT_DIR, fileName), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8"); }
