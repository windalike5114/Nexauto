import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { evaluateBrakeFitment, UNIQUE_FIRST_POLICY_VERSION } from './brake-pad-strict-policy.mjs';

const APPLY = process.argv.includes("--apply");
const REPORT_ONLY = process.argv.includes("--report-only");
if (APPLY === REPORT_ONLY) throw new Error("Choose exactly one of --report-only or --apply.");

const ROOT = process.cwd();
const SOURCE_CODE = "BENDIX_TOPSTAR_SUPPLIED_FITMENTS_2026_10_24";
const WORKBOOK = path.resolve("C:/Users/Sanli/Desktop/Bendix_TopstarSupplied_Rows_2026-10-24.xlsx");
const CATALOG_FILE = path.resolve(ROOT, "data", "brake-pads", "catalog.json");
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "bendix-topstar-fitments-20261024");

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase production credentials.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const source = readSourceWorkbook(WORKBOOK);
const production = await loadProduction();
const prepared = prepareImport(source, production);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const reportPath = path.join(OUTPUT_DIR, APPLY ? "apply-plan.json" : "report.json");
fs.writeFileSync(reportPath, JSON.stringify(prepared.report, null, 2));
writeCsv(path.join(OUTPUT_DIR, "待人工确认.csv"), prepared.reviewRows);
writeCsv(path.join(OUTPUT_DIR, "可发布.csv"), prepared.publishRows.map(flattenPublishRow));
fs.writeFileSync(path.join(OUTPUT_DIR, "confirmation-data.json"), JSON.stringify({
  report: prepared.report,
  review: prepared.reviewRows,
  sourceRows: source.uniqueRows.map((row) => ({ ...row, engineCodes: [...row.engineCodes], modelKeys: [...row.modelKeys] })),
  replacements: prepared.replacements.map((row) => ({
    ...flattenPublishRow(row.candidate), old_sku: row.oldSku, old_source: row.existing.source,
    old_status: row.existing.fitment_status, old_notes: row.existing.notes
  }))
}, null, 2));

let applied = null;
if (APPLY) {
  if (prepared.blockers.length) throw new Error(`Preflight has ${prepared.blockers.length} blocker(s).`);
  applied = await applyPrepared(prepared, production);
  fs.writeFileSync(path.join(OUTPUT_DIR, "applied.json"), JSON.stringify(applied, null, 2));
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "report",
  reportPath,
  sourceRows: source.rows.length,
  deduplicatedRows: source.uniqueRows.length,
  publishRows: prepared.publishRows.length,
  newRows: prepared.newRows.length,
  alreadyPublished: prepared.alreadyPublished.length,
  reviewRows: prepared.reviewRows.length,
  blockers: prepared.blockers,
  applied
}, null, 2));

