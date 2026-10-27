import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_75_ADDITIONAL_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-model-mazda6-wiper-20261025");
const WIPERTECH_FILE = path.join(ROOT, "outputs", "wipertech-enrichment-20261022", "wipertech_enriched_data.json");
const REVIEW_FILE = path.join(ROOT, "outputs", "core103-wiper-phase-20261025", "multi-candidate-review.jsonl");
const CORRECTION_FILE = path.join(ROOT, "outputs", "core103-wiper-phase-20261025", "catalog-corrections.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const EXPECTED_GAP_AY = 401;
const EXPECTED_LOCAL_EVIDENCE_CEILING_AY = 394;

if (process.argv.includes("--apply")) throw new Error("This script is report-only and never writes production.");
loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");

const group = POPULAR_75_ADDITIONAL_VEHICLE_GROUPS.find((row) => row.rank === 52);
if (!group || group.label !== "Mazda Atenza / Mazda 6") throw new Error("Maintained rank 52 Mazda group changed; review before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const local = loadLocalEvidence();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const production = await loadProduction();
const report = prepare(production, local);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), report.safe);
writeJsonl(path.join(OUTPUT_DIR, "blocked.jsonl"), report.blocked);
writeJsonl(path.join(OUTPUT_DIR, "productization.jsonl"), report.productization);
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(report.summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), readme(report.summary));

console.log(JSON.stringify({
  output_dir: OUTPUT_DIR,
  denominator_applications: report.summary.denominator.applications,
  denominator_application_years: report.summary.denominator.application_years,
  current_gap_applications: report.summary.current_gap.applications,
  current_gap_application_years: report.summary.current_gap.application_years,
  local_evidence_ceiling_application_years: report.summary.local_evidence_ceiling.application_years,
  safe_applications: report.summary.queues.safe_to_publish.applications,
  safe_application_years: report.summary.queues.safe_to_publish.application_years,
  productization_applications: report.summary.queues.productization.applications,
  productization_application_years: report.summary.queues.productization.application_years,
  blocked_applications: report.summary.queues.blocked.applications,
  blocked_application_years: report.summary.queues.blocked.application_years,
  integrity: report.summary.integrity
}, null, 2));

function loadLocalEvidence() {
  const snapshot = JSON.parse(fs.readFileSync(WIPERTECH_FILE, "utf8"));
  const sourceRows = (snapshot.sourceRows ?? []).filter((row) =>
    upper(row.make) === "MAZDA" && ["6", "ATENZA", "MAZDA6"].includes(upper(row.model)));
  if (!sourceRows.length) throw new Error("No Mazda 6/Atenza rows found in local WiperTech snapshot.");
  const rows = sourceRows.map((row) => ({
    vehicle_id: String(row.vehicle_id), make: row.make, model: row.model,
    series: String(row.series ?? "").trim(), series_family: sourceSeriesFamily(row.series),
    body: String(row.body ?? "").trim(), body_key: sourceBodyKey(row.body),
    year_from: Number(row.year_from), year_to: Number(row.year_to),
    configuration_key: [row.driver_in, row.passenger_in, row.rear_in || "-"].join("/")
  }));
  const reviewRows = readJsonl(REVIEW_FILE).filter((row) => row.family_id === "mazda_6_atenza");
  const correctionRows = readJsonl(CORRECTION_FILE).filter((row) => row.family_id === "mazda_6_atenza");
  return {
    rows,
    reviewsByApplication: indexByApplication(reviewRows),
    correctionsByApplication: indexByApplication(correctionRows),
    identities: {
      wipertech_snapshot: fileIdentity(WIPERTECH_FILE),
      existing_review: fileIdentity(REVIEW_FILE),
      existing_catalog_corrections: fileIdentity(CORRECTION_FILE)
    }
  };
}

