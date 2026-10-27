import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  canonicalBrakePadName,
  normalizeAxlePosition,
  normalizeBendixReference,
  topStarReferenceFromBendix
} from "./normalize-brake-pad-catalog.mjs";

const DATA_SOURCE_CODE = "TOPSTAR_BENDIX_BRAKE_PAD_CATALOG_V1";

loadEnv(path.resolve(".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase production credentials.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const catalog = JSON.parse(fs.readFileSync(path.resolve("data/brake-pads/catalog.json"), "utf8"));
const products = await fetchAll(db, "products", "id,slug,name", (query) => query.eq("category_slug", "brake-pad"));
const variants = await selectInChunks(db, "product_variants", "id,product_id,sku", "product_id", products.map((row) => row.id));
const variantIds = variants.map((row) => row.id);
const variantBySku = new Map(variants.map((row) => [row.sku, row]));
const productById = new Map(products.map((row) => [row.id, row]));
const { data: source, error: sourceError } = await db.from("catalog_data_sources")
  .select("id,code,name")
  .eq("code", DATA_SOURCE_CODE)
  .maybeSingle();
if (sourceError) throw sourceError;

const identifiers = source
  ? await selectInChunks(db, "product_identifiers", "product_variant_id,identifier_type,identifier_brand,identifier_value,normalized_value,data_source_id,is_primary,verification_status,metadata", "product_variant_id", variantIds)
  : [];
const sourceIdentifiers = source ? identifiers.filter((row) => row.data_source_id === source.id) : [];
const specificationResult = await safeSelectInChunks(db, "brake_pad_variant_specs", "*", "product_variant_id", variantIds);

const failures = [];
if (catalog.length !== 211) failures.push(`catalog_rows=${catalog.length}`);
if (products.length !== 211) failures.push(`products=${products.length}`);
if (variants.length !== 211) failures.push(`variants=${variants.length}`);
if (!source) failures.push("data_source_missing");
if (sourceIdentifiers.length !== 422) failures.push(`identifiers=${sourceIdentifiers.length}`);
if (sourceIdentifiers.filter((row) => row.identifier_type === "supplier_sku" && row.identifier_brand === "TopStar").length !== 211) failures.push("topstar_supplier_identifiers");
if (sourceIdentifiers.filter((row) => row.identifier_type === "cross_reference" && row.identifier_brand === "Bendix").length !== 211) failures.push("bendix_cross_references");
if (sourceIdentifiers.some((row) => row.is_primary)) failures.push("external_identifier_marked_primary");
if (sourceIdentifiers.some((row) => row.verification_status !== "supplier_only")) failures.push("unexpected_identifier_verification_status");
if (!specificationResult.exists) failures.push("brake_pad_variant_specs_table_missing");
if (specificationResult.exists && specificationResult.rows.length !== 211) failures.push(`specifications=${specificationResult.rows.length}`);

const identifierKeys = new Set(sourceIdentifiers.map((row) => `${row.product_variant_id}|${row.identifier_type}|${row.identifier_brand}|${row.normalized_value}`));
const specByVariantId = new Map(specificationResult.rows.map((row) => [row.product_variant_id, row]));
const missingMappings = [];
const invalidNames = [];
const invalidSpecifications = [];
for (const row of catalog) {
  const variant = variantBySku.get(row.sku);
  if (!variant) continue;
  const dbReference = normalizeBendixReference(row.supplierRef);
  const cdbReference = topStarReferenceFromBendix(dbReference);
  const expectedKeys = [
    `${variant.id}|supplier_sku|TopStar|${cdbReference}`,
    `${variant.id}|cross_reference|Bendix|${dbReference}`
  ];
  if (expectedKeys.some((identifierKey) => !identifierKeys.has(identifierKey))) {
    missingMappings.push({ sku: row.sku, cdb: cdbReference, db: dbReference });
  }
  const product = productById.get(variant.product_id);
  if (product?.name !== canonicalBrakePadName({ sku: row.sku, position: row.position })) {
    invalidNames.push({ sku: row.sku, actual: product?.name });
  }
  const specification = specByVariantId.get(variant.id);
  if (specification && (
    specification.part_number !== row.sku
    || specification.axle_position !== normalizeAxlePosition(row.position)
    || Number(specification.length_mm) !== Number(row.lengthMm)
    || Number(specification.width_mm) !== Number(row.widthMm)
    || Number(specification.thickness_mm) !== Number(row.thicknessMm)
  )) {
    invalidSpecifications.push(row.sku);
  }
}
if (missingMappings.length) failures.push(`missing_mappings=${missingMappings.length}`);
if (invalidNames.length) failures.push(`invalid_names=${invalidNames.length}`);
if (invalidSpecifications.length) failures.push(`invalid_specifications=${invalidSpecifications.length}`);

const report = {
  checkedAt: new Date().toISOString(),
  products: products.length,
  variants: variants.length,
  canonicalProductNames: products.length - invalidNames.length,
  identifiers: sourceIdentifiers.length,
  supplierIdentifiers: sourceIdentifiers.filter((row) => row.identifier_type === "supplier_sku").length,
  crossReferences: sourceIdentifiers.filter((row) => row.identifier_type === "cross_reference").length,
  externalIdentifiersMarkedPrimary: sourceIdentifiers.filter((row) => row.is_primary).length,
  identifierBrands: countBy(sourceIdentifiers, (row) => row.identifier_brand),
  specificationsTableExists: specificationResult.exists,
  specifications: specificationResult.rows.length,
  missingMappings,
  invalidSpecifications,
  failures
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) throw new Error(`Brake-pad normalization verification failed: ${failures.join(", ")}`);

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

async function safeSelectInChunks(client, table, columns, column, values) {
  try {
    return { exists: true, rows: await selectInChunks(client, table, columns, column, values) };
  } catch (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return { exists: false, rows: [] };
    throw error;
  }
}
