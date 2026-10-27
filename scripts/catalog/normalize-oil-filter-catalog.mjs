import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SOURCE_CODE = "OIL_FILTER_CATALOG_NORMALIZATION_2026_10_23";
const DATA_SOURCE_CODE = "TOPSTAR_FILTER_CROSSREF_V3";
const CATALOG_FILE = path.resolve("data/oil-filters/catalog.json");
const OUTPUT_DIR = path.resolve("outputs/oil-filter-normalization-20261023");

export function prepareOilFilterNormalization(catalog, variantBySku, dataSourceId, capabilities = {}) {
  const specifications = [];
  const identifiers = [];
  const productNames = [];
  const missingVariants = [];
  const crossReferenceOwners = new Map();

  for (const row of catalog) {
    for (const reference of splitReferences(row.supplierRef)) {
      const key = normalizeIdentifier(reference);
      const owners = crossReferenceOwners.get(key) ?? new Set();
      owners.add(row.sku);
      crossReferenceOwners.set(key, owners);
    }
  }

  for (const row of catalog) {
    const variant = variantBySku.get(row.sku);
    if (!variant) {
      missingVariants.push(row.sku);
      continue;
    }
    const outside = parseDimensionPair(row.outerDiameter);
    const inside = parseDimensionPair(row.insideDiameter);
    const constructionType = normalizeConstruction(row.category);
    productNames.push({
      product_id: variant.product_id,
      sku: row.sku,
      name: canonicalOilFilterName(row)
    });
    const commonMetadata = {
      normalization_source: SOURCE_CODE,
      source_catalog: "data/oil-filters/catalog.json",
      canonical_sku: row.sku,
      brands: row.brands,
      mostly_for: row.mostlyFor,
      normalized_spec: {
        construction_type: constructionType,
        height_mm: positiveNumberOrNull(row.heightMm),
        outside_diameter_mm: outside.values.length === 1 ? outside.values[0] : null,
        outside_diameter_top_mm: outside.values[0] ?? null,
        outside_diameter_bottom_mm: outside.values[1] ?? outside.values[0] ?? null,
        inside_diameter_top_mm: inside.values[0] ?? null,
        inside_diameter_bottom_mm: inside.values[1] ?? inside.values[0] ?? null,
        thread_size: clean(row.threadSize) || null,
        seal_ring_dimensions: splitSealRings(row.sealRingSize),
        pack_quantity: 1
      },
      raw_dimensions: {
        outside_diameter: clean(row.outerDiameter),
        inside_diameter: clean(row.insideDiameter),
        seal_ring_size: clean(row.sealRingSize)
      }
    };
    const specification = {
      product_variant_id: variant.id,
      supplier_brand: "TopStar",
      supplier_part_number: clean(row.topstarRef),
      filter_type: "oil",
      verification_status: "review",
      metadata: commonMetadata
    };
    if (capabilities.structuredSpecificationColumns) {
      Object.assign(specification, {
        construction_type: commonMetadata.normalized_spec.construction_type,
        height_mm: commonMetadata.normalized_spec.height_mm,
        outside_diameter_mm: commonMetadata.normalized_spec.outside_diameter_mm,
        inside_diameter_top_mm: commonMetadata.normalized_spec.inside_diameter_top_mm,
        inside_diameter_bottom_mm: commonMetadata.normalized_spec.inside_diameter_bottom_mm,
        thread_size: commonMetadata.normalized_spec.thread_size,
        seal_ring_dimensions: commonMetadata.normalized_spec.seal_ring_dimensions,
        pack_quantity: commonMetadata.normalized_spec.pack_quantity
      });
    }
    if (capabilities.structuredSpecificationColumns && capabilities.outsidePairColumns) {
      specification.outside_diameter_top_mm = outside.values[0] ?? null;
      specification.outside_diameter_bottom_mm = outside.values[1] ?? outside.values[0] ?? null;
    }
    specifications.push(specification);

    const topStar = clean(row.topstarRef);
    if (topStar) identifiers.push(identifierRow({
      variantId: variant.id,
      type: "supplier_sku",
      brand: "TopStar",
      value: topStar,
      dataSourceId,
      primary: false,
      capabilities,
      sku: row.sku
    }));

    for (const rycoReference of splitReferences(row.supplierRef)) {
      const normalizedReference = normalizeIdentifier(rycoReference);
      const owners = [...(crossReferenceOwners.get(normalizedReference) ?? [])];
      identifiers.push(identifierRow({
        variantId: variant.id,
        type: "cross_reference",
        brand: "Ryco",
        value: rycoReference,
        dataSourceId,
        primary: false,
        capabilities,
        sku: row.sku,
        verification: "supplier_only",
        sharedWithSkus: owners.filter((sku) => sku !== row.sku)
      }));
    }
  }

  const duplicateIdentifiers = duplicatesBy(identifiers, (row) => [
    row.product_variant_id,
    row.identifier_type,
    row.normalized_value,
    row.data_source_id
  ].join("|"));
  const duplicatePrimaryIdentifiers = duplicatesBy(
    identifiers.filter((row) => row.is_primary),
    (row) => `${row.product_variant_id}|${row.data_source_id}`
  );
  return { productNames, specifications, identifiers, missingVariants, duplicateIdentifiers, duplicatePrimaryIdentifiers };
}

