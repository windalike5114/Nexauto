import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { buildPopularAliasIndex, groupsForPopularScope, popularGroupMatchesApplication } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "product-knowledge-coverage-20261025");
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
  fetchAll("vehicle_catalog_part_reference_fitments", "application_id,part_reference_id,position,fitment_status,match_reasons,metadata"),
  fetchAll("catalog_part_references", "id,product_type")
]);

const activeApplications = applications.filter((row) => row.status === "active");
const activeApplicationIds = new Set(activeApplications.map((row) => row.application_id));
const activeYears = years.filter((row) => activeApplicationIds.has(row.application_id));
const applicationById = new Map(activeApplications.map((row) => [row.application_id, row]));
const modelById = new Map(models.filter((row) => row.status === "active").map((row) => [row.model_id, row]));
const makeById = new Map(makes.filter((row) => row.status === "active").map((row) => [row.make_id, row]));
const variantById = new Map(variants.map((row) => [row.variant_id, row]));

const productCategoryById = new Map(products.map((row) => [row.id, row.category_slug]));
const variantTypeById = new Map(productVariants.map((row) => [row.id, classifyVariant(row, productCategoryById)]));
const publishedProductFitments = productFitments.filter((row) =>
  row.fitment_status === "published" && activeApplicationIds.has(row.application_id));

const oilFilterProduct = applicationSet(publishedProductFitments.filter((row) =>
  variantTypeById.get(row.product_variant_id) === "oil_filter"));
const brakePadProduct = applicationSet(publishedProductFitments.filter((row) =>
  variantTypeById.get(row.product_variant_id) === "brake_pad"));

const referenceTypeById = new Map(partReferences.map((row) => [row.id, row.product_type]));
const referenceKnowledgeFor = (type) => applicationSet(referenceFitments.filter((row) =>
  row.fitment_status === "published" && activeApplicationIds.has(row.application_id)
  && referenceTypeById.get(row.part_reference_id) === type
  && row.metadata?.selection_mode !== "conditional_one_of"));
const oilFilterReferenceKnowledge = referenceKnowledgeFor("oil_filter");
const airFilterReferenceKnowledge = referenceKnowledgeFor("air_filter");
const airFilterProduct = applicationSet(publishedProductFitments.filter((row) =>
  variantTypeById.get(row.product_variant_id) === "air_filter"));
const publishedBrakePadReferenceRows = referenceFitments.filter((row) =>
  row.fitment_status === "published" && activeApplicationIds.has(row.application_id)
  && referenceTypeById.get(row.part_reference_id) === "brake_pad");
const brakePadReferenceKnowledge = applicationSet(publishedBrakePadReferenceRows);
const brakePadConditionalReferenceKnowledge = applicationSet(publishedBrakePadReferenceRows.filter((row) =>
  row.metadata?.selection_mode === "conditional_one_of"
  || (row.match_reasons ?? []).includes("evidence_backed_multiple_brake_configurations")));
const brakePadDeterministicReferenceKnowledge = applicationSet(publishedBrakePadReferenceRows.filter((row) =>
  row.metadata?.selection_mode !== "conditional_one_of"
  && !(row.match_reasons ?? []).includes("evidence_backed_multiple_brake_configurations")));
const brakePadKnowledge = union(brakePadProduct, brakePadReferenceKnowledge);

const publishedWiperFitments = wiperFitments.filter((row) =>
  row.fitment_status === "published" && activeApplicationIds.has(row.application_id));
const wiperKnowledge = applicationSet(publishedWiperFitments);
const bladesByConfiguration = groupBy(configurationBlades, (row) => row.wiper_configuration_id);
const sellableFrontPairs = new Set(wiperSets.filter((row) => row.active)
  .map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));
