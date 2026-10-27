import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import {
  canonicalModelKey,
  resolveWiperTechApplication,
  wiperTechPartialKey,
} from "./wipertech-direct-matcher.mjs";
import {
  POPULAR_80_ADDITIONAL_VEHICLE_GROUPS,
  POPULAR_EXTENDED_80_VEHICLE_GROUPS,
  buildPopularAliasIndex,
} from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "extended132-wiper-phase-20261025");
const SOURCE_FILE = path.resolve(ROOT, "outputs", "wipertech-enrichment-20261022", "wipertech_enriched_data.json");
const CENTRAL_REPORT = path.resolve(ROOT, "outputs", "popular-extended132-product-gaps-20261025", "coverage-by-model.json");
const PERIOD = { from: 2000, to: 2026 };

if (process.argv.includes("--apply")) throw new Error("This script is report-only and never writes production.");
if (POPULAR_80_ADDITIONAL_VEHICLE_GROUPS.length !== 29
  || POPULAR_80_ADDITIONAL_VEHICLE_GROUPS[0]?.rank !== 104
  || POPULAR_80_ADDITIONAL_VEHICLE_GROUPS.at(-1)?.rank !== 132) {
  throw new Error("Popular rank 104-132 scope changed; review the maintained group list before rerunning.");
}
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
if (!fs.existsSync(SOURCE_FILE)) throw new Error(`Missing WiperTech snapshot: ${SOURCE_FILE}`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rawSourceRows = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8")).sourceRows.map(toSourceRecord);
const data = await loadProduction();
const prepared = prepare(data);
writeOutputs(prepared);
console.log(JSON.stringify({ outputDir: OUTPUT_DIR, ...prepared.summary.queues, uplift: prepared.summary.projected_extended132_uplift }, null, 2));

function prepare(data) {
  const allIndex = buildPopularAliasIndex(POPULAR_EXTENDED_80_VEHICLE_GROUPS);
  const incrementalIndex = buildPopularAliasIndex(POPULAR_80_ADDITIONAL_VEHICLE_GROUPS);
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const configurationByKey = groupBy(data.configurations, (row) => row.configuration_key);
  const publishedByApplication = groupBy(data.fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const activePairs = new Set(data.wiperSets.filter((row) => row.active === true).map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));
  const sourceGroupIndex = buildPopularAliasIndex(POPULAR_80_ADDITIONAL_VEHICLE_GROUPS);
  const sourceRowsByGroup = groupBy(rawSourceRows.filter((row) => sourceGroupIndex.has(canonicalModelKey(row.make, row.model))), (row) => sourceGroupIndex.get(canonicalModelKey(row.make, row.model)).id);

  const extendedApplications = [];
  for (const row of data.applications.filter((item) => item.status === "active")) {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const group = make && model ? allIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (!group) continue;
    const years = uniqueNumbers((yearsByApplication.get(row.application_id) ?? []).map((item) => item.model_year))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to);
    if (!years.length) continue;
    const series = seriesById.get(row.series_id);
    const variant = variantById.get(row.variant_id);
    const published = publishedByApplication.get(row.application_id) ?? [];
    const currentConfigurationKeys = uniqueStrings(published.map((item) => configurationById.get(item.wiper_configuration_id)?.configuration_key));
    extendedApplications.push({
      applicationId: row.application_id,
      group,
      make: upper(make?.name),
      model: upper(model?.name),
      seriesCode: upper(series?.code),
      seriesName: String(series?.display_name ?? "").trim(),
      bodyStyle: bodyKey(variant?.body_style ?? variant?.display_name),
      variantName: String(variant?.display_name ?? "").trim(),
      years,
      currentConfigurationKeys,
      currentConfigurationKey: currentConfigurationKeys.length === 1 ? currentConfigurationKeys[0] : null,
      duplicatePublished: published.length > 1,
    });
  }

  const incrementalApplications = extendedApplications.filter((row) => incrementalIndex.get(canonicalModelKey(row.make, row.model))?.id === row.group.id);
  const knowledgeBefore = new Set(extendedApplications.filter((row) => row.currentConfigurationKeys.length > 0).map((row) => row.applicationId));
  const productBefore = new Set(extendedApplications.filter((row) => row.currentConfigurationKeys.some((key) => configurationHasActivePair(key, activePairs))).map((row) => row.applicationId));
  const decisions = incrementalApplications.map(assessApplication);
  const safeApplications = decisions.filter((row) => row.outcome === "safe_to_publish");
  const productMissingApplications = decisions.filter((row) => row.outcome === "product_missing");
  const multiApplications = decisions.filter((row) => row.outcome === "multi_candidate");
  const correctionApplications = decisions.filter((row) => row.outcome === "catalog_correction");
  const safeIds = new Set(safeApplications.map((row) => row.applicationId));
  const safeProductIds = new Set(safeApplications.filter((row) => configurationHasActivePair(row.configuration_key, activePairs)).map((row) => row.applicationId));
  const productMissingPotentialIds = new Set(productMissingApplications.filter((row) => completeFrontPair(row.configuration_key)).map((row) => row.applicationId));
  const knowledgeAfter = union(knowledgeBefore, safeIds);
  const productAfterSafe = union(productBefore, safeProductIds);
  const productAfterAllLocal = union(productAfterSafe, productMissingPotentialIds);

  const incrementalIds = new Set(incrementalApplications.map((row) => row.applicationId));
  const extendedCoverage = metricBundle(extendedApplications, knowledgeBefore, productBefore, knowledgeAfter, productAfterSafe, productAfterAllLocal);
  const incrementalCoverage = metricBundle(
    incrementalApplications,
    intersect(knowledgeBefore, incrementalIds), intersect(productBefore, incrementalIds),
    intersect(knowledgeAfter, incrementalIds), intersect(productAfterSafe, incrementalIds), intersect(productAfterAllLocal, incrementalIds),
  );
  const denominator = extendedCoverage.knowledge_before.application_years_total;
  const safeApplicationYears = safeApplications.reduce((sum, row) => sum + row.years.length, 0);
  const safeProductApplicationYears = safeApplications.filter((row) => configurationHasActivePair(row.configuration_key, activePairs)).reduce((sum, row) => sum + row.years.length, 0);
  const productMissingPotentialApplicationYears = productMissingApplications.filter((row) => completeFrontPair(row.configuration_key)).reduce((sum, row) => sum + row.years.length, 0);
  const queueRows = {
    safe: aggregate(safeApplications),
    productMissing: aggregate(productMissingApplications),
    multi: aggregate(multiApplications),
    corrections: aggregate(correctionApplications),
  };
  const groupRows = POPULAR_80_ADDITIONAL_VEHICLE_GROUPS.map((group) => {
    const apps = incrementalApplications.filter((row) => row.group.id === group.id);
    const ids = new Set(apps.map((row) => row.applicationId));
    const groupDecisions = decisions.filter((row) => row.group_id === group.id);
    return {
      rank: group.rank,
      group_id: group.id,
      popular_group: group.label,
      fleet_count: group.fleetCount,
      applications: apps.length,
      application_years: apps.reduce((sum, row) => sum + row.years.length, 0),
      knowledge_before_application_year_percent: coverageMetric(apps, intersect(knowledgeBefore, ids)).application_year_coverage_percent,
      product_before_application_year_percent: coverageMetric(apps, intersect(productBefore, ids)).application_year_coverage_percent,
      safe_applications: groupDecisions.filter((row) => row.outcome === "safe_to_publish").length,
      safe_application_years: groupDecisions.filter((row) => row.outcome === "safe_to_publish").reduce((sum, row) => sum + row.years.length, 0),
      product_missing_applications: groupDecisions.filter((row) => row.outcome === "product_missing").length,
      product_missing_application_years: groupDecisions.filter((row) => row.outcome === "product_missing").reduce((sum, row) => sum + row.years.length, 0),
      multi_candidate_applications: groupDecisions.filter((row) => row.outcome === "multi_candidate").length,
      multi_candidate_application_years: groupDecisions.filter((row) => row.outcome === "multi_candidate").reduce((sum, row) => sum + row.years.length, 0),
      catalog_correction_applications: groupDecisions.filter((row) => row.outcome === "catalog_correction").length,
      catalog_correction_application_years: groupDecisions.filter((row) => row.outcome === "catalog_correction").reduce((sum, row) => sum + row.years.length, 0),
      projected_extended132_knowledge_pp: percentagePoints(groupDecisions.filter((row) => row.outcome === "safe_to_publish").reduce((sum, row) => sum + row.years.length, 0), denominator),
    };
  });

  const central = fs.existsSync(CENTRAL_REPORT) ? JSON.parse(fs.readFileSync(CENTRAL_REPORT, "utf8")) : null;
  const centralReconciliation = central ? {
    source: fileIdentity(CENTRAL_REPORT),
    generated_at: central.generated_at,
    application_years_match: central.totals?.application_years === extendedCoverage.knowledge_before.application_years_total,
    knowledge_application_years_match: central.totals?.wiper_knowledge?.application_years_covered === extendedCoverage.knowledge_before.application_years_covered,
    product_application_years_match: central.totals?.wiper_product?.application_years_covered === extendedCoverage.product_before.application_years_covered,
    central: {
      application_years: central.totals?.application_years,
      knowledge_application_years: central.totals?.wiper_knowledge?.application_years_covered,
      product_application_years: central.totals?.wiper_product?.application_years_covered,
    },
  } : null;

  const summary = {
    generated_at: new Date().toISOString(),
    mode: "report-only",
    production_writes: false,
    scope: { groups: 29, ranks: [104, 132], period: PERIOD, parent_scope: "extended132" },
    sources: { wipertech: fileIdentity(SOURCE_FILE), production: "fresh read-only snapshot", central_coverage: centralReconciliation },
    denominator: {
      extended132: { groups: 132, applications: extendedApplications.length, application_years: denominator },
      incremental_rank_104_132: { groups: 29, applications: incrementalApplications.length, application_years: incrementalApplications.reduce((sum, row) => sum + row.years.length, 0) },
    },
    coverage: { extended132: extendedCoverage, incremental_rank_104_132: incrementalCoverage },
    queues: {
      safe_to_publish: queueCount(safeApplications),
      product_missing: queueCount(productMissingApplications),
      multi_candidate: queueCount(multiApplications),
      catalog_correction: queueCount(correctionApplications),
    },
    projected_extended132_uplift: {
      knowledge_safe_application_years: safeApplicationYears,
      knowledge_pp: percentagePoints(safeApplicationYears, denominator),
      product_safe_application_years: safeProductApplicationYears,
      product_safe_pp: percentagePoints(safeProductApplicationYears, denominator),
      product_missing_if_created_application_years: productMissingPotentialApplicationYears,
      product_missing_if_created_pp: percentagePoints(productMissingPotentialApplicationYears, denominator),
      combined_product_pp: percentagePoints(safeProductApplicationYears + productMissingPotentialApplicationYears, denominator),
    },
    rules: {
      safe_to_publish: "No current published fitment; exact series/chassis resolution; compatible nonblank body; one complete body-specific configuration including rear; no production conflict.",
      product_missing: "Exactly one published knowledge configuration exists, but its complete front pair has no active wiper set; partial fronts are retained but excluded from product-uplift projection.",
      multi_candidate: "No deterministic exact-series/body configuration, incomplete evidence, missing series, or duplicate publication.",
      catalog_correction: "Exact series evidence resolves only to a different nonblank body, so identity must be corrected before fitment work.",
    },
  };
  return { summary, groupRows, ...queueRows };

  function assessApplication(application) {
    const base = decisionBase(application);
    if (application.duplicatePublished) return { ...base, outcome: "multi_candidate", reason: "duplicate_published_fitments", candidate_configurations: application.currentConfigurationKeys };
    if (application.currentConfigurationKey) {
      return configurationHasActivePair(application.currentConfigurationKey, activePairs)
        ? { ...base, outcome: "already_covered", reason: "published_and_product_covered", configuration_key: application.currentConfigurationKey }
        : { ...base, outcome: "product_missing", reason: completeFrontPair(application.currentConfigurationKey) ? "active_sellable_front_pair_missing" : "published_front_configuration_is_partial", configuration_key: application.currentConfigurationKey };
    }
    if (!application.seriesCode) return { ...base, outcome: "multi_candidate", reason: "missing_series_code_cross_generation_risk" };
    if (!application.bodyStyle) return { ...base, outcome: "multi_candidate", reason: "missing_body_style" };
    const groupSources = sourceRowsByGroup.get(application.group.id) ?? [];
    if (!groupSources.length) return { ...base, outcome: "multi_candidate", reason: "no_group_source_rows" };

    const aliasAll = groupSources.map((row) => aliasSource(row, application));
    const allDecision = resolveWiperTechApplication(application, aliasAll);
    const compatibleRows = groupSources.filter((row) => bodyKey(row.body) === application.bodyStyle);
    if (!compatibleRows.length) {
      const supportingBodies = allDecision.status === "published" ? uniqueStrings(allDecision.supportingRows.map((row) => bodyKey(row.body))) : [];
      if (strongRule(allDecision.rule) && supportingBodies.length && !supportingBodies.includes(application.bodyStyle)) {
        return { ...base, outcome: "catalog_correction", reason: "exact_series_resolves_to_different_body", candidate_bodies: supportingBodies, source_vehicle_ids: allDecision.sourceVehicleIds, requested_evidence: "Verify VIN/chassis body assignment before selecting a rear-wiper configuration." };
      }
      return { ...base, outcome: "multi_candidate", reason: "no_compatible_body_source", candidate_bodies: uniqueStrings(groupSources.map((row) => bodyKey(row.body))) };
    }
    const decision = resolveWiperTechApplication(application, compatibleRows.map((row) => aliasSource(row, application)));
    const evidenceRows = uniqueBy(decision.status === "published" ? decision.supportingRows : decision.candidates ?? [], (row) => row.vehicleId);
    const common = {
      ...base,
      matcher_status: decision.status,
      matcher_rule: decision.rule ?? null,
      matcher_reason: decision.reason ?? null,
      candidate_configuration: decision.configurationKey ?? null,
      candidate_configurations: decision.candidateConfigurationKeys?.length ? decision.candidateConfigurationKeys : uniqueStrings(evidenceRows.map(wiperTechPartialKey)),
      source_vehicle_ids: uniqueStrings(evidenceRows.map((row) => row.vehicleId)),
      source_rows: evidenceRows.map(compactSourceRow),
    };
    if (decision.status !== "published") return { ...common, outcome: "multi_candidate", reason: decision.reason ?? "not_deterministic" };
    if (!strongRule(decision.rule)) return { ...common, outcome: "multi_candidate", reason: "not_exact_series_evidence" };
    const fullConfigurations = uniqueStrings(evidenceRows.map(wiperTechPartialKey));
    if (fullConfigurations.length !== 1 || fullConfigurations[0] !== decision.configurationKey) return { ...common, outcome: "multi_candidate", reason: "rear_or_complete_configuration_ambiguous" };
    if (evidenceRows.some((row) => bodyKey(row.body) !== application.bodyStyle)) return { ...common, outcome: "multi_candidate", reason: "source_body_conflict" };
    return {
      ...common,
      outcome: "safe_to_publish",
      reason: "unique_exact_series_compatible_body_no_production_conflict",
      configuration_key: decision.configurationKey,
      configuration_ids: (configurationByKey.get(decision.configurationKey) ?? []).map((row) => row.id),
      active_sellable_front_pair: configurationHasActivePair(decision.configurationKey, activePairs),
    };
  }
}