export function splitReferences(value) {
  return [...new Set(clean(value).split(/[\/,;]+/).map(clean).filter(Boolean))];
}

export function splitSealRings(value) {
  return [...new Set(clean(value).split(/[,;]+/).map(clean).filter(Boolean))];
}

export function parseDimensionPair(value) {
  const raw = clean(value);
  if (!raw) return { raw, values: [] };
  const values = raw.split("/").map((part) => positiveNumberOrNull(part));
  if (values.some((number) => number === null)) throw new Error(`Invalid dimension: ${value}`);
  if (values.length > 2) throw new Error(`Expected at most two dimensions: ${value}`);
  return { raw, values };
}

function identifierRow({ variantId, type, brand, value, dataSourceId, primary, capabilities, sku, verification = "supplier_only", sharedWithSkus = [] }) {
  const row = {
    product_variant_id: variantId,
    identifier_type: type,
    identifier_value: value,
    normalized_value: normalizeIdentifier(value),
    data_source_id: dataSourceId,
    is_primary: primary,
    metadata: {
      brand,
      canonical_sku: sku,
      identifier_role: "external_identifier",
      normalization_source: SOURCE_CODE,
      verification_status: verification,
      ...(sharedWithSkus.length ? {
        shared_cross_reference: true,
        shared_with_nexauto_skus: sharedWithSkus
      } : {})
    }
  };
  if (capabilities.identifierBrand) row.identifier_brand = brand;
  if (capabilities.identifierVerification) row.verification_status = verification;
  return row;
}

export function canonicalOilFilterName(row) {
  const sku = clean(row?.sku).toUpperCase();
  if (!sku) throw new Error("Oil-filter SKU is required for canonical naming.");
  const category = normalizeConstruction(row?.category) === "spin_on" ? "Spin-On" : "Cartridge";
  return `NexAuto ${category} Oil Filter - ${sku}`;
}

function normalizeConstruction(value) {
  const normalized = clean(value).toLowerCase().replace(/[-_ ]+/g, "_");
  if (normalized === "cartridge") return "cartridge";
  if (normalized === "spin_on") return "spin_on";
  throw new Error(`Unsupported oil-filter construction: ${value}`);
}

function normalizeIdentifier(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function positiveNumberOrNull(value) {
  if (value === null || value === undefined || clean(value) === "") return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) return null;
  return result;
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function duplicatesBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = groups.get(key) ?? [];
    values.push(row);
    groups.set(key, values);
  }
  return [...groups.entries()].filter(([, values]) => values.length > 1).map(([key, values]) => ({ key, count: values.length }));
}

async function main() {
  if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) {
    throw new Error("Choose --report-only or --apply.");
  }
  loadEnv(path.resolve(".env.local"));
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const catalogText = fs.readFileSync(CATALOG_FILE, "utf8");
  const catalog = JSON.parse(catalogText);
  const products = await fetchAll(db, "products", "id,slug", (query) => query.like("slug", "oil-filter-%"));
  const variants = await selectInChunks(db, "product_variants", "id,product_id,sku,attributes", "product_id", products.map((row) => row.id));
  const variantBySku = new Map(variants.map((row) => [row.sku, row]));
  const { data: source, error: sourceError } = await db.from("catalog_data_sources")
    .select("id,code,name").eq("code", DATA_SOURCE_CODE).maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error(`Missing catalogue data source ${DATA_SOURCE_CODE}.`);
  const capabilities = await detectCapabilities(db);
  const prepared = prepareOilFilterNormalization(catalog, variantBySku, source.id, capabilities);
  const report = buildReport(catalog, variants, source, capabilities, prepared, catalogText);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "normalization_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--apply")) {
    const applied = await applyNormalization(db, prepared, report);
    fs.writeFileSync(path.join(OUTPUT_DIR, "normalization_applied.json"), JSON.stringify(applied, null, 2));
    console.log(JSON.stringify({ applied: true, ...applied }, null, 2));
  }
}