const sellableWiperConfigurationIds = new Set();
for (const [configurationId, blades] of bladesByConfiguration) {
  const driver = blades.find((row) => row.position === "driver")?.length_in;
  const passenger = blades.find((row) => row.position === "passenger")?.length_in;
  if (driver && passenger && sellableFrontPairs.has(pairKey(driver, passenger))) {
    sellableWiperConfigurationIds.add(configurationId);
  }
}
const wiperProduct = applicationSet(publishedWiperFitments.filter((row) =>
  sellableWiperConfigurationIds.has(row.wiper_configuration_id)));

const coreScope = popularScope(groupsForPopularScope("core75"));
const extendedScope = popularScope(groupsForPopularScope("extended80"));

const lines = {
  wiper: { product: wiperProduct, knowledge: wiperKnowledge },
  oil_filter: { product: oilFilterProduct, knowledge: union(oilFilterProduct, oilFilterReferenceKnowledge) },
  air_filter: { product: airFilterProduct, knowledge: union(airFilterProduct, airFilterReferenceKnowledge) },
  brake_pad: { product: brakePadProduct, knowledge: brakePadKnowledge }
};

const report = {
  generated_at: new Date().toISOString(),
  denominator_policy: {
    all: "All status=active NexAuto applications and every attached model_year.",
    popular_core_103: "The default core 103 model groups, aliases and application body filters applied, model years 2000-2026 inclusive; selected to represent about 75% of the New Zealand light fleet.",
    popular_extended_132: "The extended 132 model groups, aliases and application body filters applied, model years 2000-2026 inclusive; selected to represent about 80% of the New Zealand light fleet.",
    product_coverage: "Published fitment to a real product. Wiper requires an active sellable front-pair matching the published configuration; brake pad requires at least one published NBP position.",
    knowledge_coverage: "Published, reliable fitment knowledge whether or not a sellable SKU exists. Review/draft/rejected rows are excluded. Evidence-backed conditional one-of brake configurations are included but reported separately.",
    oil_filter_note: "Oil filter knowledge includes independently published Ryco reference fitments. Air filters have a separate reference-only product line pending formal NexAuto products."
  },
  catalog: {
    active_applications: activeApplicationIds.size,
    active_application_years: activeYears.length,
    popular_core_103_applications_2000_2026: coreScope.applicationIdsWithYears.size,
    popular_core_103_application_years_2000_2026: coreScope.years.length,
    popular_extended_132_applications_2000_2026: extendedScope.applicationIdsWithYears.size,
    popular_extended_132_application_years_2000_2026: extendedScope.years.length,
    popular_core_103_groups_present: coreScope.groupsPresent.size,
    popular_extended_132_groups_present: extendedScope.groupsPresent.size
  },
  all_application_years: summarizeLines(activeYears, activeApplicationIds, lines),
  popular_core_103_2000_2026: summarizeLines(coreScope.years, coreScope.applicationIdsWithYears, lines),
  popular_extended_132_2000_2026: summarizeLines(extendedScope.years, extendedScope.applicationIdsWithYears, lines),
  reference_detail: {
    oil_filter_published_reference_applications: oilFilterReferenceKnowledge.size,
    air_filter_published_reference_applications: airFilterReferenceKnowledge.size,
    brake_pad_published_reference_applications: brakePadReferenceKnowledge.size,
    brake_pad_deterministic_reference_applications: brakePadDeterministicReferenceKnowledge.size,
    brake_pad_conditional_one_of_reference_applications: brakePadConditionalReferenceKnowledge.size,
    brake_pad_conditional_one_of_all_application_years: metric(activeYears, activeApplicationIds, brakePadConditionalReferenceKnowledge),
    brake_pad_conditional_one_of_core_103_2000_2026: metric(coreScope.years, coreScope.applicationIdsWithYears, brakePadConditionalReferenceKnowledge),
    brake_pad_conditional_one_of_extended_132_2000_2026: metric(extendedScope.years, extendedScope.applicationIdsWithYears, brakePadConditionalReferenceKnowledge),
    brake_pad_product_applications: brakePadProduct.size,
    brake_pad_knowledge_applications: brakePadKnowledge.size,
    wiper_published_knowledge_applications: wiperKnowledge.size,
    wiper_sellable_front_pair_applications: wiperProduct.size,
    sellable_front_pair_configurations: sellableWiperConfigurationIds.size
  }
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-summary.csv"), summaryCsv(report));
console.log(JSON.stringify(report, null, 2));

function summarizeLines(yearRows, denominatorApplicationIds, definitions) {
  return Object.fromEntries(Object.entries(definitions).map(([name, sets]) => {
    const product = metric(yearRows, denominatorApplicationIds, sets.product);
    const knowledge = metric(yearRows, denominatorApplicationIds, sets.knowledge);
    return [name, {
      product,
      knowledge,
      knowledge_gain_application_years: knowledge.application_years_covered - product.application_years_covered,
      knowledge_gain_percentage_points: Number((knowledge.application_year_coverage_percent - product.application_year_coverage_percent).toFixed(2))
    }];
  }));
}

function popularScope(groups) {
  const aliases = buildPopularAliasIndex(groups);
  const applicationIds = new Set();
  const groupsPresent = new Set();
  for (const application of activeApplications) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const group = make && model ? aliases.get(canonicalModelKey(make.name, model.name)) : null;
    const variant = variantById.get(application.variant_id);
    if (!group || !popularGroupMatchesApplication(group, { bodyStyle: variant?.body_style, variantName: variant?.display_name })) continue;
    applicationIds.add(application.application_id);
    groupsPresent.add(group.id);
  }
  const scopeYears = activeYears.filter((row) => applicationIds.has(row.application_id) && Number(row.model_year) >= 2000 && Number(row.model_year) <= 2026);
  return { years: scopeYears, applicationIdsWithYears: new Set(scopeYears.map((row) => row.application_id)), groupsPresent };
}

