import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

import {
  cleanText,
  compactPartKey,
  parseVehicleRow,
  splitBatteryRecommendations
} from "./catalog-v3-normalization.mjs";
import {
  BATTERY_TIER_PRIORITY,
  assessWiperRows,
  matchBatteryRow,
  matchFilterRow,
  parseYearRange,
  wiperConfigurationKey
} from "./fitment-v4-matcher.mjs";

const DATA_DIR = "C:\\Users\\Sanli\\repco_nexauto\\clean\\data";
const FILES = {
  vehicles: "repco格式_虚拟source_vehicle_id.xlsx",
  batteries: "battery_passenger_clean.csv",
  filters: "filter_crossref_clean.csv",
  wipers: "wiper_clean.csv"
};
const SOURCE_CODE = "NEXAUTO_PRODUCT_MAPPING_V4";
const SOURCE_NAME = "NexAuto product-specific fitment mapping V4";

const args = parseArgs(process.argv.slice(2));
const reportOnly = Boolean(args["report-only"]);
const apply = Boolean(args.apply);
if (!reportOnly && !apply) throw new Error("Choose --report-only or --apply.");

loadEnvFile(path.join(process.cwd(), ".env.local"));
const dataDir = path.resolve(String(args["data-dir"] ?? DATA_DIR));
const outputDir = path.resolve(String(args["output-dir"] ?? path.join(process.cwd(), "tmp", "fitment-v4")));
const sourcePaths = Object.fromEntries(Object.entries(FILES).map(([key, file]) => [key, path.join(dataDir, file)]));
for (const sourcePath of Object.values(sourcePaths)) if (!fs.existsSync(sourcePath)) throw new Error(`Missing source file: ${sourcePath}`);

const prepared = prepareMappings(sourcePaths);
writeOutputs(outputDir, prepared);
printReport(prepared.report, outputDir);
if (apply) await applyMappings(prepared, sourcePaths);