export function prepareImport(source, production) {
  const blockers = [];
  const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  const productByBendix = new Map(catalog.map((row) => [normalizeIdentifier(row.supplierRef), row]));
  const productVariantsBySku = new Map(production.productVariants.map((row) => [upper(row.sku), row]));
  const sourceRefs = new Set(source.uniqueRows.map((row) => row.bendixReference).filter(Boolean));
  const directRefs = [...sourceRefs].filter((ref) => productByBendix.has(ref)).sort();
  const sourceRefsWithoutProduct = [...sourceRefs].filter((ref) => !productByBendix.has(ref)).sort();
  const catalogRefsWithoutSource = [...productByBendix.keys()].filter((ref) => !sourceRefs.has(ref)).sort();

  const productMap = new Map();
  for (const ref of directRefs) {
    const catalogRow = productByBendix.get(ref);
    const variant = productVariantsBySku.get(upper(catalogRow.sku));
    if (!variant) {
      blockers.push({ reason: "catalog_sku_missing_in_production", sku: catalogRow.sku, bendixReference: ref });
      continue;
    }
    productMap.set(ref, { ...catalogRow, productVariantId: variant.id });
  }

  const engineCodesByPowertrain = groupBy(production.powertrainEngineCodes, (row) => row.powertrain_id);
  const engineCodeById = new Map(production.engineCodes.map((row) => [row.engine_code_id, normalizeIdentifier(row.code)]));
  const yearsByApplication = groupBy(production.years, (row) => row.application_id);
  const makeById = new Map(production.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(production.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(production.series.map((row) => [row.series_id, row]));
  const variantById = new Map(production.vehicleVariants.map((row) => [row.variant_id, row]));
  const powertrainById = new Map(production.powertrains.map((row) => [row.powertrain_id, row]));

  const applications = production.applications.filter((row) => row.status === "active").map((row) => {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(row.series_id);
    const variant = variantById.get(row.variant_id);
    const powertrain = powertrainById.get(row.powertrain_id);
    const years = (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
    const engineCodes = new Set((engineCodesByPowertrain.get(row.powertrain_id) ?? []).map((item) => engineCodeById.get(item.engine_code_id)).filter(Boolean));
    return {
      ...row,
      makeName: make?.name ?? "",
      makeKey: canonicalMake(make?.name),
      modelName: model?.name ?? "",
      modelKeys: canonicalModelKeys(model?.name),
      seriesName: series?.display_name ?? series?.code ?? "",
      seriesKey: normalizeIdentifier(series?.code),
      bodyStyle: lower(variant?.body_style),
      driveType: lower(variant?.drive_type),
      variantName: variant?.display_name ?? "",
      engineName: powertrain?.display_name ?? "",
      displacementCc: numberOrNull(powertrain?.displacement_cc),
      fuelType: lower(powertrain?.fuel_type),
      engineCodes,
      years
    };
  });

  const applicationsByMake = groupBy(applications, (row) => row.makeKey);
  const evidenceByFitment = new Map();
  const reviewRows = [];
  const mappedSourceRows = [];

  for (const row of source.uniqueRows) {
    const product = productMap.get(row.bendixReference);
    if (!row.bendixReference) {
      reviewRows.push(reviewRow(row, "invalid_bendix_reference"));
      continue;
    }
    if (!product) {
      reviewRows.push(reviewRow(row, "bendix_reference_not_listed_as_exact_nexauto_product"));
      continue;
    }
    if (!row.position) {
      reviewRows.push(reviewRow(row, "invalid_position"));
      continue;
    }

    const makeCandidates = applicationsByMake.get(row.makeKey) ?? [];
    const modelCandidates = makeCandidates.filter((application) => setsIntersect(row.modelKeys, application.modelKeys));
    const scored = modelCandidates.map((application) => scoreMatch(row, application)).filter((match) => match.overlap);
    const high = scored.filter((match) => match.highConfidence);

    if (!high.length) {
      reviewRows.push(reviewRow(row, scored.length ? "no_high_confidence_application" : "no_make_model_year_application", {
        candidate_count: scored.length,
        candidate_applications: scored.slice(0, 8).map((match) => match.application.application_id).join(" | ")
      }));
      continue;
    }

    for (const match of high) {
      const key = `${match.application.application_id}|${row.position}|${product.productVariantId}`;
      const evidence = evidenceByFitment.get(key) ?? {
        application: match.application,
        product,
        position: row.position,
        rows: [],
        matchReasons: new Set(),
        sourceRowIds: new Set()
      };
      evidence.rows.push(row);
      match.reasons.forEach((reason) => evidence.matchReasons.add(reason));
      evidence.sourceRowIds.add(row.sourceRowId);
      evidenceByFitment.set(key, evidence);
      mappedSourceRows.push(row.sourceRowId);
    }
  }

  const evidenceRows = [...evidenceByFitment.values()];
  const byApplicationPosition = groupBy(evidenceRows, (row) => `${row.application.application_id}|${row.position}`);
  const existingByApplicationPosition = groupBy(production.productFitments, (row) => `${row.application_id}|${row.position}`);
  const skuByVariantId = new Map(production.productVariants.map((row) => [row.id, upper(row.sku)]));
  const publishRows = [];
  const replacements = [];

  for (const [applicationPosition, candidates] of byApplicationPosition) {
    const candidateSkus = [...new Set(candidates.map((row) => row.product.sku))];
    const existingPublished = (existingByApplicationPosition.get(applicationPosition) ?? []).filter((row) => row.fitment_status === "published");
    const existingSkus = [...new Set(existingPublished.map((row) => skuByVariantId.get(row.product_variant_id)).filter(Boolean))];
    if (candidateSkus.length !== 1) {
      const engineMatchedCandidates = candidates.filter((candidate) => candidate.rows.some((row) => (
        row.engineCodes.size > 0 &&
        candidate.application.engineCodes.size > 0 &&
        setsIntersect(row.engineCodes, candidate.application.engineCodes)
      )));
      const engineMatchedSkus = [...new Set(engineMatchedCandidates.map((row) => row.product.sku))];
      if (engineMatchedSkus.length === 1) {
        const selected = engineMatchedCandidates.find((row) => row.product.sku === engineMatchedSkus[0]);
        selected.matchReasons.add("engine_code_disambiguation");
        publishRows.push(selected);
        continue;
      }
      for (const candidate of candidates) {
        reviewRows.push(reviewFromCandidate(candidate, "multiple_nexauto_skus_for_same_application_position", { candidate_skus: candidateSkus.join(" | "), existing_skus: existingSkus.join(" | ") }));
      }
      continue;
    }
    const candidate = candidates[0];
    publishRows.push(candidate);
  }

  // The legacy similarity pass above only gathers candidates. Publication must
  // pass the shared hard-key policy; engine-only narrowing is not sufficient.
  for (let index = publishRows.length - 1; index >= 0; index--) {
    const candidate = publishRows[index], a = candidate.application;
    const result = evaluateBrakeFitment({status:a.status,make:a.makeName,model:a.modelName,series:a.seriesKey,
      body:a.bodyStyle,drive:a.driveType,variant:a.variantName,engine:a.engineName,
      engineCodes:[...a.engineCodes],displacementCc:a.displacementCc,years:a.years},
      candidate.position,candidate.product.supplierRef,source.uniqueRows.map(r=>({...r,engineCodes:[...r.engineCodes]})));
    if (!result.keep) {
      reviewRows.push(reviewFromCandidate(candidate, `strict_${result.rule}`, {strict_reasons:result.reasons.join('；')}));
      publishRows.splice(index,1);
    } else {candidate.matchReasons.add(result.rule);candidate.strictEvaluation=result;}
  }

  for (const candidate of publishRows) {
    const key = `${candidate.application.application_id}|${candidate.position}`;
    for (const existing of existingByApplicationPosition.get(key) ?? []) {
      const oldSku = skuByVariantId.get(existing.product_variant_id);
      if (oldSku && existing.fitment_status === "published" && existing.product_variant_id !== candidate.product.productVariantId) {
        replacements.push({ candidate, existing, oldSku });
      }
    }
  }

  const existingKeySet = new Set(production.productFitments.filter((row) => row.fitment_status === "published").map((row) => `${row.application_id}|${row.position}|${row.product_variant_id}`));
  const alreadyPublished = publishRows.filter((row) => existingKeySet.has(`${row.application.application_id}|${row.position}|${row.product.productVariantId}`));
  const newRows = publishRows.filter((row) => !existingKeySet.has(`${row.application.application_id}|${row.position}|${row.product.productVariantId}`));
  const brakeVariantIds = new Set(production.productVariants.map((row) => row.id));
  const previouslyCoveredApplications = new Set(production.productFitments
    .filter((row) => row.fitment_status === "published" && brakeVariantIds.has(row.product_variant_id)).map((row) => row.application_id));
  const newCoverageRows = newRows.filter((row) => !previouslyCoveredApplications.has(row.application.application_id));

  const report = {
    generatedAt: new Date().toISOString(),
    sourceCode: SOURCE_CODE,
    policy: "Highest-confidence source does not imply an exact application match. Under the user-approved unique-first policy, missing information may be provisionally published only when one DB remains and no known body/drive/chassis contradiction exists. Multiple DBs require populated secondary configuration evidence. Source confidence and match uncertainty are recorded separately.",
    sourceWorkbook: {
      path: WORKBOOK,
      sheet: source.sheetName,
      sha256: source.sha256,
      rows: source.rows.length,
      uniqueRows: source.uniqueRows.length,
      duplicateRows: source.rows.length - source.uniqueRows.length,
      bendixReferences: sourceRefs.size,
      positions: countBy(source.uniqueRows, (row) => row.position || "invalid"),
      seriesPositionGroups: summarizeSeriesPositionGroups(source.uniqueRows)
    },
    productMapping: {
      productionBrakePadSkus: production.productVariants.length,
      exactMappedBendixReferences: productMap.size,
      sourceReferencesWithoutExactProduct: sourceRefsWithoutProduct,
      catalogReferencesAbsentFromSource: catalogRefsWithoutSource,
      sourceConfidence: "highest"
    },
    matching: {
      highConfidenceEvidenceRows: evidenceRows.length,
      sourceRowsWithHighConfidenceMatch: new Set(mappedSourceRows).size,
      publishableFitments: publishRows.length,
      alreadyPublishedFitments: alreadyPublished.length,
      newFitments: newRows.length,
      oldPublishedFitmentsToReplace: replacements.length,
      conflictCasesToReplace: new Set(replacements.map((row) => `${row.existing.application_id}|${row.existing.position}`)).size,
      newFitmentApplications: new Set(newRows.map((row) => row.application.application_id)).size,
      newApplications: new Set(newCoverageRows.map((row) => row.application.application_id)).size,
      newApplicationYears: new Set(newCoverageRows.flatMap((row) => row.application.years.map((year) => `${row.application.application_id}|${year}`))).size,
      reviewRows: reviewRows.length,
      reviewReasons: countBy(reviewRows, (row) => row.reason)
    },
    blockers
  };

  return { report, blockers, publishRows, newRows, alreadyPublished, reviewRows, replacements };
}

function scoreMatch(row, application) {
  const overlapYears = application.years.filter((year) => year >= row.yearFrom && year <= row.yearTo);
  const yearsContained = application.years.length > 0 && overlapYears.length === application.years.length;
  const engineExact = row.engineCodes.size > 0 && application.engineCodes.size > 0 && setsIntersect(row.engineCodes, application.engineCodes);
  const displacementMatch = row.displacementCc && application.displacementCc
    ? Math.abs(row.displacementCc - application.displacementCc) <= Math.max(30, application.displacementCc * 0.02)
    : false;
  const seriesExact = seriesPatternMatches(row.seriesTokens, application.seriesKey);
  const overlap = seriesExact || overlapYears.length > 0;
  const bodyCompatible = !row.bodyStyle || !application.bodyStyle || row.bodyStyle === application.bodyStyle;
  const driveCompatible = !row.driveType || !application.driveType || driveMatches(row.driveType, application.driveType);
  const reasons = [];
  if (yearsContained) reasons.push("years_contained");
  if (engineExact) reasons.push("engine_code_exact");
  if (displacementMatch) reasons.push("displacement_match");
  if (seriesExact) reasons.push("series_exact");
  if (bodyCompatible && row.bodyStyle && application.bodyStyle) reasons.push("body_match");
  if (driveCompatible && row.driveType && application.driveType) reasons.push("drive_match");
  const highConfidence = seriesExact || yearsContained;
  return { application, overlap, highConfidence, reasons };
}

async function applyPrepared(prepared, production) {
  const backupDir = await writeBackup(prepared, production);
  const now = new Date().toISOString();
  const existingByKey = new Map(production.productFitments.map((row) => [`${row.application_id}|${row.position}|${row.product_variant_id}`, row]));
  const payload = prepared.publishRows.map((row) => ({
    application_id: row.application.application_id,
    product_variant_id: row.product.productVariantId,
    position: row.position,
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: [
      `bendix=${row.product.supplierRef}`,
      `nexauto_sku=${row.product.sku}`,
      `source_rows=${[...row.sourceRowIds].sort((a, b) => a - b).join(",")}`,
      `matched_on=${[...row.matchReasons].sort().join("+")}`,
      `source_confidence=highest`,
      `publication_policy=${UNIQUE_FIRST_POLICY_VERSION}`,
      `match_confidence=${row.strictEvaluation?.provisional?'unique_candidate_provisional':'complete_source_configuration'}`,
      `match_warnings=${row.strictEvaluation?.warnings?.join(' / ')??''}`
    ].join("; "),
    updated_at: now
  }));
  const createdRows = payload.filter((row) => !existingByKey.has(`${row.application_id}|${row.position}|${row.product_variant_id}`));
  const promotedRows = payload.filter((row) => {
    const existing = existingByKey.get(`${row.application_id}|${row.position}|${row.product_variant_id}`);
    return existing && existing.fitment_status !== "published";
  });

  for (const batch of chunks(payload, 200)) {
    const { error } = await db.from("vehicle_catalog_product_fitments").upsert(batch, { onConflict: "application_id,product_variant_id,position" });
    if (error) throw error;
  }

  for (const replacement of prepared.replacements) {
    const old = replacement.existing;
    const notes = [old.notes, `${SOURCE_CODE}; superseded_by_sku=${replacement.candidate.product.sku}; user_policy=new source highest confidence`].filter(Boolean).join("; ");
    const { error } = await db.from("vehicle_catalog_product_fitments")
      .update({ fitment_status: "rejected", notes, updated_at: now })
      .eq("application_id", old.application_id).eq("product_variant_id", old.product_variant_id)
      .eq("position", old.position).eq("fitment_status", "published");
    if (error) throw error;
  }

  const verified = await selectInChunks("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status,source", "application_id", payload.map((row) => row.application_id));
  const verifiedKeys = new Set(verified.filter((row) => row.fitment_status === "published").map((row) => `${row.application_id}|${row.position}|${row.product_variant_id}`));
  const missing = payload.filter((row) => !verifiedKeys.has(`${row.application_id}|${row.position}|${row.product_variant_id}`));
  if (missing.length) throw new Error(`Post-apply verification failed for ${missing.length} fitment(s).`);
  const targetByApplicationPosition = new Map(payload.map((row) => [`${row.application_id}|${row.position}`, row.product_variant_id]));
  const brakeVariantIds = new Set(production.productVariants.map((row) => row.id));
  const remainingConflicts = verified.filter((row) => row.fitment_status === "published" && brakeVariantIds.has(row.product_variant_id)
    && targetByApplicationPosition.has(`${row.application_id}|${row.position}`)
    && targetByApplicationPosition.get(`${row.application_id}|${row.position}`) !== row.product_variant_id);
  if (remainingConflicts.length) throw new Error(`Post-apply has ${remainingConflicts.length} unreplaced old brake-pad conflict(s).`);

  return {
    appliedAt: now,
    backupDir,
    publishedFitments: payload.length,
    createdFitments: createdRows.length,
    promotedFromReviewOrRejected: promotedRows.length,
    affectedApplications: new Set(payload.map((row) => row.application_id)).size,
    affectedApplicationYears: new Set(prepared.publishRows.flatMap((row) => row.application.years.map((year) => `${row.application.application_id}|${year}`))).size,
    verifiedFitments: payload.length - missing.length,
    supersededOldFitments: prepared.replacements.length,
    remainingConflicts: remainingConflicts.length
  };
}

function readSourceWorkbook(file) {
  if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}`);
  const bytes = fs.readFileSync(file);
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false });
  const sheetName = "TOPSTAR有供货的Bendix行";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Missing worksheet: ${sheetName}`);
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  const rows = rawRows.map(normalizeSourceRow);
  const seen = new Set();
  const uniqueRows = [];
  for (const row of rows) {
    const key = [row.makeKey, [...row.modelKeys].sort().join("/"), row.seriesKey, row.yearFrom, row.yearTo, row.bodyStyle, row.driveType, row.fuelType, row.displacementCc, [...row.engineCodes].sort().join("/"), row.bendixReference, row.position].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }
  return { sheetName, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), rows, uniqueRows };
}