function metric(yearRows, denominatorApplicationIds, coveredIds) {
  const applicationsCovered = [...denominatorApplicationIds].filter((id) => coveredIds.has(id)).length;
  const applicationYearsCovered = yearRows.filter((row) => coveredIds.has(row.application_id)).length;
  return {
    applications_total: denominatorApplicationIds.size,
    applications_covered: applicationsCovered,
    application_coverage_percent: percent(applicationsCovered, denominatorApplicationIds.size),
    application_years_total: yearRows.length,
    application_years_covered: applicationYearsCovered,
    application_year_coverage_percent: percent(applicationYearsCovered, yearRows.length)
  };
}

function classifyVariant(row, categoryByProduct) {
  const category = String(categoryByProduct.get(row.product_id) ?? "").toLowerCase();
  const sku = String(row.sku ?? "").toUpperCase();
  if (category === "air-filter") return "air_filter";
  if (category === "filter" || category === "oil-filter" || /^NOF\d/.test(sku)) return "oil_filter";
  if (category === "brake-pad" || /^NBP\d/.test(sku)) return "brake_pad";
  return null;
}

function applicationSet(rows) { return new Set(rows.map((row) => row.application_id)); }
function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function pairKey(left, right) {
  const values = [Number(left), Number(right)].sort((a, b) => b - a);
  return `${values[0]}|${values[1]}`;
}
function groupBy(rows, keyFn) {
  const output = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = output.get(key) ?? [];
    values.push(row);
    output.set(key, values);
  }
  return output;
}
function percent(numerator, denominator) {
  return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0;
}
function summaryCsv(report) {
  const rows = [];
  for (const [scope, linesInScope] of [["all_application_years", report.all_application_years], ["popular_core_103_2000_2026", report.popular_core_103_2000_2026],
    ["popular_extended_132_2000_2026", report.popular_extended_132_2000_2026]]) {
    for (const [productLine, values] of Object.entries(linesInScope)) {
      for (const coverageType of ["product", "knowledge"]) {
        rows.push({ scope, product_line: productLine, coverage_type: coverageType, ...values[coverageType] });
      }
    }
  }
  const headers = Object.keys(rows[0]);
  return `\uFEFF${headers.join(",")}\r\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\r\n")}\r\n`;
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