export function prepareMappings(paths) {
  const vehicleMatrix = readRows(paths.vehicles);
  const batteryMatrix = readRows(paths.batteries);
  const filterMatrix = readRows(paths.filters);
  const wiperMatrix = readRows(paths.wipers);

  const vehicles = vehicleMatrix.slice(1).map((row, index) => parseVehicleRow(row, index + 2)).filter((row) => row.parse_status !== "rejected");
  const batteries = batteryMatrix.slice(1).map((row, index) => ({
    row_number: index + 2,
    make: cleanText(row[0]),
    model: cleanText(row[1]),
    chassis_code: cleanText(row[2]),
    body: cleanText(row[3]),
    fuel: cleanText(row[4]),
    engine: cleanText(row[5]),
    drivetrain: cleanText(row[6]),
    year_start: cleanText(row[7]),
    year_end: cleanText(row[8]),
    highly_recommended: splitBatteryRecommendations(row[9]),
    recommended: splitBatteryRecommendations(row[10]),
    fits: splitBatteryRecommendations(row[11])
  }));
  const filters = filterMatrix.slice(1).map((row, index) => ({
    row_number: index + 2,
    supplier_part_number: cleanText(row[0]),
    cross_references: cleanText(row[1]),
    make: cleanText(row[2]),
    model: cleanText(row[3]),
    chassis_codes: cleanText(row[4]),
    body: cleanText(row[5]),
    engine_code: cleanText(row[6]),
    engine_displacement: cleanText(row[7]),
    drivetrain: cleanText(row[8]),
    year_start: cleanText(row[9]),
    year_end: cleanText(row[10]),
    source_description: cleanText(row[11])
  }));
  const wipers = wiperMatrix.slice(1).map((row, index) => {
    const range = parseYearRange(row[2]);
    return {
      row_number: index + 2,
      make: cleanText(row[0]),
      model: cleanText(row[1]),
      year_start: range.year_start,
      year_end: range.year_end,
      driver_length_in: numberOrNull(row[5]),
      passenger_length_in: numberOrNull(row[7]),
      rear_length_in: numberOrNull(row[9]),
      connector_type: cleanText(row[10])
    };
  });

  const batteriesByMake = groupBy(batteries, (row) => normalMake(row.make));
  const filtersByMake = groupBy(filters, (row) => normalMake(row.make));
  const wipersByMake = groupBy(wipers, (row) => normalMake(row.make));
  const fitments = [];
  const review = [];

  for (const vehicle of vehicles) {
    const vehicleContext = summarizeVehicle(vehicle);
    for (const source of batteriesByMake.get(vehicle.make_key) ?? []) {
      const decision = matchBatteryRow(vehicle, source);
      if (decision.status === "none") continue;
      const recommendations = batteryRecommendations(source);
      for (const recommendation of recommendations) {
        const candidate = {
          category: "battery",
          ...vehicleContext,
          product_sku: `BAT-${compactPartKey(recommendation.part_number)}`,
          product_part_number: recommendation.part_number,
          recommendation_level: recommendation.tier,
          mapping_status: vehicle.parse_status === "accepted" ? decision.status : "review",
          match_rule: decision.rule ?? decision.reason,
          confidence: decision.confidence,
          source_file: FILES.batteries,
          source_row_numbers: [source.row_number],
          match_reasons: decision.reasons
        };
        if (candidate.mapping_status === "published") fitments.push(candidate);
        else review.push({ ...candidate, issue: decision.reason ?? "vehicle_application_requires_review" });
      }
    }

    for (const source of filtersByMake.get(vehicle.make_key) ?? []) {
      const decision = matchFilterRow(vehicle, source);
      if (decision.status === "none") continue;
      const candidate = {
        category: "filter",
        ...vehicleContext,
        product_sku: `TOPSTAR-${compactPartKey(source.supplier_part_number)}`,
        product_part_number: source.supplier_part_number,
        recommendation_level: "compatible",
        mapping_status: vehicle.parse_status === "accepted" ? decision.status : "review",
        match_rule: decision.rule ?? decision.reason,
        confidence: decision.confidence,
        source_file: FILES.filters,
        source_row_numbers: [source.row_number],
        match_reasons: decision.reasons
      };
      if (candidate.mapping_status === "published") fitments.push(candidate);
      else review.push({ ...candidate, issue: decision.reason ?? "vehicle_application_requires_review" });
    }

    const wiperDecision = assessWiperRows(vehicle, wipersByMake.get(vehicle.make_key) ?? []);
    if (wiperDecision.status === "published" && vehicle.parse_status === "accepted") {
      fitments.push({
        category: "wiper",
        ...vehicleContext,
        product_sku: "",
        product_part_number: "",
        recommendation_level: "compatible",
        mapping_status: "published",
        match_rule: wiperDecision.reason,
        confidence: wiperDecision.confidence,
        configuration_key: wiperDecision.configuration_key,
        source_file: FILES.wipers,
        source_row_numbers: wiperDecision.evidence_rows.map((row) => row.row_number),
        match_reasons: ["exact_make", "exact_model", "overlapping_year", "single_configuration"]
      });
    } else if (wiperDecision.status === "review") {
      review.push({
        category: "wiper",
        ...vehicleContext,
        product_sku: "",
        product_part_number: "",
        recommendation_level: "compatible",
        mapping_status: "review",
        match_rule: wiperDecision.reason,
        confidence: 0.5,
        configuration_key: (wiperDecision.configuration_keys ?? []).join(" | "),
        source_file: FILES.wipers,
        source_row_numbers: wiperDecision.candidates.map((row) => row.row_number),
        match_reasons: ["chassis_or_generation_confirmation_required"],
        issue: wiperDecision.reason,
        required_discriminator: wiperDecision.required_discriminator,
        suggested_configuration_key: wiperDecision.suggested_configuration_key ?? "",
        suggestion_reason: wiperDecision.suggestion_reason ?? "",
        suggestion_confidence: wiperDecision.suggestion_confidence ?? null,
        candidate_ranges: [...new Set(wiperDecision.candidates.map((row) => {
          const end = row.year_end ?? "ON";
          return `${wiperConfigurationKey(row)} (${row.year_start ?? "?"}-${end})`;
        }))].join(" | ")
      });
    }
  }

  const published = dedupeFitments(fitments);
  const manualReview = dedupeReview(review);
  const nke = published.filter((row) => row.source_vehicle_id === "670" && row.category === "battery");
  if (nke.length !== 1 || nke[0].product_part_number !== "S34B20R") {
    throw new Error(`NKE165 invariant failed: expected only S34B20R, received ${nke.map((row) => row.product_part_number).join(", ") || "none"}.`);
  }

  const report = {
    mapping_version: 4,
    generated_at: new Date().toISOString(),
    rules: {
      battery: "make namespace + exact chassis; body/model/year/engine are not battery fitment keys",
      filter: "make namespace + exact engine; chassis/model/body/year are not filter fitment keys",
      wiper: "make + exact model + generation/chassis context; auto-publish only when all valid source evidence resolves to one approved configuration"
    },
    source_counts: { vehicles: vehicles.length, batteries: batteries.length, filters: filters.length, wipers: wipers.length },
    published_counts: countByCategory(published),
    published_vehicle_counts: countDistinctVehiclesByCategory(published),
    review_counts: countByCategory(manualReview),
    nke165_check: nke.map((row) => ({ source_vehicle_id: row.source_vehicle_id, chassis: row.chassis, product: row.product_part_number, rule: row.match_rule }))
  };
  return { vehicles, published, manualReview, report };
}

