import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  FileBlob,
  SpreadsheetFile
} from "file:///C:/Users/Sanli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";
import {
  analyzeDecisionYears,
  prepareCollapsibleSplitDecisions
} from "./wipertech-split-review.mjs";

const WORKBOOK = path.resolve("outputs/wipertech-cross-ai-review-20261022/NexAuto_WiperTech_交叉AI审核_完整审核_2026-10-22.xlsx");
const PAIR_FILE = "C:/Users/Sanli/Desktop/database/wipertech/wipertech_wpfp_pairs_to_create.csv";
const MEDIUM_LOW_NO_CONFLICT = process.argv.includes("--medium-low-no-conflict");
const COLLAPSIBLE_SPLITS = process.argv.includes("--collapsible-splits");
if (MEDIUM_LOW_NO_CONFLICT && COLLAPSIBLE_SPLITS) throw new Error("Choose only one special import mode.");
const OUTPUT_DIR = path.resolve(COLLAPSIBLE_SPLITS
  ? "outputs/wipertech-cross-ai-collapsed-splits-20261023"
  : MEDIUM_LOW_NO_CONFLICT
  ? "outputs/wipertech-cross-ai-medium-low-import-20261023"
  : "outputs/wipertech-cross-ai-import-20261023");
const SOURCE_CODE = COLLAPSIBLE_SPLITS
  ? "WIPERTECH_CROSS_AI_COLLAPSED_SPLIT_2026_10_23"
  : MEDIUM_LOW_NO_CONFLICT
  ? "WIPERTECH_CROSS_AI_ML_NO_CONFLICT_2026_10_23"
  : "WIPERTECH_CROSS_AI_REVIEW_2026_10_22";
const SELECTED_CONFIDENCES = new Set(COLLAPSIBLE_SPLITS ? ["高", "中", "低"] : MEDIUM_LOW_NO_CONFLICT ? ["中", "低"] : ["高"]);
const ACTIONABLE_CONCLUSIONS = new Set(["采用WiperTech", "保留现网", "补充来源", "补商品组合"]);
const OUTPUT_FIELDS = ["审核结论", "最终配置", "审核置信度", "审核理由", "审核证据", "审核AI", "审核时间"];
const SIMPLE_CONFIGURATION = /^(\d{1,2})\/(\d{1,2}|-)\/(\d{1,2}|-)$/;

if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) {
  throw new Error("Choose --report-only or --apply.");
}

loadEnv(path.resolve(".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase service credentials.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const reviewRows = await readReviewRows(WORKBOOK);
const prepared = COLLAPSIBLE_SPLITS
  ? prepareCollapsibleSplitDecisions(reviewRows, SELECTED_CONFIDENCES)
  : prepareDecisions(reviewRows, SELECTED_CONFIDENCES);
const pairRows = readCsv(PAIR_FILE);
const preparedPairs = preparePairs(pairRows);
const inspected = await inspectProduction(db, prepared.decisions, preparedPairs.uniquePairs);
const selection = COLLAPSIBLE_SPLITS
  ? selectCollapsibleProductionRows(inspected)
  : MEDIUM_LOW_NO_CONFLICT
    ? selectNonConflictingProductionRows(inspected)
  : { inspection: inspected, held: [] };
const inspection = selection.inspection;
const report = buildReport(reviewRows, prepared, preparedPairs, inspection, selection.held);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "cross_ai_import_report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--apply")) {
  const applied = await apply(db, prepared.decisions, inspection, preparedPairs, report);
  fs.writeFileSync(path.join(OUTPUT_DIR, "cross_ai_import_applied.json"), JSON.stringify(applied, null, 2));
  console.log(JSON.stringify({ applied: true, ...applied }, null, 2));
}

