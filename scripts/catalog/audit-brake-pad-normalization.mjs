import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [brakeProducts, oilProducts] = await Promise.all([
  fetchAll("products", "id,slug,name,category_slug,active", (query) => query.like("slug", "brake-pad-%")),
  fetchAll("products", "id,slug,name,category_slug,active", (query) => query.like("slug", "oil-filter-%")),
]);
const [brakeVariants, oilVariants] = await Promise.all([
  selectInChunks("product_variants", "id,product_id,sku,attributes,active", "product_id", brakeProducts.map((row) => row.id)),
  selectInChunks("product_variants", "id,product_id,sku,attributes,active", "product_id", oilProducts.map((row) => row.id)),
]);

const [brakeSpecs, oilSpecs, brakeIdentifiers, oilIdentifiers, allFitments] = await Promise.all([
  safeSelectInChunks("brake_pad_variant_specs", "*", "product_variant_id", brakeVariants.map((row) => row.id)),
  safeSelectInChunks("filter_variant_specs", "*", "product_variant_id", oilVariants.map((row) => row.id)),
  safeSelectInChunks("product_identifiers", "product_variant_id,identifier_type,identifier_brand,identifier_value,normalized_value,is_primary,verification_status,metadata", "product_variant_id", brakeVariants.map((row) => row.id)),
  safeSelectInChunks("product_identifiers", "product_variant_id,identifier_type,identifier_brand,identifier_value,normalized_value,is_primary,verification_status,metadata", "product_variant_id", oilVariants.map((row) => row.id)),
  fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status,source"),
]);
const brakeVariantIds = new Set(brakeVariants.map((row) => row.id));
const oilVariantIds = new Set(oilVariants.map((row) => row.id));
const brakeFitments = allFitments.filter((row) => brakeVariantIds.has(row.product_variant_id));
const oilFitments = allFitments.filter((row) => oilVariantIds.has(row.product_variant_id));

const brakeCatalog = JSON.parse(fs.readFileSync(path.resolve("data/brake-pads/catalog.json"), "utf8"));
const brakeCatalogBySku = new Map(brakeCatalog.map((row) => [row.sku, row]));
const report = {
  checked_at: new Date().toISOString(),
  oil_filter_baseline: summarize(oilProducts, oilVariants, oilSpecs.rows, oilIdentifiers.rows, oilFitments),
  brake_pad: {
    ...summarize(brakeProducts, brakeVariants, brakeSpecs.rows, brakeIdentifiers.rows, brakeFitments),
    source_catalog_rows: brakeCatalog.length,
    nexauto_sku_unique: new Set(brakeVariants.map((row) => row.sku)).size === brakeVariants.length,
    supplier_ref_in_variant_attributes: brakeVariants.filter((row) => text(row.attributes?.supplier_ref)).length,
    dimensions_in_variant_attributes: brakeVariants.filter((row) => positive(row.attributes?.length_mm) && positive(row.attributes?.width_mm) && positive(row.attributes?.thickness_mm)).length,
    catalog_supplier_refs: new Set(brakeCatalog.map((row) => text(row.supplierRef)).filter(Boolean)).size,
    catalog_complete_dimensions: brakeCatalog.filter((row) => positive(row.lengthMm) && positive(row.widthMm) && positive(row.thicknessMm)).length,
    catalog_rows_missing_production_variant: brakeCatalog.filter((row) => !brakeVariants.some((variant) => variant.sku === row.sku)).map((row) => row.sku),
    production_variants_missing_catalog_row: brakeVariants.filter((variant) => !brakeCatalogBySku.has(variant.sku)).map((variant) => variant.sku),
  },
  conclusion: {
    same_level_as_oil_filter: brakeSpecs.rows.length === brakeVariants.length
      && brakeIdentifiers.rows.length >= brakeVariants.length
      && brakeIdentifiers.rows.every((row) => text(row.identifier_brand) && text(row.verification_status)),
    gaps: [
      ...(brakeSpecs.exists && brakeSpecs.rows.length < brakeVariants.length ? ["brake_pad_variant_specs_not_fully_populated"] : []),
      ...(!brakeSpecs.exists ? ["brake_pad_variant_specs_table_unavailable"] : []),
      ...(brakeIdentifiers.rows.length < brakeVariants.length ? ["supplier_identifiers_not_normalized"] : []),
      ...(brakeIdentifiers.rows.some((row) => !text(row.identifier_brand)) ? ["identifier_brand_missing"] : []),
      ["product_page_still_reads_data/brake-pads/catalog.json_instead_of_database_specs"],
    ].flat(),
  },
};

fs.mkdirSync(path.resolve("outputs", "brake-pad-normalization-audit-20261024"), { recursive: true });
fs.writeFileSync(path.resolve("outputs", "brake-pad-normalization-audit-20261024", "audit-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

function summarize(products, variants, specs, identifiers, fitments) {
  return {
    products: products.length,
    variants: variants.length,
    specifications: specs.length,
    variants_with_specification: new Set(specs.map((row) => row.product_variant_id)).size,
    identifiers: identifiers.length,
    variants_with_identifier: new Set(identifiers.map((row) => row.product_variant_id)).size,
    supplier_identifiers: identifiers.filter((row) => row.identifier_type === "supplier_sku").length,
    cross_references: identifiers.filter((row) => row.identifier_type === "cross_reference").length,
    identifier_brands: countBy(identifiers, (row) => row.identifier_brand || "(blank)"),
    published_fitment_rows: fitments.filter((row) => row.fitment_status === "published").length,
    published_fitment_applications: new Set(fitments.filter((row) => row.fitment_status === "published").map((row) => row.application_id)).size,
  };
}

function text(value) { return String(value ?? "").trim(); }
function positive(value) { return Number(value) > 0; }
function countBy(rows, keyFn) { const result = {}; for (const row of rows) { const key = keyFn(row); result[key] = (result[key] ?? 0) + 1; } return result; }
function chunks(rows, size) { const result = []; for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size)); return result; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
async function fetchAll(table, columns, filter = (query) => query) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
async function selectInChunks(table, columns, column, values) {
  const rows = [];
  for (const batch of chunks([...new Set(values)], 200)) {
    if (!batch.length) continue;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(columns).in(column, batch).range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
  }
  return rows;
}
async function safeSelectInChunks(table, columns, column, values) { try { return { exists: true, rows: await selectInChunks(table, columns, column, values) }; } catch (error) { if (["42P01", "PGRST205"].includes(error.code)) return { exists: false, rows: [], error: error.message }; throw error; } }