async function applyMappings(prepared, paths) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const applications = await selectAll(supabase.from("vehicle_fitment_applications").select("id,source_application_key").like("source_application_key", "NEXAUTO_V3:%"));
  const applicationBySourceId = new Map(applications.map((row) => [String(row.source_application_key).slice("NEXAUTO_V3:".length), row.id]));
  const variants = await selectAll(supabase.from("product_variants").select("id,sku,products!inner(category_slug)").in("products.category_slug", ["battery", "filter"]));
  const variantBySku = new Map(variants.map((row) => [row.sku, row.id]));
  assertDatabaseCoverage(prepared, applicationBySourceId, variantBySku);

  const productFitments = prepared.published.filter((row) => row.category !== "wiper");
  const wiperFitments = prepared.published.filter((row) => row.category === "wiper");
  const targetVariantIds = new Set(variants.map((row) => row.id));
  const existingProductFitments = [];
  const existingWiperFitments = [];
  for (const chunk of chunks([...applicationBySourceId.values()], 100)) {
    const productRows = await selectAll(supabase.from("vehicle_product_fitments").select("*").in("vehicle_application_id", chunk));
    existingProductFitments.push(...productRows.filter((row) => targetVariantIds.has(row.product_variant_id)));
    existingWiperFitments.push(...await selectAll(supabase.from("vehicle_wiper_fitments").select("*").in("vehicle_application_id", chunk)));
  }
  const existingEvidence = [];
  for (const chunk of chunks(existingProductFitments.map((row) => row.id), 100)) {
    if (chunk.length) existingEvidence.push(...await selectAll(supabase.from("vehicle_product_fitment_evidence").select("*").in("vehicle_product_fitment_id", chunk)));
  }
  const backupDir = writeProductionBackup(existingProductFitments, existingEvidence, existingWiperFitments, url);

  const batch = await getOrCreateImportBatch(supabase, prepared, paths);
  await updateStatusInChunks(supabase, "vehicle_product_fitments", existingProductFitments.map((row) => row.id), "superseded", `Superseded by ${SOURCE_CODE} batch ${batch.id}`);
  await updateStatusInChunks(supabase, "vehicle_wiper_fitments", existingWiperFitments.map((row) => row.id), "superseded", `Superseded by ${SOURCE_CODE} batch ${batch.id}`);

  const productPayload = productFitments.map((row) => ({
    vehicle_application_id: applicationBySourceId.get(row.source_vehicle_id),
    product_variant_id: variantBySku.get(row.product_sku),
    position: "vehicle",
    fitment_status: "published",
    notes: `${SOURCE_CODE}; rule=${row.match_rule}; recommendation=${row.recommendation_level}; source_rows=${row.source_row_numbers.join(",")}`
  }));
  await upsertRows(supabase, "vehicle_product_fitments", productPayload, "vehicle_application_id,product_variant_id,position");

  const savedProductFitments = [];
  for (const chunk of chunks([...applicationBySourceId.values()], 100)) {
    const rows = await selectAll(supabase.from("vehicle_product_fitments").select("id,vehicle_application_id,product_variant_id,position,fitment_status").in("vehicle_application_id", chunk).eq("fitment_status", "published"));
    savedProductFitments.push(...rows.filter((row) => targetVariantIds.has(row.product_variant_id)));
  }
  const savedByKey = new Map(savedProductFitments.map((row) => [`${row.vehicle_application_id}:${row.product_variant_id}`, row.id]));
  const evidence = productFitments.flatMap((row) => row.source_row_numbers.map((sourceRow) => ({
    vehicle_product_fitment_id: savedByKey.get(`${applicationBySourceId.get(row.source_vehicle_id)}:${variantBySku.get(row.product_sku)}`),
    import_batch_id: batch.id,
    source_row_number: sourceRow,
    evidence_kind: "supplier_catalogue",
    confidence: row.confidence,
    raw_values: {
      category: row.category,
      source_file: row.source_file,
      product_part_number: row.product_part_number,
      recommendation_level: row.recommendation_level,
      match_rule: row.match_rule,
      match_reasons: row.match_reasons
    }
  })).filter((row) => row.vehicle_product_fitment_id));
  await upsertRows(supabase, "vehicle_product_fitment_evidence", evidence, "vehicle_product_fitment_id,import_batch_id,source_row_number");

  const configurationIds = new Map();
  for (const configurationKey of [...new Set(wiperFitments.map((row) => row.configuration_key))]) {
    const [driver, passenger, rearText] = configurationKey.split("/");
    const { data, error } = await supabase.rpc("upsert_wiper_configuration", {
      p_driver_length_in: Number(driver),
      p_passenger_length_in: Number(passenger),
      p_rear_length_in: rearText === "-" ? null : Number(rearText)
    });
    if (error) throw error;
    configurationIds.set(configurationKey, data);
  }
  for (const ids of chunks([...configurationIds.values()], 100)) {
    const { error } = await supabase.from("wiper_configurations").update({ configuration_status: "published", notes: `${SOURCE_CODE}; conservative unique-configuration rule` }).in("id", ids);
    if (error) throw error;
  }
  await upsertRows(supabase, "vehicle_wiper_fitments", wiperFitments.map((row) => ({
    vehicle_application_id: applicationBySourceId.get(row.source_vehicle_id),
    wiper_configuration_id: configurationIds.get(row.configuration_key),
    fitment_status: "published",
    confidence: row.confidence,
    notes: `${SOURCE_CODE}; rule=${row.match_rule}; source_rows=${row.source_row_numbers.join(",")}`
  })), "vehicle_application_id,wiper_configuration_id");

  const compactReview = compactReviewRows(prepared.manualReview);
  const { error: dismissError } = await supabase.from("fitment_review_queue").update({ review_status: "dismissed", resolution_notes: `Superseded by ${SOURCE_CODE} batch ${batch.id}`, reviewed_at: new Date().toISOString() }).like("issue_type", "v4_%").in("review_status", ["open", "in_progress"]);
  if (dismissError) throw dismissError;
  await insertRows(supabase, "fitment_review_queue", compactReview.map((row) => ({
    issue_type: `v4_${row.category}_${row.issue}`.slice(0, 120),
    severity: "warning",
    review_status: "open",
    summary: `${row.category}: ${row.issue} for ${row.make} ${row.model} ${row.chassis}`,
    payload: row
  })));

  const { error: batchError } = await supabase.from("catalog_import_batches").update({
    import_status: compactReview.length ? "review" : "published",
    accepted_count: prepared.published.length,
    review_count: prepared.manualReview.length,
    completed_at: new Date().toISOString(),
    metadata: { mapping_version: 4, backup_dir: backupDir, review_queue_groups: compactReview.length, rules: prepared.report.rules }
  }).eq("id", batch.id);
  if (batchError) throw batchError;

  await verifyProduction(supabase, applicationBySourceId.get("670"), variantBySku);
  console.log(`Fitment V4 applied. Backup: ${backupDir}`);
  console.log(`Published: ${prepared.published.length}; review groups: ${compactReview.length}`);
}

