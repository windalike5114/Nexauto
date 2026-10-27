import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { buildPopularAliasIndex, groupsForPopularScope, popularGroupMatchesApplication } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const scopeArg = process.argv.find((arg) => arg.startsWith("--scope="))?.slice("--scope=".length) ?? "core75";
const popularGroups = groupsForPopularScope(scopeArg);
const scopeLabel = scopeArg === "extended80" ? "extended132" : scopeArg === "core75" ? "core103" : scopeArg;
const OUTPUT_DIR = path.resolve(ROOT, "outputs", `popular-${scopeLabel}-product-gaps-20261025`);
const FLEET50_FILE = path.resolve(ROOT, "outputs", "nz-fleet-popular50-20261025", "popular50-fleet-counts.csv");
loadEnv(path.resolve(ROOT, ".env.local"));

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const [makes, models, variants, applications, years, wiperFitments, configurationBlades, wiperSets,
  products, productVariants, productFitments, referenceFitments, partReferences] = await Promise.all([
  fetchAll("vehicle_catalog_makes", "make_id,name,status"),
  fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll("vehicle_catalog_variants", "variant_id,body_style,display_name"),
  fetchAll("vehicle_catalog_applications", "application_id,model_id,variant_id,status"),
  fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
  fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status"),
  fetchAll("wiper_configuration_blades", "wiper_configuration_id,position,length_in"),
  fetchAll("wiper_sets", "driver_length_in,passenger_length_in,active"),
  fetchAll("products", "id,category_slug"),
  fetchAll("product_variants", "id,product_id,sku"),
  fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status"),
  fetchAll("vehicle_catalog_part_reference_fitments", "application_id,part_reference_id,position,fitment_status"),
  fetchAll("catalog_part_references", "id,product_type")
]);

const activeApplications = applications.filter((row) => row.status === "active");
const activeApplicationIds = new Set(activeApplications.map((row) => row.application_id));
const applicationById = new Map(activeApplications.map((row) => [row.application_id, row]));
const modelById = new Map(models.filter((row) => row.status === "active").map((row) => [row.model_id, row]));
const makeById = new Map(makes.filter((row) => row.status === "active").map((row) => [row.make_id, row]));
const variantById = new Map(variants.map((row) => [row.variant_id, row]));
const popularIndex = buildPopularAliasIndex(popularGroups);

const applicationGroup = new Map();
const catalogModelsByGroup = new Map(popularGroups.map((group) => [group.id, new Set()]));
for (const application of activeApplications) {
  const model = modelById.get(application.model_id);
  const make = makeById.get(model?.make_id);
  const group = make && model ? popularIndex.get(canonicalModelKey(make.name, model.name)) : null;
  if (!group) continue;
  const variant = variantById.get(application.variant_id);
  if (!popularGroupMatchesApplication(group, { bodyStyle: variant?.body_style, variantName: variant?.display_name })) continue;
  applicationGroup.set(application.application_id, group);
  catalogModelsByGroup.get(group.id)?.add(`${make.name} ${model.name}`);
}

const scopedYears = years.filter((row) => {
  const year = Number(row.model_year);
  return activeApplicationIds.has(row.application_id)
    && applicationGroup.has(row.application_id)
    && year >= 2000 && year <= 2026;
});
const scopedApplicationIds = new Set(scopedYears.map((row) => row.application_id));

const productCategoryById = new Map(products.map((row) => [row.id, row.category_slug]));
const variantTypeById = new Map(productVariants.map((row) => [row.id, classifyVariant(row, productCategoryById)]));
const publishedProductFitments = productFitments.filter((row) => row.fitment_status === "published" && scopedApplicationIds.has(row.application_id));
const brakeProduct = new Set(publishedProductFitments
  .filter((row) => variantTypeById.get(row.product_variant_id) === "brake_pad")
  .map((row) => row.application_id));

const referenceTypeById = new Map(partReferences.map((row) => [row.id, row.product_type]));
const brakeReference = new Set(referenceFitments
  .filter((row) => row.fitment_status === "published"
    && scopedApplicationIds.has(row.application_id)
    && referenceTypeById.get(row.part_reference_id) === "brake_pad")
  .map((row) => row.application_id));
const brakeKnowledge = union(brakeProduct, brakeReference);

const publishedWiperFitments = wiperFitments.filter((row) => row.fitment_status === "published" && scopedApplicationIds.has(row.application_id));
const wiperKnowledge = new Set(publishedWiperFitments.map((row) => row.application_id));
const bladesByConfiguration = groupBy(configurationBlades, (row) => row.wiper_configuration_id);
const sellableFrontPairs = new Set(wiperSets.filter((row) => row.active).map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));
const sellableConfigurationIds = new Set();
for (const [configurationId, blades] of bladesByConfiguration) {
  const driver = blades.find((row) => row.position === "driver")?.length_in;
  const passenger = blades.find((row) => row.position === "passenger")?.length_in;
  if (driver && passenger && sellableFrontPairs.has(pairKey(driver, passenger))) sellableConfigurationIds.add(configurationId);
}
const wiperProduct = new Set(publishedWiperFitments
  .filter((row) => sellableConfigurationIds.has(row.wiper_configuration_id))
  .map((row) => row.application_id));

