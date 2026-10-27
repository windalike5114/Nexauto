import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SOURCE_CODE = "BRAKE_PAD_CATALOG_NORMALIZATION_2026_10_24";
const DATA_SOURCE_CODE = "TOPSTAR_BENDIX_BRAKE_PAD_CATALOG_V1";
const CATALOG_FILE = path.resolve("data/brake-pads/catalog.json");
const OUTPUT_DIR = path.resolve("outputs/brake-pad-normalization-20261024");
const TOPSTAR_SUPPLIER_SKU_OVERRIDES = new Map([
  ["DB1405", "CDB1405W"],
  ["DB1849", "CDB1849W"],
  ["DB2193", "CDB2193W"]
]);

export function prepareBrakePadNormalization(catalog, variantBySku, dataSourceId, capabilities = {}) {
  const specifications = [];
  const identifiers = [];
  const productNames = [];
  const missingVariants = [];
  const invalidRows = [];

  for (const row of catalog) {
    const sku = clean(row.sku).toUpperCase();
    const variant = variantBySku.get(sku);
    if (!variant) {
      missingVariants.push(sku);
      continue;
    }

    try {
      const bendixReference = normalizeBendixReference(row.supplierRef);
      const topStarReference = topStarReferenceFromBendix(bendixReference);
      const axlePosition = normalizeAxlePosition(row.position);
      const dimensions = {
        length_mm: positiveNumber(row.lengthMm, "lengthMm", sku),
        width_mm: positiveNumber(row.widthMm, "widthMm", sku),
        thickness_mm: positiveNumber(row.thicknessMm, "thicknessMm", sku)
      };

      productNames.push({
        product_id: variant.product_id,
        sku,
        name: canonicalBrakePadName({ sku, position: axlePosition })
      });

      specifications.push({
        product_variant_id: variant.id,
        part_number: sku,
        axle_position: axlePosition,
        friction_material: null,
        ...dimensions,
        pack_description: "1 Axle Set",
        driving_use: null,
        wear_sensor_included: null,
        shims_included: null,
        hardware_included: null,
        verification_status: "verified",
        metadata: {
          normalization_source: SOURCE_CODE,
          source_catalog: "data/brake-pads/catalog.json",
          source_workbook: "20261020_小车_TOPSTAR刹车片_件到车_V01.xlsx",
          canonical_sku: sku,
          bendix_cross_reference: bendixReference,
          topstar_supplier_sku: topStarReference,
          raw_position: clean(row.position),
          position_verified_against_topstar_workbook: true
        }
      });

      identifiers.push(identifierRow({
        variantId: variant.id,
        dataSourceId,
        type: "supplier_sku",
        brand: "TopStar",
        value: topStarReference,
        sku,
        equivalentValue: bendixReference,
        equivalentBrand: "Bendix",
        capabilities
      }));
      identifiers.push(identifierRow({
        variantId: variant.id,
        dataSourceId,
        type: "cross_reference",
        brand: "Bendix",
        value: bendixReference,
        sku,
        equivalentValue: topStarReference,
        equivalentBrand: "TopStar",
        capabilities
      }));
    } catch (error) {
      invalidRows.push({ sku, message: error.message });
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

  return {
    productNames,
    specifications,
    identifiers,
    missingVariants,
    invalidRows,
    duplicateIdentifiers,
    duplicatePrimaryIdentifiers
  };
}

export function normalizeBendixReference(value) {
  const normalized = normalizeIdentifier(value);
  if (!/^DB\d+[A-Z]*$/.test(normalized)) {
    throw new Error(`Unsupported Bendix reference: ${value}`);
  }
  return normalized;
}

export function topStarReferenceFromBendix(value) {
  const bendixReference = normalizeBendixReference(value);
  return TOPSTAR_SUPPLIER_SKU_OVERRIDES.get(bendixReference) ?? `C${bendixReference}`;
}

export function normalizeAxlePosition(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized.startsWith("front")) return "front";
  if (normalized.startsWith("rear")) return "rear";
  throw new Error(`Unsupported brake-pad axle position: ${value}`);
}

export function canonicalBrakePadName(row) {
  const sku = clean(row?.sku).toUpperCase();
  if (!/^NBP\d+$/.test(sku)) throw new Error(`Invalid NexAuto brake-pad SKU: ${row?.sku}`);
  const position = normalizeAxlePosition(row?.position);
  const positionLabel = position === "front" ? "Front" : "Rear";
  return `NexAuto ${positionLabel} Brake Pad Set - ${sku}`;
}

function identifierRow({ variantId, dataSourceId, type, brand, value, sku, equivalentValue, equivalentBrand, capabilities }) {
  const row = {
    product_variant_id: variantId,
    identifier_type: type,
    identifier_value: value,
    normalized_value: normalizeIdentifier(value),
    data_source_id: dataSourceId,
    is_primary: false,
    metadata: {
      brand,
      canonical_sku: sku,
      identifier_role: "external_identifier",
      normalization_source: SOURCE_CODE,
      verification_status: "supplier_only",
      equivalent_identifier: {
        brand: equivalentBrand,
        value: equivalentValue
      }
    }
  };
  if (capabilities.identifierBrand) row.identifier_brand = brand;
  if (capabilities.identifierVerification) row.verification_status = "supplier_only";
  return row;
}

async function main() {
  if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) {
    throw new Error("Choose --report-only or --apply.");
  }

  loadEnv(path.resolve(".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase production credentials.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const catalogText = fs.readFileSync(CATALOG_FILE, "utf8");
  const catalog = JSON.parse(catalogText);
  const products = await fetchAll(db, "products", "id,slug,name,category_slug", (query) => query.eq("category_slug", "brake-pad"));
  const variants = await selectInChunks(db, "product_variants", "id,product_id,sku,attributes", "product_id", products.map((row) => row.id));
  const variantBySku = new Map(variants.map((row) => [clean(row.sku).toUpperCase(), row]));
  const capabilities = await detectCapabilities(db);
  let source = await findDataSource(db);

  if (process.argv.includes("--apply")) source = await createDataSource(db);
  const prepared = prepareBrakePadNormalization(catalog, variantBySku, source?.id ?? null, capabilities);
  const report = buildReport(catalog, catalogText, variants, source, capabilities, prepared);

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
    brakePadSpecifications: await tableExists(db, "brake_pad_variant_specs")
  };
}

async function findDataSource(db) {
  const { data, error } = await db.from("catalog_data_sources")
    .select("id,code,name,source_kind,active,metadata")
    .eq("code", DATA_SOURCE_CODE)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createDataSource(db) {
  const payload = {
    code: DATA_SOURCE_CODE,
    name: "TopStar / Bendix brake pad catalogue V1",
    source_kind: "product_catalogue",
    vehicle_identity_priority: 100,
    product_fitment_priority: 30,
    active: true,
    metadata: {
      product_line: "brake_pad",
      normalization_source: SOURCE_CODE,
      identifier_rule: "TopStar supplier SKU normally adds a C prefix to the Bendix DB cross-reference; CDB1405W, CDB1849W and CDB2193W retain supplier suffix W while Bendix references are DB1405, DB1849 and DB2193"
    }
  };
  const { data, error } = await db.from("catalog_data_sources").upsert(payload, { onConflict: "code" }).select("id,code,name,source_kind,active,metadata").single();
  if (error) throw error;
  return data;
}

function buildReport(catalog, catalogText, variants, source, capabilities, prepared) {
  const expectedIdentifiers = catalog.length * 2;
  return {
    source: SOURCE_CODE,
    catalog: {
      path: CATALOG_FILE,
      sha256: crypto.createHash("sha256").update(catalogText).digest("hex"),
      rows: catalog.length,
      front: catalog.filter((row) => normalizeAxlePosition(row.position) === "front").length,
      rear: catalog.filter((row) => normalizeAxlePosition(row.position) === "rear").length
    },
    dataSource: source,
    schemaCapabilities: capabilities,
    productionVariants: variants.length,
    prepared: {
      productNames: prepared.productNames.length,
      specifications: prepared.specifications.length,
      identifiers: prepared.identifiers.length,
      supplierIdentifiers: prepared.identifiers.filter((row) => row.identifier_type === "supplier_sku").length,
      crossReferenceIdentifiers: prepared.identifiers.filter((row) => row.identifier_type === "cross_reference").length,
      identifiersMarkedPrimary: prepared.identifiers.filter((row) => row.is_primary).length,
      identifierBrands: countBy(prepared.identifiers, (row) => row.identifier_brand ?? row.metadata.brand),
      missingVariants: prepared.missingVariants,
      invalidRows: prepared.invalidRows,
      duplicateIdentifiers: prepared.duplicateIdentifiers,
      duplicatePrimaryIdentifiers: prepared.duplicatePrimaryIdentifiers
    },
    blockers: [
      ...(catalog.length !== 211 ? [`catalog_row_count=${catalog.length}`] : []),
      ...(variants.length !== catalog.length ? [`variant_count=${variants.length}`] : []),
      ...(prepared.missingVariants.length ? [`missing_variants=${prepared.missingVariants.length}`] : []),
      ...(prepared.invalidRows.length ? [`invalid_rows=${prepared.invalidRows.length}`] : []),
      ...(prepared.identifiers.length !== expectedIdentifiers ? [`identifier_count=${prepared.identifiers.length}`] : []),
      ...(prepared.identifiers.some((row) => row.is_primary) ? ["external_identifier_marked_primary"] : []),
      ...(prepared.duplicateIdentifiers.length ? [`duplicate_identifiers=${prepared.duplicateIdentifiers.length}`] : []),
      ...(prepared.duplicatePrimaryIdentifiers.length ? [`duplicate_primary_identifiers=${prepared.duplicatePrimaryIdentifiers.length}`] : [])
    ],
    migrationRequired: !capabilities.brakePadSpecifications,
    migrationFile: "supabase/migrations/20261023_brake_pad_product_page_specs.sql"
  };
}

async function applyNormalization(db, prepared, report) {
  if (report.blockers.length) throw new Error(`Normalization blocked: ${report.blockers.join(", ")}`);
  const backupDir = await writeBackup(db, prepared, report);
  await updateProductNames(db, prepared.productNames);
  await replaceSourceIdentifiers(db, prepared.identifiers);
  await upsertRows(db, "product_identifiers", prepared.identifiers, "product_variant_id,identifier_type,normalized_value,data_source_id");
  if (report.schemaCapabilities.brakePadSpecifications) {
    await upsertRows(db, "brake_pad_variant_specs", prepared.specifications, "product_variant_id");
  }

  const variantIds = prepared.specifications.map((row) => row.product_variant_id);
  const [products, identifiers, specifications] = await Promise.all([
    selectInChunks(db, "products", "id,name", "id", prepared.productNames.map((row) => row.product_id)),
    selectInChunks(db, "product_identifiers", "product_variant_id,identifier_type,identifier_brand,identifier_value,normalized_value,data_source_id,is_primary,verification_status,metadata", "product_variant_id", variantIds),
    report.schemaCapabilities.brakePadSpecifications
      ? selectInChunks(db, "brake_pad_variant_specs", "*", "product_variant_id", variantIds)
      : Promise.resolve([])
  ]);

  const expectedProductNames = new Map(prepared.productNames.map((row) => [row.product_id, row.name]));
  const invalidProductNames = products.filter((row) => expectedProductNames.get(row.id) !== row.name);
  const expectedIdentifierKeys = new Set(prepared.identifiers.map(identifierKey));
  const verifiedIdentifiers = identifiers.filter((row) => expectedIdentifierKeys.has(identifierKey(row)));
  const actualIdentifierKeys = new Set(verifiedIdentifiers.map(identifierKey));
  const missingIdentifiers = [...expectedIdentifierKeys].filter((key) => !actualIdentifierKeys.has(key));
  const unexpectedPrimaryIdentifiers = verifiedIdentifiers.filter((row) => row.is_primary);
  const specificationIds = new Set(specifications.map((row) => row.product_variant_id));
  const missingSpecifications = report.schemaCapabilities.brakePadSpecifications
    ? variantIds.filter((id) => !specificationIds.has(id))
    : variantIds;

  if (invalidProductNames.length || missingIdentifiers.length || unexpectedPrimaryIdentifiers.length || (report.schemaCapabilities.brakePadSpecifications && missingSpecifications.length)) {
    throw new Error(`Post-apply verification failed: product_names=${invalidProductNames.length}, identifiers=${missingIdentifiers.length}, primary_identifiers=${unexpectedPrimaryIdentifiers.length}, specifications=${missingSpecifications.length}`);
  }

  return {
    appliedAt: new Date().toISOString(),
    backupDir,
    productNames: products.length,
    identifiers: verifiedIdentifiers.length,
    supplierIdentifiers: verifiedIdentifiers.filter((row) => row.identifier_type === "supplier_sku").length,
    crossReferenceIdentifiers: verifiedIdentifiers.filter((row) => row.identifier_type === "cross_reference").length,
    identifiersMarkedPrimary: unexpectedPrimaryIdentifiers.length,
    specifications: specifications.length,
    missingSpecifications: missingSpecifications.length,
    migrationRequired: !report.schemaCapabilities.brakePadSpecifications
  };
}

async function replaceSourceIdentifiers(db, identifiers) {
  const dataSourceIds = [...new Set(identifiers.map((row) => row.data_source_id).filter(Boolean))];
  if (dataSourceIds.length !== 1) throw new Error(`Expected one identifier data source, received ${dataSourceIds.length}.`);
  const variantIds = [...new Set(identifiers.map((row) => row.product_variant_id))];
  for (const batch of chunks(variantIds, 100)) {
    const { error } = await db.from("product_identifiers")
      .delete()
      .eq("data_source_id", dataSourceIds[0])
      .in("product_variant_id", batch);
    if (error) throw error;
  }
}

async function writeBackup(db, prepared, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `brake-pad-normalization-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const variantIds = prepared.specifications.map((row) => row.product_variant_id);
  const [products, variants, identifiers, specifications] = await Promise.all([
    fetchAll(db, "products", "*", (query) => query.eq("category_slug", "brake-pad")),
    selectInChunks(db, "product_variants", "*", "id", variantIds),
    selectInChunks(db, "product_identifiers", "*", "product_variant_id", variantIds),
    report.schemaCapabilities.brakePadSpecifications
      ? selectInChunks(db, "brake_pad_variant_specs", "*", "product_variant_id", variantIds)
      : Promise.resolve([])
  ]);
  for (const [file, rows] of [
    ["products.json", products],
    ["product_variants.json", variants],
    ["product_identifiers.json", identifiers],
    ["brake_pad_variant_specs.json", specifications]
  ]) {
    fs.writeFileSync(path.join(directory, file), JSON.stringify(rows, null, 2));
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

function identifierKey(row) {
  return `${row.product_variant_id}|${row.identifier_type}|${row.normalized_value}|${row.data_source_id}`;
}

function normalizeIdentifier(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function positiveNumber(value, field, sku) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) throw new Error(`Invalid ${field} for ${sku}: ${value}`);
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

async function tableExists(db, table) {
  const { error } = await db.from(table).select("*").limit(1);
  if (!error) return true;
  if (["42P01", "PGRST205"].includes(error.code)) return false;
  throw error;
}

async function columnExists(db, table, column) {
  const { error } = await db.from(table).select(column).limit(1);
  if (!error) return true;
  if (error.code === "42703") return false;
  throw error;
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