async function getOrCreateImportBatch(supabase, prepared, paths) {
  const sourcePayload = {
    code: SOURCE_CODE,
    name: SOURCE_NAME,
    source_kind: "product_catalogue",
    vehicle_identity_priority: 100,
    product_fitment_priority: 1,
    metadata: { role: "fitment_mapping", version: 4, product_specific_rules: true }
  };
  const { data: source, error: sourceError } = await supabase.from("catalog_data_sources").upsert(sourcePayload, { onConflict: "code" }).select("id").single();
  if (sourceError) throw sourceError;
  const sourceHash = combinedSourceHash(paths);
  const { data: existing, error: existingError } = await supabase.from("catalog_import_batches").select("id,import_status").eq("data_source_id", source.id).eq("source_file_hash", sourceHash).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return existing;
  const { data, error } = await supabase.from("catalog_import_batches").insert({
    data_source_id: source.id,
    source_file: Object.values(FILES).join(", "),
    source_file_hash: sourceHash,
    sheet_name: "product-specific-fitments",
    import_status: "parsed",
    row_count: prepared.published.length + prepared.manualReview.length,
    accepted_count: prepared.published.length,
    review_count: prepared.manualReview.length,
    metadata: { mapping_version: 4, rules: prepared.report.rules }
  }).select("id,import_status").single();
  if (error) throw error;
  return data;
}

