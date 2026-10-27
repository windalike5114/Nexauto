import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { buildPopularAliasIndex, groupsForPopularScope, popularGroupMatchesApplication } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-brake-supplement-20261025");
const CENTRAL_REPORT = path.join(ROOT, "outputs", "popular-extended132-product-gaps-20261025", "coverage-by-model.json");
loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const groups = groupsForPopularScope("extended80");
const aliasIndex = buildPopularAliasIndex(groups);
const fleetByGroup = new Map((JSON.parse(fs.readFileSync(CENTRAL_REPORT, "utf8")).groups ?? [])
  .map((row) => [row.popular_group, Number(row.fleet_vehicles_2000_2026) || 0]));
const [makes, models, variants, applications, years, products, productVariants, productFitments,
  referenceFitments, references] = await Promise.all([
  fetchAll("vehicle_catalog_makes", "make_id,name,status"),
  fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll("vehicle_catalog_variants", "variant_id,body_style,display_name"),
  fetchAll("vehicle_catalog_applications", "application_id,model_id,variant_id,status"),
  fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
  fetchAll("products", "id,category_slug"),
  fetchAll("product_variants", "id,product_id,sku"),
  fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,fitment_status"),
  fetchAll("vehicle_catalog_part_reference_fitments", "application_id,part_reference_id,fitment_status,metadata"),
  fetchAll("catalog_part_references", "id,product_type"),
]);

const makeById = new Map(makes.filter((row) => row.status === "active").map((row) => [row.make_id, row]));
const modelById = new Map(models.filter((row) => row.status === "active").map((row) => [row.model_id, row]));
const variantById = new Map(variants.map((row) => [row.variant_id, row]));
const activeApplications = applications.filter((row) => row.status === "active");
const applicationGroup = new Map();
const applicationMake = new Map();
for (const application of activeApplications) {
  const model = modelById.get(application.model_id);
  const make = makeById.get(model?.make_id);
  const group = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
  if (!group) continue;
  const variant = variantById.get(application.variant_id);
  if (!popularGroupMatchesApplication(group, { bodyStyle: variant?.body_style, variantName: variant?.display_name })) continue;
  applicationGroup.set(application.application_id, group);
  applicationMake.set(application.application_id, make.name);
}

const scopedYears = years.filter((row) => {
  const year = Number(row.model_year);
  return year >= 2000 && year <= 2026 && applicationGroup.has(row.application_id);
});
const scopedApplicationIds = new Set(scopedYears.map((row) => row.application_id));
const productCategoryById = new Map(products.map((row) => [row.id, row.category_slug]));
const productVariantIsBrake = new Map(productVariants.map((row) => [row.id,
  productCategoryById.get(row.product_id) === "brake-pads" || /^NBP/i.test(row.sku)]));
const productCovered = new Set(productFitments.filter((row) => row.fitment_status === "published"
  && scopedApplicationIds.has(row.application_id) && productVariantIsBrake.get(row.product_variant_id))
  .map((row) => row.application_id));
const referenceIsBrake = new Map(references.map((row) => [row.id, row.product_type === "brake_pad"]));
const publishedBrakeReferences = referenceFitments.filter((row) => row.fitment_status === "published"
  && scopedApplicationIds.has(row.application_id) && referenceIsBrake.get(row.part_reference_id));
const anyReferenceCovered = new Set(publishedBrakeReferences.map((row) => row.application_id));
const deterministicReferenceCovered = new Set(publishedBrakeReferences.filter((row) => !isConditional(row.metadata))
  .map((row) => row.application_id));
const strictKnowledgeCovered = union(productCovered, deterministicReferenceCovered);
const reportedKnowledgeCovered = union(productCovered, anyReferenceCovered);
const conditionalOnly = new Set([...reportedKnowledgeCovered].filter((id) => !strictKnowledgeCovered.has(id)));

const groupRows = groups.map((group) => {
  const groupYears = scopedYears.filter((row) => applicationGroup.get(row.application_id)?.id === group.id);
  const total = groupYears.length;
  const strictMissing = groupYears.filter((row) => !strictKnowledgeCovered.has(row.application_id)).length;
  const reportedMissing = groupYears.filter((row) => !reportedKnowledgeCovered.has(row.application_id)).length;
  const conditionalYears = groupYears.filter((row) => conditionalOnly.has(row.application_id)).length;
  const productMissing = groupYears.filter((row) => !productCovered.has(row.application_id)).length;
  const deterministicProductGap = groupYears.filter((row) => strictKnowledgeCovered.has(row.application_id)
    && !productCovered.has(row.application_id)).length;
  const fleet = fleetByGroup.get(group.label) ?? 0;
  return {
    rank: group.rank,
    popular_group: group.label,
    fleet_vehicles_2000_2026: fleet,
    application_years_total: total,
    strict_knowledge_application_years_missing: strictMissing,
    strict_knowledge_coverage_percent: percent(total - strictMissing, total),
    conditional_only_application_years: conditionalYears,
    reported_knowledge_application_years_missing: reportedMissing,
    reported_knowledge_coverage_percent: percent(total - reportedMissing, total),
    deterministic_product_gap_application_years: deterministicProductGap,
    product_application_years_missing: productMissing,
    product_coverage_percent: percent(total - productMissing, total),
    commercial_gap_proxy: Math.round(fleet * percentRaw(strictMissing, total)),
    priority: strictMissing >= 100 || Math.round(fleet * percentRaw(strictMissing, total)) >= 5000 ? "P0"
      : strictMissing >= 30 || deterministicProductGap >= 100 ? "P1" : strictMissing || deterministicProductGap ? "P2" : "maintain",
  };
}).filter((row) => row.application_years_total > 0);