function prepare(data, local) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApp = groupBy(data.years, (row) => row.application_id);
  const fitmentsByApp = groupBy(data.fitments, (row) => row.application_id);
  const configById = new Map(data.configurations.map((row) => [row.id, row]));
  const configsByKey = groupBy(data.configurations, (row) => row.configuration_key);
  const bladesByConfig = groupBy(data.blades, (row) => row.wiper_configuration_id);
  const sellablePairs = groupBy(data.wiperSets.filter(isSellableFrontPair), (row) => pairKey(row.driver_length_in, row.passenger_length_in));

  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const matchedGroup = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (matchedGroup?.id !== group.id) continue;
    const years = unique((yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b);
    if (!years.length) continue;
    const series = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id);
    const fitments = fitmentsByApp.get(application.application_id) ?? [];
    const published = fitments.filter((row) => row.fitment_status === "published");
    const publishedKeys = unique(published.map((row) => configById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`));
    applications.push({
      application_id: application.application_id, make: upper(make?.name), model: upper(model?.name),
      series_code: upper(series?.code), series_name: String(series?.display_name ?? "").trim(),
      body_style: bodyKey(variant?.body_style ?? variant?.display_name), variant_name: String(variant?.display_name ?? "").trim(),
      years, application_years: years.length, published_configuration_keys: publishedKeys,
      current_knowledge_covered: published.length > 0
    });
  }

  const gaps = applications.filter((row) => !row.current_knowledge_covered);
  const appAssessments = gaps.map((row) => assessGap(row, local, configsByKey, bladesByConfig, sellablePairs));
  const safeApps = appAssessments.filter((row) => row.outcome === "safe_to_publish");
  const productizationApps = appAssessments.filter((row) => row.outcome === "productization");
  const blockedApps = appAssessments.filter((row) => row.outcome === "blocked");
  const safe = aggregate(safeApps);
  const productization = aggregate(productizationApps);
  const blocked = aggregate(blockedApps);

  const sourceYearMin = Math.min(...local.rows.map((row) => row.year_from));
  const sourceYearMax = Math.max(...local.rows.map((row) => row.year_to));
  const preStrictEvidenceCeilingAy = appAssessments.filter((row) => row.existing_review_candidate_configurations.length > 0).reduce((sum, row) => sum + row.application_years, 0);
  const temporalEvidenceEnvelopeAy = gaps.reduce((sum, row) => sum + row.years.filter((year) => year >= sourceYearMin && year <= sourceYearMax).length, 0);
  const strictCompatibleEvidenceAy = appAssessments.reduce((sum, row) => sum + row.locally_supported_years.length, 0);
  const safeAy = sumAy(safeApps); const productizationAy = sumAy(productizationApps); const blockedAy = sumAy(blockedApps);
  const currentKnowledgeIds = new Set(applications.filter((row) => row.current_knowledge_covered).map((row) => row.application_id));
  const afterSafeIds = new Set([...currentKnowledgeIds, ...safeApps.map((row) => row.application_id)]);
  const afterSafeAndProductIds = new Set([...afterSafeIds, ...productizationApps.map((row) => row.application_id)]);
  const configProductization = productPlan(appAssessments, configsByKey, bladesByConfig, sellablePairs);

  const summary = {
    generated_at: new Date().toISOString(), mode: "report-only", production_writes: false,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, fleet_count: group.fleetCount, period: PERIOD },
    policy: {
      aggregation: "application -> exact NexAuto series/chassis code -> body -> identical year vector; engine/trim variants collapse only when those fields and outcome match",
      strict_series: "WiperTech GG/GY/GH/GJ map only to the same NexAuto chassis prefix; GL and GL Facelift map only to GL; no cross-generation promotion",
      body: "Sedan, Sedan-Hatch/hatchback, and Wagon remain distinct because rear blades differ",
      safe_gate: "all application years locally supported by one configuration, one body-compatible series family, no prior multi-configuration review/correction, no published conflict, valid configuration, and active sellable front pair",
      multi_candidate: "existing review rows with more than one candidate configuration remain blocked",
      productization: "deterministic knowledge evidence that fails only configuration/front-pair readiness is separated from safe",
      application_atomicity: "a partly supported application is blocked; the report does not silently split production application years"
    },
    sources: { ...local.identities, production_snapshot: { mode: "fresh read-only", table_counts: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length])) } },
    denominator: metrics(applications),
    current_gap: metrics(gaps),
    local_evidence_ceiling: {
      application_years: preStrictEvidenceCeilingAy,
      percent_of_gap: percent(preStrictEvidenceCeilingAy, sumAy(gaps)),
      source_year_from: sourceYearMin,
      source_year_to: sourceYearMax,
      definition: "provided pre-strict ceiling: gap applications carrying at least one candidate configuration in the existing local review; identity/body/configuration gates are not yet applied",
      temporal_source_envelope_application_years: temporalEvidenceEnvelopeAy,
      strict_same_series_body_application_years: strictCompatibleEvidenceAy,
      strict_same_series_body_percent_of_gap: percent(strictCompatibleEvidenceAy, sumAy(gaps)),
      strict_definition: "gap application-years having a same-series-prefix, body-compatible local WiperTech row; still not automatically publishable"
    },
    queues: {
      safe_to_publish: queueMetrics(safeApps, safe),
      productization: { ...queueMetrics(productizationApps, productization), reasons: countBy(productizationApps.flatMap((row) => row.blocker_reasons), (value) => value) },
      blocked: { ...queueMetrics(blockedApps, blocked), reasons: countBy(blockedApps.flatMap((row) => row.blocker_reasons), (value) => value) }
    },
    configuration_productization: configProductization,
    coverage: {
      knowledge_before: coverageMetric(applications, currentKnowledgeIds),
      knowledge_after_safe: coverageMetric(applications, afterSafeIds),
      knowledge_after_safe_and_productization: coverageMetric(applications, afterSafeAndProductIds)
    },
    projected_uplift: {
      safe_knowledge_application_years: safeAy,
      safe_knowledge_pp_of_model_denominator: percent(safeAy, sumAy(applications)),
      productization_potential_application_years: productizationAy,
      productization_potential_pp_of_model_denominator: percent(productizationAy, sumAy(applications))
    },
    integrity: {
      expected_gap_application_years: EXPECTED_GAP_AY,
      observed_gap_application_years: sumAy(gaps),
      expected_gap_matches: sumAy(gaps) === EXPECTED_GAP_AY,
      expected_local_evidence_ceiling_application_years: EXPECTED_LOCAL_EVIDENCE_CEILING_AY,
      observed_local_evidence_ceiling_application_years: preStrictEvidenceCeilingAy,
      expected_local_evidence_ceiling_matches: preStrictEvidenceCeilingAy === EXPECTED_LOCAL_EVIDENCE_CEILING_AY,
      gap_partition_matches: safeApps.length + productizationApps.length + blockedApps.length === gaps.length,
      gap_application_year_partition_matches: safeAy + productizationAy + blockedAy === sumAy(gaps),
      duplicate_queue_application_ids: duplicateValues(appAssessments.map((row) => row.application_id)),
      safe_contains_prior_multi_configuration_review: safeApps.filter((row) => row.existing_review_candidate_configurations.length > 1).map((row) => row.application_id),
      safe_contains_unsupported_years: safeApps.filter((row) => row.unsupported_years.length).map((row) => row.application_id)
    }
  };
  return { safe, blocked, productization, summary };
}

function assessGap(row, local, configsByKey, bladesByConfig, sellablePairs) {
  const seriesFamily = applicationSeriesFamily(row.series_code || row.series_name);
  const bodyRows = local.rows.filter((source) => source.series_family === seriesFamily && source.body_key === row.body_style);
  const configsByYear = {};
  for (const year of row.years) configsByYear[year] = unique(bodyRows.filter((source) => year >= source.year_from && year <= source.year_to).map((source) => source.configuration_key)).sort();
  const locallySupportedYears = row.years.filter((year) => configsByYear[year].length > 0);
  const unsupportedYears = row.years.filter((year) => configsByYear[year].length === 0);
  const localCandidateConfigurations = unique(Object.values(configsByYear).flat()).sort();
  const reviewRows = local.reviewsByApplication.get(row.application_id) ?? [];
  const correctionRows = local.correctionsByApplication.get(row.application_id) ?? [];
  const existingReviewCandidates = unique(reviewRows.flatMap((item) => item.candidate_configurations ?? [])).sort();
  const failures = [];
  if (!seriesFamily) failures.push("unsupported_or_missing_series_family");
  if (!recognizedBody(row.body_style)) failures.push("unsupported_or_missing_body");
  if (!bodyRows.length) failures.push("no_exact_series_body_local_evidence");
  if (unsupportedYears.length) failures.push("incomplete_local_year_coverage");
  if (localCandidateConfigurations.length !== 1) failures.push(localCandidateConfigurations.length ? "multiple_local_configurations" : "no_local_configuration");
  if (Object.values(configsByYear).some((values) => values.length > 1)) failures.push("multiple_configurations_for_same_year");
  if (existingReviewCandidates.length > 1) failures.push("existing_review_multiple_configurations");
  if (correctionRows.length) failures.push("existing_catalog_correction");
  if (row.published_configuration_keys.length) failures.push("published_configuration_conflict");
  const configurationKey = localCandidateConfigurations.length === 1 ? localCandidateConfigurations[0] : null;
  const readiness = configurationKey ? configurationReadiness(configurationKey, configsByKey, bladesByConfig, sellablePairs) : null;
  const evidenceFailures = unique(failures);
  let outcome = "blocked";
  let blockerReasons = evidenceFailures;
  if (!evidenceFailures.length && readiness?.product_ready) outcome = "safe_to_publish";
  else if (!evidenceFailures.length) { outcome = "productization"; blockerReasons = readiness.blocker_reasons; }
  const matchedRows = bodyRows.filter((source) => row.years.some((year) => year >= source.year_from && year <= source.year_to));
  return {
    ...row, rank: group.rank, group_id: group.id, popular_group: group.label, series_family: seriesFamily,
    outcome, configuration_key: configurationKey, blocker_reasons: blockerReasons,
    locally_supported_years: locallySupportedYears, unsupported_years: unsupportedYears,
    candidate_configurations: localCandidateConfigurations, configurations_by_year: configsByYear,
    existing_review_reasons: unique(reviewRows.map((item) => item.reason)).sort(),
    existing_review_candidate_configurations: existingReviewCandidates,
    existing_catalog_correction_reasons: unique(correctionRows.map((item) => item.reason)).sort(),
    source_vehicle_ids: unique(matchedRows.map((source) => source.vehicle_id)).sort(),
    source_spans: unique(matchedRows.map((source) => `${source.series}|${source.body}|${source.year_from}-${source.year_to}|${source.configuration_key}`)).sort(),
    product: readiness,
    next_requirement: nextRequirement(blockerReasons, unsupportedYears)
  };
}

function configurationReadiness(key, configsByKey, bladesByConfig, sellablePairs) {
  const configs = configsByKey.get(key) ?? [];
  const failures = [];
  if (!configs.length) failures.push("wiper_configuration_missing");
  if (configs.length > 1) failures.push("duplicate_wiper_configuration_key");
  const config = configs.length === 1 ? configs[0] : null;
  const bladesKey = config ? bladeKey(bladesByConfig.get(config.id) ?? []) : null;
  if (config && bladesKey !== key) failures.push("wiper_configuration_blades_mismatch");
  if (config && ["rejected", "superseded"].includes(config.configuration_status)) failures.push("wiper_configuration_not_publishable");
  const [driver, passenger] = key.split("/");
  const pair = sellablePairs.get(pairKey(driver, passenger)) ?? [];
  if (!pair.length) failures.push("active_sellable_front_pair_missing");
  return {
    configuration_id: config?.id ?? null, configuration_exists: Boolean(config),
    configuration_status: config?.configuration_status ?? null, configuration_blades_key: bladesKey,
    sellable_front_pair_skus: pair.map((item) => item.sku).sort(), product_ready: failures.length === 0,
    blocker_reasons: failures
  };
}

function aggregate(rows) {
  const groups = groupBy(rows, (row) => JSON.stringify([
    row.outcome, row.make, row.model, row.series_code, row.body_style, row.years,
    row.configuration_key, row.blocker_reasons, row.product?.configuration_id ?? null,
    row.product?.sellable_front_pair_skus ?? []
  ]));
  return [...groups.values()].map((items) => {
    const first = items[0];
    return {
      rank: first.rank, group_id: first.group_id, popular_group: first.popular_group, outcome: first.outcome,
      make: first.make, model: first.model, series_code: first.series_code, series_name: first.series_name,
      series_family: first.series_family, body_style: first.body_style, years: first.years,
      year_from: Math.min(...first.years), year_to: Math.max(...first.years),
      application_ids: items.map((row) => row.application_id).sort(), applications: items.length,
      application_years: sumAy(items), variant_names: unique(items.map((row) => row.variant_name)).sort(),
      configuration_key: first.configuration_key, candidate_configurations: first.candidate_configurations,
      locally_supported_years: first.locally_supported_years, unsupported_years: first.unsupported_years,
      blocker_reasons: first.blocker_reasons, next_requirement: first.next_requirement,
      existing_review_reasons: unique(items.flatMap((row) => row.existing_review_reasons)).sort(),
      existing_review_candidate_configurations: unique(items.flatMap((row) => row.existing_review_candidate_configurations)).sort(),
      existing_catalog_correction_reasons: unique(items.flatMap((row) => row.existing_catalog_correction_reasons)).sort(),
      source_vehicle_ids: unique(items.flatMap((row) => row.source_vehicle_ids)).sort(),
      source_spans: unique(items.flatMap((row) => row.source_spans)).sort(), product: first.product
    };
  }).sort(queueSort);
}

function productPlan(rows, configsByKey, bladesByConfig, sellablePairs) {
  const keys = unique(rows.map((row) => row.configuration_key)).sort();
  return keys.map((key) => {
    const readiness = configurationReadiness(key, configsByKey, bladesByConfig, sellablePairs);
    const affected = rows.filter((row) => row.configuration_key === key && !row.blocker_reasons.some((reason) => reason.startsWith("multiple_") || reason.includes("review") || reason.includes("correction") || reason.includes("coverage") || reason.startsWith("no_") || reason.startsWith("unsupported_")));
    return { configuration_key: key, ...readiness, deterministic_gap_applications: affected.length, deterministic_gap_application_years: sumAy(affected), required_actions: readiness.product_ready ? [] : readiness.blocker_reasons };
  });
}

async function loadProduction() {
  const specs = [
    ["makes", "vehicle_catalog_makes", "make_id,name,status"], ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
    ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"], ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
    ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"],
    ["years", "vehicle_catalog_application_years", "application_id,model_year"],
    ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
    ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"],
    ["blades", "wiper_configuration_blades", "wiper_configuration_id,position,length_in"],
    ["wiperSets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"]
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

function coverageMetric(applications, coveredIds) {
  const years = unique(applications.flatMap((row) => row.years)).sort((a, b) => a - b);
  let any = 0; let full = 0;
  for (const year of years) {
    const ids = applications.filter((row) => row.years.includes(year)).map((row) => row.application_id);
    const covered = ids.filter((id) => coveredIds.has(id)).length;
    if (covered) any += 1;
    if (covered === ids.length) full += 1;
  }
  const coveredApps = applications.filter((row) => coveredIds.has(row.application_id));
  return { applications_total: applications.length, applications_covered: coveredApps.length,
    application_coverage_percent: percent(coveredApps.length, applications.length),
    application_years_total: sumAy(applications), application_years_covered: sumAy(coveredApps),
    application_year_coverage_percent: percent(sumAy(coveredApps), sumAy(applications)), model_years_total: years.length,
    model_years_any_covered: any, model_year_any_coverage_percent: percent(any, years.length),
    model_years_fully_covered: full, model_year_full_coverage_percent: percent(full, years.length) };
}

function applicationSeriesFamily(value) { const text = upper(value).replace(/[^A-Z0-9]/g, ""); return ["GG", "GY", "GH", "GJ", "GL"].find((prefix) => text.startsWith(prefix)) ?? null; }
function sourceSeriesFamily(value) { const text = upper(value); if (text.startsWith("GL")) return "GL"; return ["GG", "GY", "GH", "GJ"].find((prefix) => text.startsWith(prefix)) ?? null; }
function sourceBodyKey(value) { const text = String(value ?? "").toLowerCase(); if (text.includes("sedan-hatch")) return "hatchback"; if (text.includes("wagon")) return "wagon"; if (text.includes("sedan")) return "sedan"; return bodyKey(text); }
function bodyKey(value) { const text = String(value ?? "").toLowerCase(); if (/hatch|liftback/.test(text)) return "hatchback"; if (/wagon|estate/.test(text)) return "wagon"; if (/sedan|saloon/.test(text)) return "sedan"; if (/coupe/.test(text)) return "coupe"; if (/convertible|cabriolet/.test(text)) return "convertible"; return text.trim(); }
function recognizedBody(value) { return ["sedan", "hatchback", "wagon"].includes(value); }
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function pairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function bladeKey(rows) { const map = new Map(rows.map((row) => [row.position, Number(row.length_in)])); return [map.get("driver") ?? "-", map.get("passenger") ?? "-", map.get("rear") ?? "-"].join("/"); }
function nextRequirement(failures, unsupportedYears) { if (failures.includes("existing_review_multiple_configurations") || failures.includes("multiple_local_configurations") || failures.includes("multiple_configurations_for_same_year")) return "Authoritative series/body evidence must select one configuration; multi-candidate evidence remains review-only."; if (failures.includes("existing_catalog_correction")) return "Resolve the recorded body/chassis catalog correction before fitment publication."; if (failures.includes("incomplete_local_year_coverage")) return `Obtain same-series/body evidence for ${unsupportedYears.join(", ")} or explicitly split/correct the application.`; if (failures.includes("active_sellable_front_pair_missing")) return "Create or restore a complete active sellable front pair before publication."; if (failures.includes("wiper_configuration_missing")) return "Create and validate the exact wiper configuration before publication."; return "Obtain exact same-series, body-compatible local evidence and resolve configuration integrity."; }
function metrics(rows) { return { applications: rows.length, application_years: sumAy(rows), model_years: unique(rows.flatMap((row) => row.years)).length }; }
function queueMetrics(appRows, groupedRows) { return { rows: groupedRows.length, applications: appRows.length, application_years: sumAy(appRows) }; }
function sumAy(rows) { return rows.reduce((sum, row) => sum + Number(row.application_years ?? 0), 0); }
function indexByApplication(rows) { const output = new Map(); for (const row of rows) for (const id of row.application_ids ?? []) { const values = output.get(id) ?? []; values.push(row); output.set(id, values); } return output; }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return Object.fromEntries(Object.entries(output).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))); }
function duplicateValues(values) { return Object.entries(countBy(values, (value) => value)).filter(([, count]) => count > 1).map(([value]) => value); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(4)) : 0; }
function queueSort(a, b) { return a.series_code.localeCompare(b.series_code) || a.body_style.localeCompare(b.body_style) || a.year_from - b.year_from || a.model.localeCompare(b.model); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
function readme(summary) { return `Mazda Atenza / Mazda 6 Wiper Model Report - 2026-10-25\n\nMode: report-only. No production writes are implemented.\nPeriod: 2000-2026.\n\nInputs\n- Local WiperTech snapshot only.\n- Existing core103 review/correction queues.\n- Fresh read-only production state.\n\nRules\n- Strict same chassis-prefix and body matching. GG, GY, GH and GJ never inherit another generation. GL may use GL and GL Facelift rows.\n- Sedan, hatch/liftback and wagon are distinct because rear blades differ.\n- Every year attached to an application must be supported by one configuration; no hidden year splitting.\n- Existing multi-configuration reviews remain blocked.\n- Safe additionally requires a valid configuration and active sellable front pair.\n\nObserved\n- Denominator: ${summary.denominator.applications} applications / ${summary.denominator.application_years} AY.\n- Current knowledge gap: ${summary.current_gap.applications} applications / ${summary.current_gap.application_years} AY.\n- Local evidence ceiling: ${summary.local_evidence_ceiling.application_years} AY (year-level only, not automatically publishable).\n- Safe: ${summary.queues.safe_to_publish.applications} applications / ${summary.queues.safe_to_publish.application_years} AY.\n- Productization: ${summary.queues.productization.applications} applications / ${summary.queues.productization.application_years} AY.\n- Blocked: ${summary.queues.blocked.applications} applications / ${summary.queues.blocked.application_years} AY.\n\nFiles\n- safe-to-publish.jsonl\n- blocked.jsonl\n- productization.jsonl\n- summary.json\n\nRerun\nnode scripts/catalog/report-extended132-model-mazda6-wiper-20261025.mjs\n` + (summary.integrity.expected_gap_matches && summary.integrity.expected_local_evidence_ceiling_matches ? "" : "\nWARNING: expected gap/evidence ceiling drifted; review summary.integrity before using queues.\n"); }
