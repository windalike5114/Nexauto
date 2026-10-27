import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import {
  brakeFamily,
  bodyKey,
  chassisTokens,
  driveKey,
  evaluateBrakeFitment,
  platformCodeMatch,
  UNIQUE_FIRST_POLICY_VERSION
} from "./brake-pad-strict-policy.mjs";

const ROOT = process.cwd();
const DEFAULT_WORKBOOK = "C:/Users/Sanli/Desktop/database/Bendix刹车片_全量车找件_V01.xlsx";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const REFERENCE_SCHEME = "bendix_db";
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "bendix-full-reference-fitments-20261025");

export function readBendixWorkbook(file = DEFAULT_WORKBOOK) {
  if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}`);
  const bytes = fs.readFileSync(file);
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const sheetName = "01刹车片";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing worksheet: ${sheetName}`);
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  const rows = rawRows.map(normalizeSourceRow);
  const dbRows = rows.filter((row) => row.bendixReference);
  const seen = new Set();
  const uniqueRows = [];
  for (const row of dbRows) {
    const key = [row.makeKey, row.modelFamily, row.seriesKey, row.yearFrom, row.yearTo,
      row.bodyStyle, row.driveType, row.fuelType, row.displacementCc,
      [...row.engineCodes].sort().join("/"), row.bendixReference, row.position, row.lifecycleStatus].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }
  return {
    file,
    sheetName,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    rawRowCount: rows.length,
    nonDbRows: rows.filter((row) => !row.bendixReference),
    rows: dbRows,
    uniqueRows
  };
}