const brandMap = new Map();
for (const row of scopedYears) {
  const make = applicationMake.get(row.application_id) ?? "UNKNOWN";
  const item = brandMap.get(make) ?? { brand: make, application_years_total: 0,
    strict_knowledge_application_years_missing: 0, conditional_only_application_years: 0,
    deterministic_product_gap_application_years: 0, product_application_years_missing: 0 };
  item.application_years_total += 1;
  if (!strictKnowledgeCovered.has(row.application_id)) item.strict_knowledge_application_years_missing += 1;
  if (conditionalOnly.has(row.application_id)) item.conditional_only_application_years += 1;
  if (strictKnowledgeCovered.has(row.application_id) && !productCovered.has(row.application_id)) item.deterministic_product_gap_application_years += 1;
  if (!productCovered.has(row.application_id)) item.product_application_years_missing += 1;
  brandMap.set(make, item);
}
const brandRows = [...brandMap.values()].map((row) => ({ ...row,
  strict_knowledge_coverage_percent: percent(row.application_years_total - row.strict_knowledge_application_years_missing, row.application_years_total),
  product_coverage_percent: percent(row.application_years_total - row.product_application_years_missing, row.application_years_total),
})).sort((a, b) => b.strict_knowledge_application_years_missing - a.strict_knowledge_application_years_missing);

const totals = {
  application_years: scopedYears.length,
  strict_knowledge_missing: scopedYears.filter((row) => !strictKnowledgeCovered.has(row.application_id)).length,
  strict_knowledge_coverage_percent: percent(scopedYears.filter((row) => strictKnowledgeCovered.has(row.application_id)).length, scopedYears.length),
  conditional_only_application_years: scopedYears.filter((row) => conditionalOnly.has(row.application_id)).length,
  reported_knowledge_missing: scopedYears.filter((row) => !reportedKnowledgeCovered.has(row.application_id)).length,
  reported_knowledge_coverage_percent: percent(scopedYears.filter((row) => reportedKnowledgeCovered.has(row.application_id)).length, scopedYears.length),
  deterministic_product_gap_application_years: scopedYears.filter((row) => strictKnowledgeCovered.has(row.application_id) && !productCovered.has(row.application_id)).length,
  product_missing: scopedYears.filter((row) => !productCovered.has(row.application_id)).length,
  product_coverage_percent: percent(scopedYears.filter((row) => productCovered.has(row.application_id)).length, scopedYears.length),
};

const report = {
  generated_at: new Date().toISOString(),
  scope: "Extended132, active NexAuto application-years 2000-2026",
  definitions: {
    strict_knowledge: "Published NBP product or deterministic published brake-pad reference. Conditional one-of rows are excluded.",
    conditional_only: "Published search candidates requiring PR code/caliper/disc/OE-package confirmation and lacking deterministic knowledge.",
    deterministic_product_gap: "Deterministic knowledge exists but no published NBP product fitment exists.",
  },
  totals,
  priority_models_by_coverage_gap: [...groupRows].filter((row) => row.strict_knowledge_application_years_missing > 0)
    .sort((a, b) => b.strict_knowledge_application_years_missing - a.strict_knowledge_application_years_missing),
  priority_models_by_commercial_gap: [...groupRows].filter((row) => row.strict_knowledge_application_years_missing > 0)
    .sort((a, b) => b.commercial_gap_proxy - a.commercial_gap_proxy),
  product_gap_models: [...groupRows].filter((row) => row.deterministic_product_gap_application_years > 0)
    .sort((a, b) => b.deterministic_product_gap_application_years - a.deterministic_product_gap_application_years),
  brands: brandRows,
  groups: groupRows,
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "models.csv"), toCsv(groupRows));
fs.writeFileSync(path.join(OUTPUT_DIR, "brands.csv"), toCsv(brandRows));
console.log(JSON.stringify({ generated_at: report.generated_at, totals,
  top_coverage: report.priority_models_by_coverage_gap.slice(0, 25),
  top_commercial: report.priority_models_by_commercial_gap.slice(0, 20),
  top_product: report.product_gap_models.slice(0, 20),
  top_brands: report.brands.slice(0, 20) }, null, 2));

function isConditional(metadata) {
  return metadata?.selection_mode === "conditional_one_of"
    || metadata?.configuration_confirmation_required === true
    || metadata?.exact_knowledge_coverage === false;
}
function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function percent(value, total) { return total ? Math.round(value * 10000 / total) / 100 : 0; }
function percentRaw(value, total) { return total ? value / total : 0; }
async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
function toCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${columns.map(quote).join(",")}\n${rows.map((row) => columns.map((column) => quote(row[column])).join(",")).join("\n")}\n`;
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
