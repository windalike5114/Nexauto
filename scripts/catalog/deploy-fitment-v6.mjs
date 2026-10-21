import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const SOURCE_CODE = "NEXAUTO_FITMENT_V6_2026_10_22";
const EXPECTED_VEHICLE_RELEASE_HASH = "ea51cdaebe629afa9edf096bbcd0de18dbdc1e919d2a9051ec96c34421812e46";
const DEFAULT_PACKAGE_DIR = path.resolve("data/fitment-v6");
const APPROVED_FRONT_SIZES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30]);
const PACKAGE_FILES = [
  "brakepad_product_application_test.csv",
  "oilfilter_product_application_test.csv",
  "wiper_application_test.csv",
  "fitment_match_issues.csv",
  "fitment_test_summary.json",
  "README.md"
];

export function prepareFitmentV6(packageDir = DEFAULT_PACKAGE_DIR) {
  const brake = readCsv(path.join(packageDir, "brakepad_product_application_test.csv"));
  const oil = readCsv(path.join(packageDir, "oilfilter_product_application_test.csv"));
  const wiper = readCsv(path.join(packageDir, "wiper_application_test.csv"));
  const summary = JSON.parse(fs.readFileSync(path.join(packageDir, "fitment_test_summary.json"), "utf8"));
  const brakeCatalog = JSON.parse(fs.readFileSync(path.resolve("data/brake-pads/catalog.json"), "utf8"));
  const oilCatalog = JSON.parse(fs.readFileSync(path.resolve("data/oil-filters/catalog.json"), "utf8"));

  assertCount(brake.length, summary.matching.brake_pad_unique_product_applications, "brake links");
  assertCount(oil.length, summary.matching.oil_filter_unique_product_applications, "oil-filter links");
  assertCount(wiper.length, summary.matching.wiper_unique_spec_applications, "wiper links");
  assertUnique(brake, (row) => `${row.sku}:${row.application_id}:${row.position}`, "brake fitment");
  assertUnique(oil, (row) => `${row.sku}:${row.application_id}:${row.position}`, "oil-filter fitment");
  assertUnique(wiper, (row) => `${row.wiper_spec_id}:${row.application_id}`, "wiper fitment");

  const applicationIds = new Set([...brake, ...oil, ...wiper].map((row) => row.application_id));
  if ([...applicationIds].some((id) => !/^ap_[0-9a-f]{20}$/.test(id))) throw new Error("Invalid V5 application id in fitment package.");

  const brakeSkus = new Set(brakeCatalog.map((row) => row.sku));
  const oilSkus = new Set(oilCatalog.map((row) => row.sku));
  const missingCatalogSkus = [
    ...new Set(brake.map((row) => row.sku).filter((sku) => !brakeSkus.has(sku))),
    ...new Set(oil.map((row) => row.sku).filter((sku) => !oilSkus.has(sku)))
  ];
  if (missingCatalogSkus.length) throw new Error(`Fitments reference missing catalogue SKUs: ${missingCatalogSkus.join(", ")}`);

  const productFitments = [...brake, ...oil].map((row) => ({
    ...row,
    fitment_status: row.match_confidence === "low" ? "review" : "published"
  }));
  const wiperRows = wiper.map((row) => ({
    ...row,
    driver_in: Number(row.driver_in),
    passenger_in: Number(row.passenger_in),
    configuration_key: `${Number(row.driver_in)}/${Number(row.passenger_in)}/-`,
    requested_status: row.match_confidence === "low" || row.review_status === "conflict_review" ? "review" : "published"
  }));
  if (wiperRows.some((row) => !Number.isInteger(row.driver_in) || !Number.isInteger(row.passenger_in))) {
    throw new Error("Wiper package contains a non-integer front blade size.");
  }

  return {
    packageDir,
    packageHash: hashPackage(packageDir),
    summary,
    brakeCatalog,
    oilCatalog,
    productFitments,
    wiperRows,
    applicationIds,
    report: {
      source: SOURCE_CODE,
      package_hash: hashPackage(packageDir),
      vehicle_release_hash: EXPECTED_VEHICLE_RELEASE_HASH,
      source_links: { brake_pad: brake.length, oil_filter: oil.length, wiper: wiper.length },
      distinct_applications: applicationIds.size,
      product_fitment_status: countBy(productFitments, (row) => row.fitment_status),
      wiper_requested_status: countBy(wiperRows, (row) => row.requested_status),
      wiper_configurations: new Set(wiperRows.map((row) => row.configuration_key)).size,
      unsupported_wiper_links: wiperRows.filter((row) => !APPROVED_FRONT_SIZES.has(row.driver_in) || !APPROVED_FRONT_SIZES.has(row.passenger_in)).length,
      catalogue_products: { brake_pad: brakeCatalog.length, oil_filter: oilCatalog.length }
    }
  };
}