async function verifyProduction(supabase, nkeApplicationId, variantBySku) {
  const { data, error } = await supabase.from("vehicle_product_fitments").select("product_variant_id,fitment_status").eq("vehicle_application_id", nkeApplicationId).eq("fitment_status", "published");
  if (error) throw error;
  const batteryIds = new Set([...variantBySku].filter(([sku]) => sku.startsWith("BAT-")).map(([, id]) => id));
  const batteryRows = data.filter((row) => batteryIds.has(row.product_variant_id));
  const expectedId = variantBySku.get("BAT-S34B20R");
  if (batteryRows.length !== 1 || batteryRows[0].product_variant_id !== expectedId) throw new Error(`Production NKE165 verification failed: ${batteryRows.length} published batteries.`);
  console.log("Production verification: NKE165 has one published battery, S34B20R.");
}

function assertDatabaseCoverage(prepared, applications, variants) {
  const missingApplications = [...new Set(prepared.published.map((row) => row.source_vehicle_id).filter((id) => !applications.has(id)))];
  const missingVariants = [...new Set(prepared.published.filter((row) => row.category !== "wiper").map((row) => row.product_sku).filter((sku) => !variants.has(sku)))];
  if (missingApplications.length || missingVariants.length) throw new Error(`Database coverage failed. Missing applications: ${missingApplications.slice(0, 10).join(",")}; missing variants: ${missingVariants.slice(0, 10).join(",")}`);
}

function writeOutputs(outputDir, prepared) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "fitment-v4-report.json"), JSON.stringify(prepared.report, null, 2));
  fs.writeFileSync(path.join(outputDir, "fitment-v4-manifest.json"), JSON.stringify(prepared, null, 2));
  writeCsv(path.join(outputDir, "fitment-v4-published.csv"), flattenRows(prepared.published));
  writeCsv(path.join(outputDir, "fitment-v4-manual-review.csv"), flattenRows(prepared.manualReview));
}

function flattenRows(rows) {
  return rows.map((row) => ({ ...row, source_row_numbers: row.source_row_numbers.join(","), match_reasons: row.match_reasons.join(",") }));
}

function dedupeFitments(rows) {
  const grouped = groupBy(rows, (row) => row.category === "wiper" ? `${row.category}:${row.source_vehicle_id}:${row.configuration_key}` : `${row.category}:${row.source_vehicle_id}:${row.product_sku}`);
  const result = [];
  for (const group of grouped.values()) {
    group.sort((a, b) => (BATTERY_TIER_PRIORITY[b.recommendation_level] ?? 0) - (BATTERY_TIER_PRIORITY[a.recommendation_level] ?? 0));
    const first = group[0];
    result.push({
      ...first,
      source_row_numbers: [...new Set(group.flatMap((row) => row.source_row_numbers))].sort((a, b) => a - b),
      match_reasons: [...new Set(group.flatMap((row) => row.match_reasons))]
    });
  }
  return result.sort(mappingSort);
}

function dedupeReview(rows) {
  const grouped = groupBy(rows, (row) => `${row.category}:${row.source_vehicle_id}:${row.product_sku}:${row.configuration_key ?? ""}:${row.issue}`);
  return [...grouped.values()].map((group) => ({
    ...group[0],
    source_row_numbers: [...new Set(group.flatMap((row) => row.source_row_numbers))].sort((a, b) => a - b),
    match_reasons: [...new Set(group.flatMap((row) => row.match_reasons))]
  })).sort(mappingSort);
}