export function prepareDecisions(rows, selectedConfidences = new Set(["高"])) {
  const selectedConfidenceRows = rows.filter((row) => selectedConfidences.has(text(row["审核置信度"])));
  const decisions = [];
  const skipped = [];

  for (const row of selectedConfidenceRows) {
    const conclusion = text(row["审核结论"]);
    const configuration = parseConfiguration(row["最终配置"]);
    const reasons = [];
    if (!OUTPUT_FIELDS.every((field) => text(row[field]))) reasons.push("incomplete_review_output");
    if (!ACTIONABLE_CONCLUSIONS.has(conclusion)) reasons.push(conclusion === "拆分Application" ? "split_application_requires_year_segment_model" : "non_actionable_conclusion");
    if (!configuration) reasons.push("non_simple_configuration");
    if (!text(row.application_id)) reasons.push("missing_application_id");
    if (reasons.length) {
      skipped.push({ reviewId: text(row["审核ID"]), applicationId: text(row.application_id), conclusion, finalConfiguration: text(row["最终配置"]), reasons });
      continue;
    }
    decisions.push({
      reviewId: text(row["审核ID"]),
      applicationId: text(row.application_id),
      conclusion,
      configurationKey: configuration.key,
      driverLengthIn: configuration.driver,
      passengerLengthIn: configuration.passenger,
      rearLengthIn: configuration.rear,
      reason: text(row["审核理由"]),
      evidence: text(row["审核证据"]),
      reviewer: text(row["审核AI"]),
      reviewedAt: text(row["审核时间"]),
      confidence: text(row["审核置信度"]),
      problemType: text(row["问题类型"]),
      currentAtReview: text(row["现网配置"]),
      wiperTechRecommended: text(row["WiperTech建议配置"])
    });
  }

  const duplicates = [...groupBy(decisions, (row) => row.applicationId).entries()].filter(([, values]) => values.length > 1);
  if (duplicates.length) throw new Error(`Found ${duplicates.length} duplicate application decisions.`);
  return { selectedConfidenceRows, selectedConfidences: [...selectedConfidences], decisions, skipped };
}

export function selectNonConflictingProductionRows(inspection) {
  const missingIds = new Set(inspection.missingApplications.map((row) => row.applicationId));
  const inactiveIds = new Set(inspection.inactiveApplications.map((row) => row.applicationId));
  const eligible = [];
  const held = [];
  for (const row of inspection.resolved) {
    let reason = null;
    if (missingIds.has(row.applicationId)) reason = "missing_application";
    else if (inactiveIds.has(row.applicationId)) reason = "inactive_application";
    else if (row.changeType === "replacement") reason = "published_configuration_conflict";
    else if (row.changeType === "duplicate_current") reason = "duplicate_published_fitments";
    if (reason) held.push({ ...row, heldReason: reason });
    else eligible.push(row);
  }
  return {
    inspection: {
      ...inspection,
      resolved: eligible,
      missingApplications: [],
      inactiveApplications: []
    },
    held
  };
}

export function selectCollapsibleProductionRows(inspection) {
  const base = selectNonConflictingProductionRows(inspection);
  const eligible = [];
  const held = [...base.held];
  const alreadyPublished = [];
  for (const row of base.inspection.resolved) {
    if (row.changeType === "corroborated") {
      alreadyPublished.push(row);
      continue;
    }
    if (!row.yearAnalysis.currentYears.length) {
      held.push({ ...row, heldReason: "application_has_no_model_years" });
      continue;
    }
    if (!row.yearAnalysis.confirmedYears.length) {
      held.push({ ...row, heldReason: "no_current_year_overlaps_confirmed_segment" });
      continue;
    }
    eligible.push(row);
  }
  return {
    inspection: {
      ...base.inspection,
      resolved: eligible,
      alreadyPublishedSameConfiguration: alreadyPublished
    },
    held
  };
}

export function preparePairs(rows) {
  const validated = rows.map((row, index) => {
    const sku = text(row["WPFP组合"]).toUpperCase();
    const shortLength = numberOrNull(row["短寸"]);
    const longLength = numberOrNull(row["长寸"]);
    const driverBladeSku = text(row["驾驶位blade"]);
    const passengerBladeSku = text(row["副驾位blade"]);
    const driverProductId = text(row["驾驶位product_id"]);
    const passengerProductId = text(row["副驾位product_id"]);
    const expectedSku = `WPFP${shortLength}${longLength}`;
    if (!shortLength || !longLength || shortLength > longLength || sku !== expectedSku || !driverBladeSku || !passengerBladeSku || !driverProductId || !passengerProductId) {
      throw new Error(`Invalid WPFP pair source row ${index + 2}.`);
    }
    return {
      sku,
      shortLength,
      longLength,
      driverBladeSku,
      passengerBladeSku,
      driverProductId,
      passengerProductId,
      usageCount: numberOrNull(row["条目数"]) ?? 0
    };
  });
  const bySku = groupBy(validated, (row) => row.sku);
  const uniquePairs = [...bySku.entries()].map(([sku, alternatives]) => {
    const lengthKeys = new Set(alternatives.map((row) => `${row.longLength}/${row.shortLength}`));
    if (lengthKeys.size !== 1) throw new Error(`WPFP ${sku} has inconsistent lengths.`);
    return {
      sku,
      slug: `wiper-pair-${alternatives[0].longLength}-${alternatives[0].shortLength}`,
      name: `Premium Front Windscreen Wiper Blade Pair - ${alternatives[0].longLength}\" + ${alternatives[0].shortLength}\"`,
      driverLengthIn: alternatives[0].longLength,
      passengerLengthIn: alternatives[0].shortLength,
      alternatives
    };
  });
  return { sourceRows: validated, uniquePairs };
}