async function inspectProduction(db, prepared) {
  const releases = await selectAll(db.from("vehicle_catalog_releases").select("release_id,package_sha256,active").eq("active", true));
  const release = releases.find((row) => row.package_sha256 === EXPECTED_VEHICLE_RELEASE_HASH);
  if (!release) throw new Error("Production vehicle catalogue does not match the fitment package release.");

  const applications = await selectAll(db.from("vehicle_catalog_applications").select("application_id"));
  const productionApplicationIds = new Set(applications.map((row) => row.application_id));
  const missingApplications = [...prepared.applicationIds].filter((id) => !productionApplicationIds.has(id));
  if (missingApplications.length) throw new Error(`Production is missing ${missingApplications.length} fitment applications.`);

  const configurations = await selectAll(db.from("wiper_configurations").select("id,configuration_key,configuration_status"));
  const wiperSets = await selectAll(db.from("wiper_sets").select("id,driver_length_in,passenger_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"));
  const purchasablePairs = new Set(wiperSets.filter(isPurchasableWiperSet).map(wiperPairKey));
  const configurationKeys = new Set(configurations.map((row) => row.configuration_key));
  const missingConfigurations = [...new Set(prepared.wiperRows.map((row) => row.configuration_key).filter((key) => !configurationKeys.has(key)))];

  return {
    release,
    configurations,
    wiperSets,
    purchasablePairs,
    missingConfigurations,
    current: {
      applications: applications.length,
      product_fitments: await exactCount(db, "vehicle_catalog_product_fitments"),
      wiper_fitments: await exactCount(db, "vehicle_catalog_wiper_fitments"),
      wiper_configurations: configurations.length,
      purchasable_wiper_pairs: purchasablePairs.size
    }
  };
}

async function applyDeployment(db, prepared, inspection) {
  const backupDir = await writeProductionBackup(db);
  const variantBySku = await upsertCatalogues(db, prepared);

  const { error: clearProductError } = await db.from("vehicle_catalog_product_fitments").delete().eq("source", SOURCE_CODE);
  if (clearProductError) throw clearProductError;
  await deleteAll(db, "vehicle_catalog_wiper_fitments", "application_id");

  const productPayload = prepared.productFitments.map((row) => {
    const productVariantId = variantBySku.get(row.sku);
    if (!productVariantId) throw new Error(`Missing deployed product variant for ${row.sku}`);
    return {
      application_id: row.application_id,
      product_variant_id: productVariantId,
      position: row.position || "vehicle",
      fitment_status: row.fitment_status,
      source: SOURCE_CODE,
      notes: productNotes(row)
    };
  });
  await upsertRows(db, "vehicle_catalog_product_fitments", productPayload, "application_id,product_variant_id,position");

  const configurationByKey = new Map(inspection.configurations.map((row) => [row.configuration_key, row.id]));
  for (const key of inspection.missingConfigurations) {
    const [driver, passenger] = key.split("/").map(Number);
    if (!APPROVED_FRONT_SIZES.has(driver) || !APPROVED_FRONT_SIZES.has(passenger)) continue;
    const { data, error } = await db.rpc("upsert_wiper_configuration", {
      p_driver_length_in: driver,
      p_passenger_length_in: passenger,
      p_rear_length_in: null
    });
    if (error) throw error;
    configurationByKey.set(key, data);
  }

  const wiperPayload = [];
  const unsupported = [];
  for (const row of prepared.wiperRows) {
    const configurationId = configurationByKey.get(row.configuration_key);
    if (!configurationId) {
      unsupported.push(row);
      continue;
    }
    const sellable = inspection.purchasablePairs.has(wiperPairKey(row));
    const fitmentStatus = row.requested_status === "published" && sellable ? "published" : "review";
    wiperPayload.push({
      application_id: row.application_id,
      wiper_configuration_id: configurationId,
      fitment_status: fitmentStatus,
      source: SOURCE_CODE,
      notes: wiperNotes(row, sellable)
    });
  }
  await insertRows(db, "vehicle_catalog_wiper_fitments", wiperPayload);

  const publishedConfigurationIds = [...new Set(wiperPayload.filter((row) => row.fitment_status === "published").map((row) => row.wiper_configuration_id))];
  for (const ids of chunks(publishedConfigurationIds, 200)) {
    const { error } = await db.from("wiper_configurations").update({ configuration_status: "published" }).in("id", ids);
    if (error) throw error;
  }
  await replaceUnsupportedReviewQueue(db, unsupported);

  const verification = await verifyDeployment(db, productPayload, wiperPayload, unsupported);
  return { backup_dir: backupDir, verification };
}