const baseFleetCounts = loadBaseFleetCounts(FLEET50_FILE);
const aliasFleetAdditions = new Map([[16, 47254], [31, 11801], [35, 7514]]);
const totalApplicationYears = scopedYears.length;
const rows = popularGroups.map((group) => {
  const yearRows = scopedYears.filter((row) => applicationGroup.get(row.application_id)?.id === group.id);
  const applicationIds = new Set(yearRows.map((row) => row.application_id));
  const fleetCount = group.fleetCount ?? ((baseFleetCounts.get(group.rank) ?? 0) + (aliasFleetAdditions.get(group.rank) ?? 0));
  const metrics = {
    wiper_product: metric(yearRows, applicationIds, wiperProduct),
    wiper_knowledge: metric(yearRows, applicationIds, wiperKnowledge),
    brake_product: metric(yearRows, applicationIds, brakeProduct),
    brake_knowledge: metric(yearRows, applicationIds, brakeKnowledge)
  };
  return {
    rank: group.rank,
    popular_group: group.label,
    tier: group.rank <= 50 ? "historical50" : "fleet_to_75",
    fleet_vehicles_2000_2026: fleetCount,
    catalog_models: [...(catalogModelsByGroup.get(group.id) ?? [])].sort().join(" | "),
    applications_total: applicationIds.size,
    application_years_total: yearRows.length,
    ...flattenMetrics(metrics),
    wiper_knowledge_uplift_if_closed_pp: percentagePoints(metrics.wiper_knowledge.application_years_missing, totalApplicationYears),
    wiper_product_uplift_if_closed_pp: percentagePoints(metrics.wiper_product.application_years_missing, totalApplicationYears),
    brake_knowledge_uplift_if_closed_pp: percentagePoints(metrics.brake_knowledge.application_years_missing, totalApplicationYears),
    brake_product_uplift_if_closed_pp: percentagePoints(metrics.brake_product.application_years_missing, totalApplicationYears),
    wiper_fleet_gap_proxy: Math.round(fleetCount * (100 - metrics.wiper_knowledge.application_year_coverage_percent) / 100),
    brake_fleet_gap_proxy: Math.round(fleetCount * (100 - metrics.brake_knowledge.application_year_coverage_percent) / 100),
    wiper_next_action: action(metrics.wiper_product, metrics.wiper_knowledge, "wiper"),
    brake_next_action: action(metrics.brake_product, metrics.brake_knowledge, "brake")
  };
});

const totals = {
  applications: scopedApplicationIds.size,
  application_years: scopedYears.length,
  wiper_product: metric(scopedYears, scopedApplicationIds, wiperProduct),
  wiper_knowledge: metric(scopedYears, scopedApplicationIds, wiperKnowledge),
  brake_product: metric(scopedYears, scopedApplicationIds, brakeProduct),
  brake_knowledge: metric(scopedYears, scopedApplicationIds, brakeKnowledge)
};