async function detectCapabilities(db) {
  return {
    identifierBrand: await columnExists(db, "product_identifiers", "identifier_brand"),
    identifierVerification: await columnExists(db, "product_identifiers", "verification_status"),
    structuredSpecificationColumns: await columnExists(db, "filter_variant_specs", "construction_type")
      && await columnExists(db, "filter_variant_specs", "height_mm")
      && await columnExists(db, "filter_variant_specs", "inside_diameter_top_mm")
      && await columnExists(db, "filter_variant_specs", "seal_ring_dimensions"),
    outsidePairColumns: await columnExists(db, "filter_variant_specs", "outside_diameter_top_mm")
      && await columnExists(db, "filter_variant_specs", "outside_diameter_bottom_mm")
  };
}

async function columnExists(db, table, column) {
  const { error } = await db.from(table).select(column).limit(1);
  if (!error) return true;
  if (error.code === "42703") return false;
  throw error;
}

function buildReport(catalog, variants, source, capabilities, prepared, catalogText) {
  return {
    source: SOURCE_CODE,
    catalog: {
      path: CATALOG_FILE,
      sha256: crypto.createHash("sha256").update(catalogText).digest("hex"),
      rows: catalog.length,
      cartridge: catalog.filter((row) => row.category === "Cartridge").length,
      spinOn: catalog.filter((row) => row.category === "Spin-On").length
    },
    dataSource: source,
    schemaCapabilities: capabilities,
    productionVariants: variants.length,
    prepared: {
      productNames: prepared.productNames.length,
      specifications: prepared.specifications.length,
      supplierIdentifiers: prepared.identifiers.filter((row) => row.identifier_type === "supplier_sku").length,
      crossReferenceIdentifiers: prepared.identifiers.filter((row) => row.identifier_type === "cross_reference").length,
      identifierBrands: countBy(prepared.identifiers, (row) => row.identifier_brand ?? row.metadata.brand),
      identifierVerification: countBy(prepared.identifiers, (row) => row.verification_status ?? row.metadata.verification_status),
      missingVariants: prepared.missingVariants,
      duplicateIdentifiers: prepared.duplicateIdentifiers,
      duplicatePrimaryIdentifiers: prepared.duplicatePrimaryIdentifiers,
      multiOutsideDiameterSpecifications: prepared.specifications.filter((row) => row.metadata.raw_dimensions.outside_diameter.includes("/")).length
    },
    blockers: [
      ...(catalog.length !== 125 ? [`catalog_row_count=${catalog.length}`] : []),
      ...(variants.length !== catalog.length ? [`variant_count=${variants.length}`] : []),
      ...(prepared.missingVariants.length ? [`missing_variants=${prepared.missingVariants.length}`] : []),
      ...(prepared.duplicateIdentifiers.length ? [`duplicate_identifiers=${prepared.duplicateIdentifiers.length}`] : []),
      ...(prepared.duplicatePrimaryIdentifiers.length ? [`duplicate_primary_identifiers=${prepared.duplicatePrimaryIdentifiers.length}`] : [])
    ]
  };
}