function normalizeSourceRow(row) {
  const bendixMatch = upper(row["件号"]).match(/DB\d+[A-Z]?/);
  return {
    sourceRowId: Number(row["行ID"]),
    makeName: clean(row["品牌(英文)"]),
    makeKey: canonicalMake(row["品牌(英文)"]),
    modelName: clean(row["车型"]),
    modelKeys: canonicalModelKeys(row["车型"]),
    seriesName: clean(row["车系"]),
    seriesKey: normalizeIdentifier(row["车系"]),
    seriesTokens: extractSeriesTokens(row["车系"]),
    yearFrom: Number(row["年款起"]),
    yearTo: Number(row["年款止"]),
    bodyStyle: normalizeBody(row["车身"]),
    driveType: normalizeDrive(row["驱动"]),
    fuelType: normalizeFuel(row["燃料"]),
    displacementCc: numberOrNull(row["排量(cc)"]),
    engineCodes: new Set(splitCodes(row["发动机码"])),
    bendixReference: bendixMatch?.[0] ?? "",
    rawPartNumber: clean(row["件号"]),
    position: normalizePosition(row["位置"]),
    status: clean(row["状态"]),
    dimensions: [numberOrNull(row["宽(mm)"]), numberOrNull(row["高(mm)"]), numberOrNull(row["厚(mm)"])]
  };
}