const report = {
  generated_at: new Date().toISOString(),
  scope: `${scopeLabel} (${popularGroups.length} groups), all active NexAuto applications, model years 2000-2026`,
  definitions: {
    application_year_coverage: "Each active application multiplied by each attached model year in 2000-2026.",
    wiper_product: "Published wiper configuration with an active sellable front pair.",
    wiper_knowledge: "Any published wiper configuration, including valid configurations without a sellable pair.",
    brake_product: "At least one published fitment to an NBP product; this is not a claim that both axles are covered.",
    brake_knowledge: "At least one published NBP product or published DB reference fitment; review/draft/rejected rows excluded.",
    fleet_gap_proxy: "Fleet count multiplied by the application-year knowledge gap rate; prioritization proxy, not an exact count of unsupported vehicles."
  },
  totals,
  priorities: {
    wiper_by_application_year_gap: top(rows, "wiper_knowledge_application_years_missing"),
    wiper_by_fleet_gap_proxy: top(rows, "wiper_fleet_gap_proxy"),
    brake_by_application_year_gap: top(rows, "brake_knowledge_application_years_missing"),
    brake_by_fleet_gap_proxy: top(rows, "brake_fleet_gap_proxy"),
    wiper_product_only_gap: top(rows, "wiper_product_without_knowledge_gap_years"),
    brake_product_only_gap: top(rows, "brake_product_without_knowledge_gap_years")
  },
  groups: rows
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-by-model.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-by-model.csv"), toCsv(rows));
console.log(JSON.stringify({ generated_at: report.generated_at, totals, priorities: report.priorities }, null, 2));

function metric(yearRows, denominatorApplicationIds, coveredIds) {
  const applicationsCovered = [...denominatorApplicationIds].filter((id) => coveredIds.has(id)).length;
  const applicationYearsCovered = yearRows.filter((row) => coveredIds.has(row.application_id)).length;
  const modelYearGroups = new Map();
  for (const row of yearRows) {
    const groupId = applicationGroup.get(row.application_id)?.id ?? "unknown";
    const key = `${groupId}|${row.model_year}`;
    const ids = modelYearGroups.get(key) ?? new Set();
    ids.add(row.application_id);
    modelYearGroups.set(key, ids);
  }
  const modelYearsAnyCovered = [...modelYearGroups.values()].filter((ids) => [...ids].some((id) => coveredIds.has(id))).length;
  const modelYearsFullyCovered = [...modelYearGroups.values()].filter((ids) => [...ids].every((id) => coveredIds.has(id))).length;
  return {
    applications_total: denominatorApplicationIds.size,
    applications_covered: applicationsCovered,
    applications_missing: denominatorApplicationIds.size - applicationsCovered,
    application_coverage_percent: percent(applicationsCovered, denominatorApplicationIds.size),
    application_years_total: yearRows.length,
    application_years_covered: applicationYearsCovered,
    application_years_missing: yearRows.length - applicationYearsCovered,
    application_year_coverage_percent: percent(applicationYearsCovered, yearRows.length),
    model_years_total: modelYearGroups.size,
    model_years_any_covered: modelYearsAnyCovered,
    model_year_any_coverage_percent: percent(modelYearsAnyCovered, modelYearGroups.size),
    model_years_fully_covered: modelYearsFullyCovered,
    model_year_full_coverage_percent: percent(modelYearsFullyCovered, modelYearGroups.size)
  };
}

function flattenMetrics(metrics) {
  const output = {};
  for (const [name, values] of Object.entries(metrics)) {
    output[`${name}_applications_covered`] = values.applications_covered;
    output[`${name}_applications_missing`] = values.applications_missing;
    output[`${name}_application_coverage_percent`] = values.application_coverage_percent;
    output[`${name}_application_years_covered`] = values.application_years_covered;
    output[`${name}_application_years_missing`] = values.application_years_missing;
    output[`${name}_application_year_coverage_percent`] = values.application_year_coverage_percent;
    output[`${name}_model_years_total`] = values.model_years_total;
    output[`${name}_model_years_any_covered`] = values.model_years_any_covered;
    output[`${name}_model_year_any_coverage_percent`] = values.model_year_any_coverage_percent;
    output[`${name}_model_years_fully_covered`] = values.model_years_fully_covered;
    output[`${name}_model_year_full_coverage_percent`] = values.model_year_full_coverage_percent;
  }
  output.wiper_product_without_knowledge_gap_years = metrics.wiper_product.application_years_missing - metrics.wiper_knowledge.application_years_missing;
  output.brake_product_without_knowledge_gap_years = metrics.brake_product.application_years_missing - metrics.brake_knowledge.application_years_missing;
  return output;
}

function action(product, knowledge, type) {
  const researchGap = knowledge.application_years_missing;
  const productOnlyGap = product.application_years_missing - researchGap;
  if (researchGap && productOnlyGap) return type === "wiper" ? "先补长度/底盘知识，再补可售前挡组合" : "先补DB/底盘知识，再建立NBP商品关联";
  if (researchGap) return type === "wiper" ? "补长度与底盘映射" : "补DB参考号与底盘映射";
  if (productOnlyGap) return type === "wiper" ? "知识已覆盖，新增可售前挡组合" : "知识已覆盖，建立或新增NBP商品";
  return "已覆盖，维护即可";
}

function top(values, field, limit = 20) {
  return [...values]
    .filter((row) => Number(row[field]) > 0)
    .sort((left, right) => Number(right[field]) - Number(left[field]) || left.rank - right.rank)
    .slice(0, limit)
    .map((row) => ({
      rank: row.rank,
      popular_group: row.popular_group,
      fleet_vehicles_2000_2026: row.fleet_vehicles_2000_2026,
      value: row[field],
      application_years_total: row.application_years_total,
      wiper_knowledge_percent: row.wiper_knowledge_application_year_coverage_percent,
      brake_knowledge_percent: row.brake_knowledge_application_year_coverage_percent
    }));
}

function loadBaseFleetCounts(file) {
  if (!fs.existsSync(file)) return new Map();
  return new Map(readCsv(file).map((row) => [Number(row.rank), Number(row.light_fleet_2000_2026)]));
}

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}

function classifyVariant(row, categoryByProduct) {
  const category = String(categoryByProduct.get(row.product_id) ?? "").toLowerCase();
  const sku = String(row.sku ?? "").toUpperCase();
  if (category === "filter" || category === "oil-filter" || /^NOF\d/.test(sku)) return "oil_filter";
  if (category === "brake-pad" || /^NBP\d/.test(sku)) return "brake_pad";
  return null;
}

function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const bucket = output.get(key) ?? [];
    bucket.push(value);
    output.set(key, bucket);
  }
  return output;
}
function pairKey(left, right) {
  const values = [Number(left), Number(right)].sort((a, b) => b - a);
  return `${values[0]}|${values[1]}`;
}
function percentagePoints(missing, denominator) { return denominator ? Number((100 * missing / denominator).toFixed(2)) : 0; }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0; }
function toCsv(values) {
  const headers = Object.keys(values[0] ?? {});
  return `\uFEFF${headers.join(",")}\r\n${values.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\r\n")}\r\n`;
}
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
async function fetchAll(table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