async function inspectProduction(client, decisions, pairs) {
  const [applications, configurations, publishedFitments, wiperSets] = await Promise.all([
    fetchAll(client, "vehicle_catalog_applications", "application_id,status,review_status"),
    fetchAll(client, "wiper_configurations", "id,configuration_key,configuration_status"),
    fetchAll(client, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", (query) => query.eq("fitment_status", "published")),
    fetchAll(client, "wiper_sets", "*")
  ]);
  const applicationById = new Map(applications.map((row) => [row.application_id, row]));
  const applicationYears = await selectAllInChunks(client, "vehicle_catalog_application_years", "application_id,model_year", "application_id", decisions.map((row) => row.applicationId));
  const yearsByApplication = groupBy(applicationYears, (row) => row.application_id);
  const configurationById = new Map(configurations.map((row) => [row.id, row]));
  const configurationByKey = new Map(configurations.map((row) => [row.configuration_key, row]));
  const publishedByApplication = groupBy(publishedFitments, (row) => row.application_id);
  const duplicatePublished = [...publishedByApplication.entries()].filter(([, rows]) => rows.length > 1).map(([applicationId, rows]) => ({ applicationId, count: rows.length }));
  const missingApplications = decisions.filter((row) => !applicationById.has(row.applicationId));
  const inactiveApplications = decisions.filter((row) => applicationById.get(row.applicationId)?.status !== "active");
  const resolved = decisions.map((decision) => {
    const currentRows = publishedByApplication.get(decision.applicationId) ?? [];
    const currentConfigurations = currentRows.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key ?? null).filter(Boolean);
    const currentConfiguration = currentConfigurations.length === 1 ? currentConfigurations[0] : null;
    return {
      ...decision,
      yearAnalysis: decision.knownSegments
        ? analyzeDecisionYears(decision, (yearsByApplication.get(decision.applicationId) ?? []).map((row) => row.model_year))
        : { currentYears: [], confirmedYears: [], pendingYears: [], inferredYears: [] },
      currentConfiguration,
      changeType: currentConfigurations.length > 1 ? "duplicate_current" : !currentConfiguration ? "new_coverage" : currentConfiguration === decision.configurationKey ? "corroborated" : "replacement"
    };
  });
  const wiperSetByLength = groupBy(wiperSets, (row) => `${Number(row.driver_length_in)}/${Number(row.passenger_length_in)}`);
  const pairInspection = pairs.map((pair) => {
    const existing = wiperSetByLength.get(`${pair.driverLengthIn}/${pair.passengerLengthIn}`) ?? [];
    return {
      ...pair,
      existing,
      action: existing.length === 0 ? "create" : existing.length === 1 ? (isPurchasable(existing[0]) && existing[0].sku === pair.sku ? "already_purchasable" : "update_existing") : "duplicate_length_rows"
    };
  });
  return {
    applications,
    configurations,
    configurationByKey,
    publishedFitments,
    wiperSets,
    resolved,
    pairInspection,
    duplicatePublished,
    missingApplications,
    inactiveApplications
  };
}