async function loadProduction() {
  const [applications, years, makes, models, series, vehicleVariants, powertrains, engineCodes, powertrainEngineCodes, products, productFitments] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "*"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("vehicle_catalog_makes", "make_id,name,normalized_name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,normalized_name,status"),
    fetchAll("vehicle_catalog_series", "series_id,model_id,code,normalized_code,display_name,status"),
    fetchAll("vehicle_catalog_variants", "variant_id,display_name,body_style,drive_type,vehicle_class,parse_status"),
    fetchAll("vehicle_catalog_powertrains", "powertrain_id,make_id,display_name,displacement_cc,fuel_type,powertrain_type,parse_status"),
    fetchAll("vehicle_catalog_engine_codes", "engine_code_id,make_id,code,normalized_code"),
    fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id,is_primary"),
    fetchAll("products", "id,name,category_slug", (query) => query.eq("category_slug", "brake-pad")),
    fetchAll("vehicle_catalog_product_fitments", "*")
  ]);
  const productVariants = await selectInChunks("product_variants", "id,product_id,sku,attributes", "product_id", products.map((row) => row.id));
  return { applications, years, makes, models, series, vehicleVariants, powertrains, engineCodes, powertrainEngineCodes, products, productVariants, productFitments };
}

async function writeBackup(prepared, production) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp", "production-backups", `bendix-topstar-fitments-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const targetApplicationIds = [...new Set(prepared.publishRows.map((row) => row.application.application_id))];
  const existingRows = production.productFitments.filter((row) => targetApplicationIds.includes(row.application_id));
  const content = JSON.stringify(existingRows, null, 2);
  fs.writeFileSync(path.join(directory, "vehicle_catalog_product_fitments.json"), content);
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceCode: SOURCE_CODE,
    targetApplicationIds,
    existingRows: existingRows.length,
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    report: prepared.report
  }, null, 2));
  return directory;
}

