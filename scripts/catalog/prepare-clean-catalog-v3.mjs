import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

import {
  cleanText,
  compactPartKey,
  normalKey,
  parseBatteryCode,
  parseFilterDetail,
  parseVehicleRow,
  slugify,
  splitBatteryRecommendations,
  splitCodes,
  stableHash,
  unique,
  validateWiperRow
} from "./catalog-v3-normalization.mjs";

const DEFAULT_DATA_DIR = "C:\\Users\\Sanli\\repco_nexauto\\clean\\data";
const FILES = {
  vehicles: "repco格式_虚拟source_vehicle_id.xlsx",
  batteries: "battery_passenger_clean.csv",
  filters: "filter_crossref_clean.csv",
  mappings: "mapping_long.csv",
  wipers: "wiper_clean.csv"
};
const SOURCE_DEFINITIONS = [
  { code: "NEXAUTO_VEHICLE_BACKBONE_V3", name: "NexAuto clean vehicle backbone V3", source_kind: "vehicle_catalogue", vehicle_identity_priority: 1, product_fitment_priority: 100, metadata: { market: "NZ", role: "vehicle_backbone", version: 3 } },
  { code: "NEXAUTO_BATTERY_PASSENGER_V3", name: "NexAuto passenger battery catalogue V3", source_kind: "product_catalogue", vehicle_identity_priority: 100, product_fitment_priority: 10, metadata: { product_line: "battery", version: 3 } },
  { code: "TOPSTAR_FILTER_CROSSREF_V3", name: "TopStar filter cross-reference catalogue V3", source_kind: "product_catalogue", vehicle_identity_priority: 100, product_fitment_priority: 10, metadata: { product_line: "oil_filter", version: 3 } },
  { code: "NEXAUTO_PRODUCT_MAPPING_V3", name: "NexAuto vehicle-to-product mapping V3", source_kind: "product_catalogue", vehicle_identity_priority: 100, product_fitment_priority: 1, metadata: { role: "fitment_mapping", version: 3 } },
  { code: "NEXAUTO_WIPER_CLEAN_V3", name: "NexAuto clean wiper observations V3", source_kind: "product_catalogue", vehicle_identity_priority: 100, product_fitment_priority: 10, metadata: { product_line: "wiper", version: 3 } }
];

const args = parseArgs(process.argv.slice(2));
const reportOnly = Boolean(args["report-only"]);
const apply = Boolean(args.apply);
if (!reportOnly && !apply) throw new Error("Choose --report-only or --apply.");