function buildReport(rows, prepared, preparedPairs, inspection, heldByProductionPolicy = []) {
  return {
    source: {
      code: SOURCE_CODE,
      workbook: fileIdentity(WORKBOOK),
      pairFile: fileIdentity(PAIR_FILE)
    },
    workbook: {
      totalRows: rows.length,
      fullyReviewedRows: rows.filter((row) => OUTPUT_FIELDS.every((field) => text(row[field]))).length,
      blankReviewRows: rows.filter((row) => OUTPUT_FIELDS.every((field) => !text(row[field]))).length,
      confidence: countBy(rows, (row) => text(row["审核置信度"]) || "blank"),
      selectedConfidences: prepared.selectedConfidences,
      selectedConfidenceRows: prepared.selectedConfidenceRows.length,
      publishableSimpleSelectedConfidence: prepared.decisions.length,
      heldSelectedConfidenceRows: prepared.skipped.length,
      heldReasons: countBy(prepared.skipped.flatMap((row) => row.reasons), (reason) => reason),
      actionableConclusions: countBy(prepared.decisions, (row) => row.conclusion)
    },
    production: {
      publishedBefore: inspection.publishedFitments.length,
      targetedApplications: inspection.resolved.length,
      changes: countBy(inspection.resolved, (row) => row.changeType),
      replacementByConclusion: countBy(inspection.resolved.filter((row) => row.changeType === "replacement"), (row) => row.conclusion),
      missingApplications: inspection.missingApplications.length,
      inactiveApplications: inspection.inactiveApplications.length,
      duplicatePublishedApplicationsBefore: inspection.duplicatePublished.length,
      missingConfigurationKeys: [...new Set(inspection.resolved.filter((row) => !inspection.configurationByKey.has(row.configurationKey)).map((row) => row.configurationKey))]
    },
    selectionPolicy: {
      mode: COLLAPSIBLE_SPLITS ? "single_unique_configuration_from_split_review_extend_exact_series" : MEDIUM_LOW_NO_CONFLICT ? "medium_low_no_published_replacement" : "high_confidence",
      heldByProductionPolicy: heldByProductionPolicy.length,
      heldReasons: countBy(heldByProductionPolicy, (row) => row.heldReason),
      heldChanges: countBy(heldByProductionPolicy, (row) => row.changeType),
      eligibleConclusions: countBy(inspection.resolved, (row) => row.conclusion),
      heldConclusions: countBy(heldByProductionPolicy, (row) => row.conclusion)
    },
    ...(COLLAPSIBLE_SPLITS ? {
      collapsedSplits: {
        eligibleApplications: inspection.resolved.length,
        eligibleApplicationYears: inspection.resolved.reduce((sum, row) => sum + row.yearAnalysis.currentYears.length, 0),
        confirmedApplicationYears: inspection.resolved.reduce((sum, row) => sum + row.yearAnalysis.confirmedYears.length, 0),
        extendedApplicationYears: inspection.resolved.reduce((sum, row) => sum + row.yearAnalysis.inferredYears.length, 0),
        configurations: countBy(inspection.resolved, (row) => row.configurationKey),
        confidence: countBy(inspection.resolved, (row) => row.confidence),
        problemTypes: countBy(inspection.resolved, (row) => row.problemType),
        makesModels: countBy(inspection.resolved, (row) => `${row.make} ${row.model}`.trim()),
        alreadyPublishedSameConfiguration: inspection.alreadyPublishedSameConfiguration?.length ?? 0,
        candidates: inspection.resolved.map((row) => ({
          applicationId: row.applicationId,
          reviewId: row.reviewId,
          make: row.make,
          model: row.model,
          seriesCode: row.seriesCode,
          bodyStyle: row.bodyStyle,
          configuration: row.configurationKey,
          confidence: row.confidence,
          problemType: row.problemType,
          currentYears: row.yearAnalysis.currentYears,
          confirmedYears: row.yearAnalysis.confirmedYears,
          extendedYears: row.yearAnalysis.inferredYears,
          reason: row.reason,
          evidence: row.evidence
        }))
      }
    } : {}),
    commerce: {
      sourceRows: preparedPairs.sourceRows.length,
      uniqueLengthPairs: preparedPairs.uniquePairs.length,
      actions: countBy(inspection.pairInspection, (row) => row.action),
      pairs: inspection.pairInspection.map((row) => ({
        sku: row.sku,
        lengths: `${row.driverLengthIn}/${row.passengerLengthIn}`,
        bladeAlternatives: row.alternatives.length,
        action: row.action,
        existingSkus: row.existing.map((item) => item.sku),
        existingLifecycle: row.existing.map((item) => `${item.active}|${item.visibility_status}|${item.content_status}|${item.commerce_status}|${item.checkout_enabled}`)
      }))
    },
    blockers: [
      ...(inspection.missingApplications.length ? [`missing_applications:${inspection.missingApplications.length}`] : []),
      ...(inspection.inactiveApplications.length ? [`inactive_applications:${inspection.inactiveApplications.length}`] : []),
      ...(inspection.duplicatePublished.length ? [`duplicate_published_applications:${inspection.duplicatePublished.length}`] : []),
      ...(inspection.resolved.some((row) => row.changeType === "duplicate_current") ? ["targeted_application_has_duplicate_published_fitments"] : []),
      ...(inspection.pairInspection.some((row) => row.action === "duplicate_length_rows") ? ["duplicate_wiper_set_length_rows"] : [])
    ]
  };
}