async function upsertCatalogues(db, prepared) {
  const catalogues = [
    ...prepared.brakeCatalog.map((row) => ({
      sku: row.sku,
      product: {
        slug: `brake-pad-${row.sku.toLowerCase()}`,
        name: row.title,
        category_slug: "brake-pad",
        price: row.priceNzd,
        description: `${row.position}. Dimensions and vehicle applications are listed on the product page.`,
        images: [row.imageUrl],
        active: true,
        visibility_status: "public",
        content_status: "approved",
        commerce_status: "active",
        checkout_enabled: true
      },
      variant: {
        sku: row.sku,
        price: row.priceNzd,
        stock: 999,
        attributes: {
          supplier_ref: row.supplierRef,
          position: row.position,
          length_mm: row.lengthMm,
          width_mm: row.widthMm,
          thickness_mm: row.thicknessMm
        },
        active: true
      }
    })),
    ...prepared.oilCatalog.map((row) => ({
      sku: row.sku,
      product: {
        slug: `oil-filter-${row.sku.toLowerCase()}`,
        name: row.title,
        category_slug: "filter",
        price: row.priceNzd,
        description: `${row.supplierRef}. Mostly for ${row.mostlyFor}.`,
        images: [row.imageUrl],
        active: true,
        visibility_status: "public",
        content_status: "approved",
        commerce_status: "active",
        checkout_enabled: true
      },
      variant: {
        sku: row.sku,
        price: row.priceNzd,
        stock: 999,
        attributes: {
          supplier_ref: row.supplierRef,
          topstar_ref: row.topstarRef,
          filter_type: row.category,
          height_mm: row.heightMm,
          outside_diameter_mm: row.outerDiameter,
          inside_diameter: row.insideDiameter,
          thread_size: row.threadSize,
          seal_ring_size: row.sealRingSize
        },
        active: true
      }
    }))
  ];

  const productIdBySlug = new Map();
  for (const group of chunks(catalogues.map((entry) => entry.product), 200)) {
    const { data, error } = await db.from("products").upsert(group, { onConflict: "slug" }).select("id,slug");
    if (error) throw error;
    for (const row of data) productIdBySlug.set(row.slug, row.id);
  }
  const variants = catalogues.map((entry) => ({ ...entry.variant, product_id: productIdBySlug.get(entry.product.slug) }));
  const variantBySku = new Map();
  for (const group of chunks(variants, 200)) {
    const { data, error } = await db.from("product_variants").upsert(group, { onConflict: "sku" }).select("id,sku");
    if (error) throw error;
    for (const row of data) variantBySku.set(row.sku, row.id);
  }
  return variantBySku;
}

async function replaceUnsupportedReviewQueue(db, rows) {
  const { error: dismissError } = await db.from("fitment_review_queue")
    .update({ review_status: "dismissed", resolution_notes: `Superseded by ${SOURCE_CODE}`, reviewed_at: new Date().toISOString() })
    .like("issue_type", "fitment_v6_wiper_%")
    .in("review_status", ["open", "in_progress"]);
  if (dismissError) throw dismissError;
  const compact = [...groupBy(rows, (row) => `${row.application_id}:${row.configuration_key}`).values()].map((group) => ({
    issue_type: "fitment_v6_wiper_unsupported_size",
    severity: "warning",
    review_status: "open",
    summary: `Wiper configuration ${group[0].configuration_key} needs an approved size or database rule update`,
    payload: { source: SOURCE_CODE, rows: group }
  }));
  await insertRows(db, "fitment_review_queue", compact);
}

async function verifyDeployment(db, productPayload, wiperPayload, unsupported) {
  const productTotal = await filteredCount(db, "vehicle_catalog_product_fitments", "source", SOURCE_CODE);
  const wiperTotal = await exactCount(db, "vehicle_catalog_wiper_fitments");
  if (productTotal !== productPayload.length) throw new Error(`Product fitment count mismatch: ${productTotal}/${productPayload.length}`);
  if (wiperTotal !== wiperPayload.length) throw new Error(`Wiper fitment count mismatch: ${wiperTotal}/${wiperPayload.length}`);
  return {
    product_fitments: productTotal,
    product_published: await filteredPairCount(db, "vehicle_catalog_product_fitments", "source", SOURCE_CODE, "fitment_status", "published"),
    product_review: await filteredPairCount(db, "vehicle_catalog_product_fitments", "source", SOURCE_CODE, "fitment_status", "review"),
    wiper_fitments: wiperTotal,
    wiper_published: await filteredCount(db, "vehicle_catalog_wiper_fitments", "fitment_status", "published"),
    wiper_review: await filteredCount(db, "vehicle_catalog_wiper_fitments", "fitment_status", "review"),
    unsupported_wiper_review_queue: unsupported.length
  };
}

