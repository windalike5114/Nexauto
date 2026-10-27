import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalOilFilterName } from "./normalize-oil-filter-catalog.mjs";

loadEnv(path.resolve(".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase production credentials.");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const catalog = JSON.parse(fs.readFileSync(path.resolve("data/oil-filters/catalog.json"), "utf8"));
const products = await fetchAll(db, "products", "id,slug,name", (query) => query.like("slug", "oil-filter-%"));
const variants = await selectInChunks(db, "product_variants", "id,product_id,sku", "product_id", products.map((row) => row.id));
const variantById = new Map(variants.map((row) => [row.id, row]));
const productById = new Map(products.map((row) => [row.id, row]));
const variantIds = variants.map((row) => row.id);
const [specifications, identifiers] = await Promise.all([
  selectInChunks(db, "filter_variant_specs", "product_variant_id,construction_type,height_mm,outside_diameter_mm,outside_diameter_top_mm,outside_diameter_bottom_mm,inside_diameter_top_mm,inside_diameter_bottom_mm,thread_size,seal_ring_dimensions,verification_status,metadata", "product_variant_id", variantIds),
  selectInChunks(db, "product_identifiers", "product_variant_id,identifier_type,identifier_brand,identifier_value,normalized_value,is_primary,verification_status,metadata", "product_variant_id", variantIds)
]);

const expectedNames = new Map(catalog.map((row) => [row.sku, canonicalOilFilterName(row)]));
const invalidNames = variants.filter((variant) => productById.get(variant.product_id)?.name !== expectedNames.get(variant.sku));
const ownerSkus = (identifier) => identifiers
  .filter((row) => row.normalized_value === identifier)
  .map((row) => variantById.get(row.product_variant_id)?.sku)
  .filter(Boolean)
  .sort();
const z9Owners = ownerSkus("Z9");
const r2703pOwners = ownerSkus("R2703P");
const r2681pOwners = ownerSkus("R2681P");
const failures = [];
if (products.length !== 125) failures.push(`products=${products.length}`);
if (variants.length !== 125) failures.push(`variants=${variants.length}`);
if (invalidNames.length) failures.push(`invalid_names=${invalidNames.length}`);
if (specifications.length !== 125) failures.push(`specifications=${specifications.length}`);
if (identifiers.length !== 263) failures.push(`identifiers=${identifiers.length}`);
if (identifiers.some((row) => row.is_primary)) failures.push("external_identifier_marked_primary");
if (identifiers.some((row) => row.verification_status !== "supplier_only")) failures.push("unexpected_identifier_verification_status");
if (identifiers.filter((row) => row.identifier_brand === "TopStar" && row.identifier_type === "supplier_sku").length !== 125) failures.push("topstar_count");
if (identifiers.filter((row) => row.identifier_brand === "Ryco" && row.identifier_type === "cross_reference").length !== 138) failures.push("ryco_count");
if (JSON.stringify(z9Owners) !== JSON.stringify(["NOF1804", "NOF1839"])) failures.push(`z9=${z9Owners.join(",")}`);
if (JSON.stringify(r2703pOwners) !== JSON.stringify(["NOF1748"])) failures.push(`r2703p=${r2703pOwners.join(",")}`);
if (JSON.stringify(r2681pOwners) !== JSON.stringify(["NOF1748"])) failures.push(`r2681p=${r2681pOwners.join(",")}`);
if (identifiers.filter((row) => row.normalized_value === "Z9").some((row) => row.metadata?.shared_cross_reference !== true)) failures.push("z9_shared_metadata");

const report = {
  checkedAt: new Date().toISOString(),
  products: products.length,
  variants: variants.length,
  canonicalProductNames: products.length - invalidNames.length,
  specifications: specifications.length,
  identifiers: identifiers.length,
  supplierIdentifiers: identifiers.filter((row) => row.identifier_type === "supplier_sku").length,
  crossReferences: identifiers.filter((row) => row.identifier_type === "cross_reference").length,
  externalIdentifiersMarkedPrimary: identifiers.filter((row) => row.is_primary).length,
  verificationStatus: countBy(identifiers, (row) => row.verification_status),
  identifierBrands: countBy(identifiers, (row) => row.identifier_brand),
  sharedReferences: { Z9: z9Owners },
  NOF1748: { R2703P: r2703pOwners, R2681P: r2681pOwners },
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) throw new Error(`Oil-filter normalization verification failed: ${failures.join(", ")}`);

function countBy(rows, keyFn) {
  const output = {};
  for (const row of rows) {
    const keyValue = keyFn(row) ?? "unknown";
    output[keyValue] = (output[keyValue] ?? 0) + 1;
  }
  return output;
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function chunks(rows, size) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

async function fetchAll(client, table, columns, applyFilter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilter(client.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function selectInChunks(client, table, columns, column, values) {
  const output = [];
  for (const batch of chunks([...new Set(values)], 200)) {
    if (!batch.length) continue;
    const { data, error } = await client.from(table).select(columns).in(column, batch);
    if (error) throw error;
    output.push(...data);
  }
  return output;
}