function reviewRow(row, reason, extra = {}) {
  return {
    reason,
    source_row_id: row.sourceRowId,
    bendix_reference: row.bendixReference,
    raw_part_number: row.rawPartNumber,
    position: row.position,
    make: row.makeName,
    model: row.modelName,
    series: row.seriesName,
    series_tokens: row.seriesTokens.join(" / "),
    year_from: row.yearFrom,
    year_to: row.yearTo,
    body: row.bodyStyle,
    drive: row.driveType,
    displacement_cc: row.displacementCc,
    engine_codes: [...row.engineCodes].join(" / "),
    ...extra
  };
}

function reviewFromCandidate(candidate, reason, extra = {}) {
  const row = candidate.rows[0];
  return reviewRow(row, reason, {
    application_id: candidate.application.application_id,
    application_years: candidate.application.years.join(","),
    application_series: candidate.application.seriesName,
    application_engine: candidate.application.engineName,
    application_variant: candidate.application.variantName,
    candidate_sku: candidate.product.sku,
    application_make: candidate.application.makeName,
    application_model: candidate.application.modelName,
    application_engine_codes: [...candidate.application.engineCodes].join(" / "),
    source_evidence: candidate.rows.map((row) => ({
      source_row_id: row.sourceRowId, series: row.seriesName, years: `${row.yearFrom}-${row.yearTo}`,
      engine_codes: [...row.engineCodes].join(" / "), body: row.bodyStyle, drive: row.driveType,
      bendix_reference: row.bendixReference, raw_part_number: row.rawPartNumber,
      engine_matches_application: setsIntersect(row.engineCodes, candidate.application.engineCodes)
    })),
    matched_on: [...candidate.matchReasons].sort().join("+"),
    source_row_ids: [...candidate.sourceRowIds].sort((a, b) => a - b).join(","),
    ...extra
  });
}