function aggregate(rows) {
  return [...groupBy(rows, (row) => [row.outcome, row.rank, row.make, row.model, row.series_code, row.body_style, row.configuration_key ?? row.candidate_configuration ?? "", row.reason].join("|")).values()]
    .map((items) => {
      const first = items[0];
      const years = uniqueNumbers(items.flatMap((row) => row.years));
      return {
        rank: first.rank,
        group_id: first.group_id,
        popular_group: first.popular_group,
        fleet_count: first.fleet_count,
        make: first.make,
        model: first.model,
        series_code: first.series_code,
        series_name: first.series_name,
        body_style: first.body_style,
        years,
        year_from: years[0] ?? null,
        year_to: years.at(-1) ?? null,
        application_ids: uniqueStrings(items.map((row) => row.applicationId)),
        applications: items.length,
        application_years: items.reduce((sum, row) => sum + row.years.length, 0),
        configuration_key: first.configuration_key ?? null,
        current_configurations: uniqueStrings(items.flatMap((row) => row.current_configurations ?? [])),
        candidate_configurations: uniqueStrings(items.flatMap((row) => row.candidate_configurations ?? [])),
        configuration_ids: uniqueStrings(items.flatMap((row) => row.configuration_ids ?? [])),
        active_sellable_front_pair: items.some((row) => row.active_sellable_front_pair),
        matcher_rules: uniqueStrings(items.map((row) => row.matcher_rule)),
        reason: first.reason,
        candidate_bodies: uniqueStrings(items.flatMap((row) => row.candidate_bodies ?? [])),
        source_vehicle_ids: uniqueStrings(items.flatMap((row) => row.source_vehicle_ids ?? [])),
        source_rows: uniqueBy(items.flatMap((row) => row.source_rows ?? []), (row) => row.vehicle_id),
        requested_evidence: first.requested_evidence ?? null,
      };
    }).sort((left, right) => left.rank - right.rank || left.make.localeCompare(right.make) || left.series_code.localeCompare(right.series_code));
}

