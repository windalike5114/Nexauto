import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const TARGET_IDS = [
  "ap_703a6d37fcf57f1c7794",
  "ap_085a2b2720384058ea78",
  "ap_da0fc06d3f96a8a79953",
];

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const applications = await selectIn("vehicle_catalog_applications", "application_id", TARGET_IDS);
const modelIds = [...new Set(applications.map((row) => row.model_id))];
const seriesIds = [...new Set(applications.map((row) => row.series_id).filter(Boolean))];
const variantIds = [...new Set(applications.map((row) => row.variant_id).filter(Boolean))];
const powertrainIds = [...new Set(applications.map((row) => row.powertrain_id).filter(Boolean))];

const [years, models, allModels, series, variants, powertrains, engineLinks, engineCodes,
  productFitments, wiperFitments, referenceFitments, provenance, customerVehicles, orderItems,
  orderSnapshots, orderWipers, schemes, sources, allProductVariants, allProducts] = await Promise.all([
  selectIn("vehicle_catalog_application_years", "application_id", TARGET_IDS),
  selectIn("vehicle_catalog_models", "model_id", modelIds),
  fetchMany("vehicle_catalog_models", (query) => query.ilike("name", "%COROLLA%")),
  selectIn("vehicle_catalog_series", "series_id", seriesIds),
  selectIn("vehicle_catalog_variants", "variant_id", variantIds),
  selectIn("vehicle_catalog_powertrains", "powertrain_id", powertrainIds),
  selectIn("vehicle_catalog_powertrain_engine_codes", "powertrain_id", powertrainIds),
  fetchAll("vehicle_catalog_engine_codes"),
  selectIn("vehicle_catalog_product_fitments", "application_id", TARGET_IDS),
  selectIn("vehicle_catalog_wiper_fitments", "application_id", TARGET_IDS),
  selectIn("vehicle_catalog_part_reference_fitments", "application_id", TARGET_IDS),
  selectIn("vehicle_catalog_application_provenance", "application_id", TARGET_IDS),
  selectIn("customer_vehicles", "vehicle_catalog_application_id", TARGET_IDS),
  selectIn("order_items", "vehicle_catalog_application_id", TARGET_IDS),
  selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", TARGET_IDS),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", TARGET_IDS),
  fetchAll("catalog_reference_schemes"),
  fetchAll("catalog_data_sources"),
  fetchAll("product_variants"),
  fetchAll("products"),
]);

const modelById = new Map(models.map((row) => [row.model_id, row]));
const seriesById = new Map(series.map((row) => [row.series_id, row]));
const variantById = new Map(variants.map((row) => [row.variant_id, row]));
const powertrainById = new Map(powertrains.map((row) => [row.powertrain_id, row]));
const engineCodeById = new Map(engineCodes.map((row) => [row.engine_code_id, row.code]));
const engineCodesByPowertrain = Map.groupBy(engineLinks, (row) => row.powertrain_id);
const yearsByApp = Map.groupBy(years, (row) => row.application_id);
const productVariantById = new Map(allProductVariants.map((row) => [row.id, row]));
const productById = new Map(allProducts.map((row) => [row.id, row]));
const summarize = (rows, field) => Object.fromEntries(TARGET_IDS.map((id) => [id, rows.filter((row) => row[field] === id).length]));

const targetDetails = applications.map((row) => ({
  application: row,
  model: modelById.get(row.model_id),
  series: seriesById.get(row.series_id),
  variant: variantById.get(row.variant_id),
  powertrain: powertrainById.get(row.powertrain_id),
  engine_codes: (engineCodesByPowertrain.get(row.powertrain_id) ?? []).map((item) => engineCodeById.get(item.engine_code_id)).sort(),
  years: (yearsByApp.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b),
}));

const versus = allModels.filter((row) => /COROLLA\s+VERSO/i.test(row.name));
const versoSeries = versus.length ? await selectIn("vehicle_catalog_series", "model_id", versus.map((row) => row.model_id)) : [];
const versoApplications = versus.length ? await selectIn("vehicle_catalog_applications", "model_id", versus.map((row) => row.model_id)) : [];

const result = {
  generated_at: new Date().toISOString(),
  targetDetails,
  corollaModels: allModels,
  corollaVersoModels: versus,
  corollaVersoSeries: versoSeries,
  corollaVersoApplications: versoApplications,
  childCounts: {
    productFitments: summarize(productFitments, "application_id"),
    wiperFitments: summarize(wiperFitments, "application_id"),
    referenceFitments: summarize(referenceFitments, "application_id"),
    provenance: summarize(provenance, "application_id"),
  },
  productFitmentDetails: productFitments.map((row) => {
    const variant = productVariantById.get(row.product_variant_id);
    const product = productById.get(variant?.product_id);
    return { ...row, sku: variant?.sku, product_name: product?.name, category_slug: product?.category_slug };
  }),
  commerceReferences: {
    customerVehicles: summarize(customerVehicles, "vehicle_catalog_application_id"),
    orderItems: summarize(orderItems, "vehicle_catalog_application_id"),
    orderSnapshots: summarize(orderSnapshots, "vehicle_catalog_application_id"),
    orderWipers: summarize(orderWipers, "vehicle_catalog_application_id"),
  },
  brakeReferenceSchemes: schemes.filter((row) => row.product_type === "brake_pad"),
  relevantSources: sources.filter((row) => /TOYOTA|AKEBONO|BENDIX/i.test(`${row.code} ${row.name}`)),
};

const out = path.join(ROOT, "outputs", "brake-search-resolvable-20261025", "corolla-preflight.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ out: path.relative(ROOT, out), targets: targetDetails, versoModels: versus,
  versoSeriesCount: versoSeries.length, versoApplicationsCount: versoApplications.length,
  childCounts: result.childCounts, commerceReferences: result.commerceReferences,
  brakeReferenceSchemes: result.brakeReferenceSchemes, relevantSources: result.relevantSources }, null, 2));

async function fetchAll(table) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("*").range(from, from + 999);
    if (error) throw error;
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}
async function fetchMany(table, filter) { const { data, error } = await filter(db.from(table).select("*")); if (error) throw error; return data ?? []; }
async function selectIn(table, field, values) {
  if (!values.length) return [];
  const output = [];
  for (let index = 0; index < values.length; index += 50) {
    const { data, error } = await db.from(table).select("*").in(field, values.slice(index, index + 50));
    if (error) throw error;
    output.push(...(data ?? []));
  }
  return output;
}
function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
