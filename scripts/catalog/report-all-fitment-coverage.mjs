import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { DEFAULT_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "catalog-fitment-coverage-20261024");
loadEnv(path.resolve(ROOT, ".env.local"));

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [makes, models, applications, years, wiperFitments, productFitments, variants] = await Promise.all([
  fetchAll("vehicle_catalog_makes", "make_id,name,status"),
  fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll("vehicle_catalog_applications", "application_id,model_id,status"),
  fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
  fetchAll("vehicle_catalog_wiper_fitments", "application_id,fitment_status"),
  fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,fitment_status,notes"),
  fetchAll("product_variants", "id,sku,products(slug,category_slug)"),
]);

const activeMakes = makes.filter((row) => row.status === "active");
const activeModels = models.filter((row) => row.status === "active");
const activeApplications = applications.filter((row) => row.status === "active");
const activeApplicationIds = new Set(activeApplications.map((row) => row.application_id));
const activeModelIds = new Set(activeModels.map((row) => row.model_id));
const activeYears = years.filter((row) => activeApplicationIds.has(row.application_id));
const modelById = new Map(activeModels.map((row) => [row.model_id, row]));
const makeById = new Map(activeMakes.map((row) => [row.make_id, row]));
const applicationById = new Map(activeApplications.map((row) => [row.application_id, row]));
const productTypeByVariantId = new Map(variants.map((row) => [row.id, classifyVariant(row)]));

const covered = {
  wiper: new Set(wiperFitments
    .filter((row) => row.fitment_status === "published" && activeApplicationIds.has(row.application_id))
    .map((row) => row.application_id)),
  oil_filter: new Set(productFitments
    .filter((row) => row.fitment_status === "published" && activeApplicationIds.has(row.application_id) && fitmentType(row) === "oil_filter")
    .map((row) => row.application_id)),
  brake_pad: new Set(productFitments
    .filter((row) => row.fitment_status === "published" && activeApplicationIds.has(row.application_id) && fitmentType(row) === "brake_pad")
    .map((row) => row.application_id)),
};

const allModelYears = buildModelYearGroups(activeYears);
const popularModelYears = buildPopularModelYearGroups(activeYears, 2000, 2026);
const popularApplicationIds = new Set([...popularModelYears.values()].flatMap((group) => [...group.applicationIds]));
const popularYears = activeYears.filter((row) => {
  const year = Number(row.model_year);
  return year >= 2000 && year <= 2026 && popularApplicationIds.has(row.application_id);
});