function decisionBase(application) {
  return {
    rank: application.group.rank,
    group_id: application.group.id,
    popular_group: application.group.label,
    fleet_count: application.group.fleetCount,
    applicationId: application.applicationId,
    make: application.make,
    model: application.model,
    series_code: application.seriesCode,
    series_name: application.seriesName,
    body_style: application.bodyStyle,
    variant: application.variantName,
    years: application.years,
    current_configurations: application.currentConfigurationKeys,
  };
}

function metricBundle(applications, knowledgeBefore, productBefore, knowledgeAfter, productAfterSafe, productAfterAllLocal) {
  return {
    knowledge_before: coverageMetric(applications, knowledgeBefore),
    knowledge_after_safe: coverageMetric(applications, knowledgeAfter),
    product_before: coverageMetric(applications, productBefore),
    product_after_safe: coverageMetric(applications, productAfterSafe),
    product_after_safe_and_product_missing: coverageMetric(applications, productAfterAllLocal),
  };
}

function coverageMetric(applications, coveredIds) {
  const years = applications.flatMap((row) => row.years.map((year) => ({ applicationId: row.applicationId, groupId: row.group.id, year })));
  const modelYears = groupBy(years, (row) => `${row.groupId}|${row.year}`);
  const applicationYearsCovered = years.filter((row) => coveredIds.has(row.applicationId)).length;
  const applicationsCovered = applications.filter((row) => coveredIds.has(row.applicationId)).length;
  const any = [...modelYears.values()].filter((rows) => rows.some((row) => coveredIds.has(row.applicationId))).length;
  const full = [...modelYears.values()].filter((rows) => rows.every((row) => coveredIds.has(row.applicationId))).length;
  return {
    applications_total: applications.length,
    applications_covered: applicationsCovered,
    application_coverage_percent: percent(applicationsCovered, applications.length),
    application_years_total: years.length,
    application_years_covered: applicationYearsCovered,
    application_year_coverage_percent: percent(applicationYearsCovered, years.length),
    model_years_total: modelYears.size,
    model_years_any_covered: any,
    model_year_any_coverage_percent: percent(any, modelYears.size),
    model_years_fully_covered: full,
    model_year_full_coverage_percent: percent(full, modelYears.size),
  };
}