async function applyNormalization(db, prepared, report) {
  if (report.blockers.length) throw new Error(`Normalization blocked: ${report.blockers.join(", ")}`);
  const backupDir = await writeBackup(db, report);
  await updateProductNames(db, prepared.productNames);
  await upsertRows(db, "filter_variant_specs", prepared.specifications, "product_variant_id");
  await upsertRows(db, "product_identifiers", prepared.identifiers, "product_variant_id,identifier_type,normalized_value,data_source_id");
  const variantIds = prepared.specifications.map((row) => row.product_variant_id);
  const [products, specifications, identifiers] = await Promise.all([
    selectInChunks(db, "products", "id,name", "id", prepared.productNames.map((row) => row.product_id)),
    selectInChunks(db, "filter_variant_specs", report.schemaCapabilities.structuredSpecificationColumns
      ? "product_variant_id,supplier_brand,supplier_part_number,filter_type,construction_type,height_mm,outside_diameter_mm,inside_diameter_top_mm,inside_diameter_bottom_mm,thread_size,seal_ring_dimensions,pack_quantity,verification_status,metadata"
      : "product_variant_id,supplier_brand,supplier_part_number,filter_type,verification_status,metadata", "product_variant_id", variantIds),
    selectInChunks(db, "product_identifiers", "product_variant_id,identifier_type,identifier_value,normalized_value,data_source_id,is_primary,metadata", "product_variant_id", variantIds)
  ]);
  const expectedProductNames = new Map(prepared.productNames.map((row) => [row.product_id, row.name]));
  const invalidProductNames = products.filter((row) => expectedProductNames.get(row.id) !== row.name);
  const expectedIdentifierKeys = new Set(prepared.identifiers.map(identifierKey));
  const verifiedIdentifiers = identifiers.filter((row) => expectedIdentifierKeys.has(identifierKey(row)));
  const specificationIds = new Set(specifications.map((row) => row.product_variant_id));
  const missingSpecifications = variantIds.filter((id) => !specificationIds.has(id));
  const missingIdentifiers = [...expectedIdentifierKeys].filter((key) => !new Set(verifiedIdentifiers.map(identifierKey)).has(key));
  if (invalidProductNames.length || missingSpecifications.length || missingIdentifiers.length) {
    throw new Error(`Post-apply verification failed: product_names=${invalidProductNames.length}, specifications=${missingSpecifications.length}, identifiers=${missingIdentifiers.length}`);
  }
  return {
    appliedAt: new Date().toISOString(),
    backupDir,
    productNames: products.length,
    specifications: specifications.length,
    identifiers: verifiedIdentifiers.length,
    supplierIdentifiers: verifiedIdentifiers.filter((row) => row.identifier_type === "supplier_sku").length,
    crossReferenceIdentifiers: verifiedIdentifiers.filter((row) => row.identifier_type === "cross_reference").length,
    missingSpecifications: 0,
    missingIdentifiers: 0,
    schemaCapabilities: report.schemaCapabilities
  };
}

function identifierKey(row) {
  return `${row.product_variant_id}|${row.identifier_type}|${row.normalized_value}|${row.data_source_id}`;
}

async function writeBackup(db, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `oil-filter-normalization-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const [products, specifications, identifiers] = await Promise.all([
    fetchAll(db, "products", "id,slug,name,category_slug,updated_at", (query) => query.eq("category_slug", "filter")),
    fetchAll(db, "filter_variant_specs", "*"),
    fetchAll(db, "product_identifiers", "*")
  ]);
  for (const [file, rows] of [["products.json", products], ["filter_variant_specs.json", specifications], ["product_identifiers.json", identifiers]]) {
    const content = JSON.stringify(rows, null, 2);
    fs.writeFileSync(path.join(directory, file), content);
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), source: SOURCE_CODE, report }, null, 2));
  return directory;
}

async function updateProductNames(db, rows) {
  for (const batch of chunks(rows, 25)) {
    const errors = await Promise.all(batch.map(async (row) => {
      const { error } = await db.from("products").update({ name: row.name }).eq("id", row.product_id);
      return error;
    }));
    const error = errors.find(Boolean);
    if (error) throw error;
  }
}

function countBy(rows, keyFn) {
  const output = {};
  for (const row of rows) {
    const key = keyFn(row) || "unknown";
    output[key] = (output[key] ?? 0) + 1;
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

async function fetchAll(db, table, columns, applyFilter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function selectInChunks(db, table, columns, column, values) {
  const output = [];
  for (const batch of chunks([...new Set(values)], 200)) {
    if (!batch.length) continue;
    const { data, error } = await db.from(table).select(columns).in(column, batch);
    if (error) throw error;
    output.push(...data);
  }
  return output;
}

async function upsertRows(db, table, rows, onConflict) {
  for (const batch of chunks(rows, 200)) {
    const { error } = await db.from(table).upsert(batch, { onConflict });
    if (error) throw error;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) await main();