async function apply(client, decisions, inspection, preparedPairs, report) {
  if (report.blockers.length) throw new Error(`Refusing to apply with blockers: ${report.blockers.join(", ")}`);
  const backupDir = await writeBackup(client);
  const pairResult = await applyPairs(client, inspection.pairInspection);
  const configurationByKey = new Map(inspection.configurations.map((row) => [row.configuration_key, row.id]));
  for (const row of inspection.resolved) {
    if (configurationByKey.has(row.configurationKey)) continue;
    const { data, error } = await client.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: row.driverLengthIn,
      p_passenger_length_in: row.passengerLengthIn,
      p_rear_length_in: row.rearLengthIn
    });
    if (error) throw error;
    configurationByKey.set(row.configurationKey, data);
  }

  const now = new Date().toISOString();
  const applicationIds = inspection.resolved.map((row) => row.applicationId);
  for (const ids of chunks(applicationIds, 200)) {
    const { error } = await client.from("vehicle_catalog_wiper_fitments")
      .update({ fitment_status: "review", updated_at: now })
      .in("application_id", ids)
      .eq("fitment_status", "published");
    if (error) throw error;
  }
  const payload = inspection.resolved.map((row) => ({
    application_id: row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: buildNotes(row),
    updated_at: now
  }));
  for (const rows of chunks(payload, 200)) {
    const { error } = await client.from("vehicle_catalog_wiper_fitments").upsert(rows, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
  const configurationIds = [...new Set(payload.map((row) => row.wiper_configuration_id))];
  for (const ids of chunks(configurationIds, 200)) {
    const { error } = await client.from("wiper_configurations").update({ configuration_status: "published", updated_at: now }).in("id", ids);
    if (error) throw error;
  }

  const published = await selectInChunks(client, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", "application_id", applicationIds, (query) => query.eq("fitment_status", "published"));
  const publishedByApplication = groupBy(published, (row) => row.application_id);
  const duplicates = [...publishedByApplication.values()].filter((rows) => rows.length !== 1);
  const missing = applicationIds.filter((id) => !publishedByApplication.has(id));
  if (duplicates.length || missing.length) throw new Error(`Post-apply verification failed: duplicate=${duplicates.length}, missing=${missing.length}`);
  const totalPublished = await exactCount(client, "vehicle_catalog_wiper_fitments", (query) => query.eq("fitment_status", "published"));
  return {
    appliedAt: now,
    backupDir,
    reviewedApplicationsPublished: payload.length,
    changes: countBy(inspection.resolved, (row) => row.changeType),
    commerce: pairResult,
    totalPublishedApplications: totalPublished,
    duplicateTargetApplications: 0,
    missingTargetApplications: 0,
    workbookSha256: report.source.workbook.sha256,
    pairFileSha256: report.source.pairFile.sha256,
    pairSourceRows: preparedPairs.sourceRows.length
  };
}

async function applyPairs(client, pairInspection) {
  const now = new Date().toISOString();
  const created = [];
  const updated = [];
  const alreadyPurchasable = [];
  const payload = [];
  for (const pair of pairInspection) {
    if (pair.action === "already_purchasable") {
      alreadyPurchasable.push(pair.sku);
      continue;
    }
    payload.push({
      id: pair.action === "create" ? crypto.randomUUID() : pair.existing[0].id,
      sku: pair.sku,
      slug: pair.slug,
      name: pair.name,
      set_type: "front_pair",
      driver_length_in: pair.driverLengthIn,
      passenger_length_in: pair.passengerLengthIn,
      rear_length_in: null,
      price: 59.99,
      compare_at_price: 79.99,
      active: true,
      visibility_status: "public",
      content_status: "approved",
      commerce_status: "active",
      checkout_enabled: true,
      updated_at: now
    });
    if (pair.action === "create") {
      created.push(pair.sku);
    } else {
      updated.push(pair.sku);
    }
  }
  if (payload.length) {
    const { error } = await client.from("wiper_sets").upsert(payload, { onConflict: "id" });
    if (error) throw new Error(`Apply WPFP combinations: ${error.message}`);
  }
  return { created, updated, alreadyPurchasable };
}

async function readReviewRows(file) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const values = workbook.worksheets.getItem("交叉审核任务").getUsedRange().values;
  const headers = values[0].map(text);
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  return values.slice(1)
    .filter((row) => text(row[index["审核ID"]]))
    .map((row) => Object.fromEntries(headers.map((header, position) => [header, row[position]])));
}

function parseConfiguration(value) {
  const match = text(value).match(SIMPLE_CONFIGURATION);
  if (!match) return null;
  const driver = Number(match[1]);
  const passenger = match[2] === "-" ? null : Number(match[2]);
  const rear = match[3] === "-" ? null : Number(match[3]);
  if (![driver, passenger, rear].filter((item) => item !== null).every((item) => Number.isInteger(item) && item >= 5 && item <= 40)) return null;
  return { driver, passenger, rear, key: `${driver}/${passenger ?? "-"}/${rear ?? "-"}` };
}

function buildNotes(row) {
  return [
    `review_id=${row.reviewId}`,
    `conclusion=${row.conclusion}`,
    `confidence=${row.confidence}`,
    `problem_type=${row.problemType}`,
    `reviewer=${row.reviewer}`,
    `reviewed_at=${row.reviewedAt}`,
    `current_at_review=${row.currentAtReview || "-"}`,
    `wipertech_recommended=${row.wiperTechRecommended || "-"}`,
    ...(row.segmentedConfiguration ? [
      `collapse_rule=${row.collapseRule}`,
      `segmented_configuration=${row.segmentedConfiguration}`,
      `confirmed_years=${row.yearAnalysis.confirmedYears.join(",") || "-"}`,
      `extended_years=${row.yearAnalysis.inferredYears.join(",") || "-"}`,
      `series_code=${row.seriesCode}`,
      `body_style=${row.bodyStyle || "-"}`
    ] : []),
    `reason=${row.reason}`,
    `evidence=${row.evidence}`
  ].join("; ");
}

async function writeBackup(client) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `wipertech-cross-ai-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const table of ["vehicle_catalog_wiper_fitments", "wiper_configurations", "wiper_configuration_blades", "wiper_sets"]) {
    fs.writeFileSync(path.join(directory, `${table}.json`), JSON.stringify(await fetchAll(client, table, "*"), null, 2));
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), source: SOURCE_CODE, workbook: fileIdentity(WORKBOOK), pairFile: fileIdentity(PAIR_FILE) }, null, 2));
  return directory;
}

function isPurchasable(row) {
  return row.active && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  values.push(value);
  return values;
}

function fileIdentity(file) {
  const content = fs.readFileSync(file);
  return { path: path.resolve(file), bytes: content.length, sha256: crypto.createHash("sha256").update(content).digest("hex") };
}
function text(value) { return String(value ?? "").trim(); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function countBy(rows, keyFn) { const output = {}; for (const row of rows) { const key = keyFn(row); output[key] = (output[key] ?? 0) + 1; } return output; }
function groupBy(rows, keyFn) { const output = new Map(); for (const row of rows) { const key = keyFn(row); const values = output.get(key) ?? []; values.push(row); output.set(key, values); } return output; }
function chunks(rows, size) { const output = []; for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size)); return output; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
async function fetchAll(client, table, columns, applyFilter = (query) => query) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await applyFilter(client.from(table).select(columns)).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
async function exactCount(client, table, applyFilter = (query) => query) { const { count, error } = await applyFilter(client.from(table).select("*", { count: "exact", head: true })); if (error) throw error; return count ?? 0; }
async function selectInChunks(client, table, columns, column, values, applyFilter = (query) => query) { const output = []; for (const valueChunk of chunks([...new Set(values)], 200)) { const { data, error } = await applyFilter(client.from(table).select(columns).in(column, valueChunk)); if (error) throw error; output.push(...data); } return output; }
async function selectAllInChunks(client, table, columns, column, values, applyFilter = (query) => query) {
  const output = [];
  for (const valueChunk of chunks([...new Set(values)], 200)) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await applyFilter(client.from(table).select(columns).in(column, valueChunk)).range(from, from + 999);
      if (error) throw error;
      output.push(...data);
      if (data.length < 1000) break;
    }
  }
  return output;
}