const report = {
  generated_at: new Date().toISOString(),
  denominator_policy: {
    catalog: "status=active 的车型库记录；application-year 按每个 application 的每个年份计数",
    fitment: "fitment_status=published；候选、review、draft、rejected 均不计入覆盖",
    model_year_any: "同品牌车型年份下至少一个 application 已覆盖",
    model_year_full: "同品牌车型年份下所有车身/发动机/版本 application 均覆盖",
    popular: "默认核心103个热门车型组，2000-2026，别名按 popular-vehicle-models.mjs 合并；目标约覆盖新西兰轻型车fleet的75%",
  },
  catalog: {
    active_makes: activeMakes.length,
    active_models: activeModels.length,
    active_applications: activeApplications.length,
    active_application_years: activeYears.length,
    model_years: allModelYears.size,
    year_min: activeYears.reduce((min, row) => Math.min(min, Number(row.model_year)), Infinity),
    year_max: activeYears.reduce((max, row) => Math.max(max, Number(row.model_year)), -Infinity),
    models_referenced_by_active_applications: new Set(activeApplications.filter((row) => activeModelIds.has(row.model_id)).map((row) => row.model_id)).size,
  },
  all_years: Object.fromEntries(Object.entries(covered).map(([type, ids]) => [type, summarizeCoverage({
    applicationIds: activeApplicationIds,
    yearRows: activeYears,
    modelYearGroups: allModelYears,
    coveredIds: ids,
  })])),
  popular_core_103_2000_2026: {
    model_groups_requested: DEFAULT_POPULAR_VEHICLE_GROUPS.length,
    model_groups_present: new Set([...popularModelYears.values()].map((group) => group.popularId)).size,
    model_groups_without_catalog_years: DEFAULT_POPULAR_VEHICLE_GROUPS
      .filter((definition) => ![...popularModelYears.values()].some((group) => group.popularId === definition.id))
      .map((definition) => definition.label),
    distinct_applications: popularApplicationIds.size,
    application_years: popularYears.length,
    model_years: popularModelYears.size,
    coverage: Object.fromEntries(Object.entries(covered).map(([type, ids]) => [type, summarizeCoverage({
      applicationIds: popularApplicationIds,
      yearRows: popularYears,
      modelYearGroups: popularModelYears,
      coveredIds: ids,
    })])),
  },
  product_variant_classification: {
    oil_filter_variants: [...productTypeByVariantId.values()].filter((value) => value === "oil_filter").length,
    brake_pad_variants: [...productTypeByVariantId.values()].filter((value) => value === "brake_pad").length,
    unclassified_variants: [...productTypeByVariantId.values()].filter((value) => value === null).length,
    published_product_fitments_unclassified: productFitments.filter((row) => row.fitment_status === "published" && !fitmentType(row)).length,
  },
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-report.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-summary.csv"), summaryCsv(report));
console.log(JSON.stringify(report, null, 2));

function fitmentType(row) {
  const mapped = productTypeByVariantId.get(row.product_variant_id);
  if (mapped) return mapped;
  const match = String(row.notes ?? "").match(/(?:^|;)\s*product_type=(oil_filter|brake_pad)(?:;|$)/i);
  return match ? match[1].toLowerCase() : null;
}

function classifyVariant(row) {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  const slug = String(product?.slug ?? "").toLowerCase();
  const category = String(product?.category_slug ?? "").toLowerCase();
  const sku = String(row.sku ?? "").toUpperCase();
  if (slug.startsWith("oil-filter-") || category === "oil-filter" || /^NOF\d/.test(sku)) return "oil_filter";
  if (slug.startsWith("brake-pad-") || category === "brake-pad" || /^NBP\d/.test(sku)) return "brake_pad";
  return null;
}

function buildModelYearGroups(yearRows) {
  const groups = new Map();
  for (const row of yearRows) {
    const application = applicationById.get(row.application_id);
    const model = modelById.get(application?.model_id);
    const make = makeById.get(model?.make_id);
    if (!application || !model || !make) continue;
    const year = Number(row.model_year);
    const key = `${canonicalModelKey(make.name, model.name)}|${year}`;
    const group = groups.get(key) ?? { make: make.name, model: model.name, year, applicationIds: new Set() };
    group.applicationIds.add(row.application_id);
    groups.set(key, group);
  }
  return groups;
}

function buildPopularModelYearGroups(yearRows, yearFrom, yearTo) {
  const aliases = buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS);
  const groups = new Map();
  for (const row of yearRows) {
    const year = Number(row.model_year);
    if (year < yearFrom || year > yearTo) continue;
    const application = applicationById.get(row.application_id);
    const model = modelById.get(application?.model_id);
    const make = makeById.get(model?.make_id);
    if (!application || !model || !make) continue;
    const popular = aliases.get(canonicalModelKey(make.name, model.name));
    if (!popular) continue;
    const key = `${popular.id}|${year}`;
    const group = groups.get(key) ?? { popularId: popular.id, label: popular.label, year, applicationIds: new Set() };
    group.applicationIds.add(row.application_id);
    groups.set(key, group);
  }
  return groups;
}

function summarizeCoverage({ applicationIds, yearRows, modelYearGroups, coveredIds }) {
  const coveredApplications = [...applicationIds].filter((id) => coveredIds.has(id)).length;
  const coveredApplicationYears = yearRows.filter((row) => coveredIds.has(row.application_id)).length;
  let anyModelYears = 0;
  let fullModelYears = 0;
  for (const group of modelYearGroups.values()) {
    const groupIds = [...group.applicationIds];
    const count = groupIds.filter((id) => coveredIds.has(id)).length;
    if (count > 0) anyModelYears += 1;
    if (groupIds.length > 0 && count === groupIds.length) fullModelYears += 1;
  }
  return {
    applications_total: applicationIds.size,
    applications_covered: coveredApplications,
    application_coverage_percent: percent(coveredApplications, applicationIds.size),
    application_years_total: yearRows.length,
    application_years_covered: coveredApplicationYears,
    application_year_coverage_percent: percent(coveredApplicationYears, yearRows.length),
    model_years_total: modelYearGroups.size,
    model_years_any_covered: anyModelYears,
    model_year_any_coverage_percent: percent(anyModelYears, modelYearGroups.size),
    model_years_fully_covered: fullModelYears,
    model_year_full_coverage_percent: percent(fullModelYears, modelYearGroups.size),
  };
}

function summaryCsv(report) {
  const rows = [];
  for (const [scope, values] of [["all_years", report.all_years], ["popular_core_103_2000_2026", report.popular_core_103_2000_2026.coverage]]) {
    for (const [productType, metrics] of Object.entries(values)) rows.push({ scope, product_type: productType, ...metrics });
  }
  const headers = Object.keys(rows[0]);
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const string = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

function percent(numerator, denominator) {
  return denominator ? Number((100 * numerator / denominator).toFixed(1)) : 0;
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