function flattenPublishRow(candidate) {
  return {
    application_id: candidate.application.application_id,
    make: candidate.application.makeName,
    model: candidate.application.modelName,
    years: candidate.application.years.join(","),
    series: candidate.application.seriesName,
    engine: candidate.application.engineName,
    variant: candidate.application.variantName,
    position: candidate.position,
    nexauto_sku: candidate.product.sku,
    bendix_reference: candidate.product.supplierRef,
    matched_on: [...candidate.matchReasons].sort().join("+"),
    source_row_ids: [...candidate.sourceRowIds].sort((a, b) => a - b).join(",")
  };
}

function canonicalMake(value) {
  const key = normalizeIdentifier(value);
  const aliases = { VW: "VOLKSWAGEN", MERCEDESBENZ: "MERCEDESBENZ", MERCEDES: "MERCEDESBENZ" };
  return aliases[key] ?? key;
}

function canonicalModelKeys(value) {
  const raw = upper(value).replace(/\bSERIES\b/g, "").replace(/\bGENERATION\b/g, "");
  const pieces = raw.split(/\s*\/\s*/).map(normalizeIdentifier).filter(Boolean);
  const keys = new Set([normalizeIdentifier(raw), ...pieces]);
  const aliases = [
    ["DEMIO", "MAZDA2"], ["AXELA", "MAZDA3"], ["ATENZA", "MAZDA6"],
    ["VITZ", "YARIS"], ["KLUGER", "HIGHLANDER"], ["PRADO", "LANDCRUISERPRADO"],
    ["PREMACY", "MAZDA5"], ["ALPHARDVELLFIRE", "ALPHARD"], ["ALPHARDVELLFIRE", "VELLFIRE"]
  ];
  for (const [left, right] of aliases) {
    if (keys.has(left)) keys.add(right);
    if (keys.has(right)) keys.add(left);
  }
  return keys;
}