async function writeProductionBackup(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp", "production-backups", `fitment-v6-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const tables = ["vehicle_catalog_product_fitments", "vehicle_catalog_wiper_fitments"];
  const manifest = { created_at: new Date().toISOString(), source: SOURCE_CODE, tables: {} };
  for (const table of tables) {
    const rows = await selectAll(db.from(table).select("*"));
    const content = JSON.stringify(rows, null, 2);
    fs.writeFileSync(path.join(directory, `${table}.json`), content);
    manifest.tables[table] = { rows: rows.length, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

function productNotes(row) {
  return [
    `confidence=${row.match_confidence}`,
    `score=${row.match_score}`,
    `method=${row.match_method}`,
    `matched_on=${row.matched_on}`,
    row.matched_engine_codes ? `engine_codes=${row.matched_engine_codes}` : "",
    `source_fitment=${row.source_fitment_id}`,
    `source_row=${row.source_row}`,
    `reference=${row.product_reference_match}`,
    `review=${row.review_status}`
  ].filter(Boolean).join("; ");
}

function wiperNotes(row, sellable) {
  return [
    `sku=${row.sku}`,
    `confidence=${row.match_confidence}`,
    `score=${row.match_score}`,
    `method=${row.match_method}`,
    `matched_on=${row.matched_on}`,
    `source_fitment=${row.source_fitment_id}`,
    `source_row=${row.source_row}`,
    `connector=${row.connector_type_candidates || row.connector_type || "unknown"}`,
    `connector_review=${row.connector_review_status}`,
    `sellable_pair=${sellable}`,
    `review=${row.review_status}`
  ].join("; ");
}

function isPurchasableWiperSet(row) {
  return row.active && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled;
}
function wiperPairKey(row) {
  const driver = Number(row.driver_in ?? row.driver_length_in);
  const passenger = Number(row.passenger_in ?? row.passenger_length_in);
  return `${Math.max(driver, passenger)}/${Math.min(driver, passenger)}`;
}
function readCsv(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing package file: ${file}`);
  const workbook = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
}
function hashPackage(packageDir) {
  const hash = crypto.createHash("sha256");
  for (const file of PACKAGE_FILES) hash.update(fs.readFileSync(path.join(packageDir, file)));
  return hash.digest("hex");
}
function assertCount(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} count mismatch: ${actual}/${expected}`);
}
function assertUnique(rows, keyFn, label) {
  const keys = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (keys.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
    keys.add(key);
  }
}
function countBy(rows, keyFn) {
  const result = {};
  for (const row of rows) result[keyFn(row)] = (result[keyFn(row)] ?? 0) + 1;
  return result;
}
function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  return result;
}
function chunks(rows, size = 500) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}
async function insertRows(db, table, rows) {
  for (const chunk of chunks(rows)) {
    if (!chunk.length) continue;
    const { error } = await db.from(table).insert(chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function upsertRows(db, table, rows, onConflict) {
  for (const chunk of chunks(rows)) {
    if (!chunk.length) continue;
    const { error } = await db.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}
async function deleteAll(db, table, primaryKey) {
  const { error } = await db.from(table).delete().not(primaryKey, "is", null);
  if (error) throw error;
}
async function exactCount(db, table) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}
async function filteredCount(db, table, column, value) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value);
  if (error) throw error;
  return count ?? 0;
}
async function filteredPairCount(db, table, firstColumn, firstValue, secondColumn, secondValue) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true })
    .eq(firstColumn, firstValue).eq(secondColumn, secondValue);
  if (error) throw error;
  return count ?? 0;
}
async function selectAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const packageIndex = process.argv.indexOf("--package");
  const packageDir = packageIndex >= 0 ? path.resolve(process.argv[packageIndex + 1]) : DEFAULT_PACKAGE_DIR;
  const prepared = prepareFitmentV6(packageDir);
  console.log(JSON.stringify(prepared.report, null, 2));
  loadEnv(path.resolve(".env.local"));
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service credentials.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const inspection = await inspectProduction(db, prepared);
  console.log(JSON.stringify({ production: inspection.current, missing_wiper_configurations: inspection.missingConfigurations }, null, 2));
  if (process.argv.includes("--apply")) console.log(JSON.stringify(await applyDeployment(db, prepared, inspection), null, 2));
  else if (!process.argv.includes("--report-only")) throw new Error("Choose --report-only or --apply.");
}