function compactReviewRows(rows) {
  const grouped = groupBy(rows, (row) => `${row.category}:${row.source_vehicle_id}:${row.issue}`);
  return [...grouped.values()].map((group) => ({
    category: group[0].category,
    source_vehicle_id: group[0].source_vehicle_id,
    make: group[0].make,
    model: group[0].model,
    chassis: group[0].chassis,
    body: group[0].body,
    engine: group[0].engine,
    year_start: group[0].year_start,
    year_end: group[0].year_end,
    issue: group[0].issue,
    candidate_count: group.length,
    candidates: group.slice(0, 25).map((row) => ({ product: row.product_part_number || row.configuration_key, source_rows: row.source_row_numbers }))
  }));
}

function batteryRecommendations(source) {
  const result = [];
  for (const [tier, values] of [["highly_recommended", source.highly_recommended], ["recommended", source.recommended], ["fits", source.fits]]) {
    for (const partNumber of values) result.push({ tier, part_number: partNumber });
  }
  return result;
}

function summarizeVehicle(vehicle) {
  return {
    source_vehicle_id: vehicle.source_vehicle_id,
    application_key: `NEXAUTO_V3:${vehicle.source_vehicle_id}`,
    make: vehicle.make,
    model: vehicle.model,
    chassis: vehicle.chassis_raw,
    body: vehicle.body_raw,
    engine: vehicle.engine_code,
    year_start: vehicle.year_start,
    year_end: vehicle.year_end
  };
}

function countByCategory(rows) {
  return Object.fromEntries([...groupBy(rows, (row) => row.category)].map(([category, items]) => [category, items.length]));
}

function countDistinctVehiclesByCategory(rows) {
  return Object.fromEntries([...groupBy(rows, (row) => row.category)].map(([category, items]) => [category, new Set(items.map((row) => row.source_vehicle_id)).size]));
}

function mappingSort(a, b) {
  return a.category.localeCompare(b.category) || a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.source_vehicle_id.localeCompare(b.source_vehicle_id, undefined, { numeric: true }) || a.product_sku.localeCompare(b.product_sku);
}

function normalMake(value) {
  return cleanText(value).toLocaleLowerCase("en-NZ").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function numberOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function readRows(filePath) {
  const workbook = path.extname(filePath).toLowerCase() === ".csv"
    ? XLSX.read(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""), { type: "string", raw: false })
    : XLSX.readFile(filePath, { cellDates: false, raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, blankrows: false, defval: "", raw: false });
}

function writeCsv(filePath, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  fs.writeFileSync(filePath, `\uFEFF${XLSX.utils.sheet_to_csv(worksheet)}`, "utf8");
}

function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function writeProductionBackup(productFitments, evidence, wiperFitments, url) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(process.cwd(), "tmp", "production-backups", `fitment-v4-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const files = { vehicle_product_fitments: productFitments, vehicle_product_fitment_evidence: evidence, vehicle_wiper_fitments: wiperFitments };
  const manifest = { created_at: new Date().toISOString(), project_url: url, tables: {} };
  for (const [name, rows] of Object.entries(files)) {
    const content = JSON.stringify(rows, null, 2);
    const filename = `${name}.json`;
    fs.writeFileSync(path.join(directory, filename), content);
    manifest.tables[name] = { rows: rows.length, file: filename, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

function combinedSourceHash(paths) {
  const hash = crypto.createHash("sha256");
  hash.update("fitment-v4-matcher-2026-10-20-chassis-engine-keys");
  for (const [key, filePath] of Object.entries(paths)) {
    hash.update(key);
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest("hex");
}

async function updateStatusInChunks(supabase, table, ids, fitmentStatus, notes) {
  for (const chunk of chunks(ids, 100)) {
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).update({ fitment_status: fitmentStatus, notes }).in("id", chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function upsertRows(supabase, table, rows, onConflict, size = 200) {
  for (const chunk of chunks(rows, size)) {
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function insertRows(supabase, table, rows, size = 200) {
  for (const chunk of chunks(rows, size)) {
    if (!chunk.length) continue;
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
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

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith("--")) continue;
    const key = values[index].slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}

function printReport(report, outputDir) {
  console.log(`Fitment V4 report written to ${outputDir}`);
  console.log(`Sources: ${JSON.stringify(report.source_counts)}`);
  console.log(`Published links: ${JSON.stringify(report.published_counts)}`);
  console.log(`Vehicles with published links: ${JSON.stringify(report.published_vehicle_counts)}`);
  console.log(`Manual review: ${JSON.stringify(report.review_counts)}`);
  console.log(`NKE165: ${JSON.stringify(report.nke165_check)}`);
}