function normalizeBody(value) {
  const text = lower(value);
  if (!text) return "";
  if (text.includes("mpv") || text.includes("多用途")) return "mpv";
  if (text.includes("suv") || text.includes("越野")) return "suv";
  if (text.includes("轿跑") || text.includes("coupe")) return "coupe";
  if (text.includes("敞篷") || text.includes("convertible")) return "convertible";
  if (text.includes("旅行") || text.includes("wagon") || text.includes("avant") || text.includes("variant")) return "wagon";
  if (text.includes("两厢") || text.includes("hatch")) return "hatchback";
  if (text.includes("轿车") || text.includes("sedan") || text.includes("limousine")) return "sedan";
  if (text.includes("皮卡") || text.includes("pickup") || text.includes("ute")) return "pickup";
  if (text.includes("厢") || text.includes("van") || text.includes("box")) return "van";
  return text;
}

function normalizeDrive(value) {
  const text = lower(value);
  if (!text) return "";
  if (text.includes("四驱") || text.includes("4wd") || text.includes("awd")) return "awd";
  if (text.includes("前驱") || text.includes("fwd")) return "fwd";
  if (text.includes("后驱") || text.includes("rwd")) return "rwd";
  return text;
}

function driveMatches(source, target) {
  const normalizedTarget = target.includes("4wd") || target.includes("awd") ? "awd" : target.includes("fwd") ? "fwd" : target.includes("rwd") ? "rwd" : target;
  return source === normalizedTarget;
}