function writeOutputs(prepared) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(prepared.summary, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-by-group.json"), `${JSON.stringify(prepared.groupRows, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-by-group.csv"), toCsv(prepared.groupRows));
  writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), prepared.safe);
  writeJsonl(path.join(OUTPUT_DIR, "product-missing.jsonl"), prepared.productMissing);
  writeJsonl(path.join(OUTPUT_DIR, "multi-candidate-review.jsonl"), prepared.multi);
  writeJsonl(path.join(OUTPUT_DIR, "catalog-corrections.jsonl"), prepared.corrections);
  const q = prepared.summary.queues;
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), [
    "NexAuto extended132 wiper phase — report only",
    `Generated: ${prepared.summary.generated_at}`,
    "Scope: maintained popular ranks 104-132 only; model years 2000-2026.",
    "Production writes: none.",
    "",
    `Safe to publish: ${q.safe_to_publish.applications} applications / ${q.safe_to_publish.application_years} application-years`,
    `Product missing: ${q.product_missing.applications} applications / ${q.product_missing.application_years} application-years`,
    `Multi-candidate: ${q.multi_candidate.applications} applications / ${q.multi_candidate.application_years} application-years`,
    `Catalog correction: ${q.catalog_correction.applications} applications / ${q.catalog_correction.application_years} application-years`,
    "",
    "Rows are aggregated by popular group -> application -> exact series/chassis -> compatible body; engine/trim duplicates retain their application IDs and application-year counts.",
    "See summary.json for extended132 and incremental denominators, current coverage, projected uplift, and central-report reconciliation.",
    "",
  ].join("\r\n"));
}