const dataDir = path.resolve(String(args["data-dir"] ?? DEFAULT_DATA_DIR));
const outputDir = path.resolve(String(args["output-dir"] ?? path.join(process.cwd(), "tmp", "catalog-v3")));
const sourcePaths = Object.fromEntries(Object.entries(FILES).map(([key, filename]) => [key, path.join(dataDir, filename)]));
for (const sourcePath of Object.values(sourcePaths)) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Required source file not found: ${sourcePath}`);
}

const sourceRows = Object.fromEntries(Object.entries(sourcePaths).map(([key, sourcePath]) => [key, readRows(sourcePath)]));
const prepared = prepareCatalog(sourceRows, sourcePaths);
writeOutputs(outputDir, prepared);
printReport(prepared.report, outputDir);

if (apply) {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  await applyPreparedCatalog(prepared, sourcePaths);
}

export function prepareCatalog(sourceRows, sourcePaths = {}) {
  const vehicleRows = sourceRows.vehicles.slice(1).map((row, index) => parseVehicleRow(row, index + 2));
  const vehicleBySourceId = new Map();
  const manualReview = [];

  for (const vehicle of vehicleRows) {
    if (vehicleBySourceId.has(vehicle.source_vehicle_id) && vehicle.source_vehicle_id) {
      manualReview.push(review("vehicle", vehicle.row_number, "duplicate_source_vehicle_id", "error", { source_vehicle_id: vehicle.source_vehicle_id }));
      vehicle.parse_status = "rejected";
      vehicle.parse_notes = unique([...vehicle.parse_notes, "duplicate_source_vehicle_id"]);
    } else if (vehicle.source_vehicle_id) {
      vehicleBySourceId.set(vehicle.source_vehicle_id, vehicle);
    }
    for (const note of vehicle.parse_notes) {
      manualReview.push(review("vehicle", vehicle.row_number, note, vehicle.parse_status === "rejected" ? "error" : "warning", summarizeVehicle(vehicle)));
    }
  }

  const filterRows = sourceRows.filters.slice(1).map((row, index) => ({
    row_number: index + 2,
    supplier_part_number: cleanText(row[0]),
    cross_references: splitCodes(row[1]),
    make: cleanText(row[2]),
    model: cleanText(row[3]),
    chassis_codes: splitCodes(row[4]),
    body: cleanText(row[5]),
    engine_code: cleanText(row[6]),
    engine_displacement: cleanText(row[7]),
    drivetrain: cleanText(row[8]),
    year_start: cleanText(row[9]),
    year_end: cleanText(row[10]),
    source_description: cleanText(row[11])
  }));

  const batteryRows = sourceRows.batteries.slice(1).map((row, index) => ({
    row_number: index + 2,
    make: cleanText(row[0]), model: cleanText(row[1]), chassis_code: cleanText(row[2]), body: cleanText(row[3]),
    fuel: cleanText(row[4]), engine: cleanText(row[5]), drivetrain: cleanText(row[6]), year_start: cleanText(row[7]), year_end: cleanText(row[8]),
    highly_recommended: splitBatteryRecommendations(row[9]), recommended: splitBatteryRecommendations(row[10]), fits: splitBatteryRecommendations(row[11])
  }));

  const filterProducts = buildFilterProducts(filterRows);
  const batteryProducts = buildBatteryProducts(batteryRows);
  const products = [...filterProducts.products, ...batteryProducts.products];
  const productByLookup = new Map(products.map((product) => [`${product.category_slug}:${compactPartKey(product.source_part_number)}`, product]));

  const mappingRows = sourceRows.mappings.slice(1).map((row, index) => ({
    row_number: index + 2,
    source_vehicle_id: cleanText(row[0]),
    make: cleanText(row[1]), model: cleanText(row[2]), chassis_code: cleanText(row[3]), body: cleanText(row[4]),
    year_start: cleanText(row[5]), year_end: cleanText(row[6]), product_type: cleanText(row[7]), product_detail: cleanText(row[8])
  }));
  const fitmentCandidates = [];
  let ignoredWiperMappings = 0;
  for (const row of mappingRows) {
    const vehicle = vehicleBySourceId.get(row.source_vehicle_id);
    if (!vehicle || vehicle.parse_status === "rejected") {
      manualReview.push(review("mapping", row.row_number, "unknown_or_rejected_source_vehicle_id", "error", row));
      continue;
    }
    if (row.product_type === "雨刷") {
      ignoredWiperMappings += 1;
      continue;
    }

    const isFilter = row.product_type === "滤芯";
    const isBattery = row.product_type === "电瓶";
    if (!isFilter && !isBattery) {
      manualReview.push(review("mapping", row.row_number, "unknown_product_type", "error", row));
      continue;
    }
    const detailParts = isFilter ? [parseFilterDetail(row.product_detail).supplierPartNumber] : splitBatteryRecommendations(row.product_detail);
    for (const detailPart of detailParts) {
      const category = isFilter ? "filter" : "battery";
      const product = productByLookup.get(`${category}:${compactPartKey(detailPart)}`);
      if (!product) {
        manualReview.push(review("mapping", row.row_number, "mapped_product_not_in_catalogue", "error", { ...row, parsed_part_number: detailPart }));
        continue;
      }
      fitmentCandidates.push({
        source_vehicle_id: row.source_vehicle_id,
        product_sku: product.sku,
        product_slug: product.slug,
        category_slug: product.category_slug,
        position: "vehicle",
        fitment_status: vehicle.parse_status === "accepted" ? "published" : "review",
        recommendation_level: "compatible",
        source_row_number: row.row_number,
        source_product_detail: row.product_detail
      });
    }
  }
  const fitments = dedupe(fitmentCandidates, (row) => `${row.source_vehicle_id}:${row.product_sku}:${row.position}`);

  for (const product of products) {
    const count = fitments.filter((fitment) => fitment.product_sku === product.sku).length;
    product.fitment_count = count;
    if (count === 0) manualReview.push(review("product", product.source_row_numbers[0] ?? 0, "product_has_no_backbone_fitment", "warning", { sku: product.sku, source_part_number: product.source_part_number }));
  }

  const wiperRows = sourceRows.wipers.slice(1).map((row, index) => validateWiperRow(row, index + 2));
  for (const row of wiperRows) {
    if (row.parse_status === "review") manualReview.push(review("wiper", row.row_number, row.parse_notes.filter((note) => note.startsWith("invalid_")).join(","), "warning", row));
  }

  const sourceHashes = Object.fromEntries(Object.entries(sourcePaths).map(([key, sourcePath]) => [key, sourcePath && fs.existsSync(sourcePath) ? sha256File(sourcePath) : null]));
  const report = {
    parser_version: 3,
    generated_at: new Date().toISOString(),
    sources: Object.fromEntries(Object.entries(sourceRows).map(([key, rows]) => [key, { file: sourcePaths[key] ? path.basename(sourcePaths[key]) : null, sha256: sourceHashes[key], data_rows: Math.max(rows.length - 1, 0) }])),
    vehicles: countStatuses(vehicleRows),
    canonical: {
      makes: new Set(vehicleRows.filter(usableVehicle).map((row) => row.make_key)).size,
      models: new Set(vehicleRows.filter(usableVehicle).map((row) => `${row.make_key}:${row.model_key}`)).size,
      generations: new Set(vehicleRows.filter(usableVehicle).map((row) => `${row.make_key}:${row.model_key}:${row.generation_key}`)).size,
      variants: new Set(vehicleRows.filter(usableVehicle).map((row) => `${row.make_key}:${row.model_key}:${row.generation_key}:${row.variant_key}`)).size,
      applications: vehicleRows.filter(usableVehicle).length
    },
    products: {
      total: products.length,
      filters: filterProducts.products.length,
      batteries: batteryProducts.products.length,
      filter_cross_references: filterProducts.crossReferences.length,
      with_fitments: products.filter((product) => product.fitment_count > 0).length,
      without_fitments: products.filter((product) => product.fitment_count === 0).length,
      all_checkout_disabled: products.every((product) => product.checkout_enabled === false && product.commerce_status === "catalog_only")
    },
    fitments: {
      raw_mapping_rows: mappingRows.length,
      generated_filter_and_battery_links_before_dedupe: fitmentCandidates.length,
      unique_filter_and_battery_links: fitments.length,
      duplicate_links_removed: fitmentCandidates.length - fitments.length,
      ignored_wiper_mapping_rows: ignoredWiperMappings
    },
    wipers: {
      rows: wiperRows.length,
      accepted: wiperRows.filter((row) => row.parse_status === "accepted").length,
      review: wiperRows.filter((row) => row.parse_status === "review").length,
      rear_missing_treated_as_unknown: wiperRows.filter((row) => row.rear_length_in === null).length
    },
    manual_review: {
      total: manualReview.length,
      errors: manualReview.filter((row) => row.severity === "error").length,
      warnings: manualReview.filter((row) => row.severity === "warning").length
    }
  };

  return { vehicleRows, filterRows, batteryRows, mappingRows, wiperRows, products, crossReferences: filterProducts.crossReferences, fitments, manualReview, report };
}

function buildFilterProducts(rows) {
  const grouped = groupBy(rows.filter((row) => row.supplier_part_number), (row) => compactPartKey(row.supplier_part_number));
  const products = [];
  const crossReferences = [];
  for (const groupRows of grouped.values()) {
    const partNumber = groupRows[0].supplier_part_number;
    const slug = `topstar-oil-filter-${slugify(partNumber)}`;
    const sku = `TOPSTAR-${compactPartKey(partNumber)}`;
    const refs = unique(groupRows.flatMap((row) => row.cross_references));
    products.push({
      slug, sku, source_part_number: partNumber, category_slug: "filter", brand_name: "TopStar",
      name: `TopStar Oil Filter ${partNumber}`,
      description: `TopStar oil filter ${partNumber}. Vehicle and engine fitment must be confirmed against the NexAutoParts catalogue before purchase.`,
      price: 0, stock: 0, active: true, visibility_status: "public", content_status: "generated", commerce_status: "catalog_only", checkout_enabled: false,
      images: ["/products/vehicle-oil-filter.png"],
      detail_sections: [
        { title: "Part identification", body: `Supplier part number: ${partNumber}${refs.length ? `. Cross-reference data is available for comparison only.` : "."}` },
        { title: "Fitment status", body: "This generated catalogue page is not yet available for purchase. Confirm the exact engine and production range before supply." }
      ],
      attributes: { supplier_brand: "TopStar", supplier_part_number: partNumber, filter_type: "oil", cross_references: refs },
      source_row_numbers: groupRows.map((row) => row.row_number)
    });
    for (const reference of refs) crossReferences.push({ product_sku: sku, identifier_type: "cross_reference", identifier_value: reference, normalized_value: compactPartKey(reference), source_row_numbers: groupRows.filter((row) => row.cross_references.includes(reference)).map((row) => row.row_number) });
  }
  return { products: products.sort(bySku), crossReferences: dedupe(crossReferences, (row) => `${row.product_sku}:${row.normalized_value}`) };
}

function buildBatteryProducts(rows) {
  const occurrences = new Map();
  for (const row of rows) {
    for (const [tier, codes] of [["highly_recommended", row.highly_recommended], ["recommended", row.recommended], ["fits", row.fits]]) {
      for (const code of codes) {
        const key = compactPartKey(code);
        if (!key) continue;
        if (!occurrences.has(key)) occurrences.set(key, { code, tiers: new Set(), rows: [] });
        const item = occurrences.get(key);
        item.tiers.add(tier);
        item.rows.push(row.row_number);
      }
    }
  }
  const products = [];
  for (const [key, item] of occurrences) {
    const parsed = parseBatteryCode(item.code);
    const sku = `BAT-${key}`;
    products.push({
      slug: `vehicle-battery-${slugify(item.code)}`, sku, source_part_number: item.code, category_slug: "battery", brand_name: null,
      name: `Vehicle Battery ${item.code}`,
      description: `Vehicle battery code ${item.code}. Case size, terminal layout, battery technology and vehicle requirements must be confirmed before supply.`,
      price: 0, stock: 0, active: true, visibility_status: "public", content_status: "generated", commerce_status: "catalog_only", checkout_enabled: false,
      images: ["/products/vehicle-battery.png"],
      detail_sections: [
        { title: "Battery code", body: `Catalogue code: ${item.code}. Technology inferred from the code: ${parsed.technology}.` },
        { title: "Fitment status", body: "This generated catalogue page is not yet available for purchase. Physical dimensions, terminals and electrical rating require confirmation." }
      ],
      attributes: { battery_code: item.code, technology: parsed.technology, code_format: parsed.format, recommendation_tiers_seen: [...item.tiers].sort() },
      source_row_numbers: unique(item.rows)
    });
  }
  return { products: products.sort(bySku) };
}

function writeOutputs(outputDir, prepared) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "catalog-import-report.json"), JSON.stringify(prepared.report, null, 2));
  fs.writeFileSync(path.join(outputDir, "catalog-import-manifest.json"), JSON.stringify({
    parser_version: 3,
    products: prepared.products,
    cross_references: prepared.crossReferences,
    vehicles: prepared.vehicleRows,
    fitments: prepared.fitments
  }, null, 2));
  writeCsv(path.join(outputDir, "products-preview.csv"), prepared.products.map((row) => ({ sku: row.sku, slug: row.slug, category: row.category_slug, name: row.name, source_part_number: row.source_part_number, fitment_count: row.fitment_count, visibility_status: row.visibility_status, content_status: row.content_status, commerce_status: row.commerce_status, checkout_enabled: row.checkout_enabled })));
  writeCsv(path.join(outputDir, "vehicle-applications-preview.csv"), prepared.vehicleRows);
  writeCsv(path.join(outputDir, "vehicle-product-fitments-preview.csv"), prepared.fitments);
  writeCsv(path.join(outputDir, "filter-cross-references-preview.csv"), prepared.crossReferences);
  writeCsv(path.join(outputDir, "manual-review.csv"), prepared.manualReview.map((row) => ({ ...row, payload: JSON.stringify(row.payload) })));
}

async function applyPreparedCatalog(prepared, sourcePaths) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  await upsertRows(supabase, "catalog_data_sources", SOURCE_DEFINITIONS, "code");
  const { data: sources, error: sourceError } = await supabase.from("catalog_data_sources").select("id,code").in("code", SOURCE_DEFINITIONS.map((row) => row.code));
  if (sourceError) throw sourceError;
  const sourceByCode = new Map(sources.map((row) => [row.code, row.id]));
  const batchByKind = await createImportBatches(supabase, prepared, sourcePaths, sourceByCode);
  const sourceRecordIds = await insertVehicleSourceRecords(supabase, prepared.vehicleRows, batchByKind.vehicles);
  const applicationBySourceVehicleId = await publishVehicles(supabase, prepared.vehicleRows, sourceRecordIds, sourceByCode.get("NEXAUTO_VEHICLE_BACKBONE_V3"));
  const variantBySku = await publishProducts(supabase, prepared.products, prepared.crossReferences, sourceByCode);
  await publishFitments(supabase, prepared.fitments, applicationBySourceVehicleId, variantBySku, batchByKind.mappings);
  await publishReviewQueue(supabase, prepared.manualReview, sourceRecordIds);
  await completeBatches(supabase, Object.values(batchByKind), prepared.report.manual_review.total ? "review" : "published");
  console.log("Catalog V3 was applied. Generated products remain public previews with checkout disabled.");
}

async function createImportBatches(supabase, prepared, sourcePaths, sourceByCode) {
  const definitions = {
    vehicles: ["NEXAUTO_VEHICLE_BACKBONE_V3", prepared.vehicleRows.length],
    batteries: ["NEXAUTO_BATTERY_PASSENGER_V3", prepared.batteryRows.length],
    filters: ["TOPSTAR_FILTER_CROSSREF_V3", prepared.filterRows.length],
    mappings: ["NEXAUTO_PRODUCT_MAPPING_V3", prepared.mappingRows.length],
    wipers: ["NEXAUTO_WIPER_CLEAN_V3", prepared.wiperRows.length]
  };
  const result = {};
  for (const [kind, [code, rowCount]] of Object.entries(definitions)) {
    const hash = sha256File(sourcePaths[kind]);
    const { data: existing, error: existingError } = await supabase.from("catalog_import_batches").select("id,import_status").eq("data_source_id", sourceByCode.get(code)).eq("source_file_hash", hash).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (existing.import_status === "published") throw new Error(`${kind} source was already published as batch ${existing.id}.`);
      console.log(`Resuming ${kind} batch ${existing.id} (${existing.import_status}).`);
      result[kind] = existing.id;
      continue;
    }
    const { data, error } = await supabase.from("catalog_import_batches").insert({ data_source_id: sourceByCode.get(code), source_file: path.basename(sourcePaths[kind]), source_file_hash: hash, sheet_name: kind, import_status: "parsed", row_count: rowCount, accepted_count: rowCount, metadata: { parser_version: 3, market: "NZ" } }).select("id").single();
    if (error) throw error;
    result[kind] = data.id;
  }
  return result;
}

async function insertVehicleSourceRecords(supabase, rows, batchId) {
  const payload = rows.map((row) => ({ batch_id: batchId, sheet_name: "vehicles", row_number: row.row_number, raw_values: summarizeVehicle(row), normalized_values: row, parse_status: row.parse_status, parse_notes: row.parse_notes, source_record_hash: stableHash(summarizeVehicle(row)) }));
  const saved = await upsertRowsReturning(supabase, "catalog_source_records", payload, "batch_id,sheet_name,row_number", "id,row_number");
  return new Map(saved.map((row) => [row.row_number, row.id]));
}

async function publishVehicles(supabase, rows, sourceRecordIds, dataSourceId) {
  const usable = rows.filter(usableVehicle);
  await upsertRows(supabase, "vehicle_makes", dedupe(usable.map((row) => ({ name: row.make, normalized_name: row.make_key })), (row) => row.normalized_name), "normalized_name");
  const makes = await selectAll(supabase.from("vehicle_makes").select("id,name,normalized_name"));
  const makeByKey = new Map(makes.map((row) => [row.normalized_name, row]));

  await upsertRows(supabase, "vehicle_models", dedupe(usable.map((row) => ({ make_id: makeByKey.get(row.make_key).id, name: row.model, normalized_name: row.model_key })), (row) => `${row.make_id}:${row.normalized_name}`), "make_id,normalized_name");
  const models = await selectAll(supabase.from("vehicle_models").select("id,make_id,name,normalized_name"));
  const modelByKey = new Map(models.map((row) => [`${row.make_id}:${row.normalized_name}`, row]));

  await upsertRows(supabase, "vehicle_generations", dedupe(usable.map((row) => { const make = makeByKey.get(row.make_key); const model = modelByKey.get(`${make.id}:${row.model_key}`); return { model_id: model.id, name: row.generation_name, normalized_name: row.generation_key, year_start: row.year_start, year_end: row.year_end, active: true, metadata: { source: "NEXAUTO_VEHICLE_BACKBONE_V3" } }; }), (row) => `${row.model_id}:${row.normalized_name}`), "model_id,normalized_name");
  const generations = await selectAll(supabase.from("vehicle_generations").select("id,model_id,normalized_name"));
  const generationByKey = new Map(generations.map((row) => [`${row.model_id}:${row.normalized_name}`, row]));

  await upsertRows(supabase, "vehicle_variants", dedupe(usable.map((row) => { const make = makeByKey.get(row.make_key); const model = modelByKey.get(`${make.id}:${row.model_key}`); const generation = generationByKey.get(`${model.id}:${row.generation_key}`); return { generation_id: generation.id, name: row.variant_name, normalized_name: row.variant_key, body_style: row.body_style, engine_code: row.engine_code, active: true, metadata: { source: "NEXAUTO_VEHICLE_BACKBONE_V3" } }; }), (row) => `${row.generation_id}:${row.normalized_name}`), "generation_id,normalized_name");
  const variants = await selectAll(supabase.from("vehicle_variants").select("id,generation_id,normalized_name"));
  const variantByKey = new Map(variants.map((row) => [`${row.generation_id}:${row.normalized_name}`, row]));

  const entityByVehicle = new Map();
  for (const row of usable) { const make = makeByKey.get(row.make_key); const model = modelByKey.get(`${make.id}:${row.model_key}`); const generation = generationByKey.get(`${model.id}:${row.generation_key}`); const variant = variantByKey.get(`${generation.id}:${row.variant_key}`); entityByVehicle.set(row.source_vehicle_id, { make, model, generation, variant }); }

  const chassisRows = dedupe(usable.flatMap((row) => row.chassis_codes.map((code) => ({ code, normalized_code: compactPartKey(code) }))), (row) => row.normalized_code);
  if (chassisRows.length) await upsertRows(supabase, "vehicle_chassis_codes", chassisRows, "normalized_code");
  const chassis = chassisRows.length ? await selectAll(supabase.from("vehicle_chassis_codes").select("id,normalized_code")) : [];
  const chassisByKey = new Map(chassis.map((row) => [row.normalized_code, row]));
  const chassisAssignments = dedupe(usable.flatMap((row) => { const entity = entityByVehicle.get(row.source_vehicle_id); return row.chassis_codes.map((code, index) => ({ chassis_code_id: chassisByKey.get(compactPartKey(code)).id, generation_id: entity.generation.id, variant_id: entity.variant.id, is_primary: index === 0 })); }), (row) => `${row.chassis_code_id}:${row.generation_id}:${row.variant_id}`);
  if (chassisAssignments.length) {
    const existingAssignments = await selectAll(supabase.from("vehicle_chassis_assignments").select("chassis_code_id,generation_id,variant_id"));
    const existingKeys = new Set(existingAssignments.map((row) => `${row.chassis_code_id}:${row.generation_id}:${row.variant_id ?? ""}`));
    await insertRows(supabase, "vehicle_chassis_assignments", chassisAssignments.filter((row) => !existingKeys.has(`${row.chassis_code_id}:${row.generation_id}:${row.variant_id}`)));
  }

  const applications = usable.map((row) => { const entity = entityByVehicle.get(row.source_vehicle_id); return { source_application_key: `NEXAUTO_V3:${row.source_vehicle_id}`, generation_id: entity.generation.id, variant_id: entity.variant.id, market: "NZ", steering_side: "RHD", year_start: row.year_start, year_end: row.year_end, fitment_status: row.parse_status === "accepted" ? "published" : "review", active: true, metadata: { source_vehicle_id: row.source_vehicle_id, source: "NEXAUTO_VEHICLE_BACKBONE_V3" } }; });
  await upsertRows(supabase, "vehicle_fitment_applications", applications, "source_application_key");
  const applicationRows = await selectAll(supabase.from("vehicle_fitment_applications").select("id,source_application_key").like("source_application_key", "NEXAUTO_V3:%"));
  const applicationBySourceVehicleId = new Map(applicationRows.map((row) => [String(row.source_application_key).slice("NEXAUTO_V3:".length), row.id]));

  const aliases = usable.map((row) => ({ data_source_id: dataSourceId, entity_type: "variant", alias_kind: "source_id", alias_scope_key: "NEXAUTO_VEHICLE_BACKBONE_V3", alias: row.source_vehicle_id, normalized_alias: normalKey(row.source_vehicle_id), market: "NZ", variant_id: entityByVehicle.get(row.source_vehicle_id).variant.id, alias_index: 0 }));
  await upsertRows(supabase, "vehicle_entity_aliases", aliases, "data_source_id,entity_type,alias_kind,alias_scope_key,normalized_alias,market,alias_index");
  const mappings = usable.map((row) => ({ source_record_id: sourceRecordIds.get(row.row_number), entity_type: "application", mapping_index: 0, mapping_status: row.parse_status === "accepted" ? "approved" : "candidate", confidence: row.parse_status === "accepted" ? 1 : 0.8, vehicle_application_id: applicationBySourceVehicleId.get(row.source_vehicle_id), match_reasons: ["source_vehicle_id", "new_vehicle_backbone_only"] }));
  await upsertRows(supabase, "source_entity_mappings", mappings, "source_record_id,entity_type,mapping_index");
  return applicationBySourceVehicleId;
}

async function publishProducts(supabase, products, crossReferences, sourceByCode) {
  const generationBatch = await supabase.from("catalog_generation_batches").insert({ source_name: "NexAuto clean catalogue V3", source_file: Object.values(FILES).join(", "), prompt_version: "catalog-v3-template-1", generator_name: "NexAuto deterministic catalogue generator", status: "review", row_count: products.length, completed_at: new Date().toISOString(), metadata: { checkout_enabled: false, categories: ["battery", "filter"] } }).select("id").single();
  if (generationBatch.error) throw generationBatch.error;
  await upsertRows(supabase, "products", products.map((row) => ({ slug: row.slug, name: row.name, category_slug: row.category_slug, price: row.price, description: row.description, detail_sections: row.detail_sections, images: row.images, active: true, visibility_status: "public", content_status: "generated", commerce_status: "catalog_only", checkout_enabled: false, content_origin: "generated", generation_batch_id: generationBatch.data.id, content_generated_at: new Date().toISOString(), content_metadata: { parser_version: 3, source_part_number: row.source_part_number, source_rows: row.source_row_numbers } })), "slug");
  const productRows = await selectAll(supabase.from("products").select("id,slug"));
  const productBySlug = new Map(productRows.map((row) => [row.slug, row.id]));
  await upsertRows(supabase, "product_variants", products.map((row) => ({ product_id: productBySlug.get(row.slug), sku: row.sku, price: 0, stock: 0, attributes: row.attributes, active: true })), "sku");
  const variants = await selectAll(supabase.from("product_variants").select("id,sku,product_id"));
  const variantBySku = new Map(variants.map((row) => [row.sku, row]));
  await upsertRows(supabase, "product_attributes", products.map((row) => ({ product_id: productBySlug.get(row.slug), attributes: row.attributes, updated_at: new Date().toISOString() })), "product_id");

  const identifierRows = products.map((row) => ({ product_variant_id: variantBySku.get(row.sku).id, identifier_type: "supplier_sku", identifier_value: row.source_part_number, normalized_value: compactPartKey(row.source_part_number), is_primary: true, data_source_id: sourceByCode.get(row.category_slug === "filter" ? "TOPSTAR_FILTER_CROSSREF_V3" : "NEXAUTO_BATTERY_PASSENGER_V3") })).concat(crossReferences.map((row) => ({ product_variant_id: variantBySku.get(row.product_sku).id, identifier_type: "cross_reference", identifier_value: row.identifier_value, normalized_value: row.normalized_value, is_primary: false, data_source_id: sourceByCode.get("TOPSTAR_FILTER_CROSSREF_V3") })));
  await upsertRows(supabase, "product_identifiers", identifierRows, "product_variant_id,identifier_type,normalized_value,data_source_id");
  await upsertRows(supabase, "filter_variant_specs", products.filter((row) => row.category_slug === "filter").map((row) => ({ product_variant_id: variantBySku.get(row.sku).id, supplier_brand: "TopStar", supplier_part_number: row.source_part_number, filter_type: "oil", verification_status: "generated" })), "product_variant_id");
  await upsertRows(supabase, "battery_variant_specs", products.filter((row) => row.category_slug === "battery").map((row) => ({ product_variant_id: variantBySku.get(row.sku).id, battery_code: row.source_part_number, technology: row.attributes.technology, code_format: row.attributes.code_format, verification_status: "generated" })), "product_variant_id");
  return new Map([...variantBySku].map(([sku, row]) => [sku, row.id]));
}

async function publishFitments(supabase, fitments, applicationBySourceVehicleId, variantBySku, mappingBatchId) {
  const rows = fitments.map((row) => ({ vehicle_application_id: applicationBySourceVehicleId.get(row.source_vehicle_id), product_variant_id: variantBySku.get(row.product_sku), position: row.position, fitment_status: row.fitment_status, notes: `Imported from clean mapping row ${row.source_row_number}` })).filter((row) => row.vehicle_application_id && row.product_variant_id);
  await upsertRows(supabase, "vehicle_product_fitments", rows, "vehicle_application_id,product_variant_id,position");
  const saved = await selectAll(supabase.from("vehicle_product_fitments").select("id,vehicle_application_id,product_variant_id,position"));
  const savedByKey = new Map(saved.map((row) => [`${row.vehicle_application_id}:${row.product_variant_id}:${row.position}`, row.id]));
  const evidence = fitments.map((row) => { const applicationId = applicationBySourceVehicleId.get(row.source_vehicle_id); const variantId = variantBySku.get(row.product_sku); const fitmentId = savedByKey.get(`${applicationId}:${variantId}:${row.position}`); return fitmentId ? { vehicle_product_fitment_id: fitmentId, import_batch_id: mappingBatchId, source_row_number: row.source_row_number, evidence_kind: "provided_mapping", confidence: row.fitment_status === "published" ? 1 : 0.8, raw_values: { source_vehicle_id: row.source_vehicle_id, product_detail: row.source_product_detail } } : null; }).filter(Boolean);
  await upsertRows(supabase, "vehicle_product_fitment_evidence", evidence, "vehicle_product_fitment_id,import_batch_id,source_row_number");
}

async function publishReviewQueue(supabase, reviewRows, sourceRecordIds) {
  const payload = reviewRows.map((row) => ({ source_record_id: row.source_kind === "vehicle" ? sourceRecordIds.get(row.row_number) ?? null : null, issue_type: row.issue_type || "catalog_review", severity: row.severity, review_status: "open", summary: `${row.source_kind}: ${row.issue}`, payload: row.payload }));
  await insertRows(supabase, "fitment_review_queue", payload);
}

async function completeBatches(supabase, ids, status) {
  for (const id of ids) { const { error } = await supabase.from("catalog_import_batches").update({ import_status: status, completed_at: new Date().toISOString() }).eq("id", id); if (error) throw error; }
}

function review(sourceKind, rowNumber, issue, severity, payload) { return { source_kind: sourceKind, row_number: rowNumber, issue_type: issue.split(",")[0] || "catalog_review", issue, severity, payload }; }
function summarizeVehicle(row) { return { source_vehicle_id: row.source_vehicle_id, make: row.make, model: row.model, chassis_raw: row.chassis_raw, body_raw: row.body_raw, engine_code: row.engine_code, year_start: row.year_start, year_end: row.year_end }; }
function usableVehicle(row) { return row.parse_status !== "rejected"; }
function countStatuses(rows) { return { total: rows.length, accepted: rows.filter((row) => row.parse_status === "accepted").length, review: rows.filter((row) => row.parse_status === "review").length, rejected: rows.filter((row) => row.parse_status === "rejected").length }; }
function bySku(a, b) { return a.sku.localeCompare(b.sku, "en-NZ"); }
function dedupe(rows, keyFn) { const seen = new Set(); return rows.filter((row) => { const key = keyFn(row); if (seen.has(key)) return false; seen.add(key); return true; }); }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }

function readRows(filePath) {
  const workbook = path.extname(filePath).toLowerCase() === ".csv"
    ? XLSX.read(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""), { type: "string", raw: false })
    : XLSX.readFile(filePath, { cellDates: false, raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "", raw: false });
}

function writeCsv(filePath, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  fs.writeFileSync(filePath, `\uFEFF${csv}`, "utf8");
}

function printReport(report, outputDir) {
  console.log(`Catalog V3 report written to ${outputDir}`);
  console.log(`Vehicles: ${JSON.stringify(report.vehicles)}; canonical: ${JSON.stringify(report.canonical)}`);
  console.log(`Products: ${JSON.stringify(report.products)}`);
  console.log(`Fitments: ${JSON.stringify(report.fitments)}`);
  console.log(`Wipers: ${JSON.stringify(report.wipers)}`);
  console.log(`Manual review: ${JSON.stringify(report.manual_review)}`);
}

function parseArgs(values) { const result = {}; for (let index = 0; index < values.length; index += 1) { const value = values[index]; if (!value.startsWith("--")) continue; const key = value.slice(2); const next = values[index + 1]; if (!next || next.startsWith("--")) result[key] = true; else { result[key] = next; index += 1; } } return result; }
function sha256File(filePath) { return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"); }
function loadEnvFile(filePath) { if (!fs.existsSync(filePath)) return; for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith("#")) continue; const separator = trimmed.indexOf("="); if (separator <= 0) continue; const key = trimmed.slice(0, separator).trim(); let value = trimmed.slice(separator + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); if (!(key in process.env)) process.env[key] = value; } }

async function upsertRows(supabase, table, rows, onConflict, chunkSize = 250) { if (!rows.length) return; for (let index = 0; index < rows.length; index += chunkSize) { const { error } = await supabase.from(table).upsert(rows.slice(index, index + chunkSize), { onConflict }); if (error) throw new Error(`${table}: ${error.message}`); } }
async function insertRows(supabase, table, rows, chunkSize = 250) { if (!rows.length) return; for (let index = 0; index < rows.length; index += chunkSize) { const { error } = await supabase.from(table).insert(rows.slice(index, index + chunkSize)); if (error) throw new Error(`${table}: ${error.message}`); } }
async function insertRowsReturning(supabase, table, rows, columns, chunkSize = 250) { const result = []; for (let index = 0; index < rows.length; index += chunkSize) { const { data, error } = await supabase.from(table).insert(rows.slice(index, index + chunkSize)).select(columns); if (error) throw new Error(`${table}: ${error.message}`); result.push(...data); } return result; }
async function upsertRowsReturning(supabase, table, rows, onConflict, columns, chunkSize = 250) { const result = []; for (let index = 0; index < rows.length; index += chunkSize) { const { data, error } = await supabase.from(table).upsert(rows.slice(index, index + chunkSize), { onConflict }).select(columns); if (error) throw new Error(`${table}: ${error.message}`); result.push(...data); } return result; }
async function selectAll(query, pageSize = 1000) { const rows = []; for (let from = 0; ; from += pageSize) { const { data, error } = await query.range(from, from + pageSize - 1); if (error) throw error; rows.push(...data); if (data.length < pageSize) return rows; } }