function normalizeFuel(value) {
  const text = lower(value);
  if (!text) return "";
  if (text.includes("混动") || text.includes("hybrid")) return "hybrid";
  if (text.includes("柴油") || text.includes("diesel")) return "diesel";
  if (text.includes("汽油") || text.includes("petrol") || text.includes("gasoline")) return "petrol";
  if (text.includes("电") || text.includes("electric")) return "electric";
  return text;
}

function normalizePosition(value) {
  const text = clean(value);
  if (text === "前" || /^front$/i.test(text)) return "front";
  if (text === "后" || /^rear$/i.test(text)) return "rear";
  return "";
}

function splitCodes(value) {
  return upper(value).split(/[\/,;|]+/).map(normalizeIdentifier).filter((item) => item.length >= 2);
}

function extractSeriesTokens(value) {
  const text = upper(value);
  const parenthetical = [...text.matchAll(/\(([^)]+)\)/g)].flatMap((match) => match[1].split(/[,/;|]+/));
  const explicit = [...text.matchAll(/\b[A-Z]{0,4}\d[A-Z0-9_]{1,8}\b/g)].map((match) => match[0]);
  return [...new Set([...parenthetical, ...explicit]
    .map((item) => normalizeIdentifier(item))
    .filter((item) => item.length >= 2 && !/^\d+(ST|ND|RD|TH)?$/.test(item)))];
}

function seriesPatternMatches(sourceTokens, applicationSeriesKey) {
  if (!applicationSeriesKey) return false;
  return sourceTokens.some((token) => (
    token.length >= 2 &&
    (applicationSeriesKey.includes(token) || (applicationSeriesKey.length >= 3 && token.includes(applicationSeriesKey)))
  ));
}

function summarizeSeriesPositionGroups(rows) {
  const groups = groupBy(rows.filter((row) => row.bendixReference && row.position), (row) => [
    row.makeKey,
    [...row.modelKeys].sort().join("/"),
    row.seriesKey,
    row.position
  ].join("|"));
  const summaries = [...groups.values()].map((items) => new Set(items.map((row) => row.bendixReference)).size);
  const unique = summaries.filter((count) => count === 1).length;
  return {
    total: summaries.length,
    uniqueBendixReference: unique,
    ambiguous: summaries.length - unique,
    uniqueRate: summaries.length ? Number((unique / summaries.length).toFixed(4)) : 0,
    candidateCounts: countBy(summaries, (count) => String(count))
  };
}

function normalizeIdentifier(value) { return upper(value).replace(/[^A-Z0-9]/g, ""); }
function clean(value) { return value === null || value === undefined ? "" : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function setsIntersect(left, right) { for (const value of left) if (right.has(value)) return true; return false; }

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

async function fetchAll(table, columns, filter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function selectInChunks(table, columns, field, values) {
  const output = [];
  const unique = [...new Set(values)];
  for (const batch of chunks(unique, 100)) {
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