async function loadProduction() {
  const specs = [
    ["makes", "vehicle_catalog_makes", "make_id,name,status"],
    ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
    ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"],
    ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
    ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"],
    ["years", "vehicle_catalog_application_years", "application_id,model_year"],
    ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
    ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"],
    ["wiperSets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"],
  ];
  const values = await Promise.all(specs.map(([, table, columns]) => fetchAll(table, columns)));
  return Object.fromEntries(specs.map(([name], index) => [name, values[index]]));
}

async function fetchAll(table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}

function toSourceRecord(row) {
  return {
    vehicleId: String(row.vehicle_id), make: row.make, model: row.model, series: row.series, body: row.body,
    yearStart: Number(row.year_from), yearEnd: row.year_to === "" || row.year_to === null ? null : Number(row.year_to),
    positions: {
      driver: sourcePosition(row.driver_sku, row.driver_in),
      passenger: sourcePosition(row.passenger_sku, row.passenger_in),
      rear: sourcePosition(row.rear_sku, row.rear_in),
    },
  };
}

function aliasSource(row, application) { return { ...row, sourceMake: row.make, sourceModel: row.model, make: application.make, model: application.model }; }
function sourcePosition(sku, size) { const number = Number(size); return sku || size !== "" && Number.isFinite(number) ? { sku: sku || null, sizeInch: size !== "" && Number.isFinite(number) ? number : null } : null; }
function compactSourceRow(row) { return { vehicle_id: row.vehicleId, make: row.sourceMake ?? row.make, model: row.sourceModel ?? row.model, series: row.series, body: row.body, year_from: row.yearStart, year_to: row.yearEnd, configuration: wiperTechPartialKey(row) }; }
function strongRule(rule) { return ["authoritative_series_all_catalog_years", "exact_series_full_year_coverage"].includes(rule); }
function completeFrontPair(key) { const [driver, passenger] = String(key ?? "").split("/"); return Boolean(driver && passenger && driver !== "-" && passenger !== "-"); }
function configurationHasActivePair(key, activePairs) { if (!completeFrontPair(key)) return false; const [driver, passenger] = key.split("/"); return activePairs.has(pairKey(driver, passenger)); }
function queueCount(rows) { return { applications: rows.length, application_years: rows.reduce((sum, row) => sum + row.years.length, 0), aggregate_rows: aggregate(rows).length }; }
function percentagePoints(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0; }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0; }
function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function intersect(left, right) { return new Set([...left].filter((value) => right.has(value))); }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function uniqueNumbers(values) { return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b); }
function uniqueBy(values, keyFn) { return [...new Map(values.map((value) => [keyFn(value), value])).values()]; }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function pairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function bodyKey(value) {
  const key = String(value ?? "").toLowerCase();
  if (/hatch|liftback/.test(key)) return "hatchback";
  if (/wagon|estate/.test(key)) return "wagon";
  if (/sport utility|\bsuv\b/.test(key)) return "suv";
  if (/sedan|saloon/.test(key)) return "sedan";
  if (/minivan|\bmpv\b/.test(key)) return "mpv";
  if (/panel van|cargo van|\bvan\b/.test(key)) return "van";
  if (/ute|utility|pickup/.test(key)) return "ute";
  if (/coupe/.test(key)) return "coupe";
  if (/convertible|cabrio|roadster/.test(key)) return "convertible";
  return key.trim();
}
function fileIdentity(file) { const value = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") }; }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function toCsv(rows) { const headers = Object.keys(rows[0] ?? {}); return `\uFEFF${headers.join(",")}\r\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\r\n")}\r\n`; }
function csvCell(value) { const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