export function prepareReferencePlan(source, production) {
  const references = aggregateReferences(source.rows);
  const eligibleRows = source.uniqueRows.filter((row) =>
    row.position && ["active", "to_be_discontinued"].includes(row.lifecycleStatus));
  const sourceByFamilyPosition = groupBy(eligibleRows, (row) => `${row.modelFamily}|${row.position}`);
  const normalizedApplications = normalizeApplications(production);
  const plannedFitments = [];
  const unresolved = [];

  for (const application of normalizedApplications) {
    for (const position of ["front", "rear"]) {
      const familyRows = sourceByFamilyPosition.get(`${application.family}|${position}`) ?? [];
      if (!familyRows.length) continue;
      const plausible = plausibleRowsForApplication(application, familyRows);
      const candidateDbs = unique(plausible.map((row) => row.bendixReference));
      if (!candidateDbs.length) {
        unresolved.push(unresolvedRow(application, position, "no_exact_platform_or_year_match", [], familyRows));
        continue;
      }

      const verdicts = candidateDbs.map((dbReference) => ({
        dbReference,
        verdict: evaluateBrakeFitment(application.policyInput, position, dbReference, familyRows)
      }));
      const accepted = verdicts.filter((item) => item.verdict.keep);
      if (accepted.length === 1) {
        const item = accepted[0];
        plannedFitments.push(fitmentPlanRow(application, position, item.dbReference, item.verdict, "published"));
        continue;
      }

      const reviewDbs = unique(verdicts.flatMap((item) =>
        item.verdict.candidate_db?.length ? item.verdict.candidate_db : [item.dbReference]));
      const bestVerdict = verdicts.find((item) => item.verdict.rule === "multiple_brake_configurations")?.verdict
        ?? verdicts[0]?.verdict;
      if (reviewDbs.length) {
        for (const dbReference of reviewDbs) {
          plannedFitments.push(fitmentPlanRow(application, position, dbReference, bestVerdict, "review"));
        }
      }
      unresolved.push(unresolvedRow(
        application,
        position,
        bestVerdict?.rule ?? "unable_to_determine",
        reviewDbs,
        plausible,
        bestVerdict
      ));
    }
  }

  const identifierByDb = groupBy(
    production.productIdentifiers.filter((row) => row.identifier_type === "cross_reference" && /^DB\d+[A-Z]?$/.test(row.normalized_value)),
    (row) => row.normalized_value
  );
  const productLinks = [];
  for (const reference of references) {
    for (const identifier of identifierByDb.get(reference.normalized_value) ?? []) {
      productLinks.push({
        normalized_value: reference.normalized_value,
        product_variant_id: identifier.product_variant_id,
        product_identifier_id: identifier.id
      });
    }
  }

  const published = plannedFitments.filter((row) => row.fitment_status === "published");
  const review = plannedFitments.filter((row) => row.fitment_status === "review");
  const linkedDbs = new Set(productLinks.map((row) => row.normalized_value));
  const referenceCoveredApps = new Set(published.map((row) => row.application_id));
  const referenceCoveredYears = new Set(published.flatMap((row) => row.application_years.map((year) => `${row.application_id}|${year}`)));
  const conditionalReferenceApps = new Set(review.map((row) => row.application_id));
  const conditionalReferenceYears = new Set(review.flatMap((row) => row.application_years.map((year) => `${row.application_id}|${year}`)));
  const unresolvedApps = new Set(unresolved.map((row) => row.application_id));
  const applicationYearsById = new Map(normalizedApplications.map((row) => [row.application_id, row.years]));
  const activeApplicationIds = new Set(normalizedApplications.map((row) => row.application_id));
  const unresolvedYears = new Set([...unresolvedApps].flatMap((applicationId) =>
    (applicationYearsById.get(applicationId) ?? []).map((year) => `${applicationId}|${year}`)));
  const sellableVariantIds = new Set(production.productVariants.map((row) => row.id));
  const sellableApps = new Set(production.productFitments
    .filter((row) => row.fitment_status === "published"
      && activeApplicationIds.has(row.application_id)
      && sellableVariantIds.has(row.product_variant_id))
    .map((row) => row.application_id));
  const activeApplicationYears = new Set(normalizedApplications.flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const sellableApplicationYears = new Set(normalizedApplications
    .filter((row) => sellableApps.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "product_independent_reference_plan",
    policyVersion: UNIQUE_FIRST_POLICY_VERSION,
    source: {
      path: source.file,
      sheet: source.sheetName,
      sha256: source.sha256,
      rawRows: source.rawRowCount,
      dbRows: source.rows.length,
      uniqueDbRows: source.uniqueRows.length,
      nonDbRows: source.nonDbRows.length,
      lifecycleRows: countBy(source.rows, (row) => row.lifecycleStatus),
      uniqueDbReferences: references.length
    },
    references: {
      total: references.length,
      activeOrToBeDiscontinued: references.filter((row) => ["active", "to_be_discontinued"].includes(row.lifecycle_status)).length,
      linkedToExistingProduct: linkedDbs.size,
      referenceOnlyWithoutProduct: references.filter((row) => !linkedDbs.has(row.normalized_value)).length,
      productLinks: productLinks.length
    },
    matching: {
      activeApplications: normalizedApplications.length,
      publishedReferenceFitments: published.length,
      reviewReferenceFitments: review.length,
      applicationsWithPublishedReference: referenceCoveredApps.size,
      unresolvedApplicationPositions: unresolved.length,
      unresolvedReasons: countBy(unresolved, (row) => row.reason)
    },
    coverage: {
      application: coverageBlock(
        normalizedApplications.length,
        sellableApps,
        referenceCoveredApps,
        conditionalReferenceApps,
        unresolvedApps
      ),
      applicationYear: coverageBlock(
        activeApplicationYears.size,
        sellableApplicationYears,
        referenceCoveredYears,
        conditionalReferenceYears,
        unresolvedYears
      )
    },
    safeguards: [
      "Only worksheet 01刹车片 is imported by this brake-pad pipeline; discs, service shoes, drums and parking shoes remain separate product lines.",
      "No NexAuto product or SKU is created for a reference-only DB number.",
      "Review/multi-candidate reference fitments do not become sellable product fitments.",
      "This import does not modify vehicle_catalog_product_fitments."
    ]
  };

  return { references, productLinks, plannedFitments, unresolved, report };
}

function normalizeApplications(production) {
  const yearsByApplication = groupBy(production.years, (row) => row.application_id);
  const makeById = new Map(production.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(production.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(production.series.map((row) => [row.series_id, row]));
  const variantById = new Map(production.vehicleVariants.map((row) => [row.variant_id, row]));
  const powertrainById = new Map(production.powertrains.map((row) => [row.powertrain_id, row]));
  const engineCodeById = new Map(production.engineCodes.map((row) => [row.engine_code_id, normalizeIdentifier(row.code)]));
  const enginesByPowertrain = groupBy(production.powertrainEngineCodes, (row) => row.powertrain_id);
  return production.applications.filter((row) => row.status === "active").map((row) => {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(row.series_id);
    const variant = variantById.get(row.variant_id);
    const powertrain = powertrainById.get(row.powertrain_id);
    const years = (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
    const engineCodes = unique((enginesByPowertrain.get(row.powertrain_id) ?? [])
      .map((item) => engineCodeById.get(item.engine_code_id)).filter(Boolean));
    const seriesCode = series?.code ?? series?.display_name ?? "";
    const output = {
      application_id: row.application_id,
      make: make?.name ?? "",
      model: model?.name ?? "",
      family: brakeFamily(make?.name, model?.name),
      series: seriesCode,
      body: variant?.body_style ?? "",
      drive: variant?.drive_type ?? "",
      variant: variant?.display_name ?? "",
      engine: powertrain?.display_name ?? "",
      displacementCc: numberOrNull(powertrain?.displacement_cc),
      engineCodes,
      years
    };
    output.policyInput = { ...output, status: row.status };
    return output;
  });
}

function plausibleRowsForApplication(application, familyRows) {
  const years = application.years;
  const platform = familyRows.filter((row) => chassisTokens(row)
    .some((token) => platformCodeMatch(application.family, application.series, token)));
  let rows = platform;
  if (!rows.length && !normalizeIdentifier(application.series)) {
    rows = familyRows.filter((row) => years.some((year) => year >= row.yearFrom && year <= row.yearTo));
  }
  if (!rows.length) return [];
  const appBody = bodyKey(application.body);
  const appDrive = driveKey(application.drive || application.variant);
  if (appBody) {
    const compatible = rows.filter((row) => !bodyKey(row.bodyStyle) || bodyKey(row.bodyStyle) === appBody);
    if (compatible.length) rows = compatible;
  }
  if (appDrive) {
    const compatible = rows.filter((row) => !driveKey(row.driveType) || driveKey(row.driveType) === appDrive);
    if (compatible.length) rows = compatible;
  }
  const overlapping = rows.filter((row) => years.some((year) => year >= row.yearFrom && year <= row.yearTo));
  return overlapping.length ? overlapping : rows;
}

function fitmentPlanRow(application, position, dbReference, verdict = {}, status) {
  const sourceRows = uniqueNumbers(verdict.source_rows?.length ? verdict.source_rows : verdict.platform_source_rows ?? []);
  return {
    application_id: application.application_id,
    position,
    normalized_value: dbReference,
    fitment_status: status,
    confidence: status === "published"
      ? (verdict.provisional ? "provisional_unique" : "exact")
      : "review",
    source_row_numbers: sourceRows,
    match_reasons: unique([verdict.rule, ...(verdict.warnings ?? [])].filter(Boolean)),
    metadata: {
      policy_version: UNIQUE_FIRST_POLICY_VERSION,
      candidate_db: verdict.candidate_db ?? [],
      missing_years: verdict.missing_years ?? [],
      missing_engine_years: verdict.missing_engine_years ?? [],
      reasons: verdict.reasons ?? [],
      evidence_urls: verdict.evidence_urls ?? []
    },
    application_years: application.years,
    make: application.make,
    model: application.model,
    series: application.series,
    variant: application.variant,
    engine: application.engine
  };
}

function unresolvedRow(application, position, reason, candidates, rows, verdict = {}) {
  return {
    application_id: application.application_id,
    make: application.make,
    model: application.model,
    years: application.years.join(","),
    series: application.series,
    body: application.body,
    drive: application.drive,
    engine: application.engine,
    position,
    reason,
    candidate_db: candidates.join(" | "),
    source_rows: uniqueNumbers(rows.flatMap((row) => row.sourceRowId)).join(","),
    detail: (verdict.reasons ?? []).join("；")
  };
}

function aggregateReferences(rows) {
  const grouped = groupBy(rows, (row) => row.bendixReference);
  return [...grouped.entries()].map(([dbReference, items]) => {
    const lifecycle = preferredLifecycle(items.map((row) => row.lifecycleStatus));
    const first = items[0];
    const compounds = unique(items.map((row) => row.compound).filter(Boolean));
    const oemNumbers = unique(items.flatMap((row) => row.oemNumbers));
    return {
      product_type: "brake_pad",
      reference_scheme: REFERENCE_SCHEME,
      reference_value: dbReference,
      normalized_value: dbReference,
      lifecycle_status: lifecycle,
      width_mm: first.dimensions[0],
      height_mm: first.dimensions[1],
      thickness_mm: first.dimensions[2],
      metadata: {
        source_code: SOURCE_CODE,
        source_statuses: unique(items.map((row) => row.rawStatus).filter(Boolean)),
        compounds,
        oem_number_count: oemNumbers.length,
        oem_number_sample: oemNumbers.slice(0, 30),
        source_row_count: items.length
      }
    };
  }).sort((left, right) => left.normalized_value.localeCompare(right.normalized_value, undefined, { numeric: true }));
}

export function normalizeSourceRow(row) {
  const rawPartNumber = clean(row["件号"]);
  const bendixMatch = upper(rawPartNumber).match(/DB\d+[A-Z]?/);
  const makeName = clean(row["品牌(英文)"]);
  const modelName = clean(row["车型"]);
  return {
    sourceRowId: Number(row["行ID"]),
    makeName,
    makeKey: normalizeIdentifier(makeName),
    modelName,
    modelFamily: brakeFamily(makeName, modelName),
    seriesName: clean(row["车系"]),
    seriesKey: normalizeIdentifier(row["车系"]),
    yearFrom: numberOrNull(row["年款起"]) ?? 0,
    // A blank catalogue end year means the fitment is current/open-ended.
    // Treating it as Number("") === 0 made every current model look outside
    // the Bendix range and triggered unsafe provisional extrapolation.
    yearTo: numberOrNull(row["年款止"]) ?? 9999,
    bodyStyle: clean(row["车身"]),
    driveType: clean(row["驱动"]),
    fuelType: clean(row["燃料"]),
    displacementCc: numberOrNull(row["排量(cc)"]),
    // The strict policy evaluates engine codes with Array methods (`some`,
    // `length`).  Keep the normalized source representation aligned with the
    // production application representation instead of using a Set here.
    engineCodes: unique(splitCodes(row["发动机码"])),
    bendixReference: bendixMatch?.[0] ?? "",
    rawPartNumber,
    compound: clean(row["子品牌"]),
    position: normalizePosition(row["位置"]),
    rawStatus: clean(row["状态"]),
    lifecycleStatus: normalizeLifecycle(row["状态"]),
    dimensions: [numberOrNull(row["宽(mm)"]), numberOrNull(row["高(mm)"]), numberOrNull(row["厚(mm)"])],
    oemNumbers: splitOem(row["OEM号"])
  };
}

async function loadProduction(db) {
  const [applications, years, makes, models, series, vehicleVariants, powertrains, engineCodes,
    powertrainEngineCodes, products, productFitments, productIdentifiers] = await Promise.all([
    fetchAll(db, "vehicle_catalog_applications", "*"),
    fetchAll(db, "vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll(db, "vehicle_catalog_makes", "make_id,name,normalized_name,status"),
    fetchAll(db, "vehicle_catalog_models", "model_id,make_id,name,normalized_name,status"),
    fetchAll(db, "vehicle_catalog_series", "series_id,model_id,code,normalized_code,display_name,status"),
    fetchAll(db, "vehicle_catalog_variants", "variant_id,display_name,body_style,drive_type,vehicle_class,parse_status"),
    fetchAll(db, "vehicle_catalog_powertrains", "powertrain_id,make_id,display_name,displacement_cc,fuel_type,powertrain_type,parse_status"),
    fetchAll(db, "vehicle_catalog_engine_codes", "engine_code_id,make_id,code,normalized_code"),
    fetchAll(db, "vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id,is_primary"),
    fetchAll(db, "products", "id,name,category_slug", (query) => query.eq("category_slug", "brake-pad")),
    fetchAll(db, "vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status,source"),
    fetchAll(db, "product_identifiers", "id,product_variant_id,identifier_type,identifier_value,normalized_value,is_primary")
  ]);
  const productVariants = await selectInChunks(db, "product_variants", "id,product_id,sku,attributes", "product_id", products.map((row) => row.id));
  return { applications, years, makes, models, series, vehicleVariants, powertrains, engineCodes,
    powertrainEngineCodes, products, productVariants, productFitments, productIdentifiers };
}

async function applyPlan(db, source, plan) {
  const { data: dataSource, error: sourceError } = await db.from("catalog_data_sources")
    .select("id,code").eq("code", SOURCE_CODE).single();
  if (sourceError) throw new Error(`Data source missing; deploy migration first: ${sourceError.message}`);
  const backupDir = await backupSourceState(db, dataSource.id);

  let { data: importBatch, error: batchReadError } = await db.from("catalog_import_batches")
    .select("id").eq("data_source_id", dataSource.id).eq("source_file_hash", source.sha256).maybeSingle();
  if (batchReadError) throw batchReadError;
  const batchPayload = {
    data_source_id: dataSource.id,
    source_file: path.basename(source.file),
    source_file_hash: source.sha256,
    sheet_name: source.sheetName,
    import_status: "review",
    row_count: source.rawRowCount,
    accepted_count: plan.plannedFitments.filter((row) => row.fitment_status === "published").length,
    review_count: plan.plannedFitments.filter((row) => row.fitment_status === "review").length,
    rejected_count: source.nonDbRows.length,
    imported_by: "scripts/catalog/import-bendix-full-reference-fitments-20261025.mjs",
    metadata: { policy_version: UNIQUE_FIRST_POLICY_VERSION, source_confidence: "highest" }
  };
  if (importBatch) {
    const { error } = await db.from("catalog_import_batches").update(batchPayload).eq("id", importBatch.id);
    if (error) throw error;
  } else {
    const { data, error } = await db.from("catalog_import_batches").insert(batchPayload).select("id").single();
    if (error) throw error;
    importBatch = data;
  }

  for (const batch of chunks(plan.references, 250)) {
    const { error } = await db.from("catalog_part_references").upsert(batch, {
      onConflict: "product_type,reference_scheme,normalized_value"
    });
    if (error) throw error;
  }
  const referenceRows = await fetchAll(db, "catalog_part_references", "id,normalized_value",
    (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", REFERENCE_SCHEME));
  const referenceIdByValue = new Map(referenceRows.map((row) => [row.normalized_value, row.id]));

  const productLinkPayload = plan.productLinks.map((row) => ({
    part_reference_id: referenceIdByValue.get(row.normalized_value),
    product_variant_id: row.product_variant_id,
    relation_type: "exact_cross_reference",
    verification_status: "verified",
    metadata: { product_identifier_id: row.product_identifier_id, source_code: SOURCE_CODE }
  })).filter((row) => row.part_reference_id);
  for (const batch of chunks(productLinkPayload, 250)) {
    const { error } = await db.from("catalog_part_reference_products").upsert(batch, {
      onConflict: "part_reference_id,product_variant_id,relation_type"
    });
    if (error) throw error;
  }
  const desiredProductLinkKeys = new Set(productLinkPayload.map((row) =>
    `${row.part_reference_id}|${row.product_variant_id}|${row.relation_type}`));
  const existingSourceLinks = await fetchAll(
    db,
    "catalog_part_reference_products",
    "part_reference_id,product_variant_id,relation_type",
    (query) => query.contains("metadata", { source_code: SOURCE_CODE })
  );
  const staleProductLinks = existingSourceLinks.filter((row) =>
    !desiredProductLinkKeys.has(`${row.part_reference_id}|${row.product_variant_id}|${row.relation_type}`));
  for (const batch of chunks(staleProductLinks, 20)) {
    const results = await Promise.all(batch.map((row) => db.from("catalog_part_reference_products")
      .delete()
      .eq("part_reference_id", row.part_reference_id)
      .eq("product_variant_id", row.product_variant_id)
      .eq("relation_type", row.relation_type)));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  }

  const fitmentPayload = plan.plannedFitments.map((row) => ({
    application_id: row.application_id,
    part_reference_id: referenceIdByValue.get(row.normalized_value),
    position: row.position,
    data_source_id: dataSource.id,
    import_batch_id: importBatch.id,
    fitment_status: row.fitment_status,
    confidence: row.confidence,
    source_row_numbers: row.source_row_numbers,
    match_reasons: row.match_reasons,
    metadata: row.metadata
  })).filter((row) => row.part_reference_id);
  for (const batch of chunks(fitmentPayload, 200)) {
    const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(batch, {
      onConflict: "application_id,part_reference_id,position,data_source_id"
    });
    if (error) throw error;
  }
  // Treat this source as an exact snapshot. Import batches are intentionally
  // reused for an identical source file hash, so batch_id alone cannot detect
  // rows removed by a newer normalization policy. Compare the full fitment
  // primary key and delete only source rows absent from the successful plan.
  const desiredFitmentKeys = new Set(fitmentPayload.map((row) =>
    `${row.application_id}|${row.part_reference_id}|${row.position}|${row.data_source_id}`));
  const existingSourceFitments = await fetchAll(
    db,
    "vehicle_catalog_part_reference_fitments",
    "application_id,part_reference_id,position,data_source_id",
    (query) => query.eq("data_source_id", dataSource.id)
  );
  const staleSourceFitments = existingSourceFitments.filter((row) =>
    !desiredFitmentKeys.has(`${row.application_id}|${row.part_reference_id}|${row.position}|${row.data_source_id}`));
  for (const batch of chunks(staleSourceFitments, 20)) {
    const results = await Promise.all(batch.map((row) => db.from("vehicle_catalog_part_reference_fitments")
      .delete()
      .eq("application_id", row.application_id)
      .eq("part_reference_id", row.part_reference_id)
      .eq("position", row.position)
      .eq("data_source_id", row.data_source_id)));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  }

  const { count: storedFitmentCount, error: fitmentCountError } = await db
    .from("vehicle_catalog_part_reference_fitments")
    .select("*", { count: "exact", head: true })
    .eq("data_source_id", dataSource.id)
    .eq("import_batch_id", importBatch.id);
  if (fitmentCountError) throw fitmentCountError;
  if (storedFitmentCount !== fitmentPayload.length) {
    throw new Error(`Reference fitment readback mismatch: expected ${fitmentPayload.length}, received ${storedFitmentCount}`);
  }

  const completedAt = new Date().toISOString();
  const { error: completeError } = await db.from("catalog_import_batches").update({
    import_status: plan.unresolved.length ? "review" : "published",
    completed_at: completedAt
  }).eq("id", importBatch.id);
  if (completeError) throw completeError;
  return {
    backupDir,
    importBatchId: importBatch.id,
    referencesUpserted: plan.references.length,
    productLinksUpserted: productLinkPayload.length,
    staleProductLinksDeleted: staleProductLinks.length,
    referenceFitmentsUpserted: fitmentPayload.length,
    staleReferenceFitmentsDeleted: staleSourceFitments.length,
    publishedReferenceFitments: fitmentPayload.filter((row) => row.fitment_status === "published").length,
    reviewReferenceFitments: fitmentPayload.filter((row) => row.fitment_status === "review").length,
    completedAt
  };
}

async function backupSourceState(db, dataSourceId) {
  const [batches, references, fitments] = await Promise.all([
    fetchAll(db, "catalog_import_batches", "*", (query) => query.eq("data_source_id", dataSourceId)),
    fetchAll(db, "catalog_part_references", "*", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", REFERENCE_SCHEME)),
    fetchAll(db, "vehicle_catalog_part_reference_fitments", "*", (query) => query.eq("data_source_id", dataSourceId)),
  ]);
  const productLinks = await selectInChunks(db, "catalog_part_reference_products", "*",
    "part_reference_id", references.map((row) => row.id));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "tmp", "production-backups", `bendix-full-reference-fitments-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const tables = { batches, references, productLinks, fitments };
  const manifest = { created_at: new Date().toISOString(), source_code: SOURCE_CODE, data_source_id: dataSourceId, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const contents = JSON.stringify(rows, null, 2);
    const filename = `${name}.json`;
    fs.writeFileSync(path.join(dir, filename), contents);
    manifest.tables[name] = { rows: rows.length, filename,
      sha256: crypto.createHash("sha256").update(contents).digest("hex") };
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const reportOnly = process.argv.includes("--report-only");
  if (apply === reportOnly) throw new Error("Choose exactly one of --report-only or --apply.");
  const workbookArg = process.argv.find((value) => value.startsWith("--workbook="));
  const workbook = path.resolve(workbookArg ? workbookArg.slice("--workbook=".length) : DEFAULT_WORKBOOK);
  loadEnv(path.resolve(ROOT, ".env.local"));
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase production credentials.");
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const source = readBendixWorkbook(workbook);
  const production = await loadProduction(db);
  const plan = prepareReferencePlan(source, production);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), JSON.stringify(plan.report, null, 2));
  writeCsv(path.join(OUTPUT_DIR, "references.csv"), plan.references.map(flattenObject));
  writeCsv(path.join(OUTPUT_DIR, "published-reference-fitments.csv"), plan.plannedFitments.filter((row) => row.fitment_status === "published").map(flattenFitment));
  writeCsv(path.join(OUTPUT_DIR, "review-reference-fitments.csv"), plan.plannedFitments.filter((row) => row.fitment_status === "review").map(flattenFitment));
  writeCsv(path.join(OUTPUT_DIR, "unresolved.csv"), plan.unresolved);
  let applied = null;
  if (apply) applied = await applyPlan(db, source, plan);
  if (applied) fs.writeFileSync(path.join(OUTPUT_DIR, "applied.json"), JSON.stringify(applied, null, 2));
  console.log(JSON.stringify({ mode: apply ? "apply" : "report", outputDir: OUTPUT_DIR, ...plan.report, applied }, null, 2));
}

function preferredLifecycle(values) {
  const statuses = new Set(values);
  for (const status of ["active", "to_be_discontinued", "superseded", "discontinued", "unknown"]) {
    if (statuses.has(status)) return status;
  }
  return "unknown";
}
function normalizeLifecycle(value) {
  const text = lower(value);
  if (text === "active") return "active";
  if (text.includes("to be discontinued")) return "to_be_discontinued";
  if (text === "discontinued") return "discontinued";
  if (text === "superseded") return "superseded";
  return "unknown";
}
function normalizePosition(value) {
  const text = clean(value);
  if (text === "前" || /^front$/i.test(text)) return "front";
  if (text === "后" || /^rear$/i.test(text)) return "rear";
  return "";
}
function splitCodes(value) { return upper(value).split(/[\/,;|]+/).map(normalizeIdentifier).filter((item) => item.length >= 2); }
function splitOem(value) { return unique(upper(value).split(/[\/,;|]+/).map(normalizeIdentifier).filter(Boolean)); }
function normalizeIdentifier(value) { return upper(value).replace(/[^A-Z0-9]/g, ""); }
function clean(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function unique(values) { return [...new Set(values)]; }
function uniqueNumbers(values) { return unique(values.map(Number).filter((value) => Number.isInteger(value) && value > 0)).sort((a, b) => a - b); }
function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const rows = output.get(key) ?? [];
    rows.push(value);
    output.set(key, rows);
  }
  return output;
}
function countBy(values, keyFn) {
  const output = {};
  for (const value of values) {
    const key = keyFn(value) || "unknown";
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}
export function coverageBlock(total, sellableKeys, publishedReferenceKeys, conditionalReferenceKeys = new Set(), unresolvedReferenceKeys = new Set()) {
  const sellable = new Set(sellableKeys);
  const published = new Set(publishedReferenceKeys);
  const conditional = new Set(conditionalReferenceKeys);
  const unresolved = new Set(unresolvedReferenceKeys);
  const uniqueKnowledge = new Set([...sellable, ...published]);
  const conditionalKnowledge = new Set([...uniqueKnowledge, ...conditional]);
  const sourceRelevantCeiling = new Set([...conditionalKnowledge, ...unresolved]);
  return {
    total,
    sellableCovered: sellable.size,
    sellableRate: total ? Number((sellable.size / total).toFixed(4)) : 0,
    publishedReferenceCovered: published.size,
    publishedReferenceRate: total ? Number((published.size / total).toFixed(4)) : 0,
    uniqueKnowledgeCovered: uniqueKnowledge.size,
    uniqueKnowledgeRate: total ? Number((uniqueKnowledge.size / total).toFixed(4)) : 0,
    uniqueReferenceKnowledgeGain: Math.max(0, uniqueKnowledge.size - sellable.size),
    conditionalReferenceCovered: conditional.size,
    conditionalKnowledgeCovered: conditionalKnowledge.size,
    conditionalKnowledgeRate: total ? Number((conditionalKnowledge.size / total).toFixed(4)) : 0,
    conditionalReferenceKnowledgeGain: Math.max(0, conditionalKnowledge.size - uniqueKnowledge.size),
    unresolvedSourceRelevantCovered: unresolved.size,
    sourceRelevantCeilingCovered: sourceRelevantCeiling.size,
    sourceRelevantCeilingRate: total ? Number((sourceRelevantCeiling.size / total).toFixed(4)) : 0
  };
}
function flattenObject(row) { return { ...row, metadata: JSON.stringify(row.metadata) }; }
function flattenFitment(row) {
  return {
    application_id: row.application_id,
    make: row.make,
    model: row.model,
    application_years: row.application_years.join(","),
    series: row.series,
    variant: row.variant,
    engine: row.engine,
    position: row.position,
    bendix_reference: row.normalized_value,
    fitment_status: row.fitment_status,
    confidence: row.confidence,
    source_row_numbers: row.source_row_numbers.join(","),
    match_reasons: row.match_reasons.join(" | "),
    metadata: JSON.stringify(row.metadata)
  };
}
function chunks(rows, size) {
  const output = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}
function writeCsv(file, rows) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))];
  fs.writeFileSync(file, `\uFEFF${lines.join("\r\n")}\r\n`);
}
function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
async function fetchAll(db, table, columns, filter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
async function selectInChunks(db, table, columns, field, values) {
  const output = [];
  for (const batch of chunks(unique(values), 100)) {
    if (!batch.length) continue;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select(columns).in(field, batch).range(from, from + 999);
      if (error) throw error;
      output.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
  }
  return output;
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
