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

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "core103-wiper-phase-20261025");
const SOURCE_FILE = path.resolve(ROOT, "outputs", "wipertech-enrichment-20261022", "wipertech_enriched_data.json");
const POPULAR_GAPS_FILE = path.resolve(ROOT, "outputs", "wiper-popular-gaps-20261024", "popular_wiper_gaps.json");
const PERIOD = { from: 2000, to: 2026 };

// These are explicit product-family aliases, not fuzzy model matching rules.
// Body is still checked separately so rear-wiper evidence is never copied across bodies.
const FAMILIES = [
  family("mini_hatch", "MINI hatch family", "primary", ["MINI"], null, ["COOPER"], ["hatchback"]),
  family("mazda_6_atenza", "Mazda Atenza / Mazda 6", "primary", ["MAZDA"], ["ATENZA", "6"], ["ATENZA", "6"]),
  family("mitsubishi_pajero", "Mitsubishi Pajero", "primary", ["MITSUBISHI"], ["PAJERO"], ["PAJERO"]),
  family("nissan_serena", "Nissan Serena", "primary", ["NISSAN"], ["SERENA"], ["SERENA"]),
  family("nissan_caravan_nv350", "Nissan Caravan / NV350", "primary", ["NISSAN"], ["CARAVAN", "NV350", "NV350 CARAVAN"], ["CARAVAN"]),
  family("toyota_vitz_yaris", "Toyota Vitz / Yaris", "known_product_gap", ["TOYOTA"], ["VITZ", "YARIS"], ["VITZ", "YARIS"]),
  family("honda_civic", "Honda Civic", "known_product_gap", ["HONDA"], ["CIVIC"], ["CIVIC"]),
  family("bmw_3_series", "BMW 3 Series", "known_product_gap", ["BMW"], ["3", "3 SERIES"], ["3 SERIES"]),
  family("ford_focus", "Ford Focus", "known_product_gap", ["FORD"], ["FOCUS"], ["FOCUS"]),
  family("toyota_estima", "Toyota Estima", "known_product_gap", ["TOYOTA"], ["ESTIMA"], ["ESTIMA"]),
];

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase read credentials.");
}
if (!fs.existsSync(SOURCE_FILE)) throw new Error(`Missing WiperTech snapshot: ${SOURCE_FILE}`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sourceSnapshot = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
const rawSourceRows = sourceSnapshot.sourceRows.map(toSourceRecord);
const existingGapRows = fs.existsSync(POPULAR_GAPS_FILE)
  ? JSON.parse(fs.readFileSync(POPULAR_GAPS_FILE, "utf8")).rows ?? []
  : [];
const existingGapByApplication = new Map(existingGapRows.map((row) => [row.application_id, row]));

const data = await loadProductionSnapshot();
const prepared = prepare(data);
writeOutputs(prepared);
console.log(JSON.stringify({ outputDir: OUTPUT_DIR, ...prepared.summary.counts, coverage: prepared.summary.coverage }, null, 2));

function prepare(data) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const publishedByApplication = groupBy(
    data.fitments.filter((row) => row.fitment_status === "published"),
    (row) => row.application_id,
  );
  const sellablePairs = new Set(data.wiperSets.filter(isSellableFrontPair).map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));

  const applications = [];
  for (const row of data.applications.filter((item) => item.status === "active")) {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(row.series_id);
    const variant = variantById.get(row.variant_id);
    const body = bodyKey(variant?.body_style ?? variant?.display_name);
    const familyDefinition = FAMILIES.find((item) => familyMatches(item, make?.name, model?.name, body));
    if (!familyDefinition) continue;
    const years = uniqueNumbers((yearsByApplication.get(row.application_id) ?? []).map((item) => item.model_year))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((left, right) => left - right);
    if (!years.length) continue;
    const publishedRows = publishedByApplication.get(row.application_id) ?? [];
    const currentConfigurationKeys = uniqueStrings(publishedRows.map((item) => configurationById.get(item.wiper_configuration_id)?.configuration_key));
    applications.push({
      applicationId: row.application_id,
      family: familyDefinition,
      make: upper(make?.name),
      model: upper(model?.name),
      seriesCode: upper(series?.code),
      seriesName: String(series?.display_name ?? "").trim(),
      variantName: String(variant?.display_name ?? "").trim(),
      bodyStyle: body,
      years,
      currentConfigurationKeys,
      currentConfigurationKey: currentConfigurationKeys.length === 1 ? currentConfigurationKeys[0] : null,
      duplicatePublished: publishedRows.length > 1,
    });
  }

  const decisions = applications.map((application) => assessApplication(application, sellablePairs));
  const readyApplications = decisions.filter((row) => row.outcome === "ready_to_publish");
  const combinationApplications = decisions.filter((row) => row.outcome === "sellable_combination_to_create");
  const reviewApplications = decisions.filter((row) => row.outcome === "multi_candidate_review");
  const correctionApplications = decisions.filter((row) => row.outcome === "catalog_correction");

  const ready = aggregate(readyApplications);
  const combinations = aggregate(combinationApplications);
  const reviews = aggregate(reviewApplications);
  const corrections = aggregate(correctionApplications);
  const readyIds = new Set(readyApplications.map((row) => row.applicationId));
  const currentKnowledgeIds = new Set(applications.filter((row) => row.currentConfigurationKeys.length === 1).map((row) => row.applicationId));
  const currentProductIds = new Set(applications.filter((row) => row.currentConfigurationKeys.length === 1 && configurationSellable(row.currentConfigurationKey, sellablePairs)).map((row) => row.applicationId));
  const afterKnowledgeIds = union(currentKnowledgeIds, readyIds);
  const afterProductIds = union(currentProductIds, readyIds);

  const coverage = coverageSummary(applications, currentKnowledgeIds, currentProductIds, afterKnowledgeIds, afterProductIds);
  const expectedApplicationYearAdditions = readyApplications.reduce((sum, row) => sum + row.years.length, 0);
  const expectedModelYearAdditions = countNewModelYears(applications, currentKnowledgeIds, readyIds);
  const combinationPotentialApplicationYears = combinationApplications
    .filter((row) => row.currentConfigurationKey && !configurationSellable(row.currentConfigurationKey, sellablePairs))
    .reduce((sum, row) => sum + row.years.length, 0);

  const summary = {
    generated_at: new Date().toISOString(),
    mode: "report-only",
    period: PERIOD,
    scope: FAMILIES.map(({ id, label, phase }) => ({ id, label, phase })),
    policy: {
      aggregation: "application -> chassis/series -> body; engine and trim variants are collapsed only in output rows",
      ready_gate: "active application, years present, one strong exact-series WiperTech configuration, compatible body/rear evidence, no published conflict, and an existing sellable front pair",
      rear_policy: "rear is retained only from body-compatible evidence; ambiguous rear evidence is review-only",
      production_writes: false,
    },
    sources: {
      wipertech_snapshot: fileIdentity(SOURCE_FILE),
      existing_gap_snapshot: fs.existsSync(POPULAR_GAPS_FILE) ? fileIdentity(POPULAR_GAPS_FILE) : null,
      production_snapshot: {
        mode: "read-only",
        tables: data.tableCounts,
      },
    },
    counts: {
      scoped_applications: applications.length,
      scoped_application_years: applications.reduce((sum, row) => sum + row.years.length, 0),
      ready_rows: ready.length,
      ready_applications: readyApplications.length,
      ready_application_years: expectedApplicationYearAdditions,
      ready_new_model_years_any_coverage: expectedModelYearAdditions,
      sellable_combination_rows: combinations.length,
      sellable_combination_applications: combinationApplications.length,
      sellable_combination_potential_application_years: combinationPotentialApplicationYears,
      review_rows: reviews.length,
      review_applications: reviewApplications.length,
      catalog_correction_rows: corrections.length,
      catalog_correction_applications: correctionApplications.length,
    },
    coverage,
    coverage_by_phase: ["primary", "known_product_gap"].map((phase) => phaseSummary(
      phase, applications, decisions, currentKnowledgeIds, currentProductIds, afterKnowledgeIds, afterProductIds,
    )),
    by_family: FAMILIES.map((definition) => familySummary(definition, applications, decisions, currentKnowledgeIds, currentProductIds, afterKnowledgeIds, afterProductIds)),
  };
  return { summary, ready, combinations, reviews, corrections };

  function assessApplication(application, sellablePairSet) {
    const base = decisionBase(application);
    const explicitCorrection = catalogCorrection(application);
    if (explicitCorrection) return { ...base, outcome: "catalog_correction", reason: explicitCorrection.reason, requested_evidence: explicitCorrection.requestedEvidence };
    if (application.duplicatePublished) return { ...base, outcome: "multi_candidate_review", reason: "duplicate_published_fitments", candidate_configurations: application.currentConfigurationKeys };

    const sourceRows = sourceRowsFor(application);
    const bodyRows = sourceRows.filter((row) => !bodyKey(row.body) || bodyKey(row.body) === application.bodyStyle);
    const matcherRows = bodyRows.length ? bodyRows : sourceRows;
    const aliasRows = matcherRows.map((row) => ({
      ...row,
      sourceMake: row.sourceMake ?? row.make,
      sourceModel: row.sourceModel ?? row.model,
      make: application.make,
      model: application.model,
    }));
    const decision = resolveWiperTechApplication(application, aliasRows);
    const evidence = decision.status === "published" ? decision.supportingRows : decision.candidates;
    const evidenceRows = uniqueBy(evidence ?? [], (row) => row.vehicleId);
    const evidenceConfigurations = uniqueStrings(evidenceRows.map(wiperTechPartialKey));
    const common = {
      ...base,
      matcher_status: decision.status,
      matcher_rule: decision.rule ?? null,
      matcher_reason: decision.reason ?? null,
      candidate_configuration: decision.configurationKey ?? null,
      candidate_configurations: decision.candidateConfigurationKeys?.length ? decision.candidateConfigurationKeys : evidenceConfigurations,
      source_vehicle_ids: uniqueStrings(evidenceRows.map((row) => row.vehicleId)),
      source_rows: evidenceRows.map(compactSourceRow),
      existing_review: existingGapByApplication.get(application.applicationId) ?? null,
    };

    if (application.currentConfigurationKey) {
      if (!configurationSellable(application.currentConfigurationKey, sellablePairSet)) {
        return { ...common, outcome: "sellable_combination_to_create", configuration_key: application.currentConfigurationKey, reason: sellableReason(application.currentConfigurationKey) };
      }
      if (decision.status === "published" && application.currentConfigurationKey !== decision.configurationKey) {
        return { ...common, outcome: "multi_candidate_review", reason: "published_configuration_conflict", configuration_key: application.currentConfigurationKey };
      }
      return { ...common, outcome: "already_covered", configuration_key: application.currentConfigurationKey, reason: "published_and_sellable" };
    }

    if (decision.status !== "published") return { ...common, outcome: "multi_candidate_review", reason: decision.reason ?? "no_deterministic_configuration" };
    if (!application.seriesCode) return { ...common, outcome: "multi_candidate_review", reason: "missing_series_code_cross_generation_risk" };
    if (!["authoritative_series_all_catalog_years", "exact_series_full_year_coverage"].includes(decision.rule)) {
      return { ...common, outcome: "multi_candidate_review", reason: "not_exact_series_evidence" };
    }
    const rearProblem = rearEvidenceProblem(application, decision.supportingRows ?? []);
    if (rearProblem) return { ...common, outcome: "multi_candidate_review", reason: rearProblem };
    if (!configurationSellable(decision.configurationKey, sellablePairSet)) {
      return { ...common, outcome: "sellable_combination_to_create", configuration_key: decision.configurationKey, reason: sellableReason(decision.configurationKey) };
    }
    return { ...common, outcome: "ready_to_publish", configuration_key: decision.configurationKey, reason: "strong_series_body_evidence_no_conflict_sellable_pair_exists" };
  }
}

function sourceRowsFor(application) {
  const sourceModels = new Set(application.family.sourceModels.map(modelKey));
  return rawSourceRows.filter((row) => application.family.makes.includes(upper(row.make)) && sourceModels.has(modelKey(row.model)));
}

function rearEvidenceProblem(application, supportingRows) {
  if (!supportingRows.length) return "missing_supporting_rows";
  const incompatibleBodies = supportingRows.filter((row) => bodyKey(row.body) && bodyKey(row.body) !== application.bodyStyle);
  if (incompatibleBodies.length) return "source_body_conflict";
  const rearValues = new Set(supportingRows.map((row) => row.positions?.rear?.sizeInch ?? null));
  if (rearValues.size > 1) return "rear_configuration_ambiguous";
  if (["hatchback", "wagon", "suv", "van", "mpv"].includes(application.bodyStyle)
    && supportingRows.every((row) => !bodyKey(row.body))) return "rear_body_evidence_missing";
  return null;
}

function catalogCorrection(application) {
  if (application.family.id === "toyota_vitz_yaris" && application.seriesCode === "KVP91") {
    return {
      reason: "KVP91 is not established as an XP90/Vitz chassis; do not repair the identity with a wiper rule",
      requestedEvidence: "VIN/market chassis identity proving the intended KSP90/NCP91-class application or another genuine KVP91 identity",
    };
  }
  if (application.family.id === "mazda_6_atenza" && application.seriesCode === "GH5FS" && application.bodyStyle === "sedan") {
    return {
      reason: "GH5FS chassis/body assignment conflicts with the existing review evidence that treats this suffix as a hatch/liftback identity",
      requestedEvidence: "VIN or authoritative Mazda body-code record before choosing sedan versus hatch rear-wiper configuration",
    };
  }
  return null;
}

function aggregate(rows) {
  const groups = groupBy(rows, (row) => [
    row.outcome, row.family_id, row.make, row.model, row.series_code, row.series_name,
    row.body_style, row.configuration_key ?? row.candidate_configuration ?? "", row.reason,
  ].join("|"));
  return [...groups.values()].map((items) => {
    const first = items[0];
    const years = uniqueNumbers(items.flatMap((row) => row.years)).sort((a, b) => a - b);
    return {
      phase: first.phase,
      family_id: first.family_id,
      family: first.family,
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
      matcher_rules: uniqueStrings(items.map((row) => row.matcher_rule)),
      reason: first.reason,
      source_vehicle_ids: uniqueStrings(items.flatMap((row) => row.source_vehicle_ids ?? [])),
      source_rows: uniqueBy(items.flatMap((row) => row.source_rows ?? []), (row) => row.vehicle_id),
      requested_evidence: first.requested_evidence ?? null,
      existing_review: items.map((row) => row.existing_review).find(Boolean) ?? null,
    };
  }).sort(sortRows);
}

function decisionBase(application) {
  return {
    phase: application.family.phase,
    family_id: application.family.id,
    family: application.family.label,
    applicationId: application.applicationId,
    make: application.make,
    model: application.model,
    series_code: application.seriesCode,
    series_name: application.seriesName,
    body_style: application.bodyStyle,
    variant: application.variantName,
    years: application.years,
    current_configurations: application.currentConfigurationKeys,
    currentConfigurationKey: application.currentConfigurationKey,
    existing_review: existingGapByApplication.get(application.applicationId) ?? null,
  };
}

function phaseSummary(phase, applications, decisions, knowledgeBefore, productBefore, knowledgeAfter, productAfter) {
  const phaseApplications = applications.filter((row) => row.family.phase === phase);
  const ids = new Set(phaseApplications.map((row) => row.applicationId));
  const phaseDecisions = decisions.filter((row) => row.phase === phase);
  return {
    phase,
    applications: phaseApplications.length,
    application_years: phaseApplications.reduce((sum, row) => sum + row.years.length, 0),
    outcomes: countBy(phaseDecisions, (row) => row.outcome),
    coverage: metricBundle(phaseApplications, intersect(knowledgeBefore, ids), intersect(productBefore, ids), intersect(knowledgeAfter, ids), intersect(productAfter, ids)),
  };
}

function familySummary(definition, applications, decisions, knowledgeBefore, productBefore, knowledgeAfter, productAfter) {
  const familyApplications = applications.filter((row) => row.family.id === definition.id);
  const ids = new Set(familyApplications.map((row) => row.applicationId));
  const familyDecisions = decisions.filter((row) => row.family_id === definition.id);
  return {
    family_id: definition.id,
    family: definition.label,
    phase: definition.phase,
    applications: familyApplications.length,
    application_years: familyApplications.reduce((sum, row) => sum + row.years.length, 0),
    outcomes: countBy(familyDecisions, (row) => row.outcome),
    coverage: metricBundle(familyApplications, intersect(knowledgeBefore, ids), intersect(productBefore, ids), intersect(knowledgeAfter, ids), intersect(productAfter, ids)),
  };
}

function coverageSummary(applications, knowledgeBefore, productBefore, knowledgeAfter, productAfter) {
  return metricBundle(applications, knowledgeBefore, productBefore, knowledgeAfter, productAfter);
}

function metricBundle(applications, knowledgeBefore, productBefore, knowledgeAfter, productAfter) {
  return {
    knowledge_before: coverageMetric(applications, knowledgeBefore),
    knowledge_after_ready: coverageMetric(applications, knowledgeAfter),
    product_before: coverageMetric(applications, productBefore),
    product_after_ready: coverageMetric(applications, productAfter),
  };
}

function coverageMetric(applications, coveredIds) {
  const applicationYears = applications.flatMap((row) => row.years.map((year) => ({ applicationId: row.applicationId, familyId: row.family.id, year })));
  const modelYears = groupBy(applicationYears, (row) => `${row.familyId}|${row.year}`);
  const coveredApplicationYears = applicationYears.filter((row) => coveredIds.has(row.applicationId)).length;
  const anyCoveredModelYears = [...modelYears.values()].filter((rows) => rows.some((row) => coveredIds.has(row.applicationId))).length;
  const fullyCoveredModelYears = [...modelYears.values()].filter((rows) => rows.every((row) => coveredIds.has(row.applicationId))).length;
  return {
    applications_total: applications.length,
    applications_covered: applications.filter((row) => coveredIds.has(row.applicationId)).length,
    application_years_total: applicationYears.length,
    application_years_covered: coveredApplicationYears,
    application_year_coverage_percent: percent(coveredApplicationYears, applicationYears.length),
    model_years_total: modelYears.size,
    model_years_any_covered: anyCoveredModelYears,
    model_year_any_coverage_percent: percent(anyCoveredModelYears, modelYears.size),
    model_years_fully_covered: fullyCoveredModelYears,
    model_year_full_coverage_percent: percent(fullyCoveredModelYears, modelYears.size),
  };
}

function countNewModelYears(applications, beforeIds, addedIds) {
  const groups = groupBy(applications.flatMap((row) => row.years.map((year) => ({ ...row, year }))), (row) => `${row.family.id}|${row.year}`);
  return [...groups.values()].filter((rows) => !rows.some((row) => beforeIds.has(row.applicationId)) && rows.some((row) => addedIds.has(row.applicationId))).length;
}

function writeOutputs(prepared) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(prepared.summary, null, 2)}\n`);
  writeJsonl(path.join(OUTPUT_DIR, "ready-to-publish.jsonl"), prepared.ready);
  writeJsonl(path.join(OUTPUT_DIR, "sellable-combinations-to-create.jsonl"), prepared.combinations);
  writeJsonl(path.join(OUTPUT_DIR, "multi-candidate-review.jsonl"), prepared.reviews);
  writeJsonl(path.join(OUTPUT_DIR, "catalog-corrections.jsonl"), prepared.corrections);
  const c = prepared.summary.counts;
  const text = [
    "NexAuto core103 wiper phase — report only",
    `Generated: ${prepared.summary.generated_at}`,
    `Scope years: ${PERIOD.from}-${PERIOD.to}`,
    "Production writes: none",
    "",
    `Scoped applications/application-years: ${c.scoped_applications}/${c.scoped_application_years}`,
    `Ready to publish: ${c.ready_rows} aggregate rows, ${c.ready_applications} applications, ${c.ready_application_years} application-years`,
    `Sellable combinations to create: ${c.sellable_combination_rows} aggregate rows, ${c.sellable_combination_applications} applications`,
    `Multi-candidate review: ${c.review_rows} aggregate rows, ${c.review_applications} applications`,
    `Catalog corrections: ${c.catalog_correction_rows} aggregate rows, ${c.catalog_correction_applications} applications`,
    "",
    "Policy: output is aggregated by application -> series/chassis -> body. Engine/trim duplicates are collapsed in JSONL rows but application IDs and application-year counts are retained.",
    "Ready rows require exact-series evidence, body-compatible rear evidence, no current conflict, and an existing sellable front pair.",
    "A dash/null rear remains unknown or intentionally absent as recorded by evidence; it is never inferred from another body style.",
    "See summary.json for before/after application-year and model-year coverage.",
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), text);
}

async function loadProductionSnapshot() {
  const specs = [
    ["makes", "vehicle_catalog_makes", "make_id,name,status"],
    ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
    ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"],
    ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
    ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status,year_from,year_to"],
    ["years", "vehicle_catalog_application_years", "application_id,model_year"],
    ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
    ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"],
    ["wiperSets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"],
  ];
  const values = await Promise.all(specs.map(([, table, columns]) => fetchAll(table, columns)));
  const output = Object.fromEntries(specs.map(([name], index) => [name, values[index]]));
  output.tableCounts = Object.fromEntries(specs.map(([name, table], index) => [table, values[index].length]));
  return output;
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
    vehicleId: String(row.vehicle_id),
    make: row.make,
    model: row.model,
    series: row.series,
    body: row.body,
    yearStart: Number(row.year_from),
    yearEnd: row.year_to === "" || row.year_to === null ? null : Number(row.year_to),
    positions: {
      driver: position(row.driver_sku, row.driver_in),
      passenger: position(row.passenger_sku, row.passenger_in),
      rear: position(row.rear_sku, row.rear_in),
    },
  };
}

function position(sku, size) {
  const number = Number(size);
  return sku || Number.isFinite(number) && size !== "" ? { sku: sku || null, sizeInch: Number.isFinite(number) && size !== "" ? number : null } : null;
}

function compactSourceRow(row) {
  return {
    vehicle_id: row.vehicleId,
    make: row.sourceMake ?? row.make,
    model: row.sourceModel ?? row.model,
    series: row.series,
    body: row.body,
    year_from: row.yearStart,
    year_to: row.yearEnd,
    configuration: wiperTechPartialKey(row),
  };
}

function configurationSellable(configurationKey, sellablePairs) {
  const [driver, passenger] = String(configurationKey ?? "").split("/");
  if (!driver || !passenger || driver === "-" || passenger === "-") return false;
  return sellablePairs.has(pairKey(driver, passenger));
}

function sellableReason(configurationKey) {
  const [driver, passenger] = String(configurationKey ?? "").split("/");
  return !driver || !passenger || driver === "-" || passenger === "-"
    ? "knowledge_exists_but_front_is_partial_and_has_no_sellable_pair"
    : "knowledge_exists_but_active_sellable_front_pair_is_missing";
}

function isSellableFrontPair(row) {
  return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
    && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true;
}

function family(id, label, phase, makes, models, sourceModels, bodies = null) {
  return { id, label, phase, makes, models, sourceModels, bodies };
}

function familyMatches(definition, make, model, body) {
  if (!definition.makes.includes(upper(make))) return false;
  if (definition.models && !definition.models.map(modelKey).includes(modelKey(model))) return false;
  if (definition.bodies && !definition.bodies.includes(body)) return false;
  return true;
}

function modelKey(value) { return canonicalModelKey("_", value).split("|")[1]; }
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

function pairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0; }
function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function intersect(left, right) { return new Set([...left].filter((value) => right.has(value))); }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function uniqueNumbers(values) { return [...new Set(values.map(Number).filter(Number.isFinite))]; }
function uniqueBy(values, keyFn) { return [...new Map(values.map((value) => [keyFn(value), value])).values()]; }
function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const bucket = output.get(key) ?? [];
    bucket.push(value);
    output.set(key, bucket);
  }
  return output;
}
function countBy(values, keyFn) {
  const output = {};
  for (const value of values) {
    const key = keyFn(value);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}
function sortRows(left, right) {
  return left.phase.localeCompare(right.phase) || left.family.localeCompare(right.family)
    || left.make.localeCompare(right.make) || left.model.localeCompare(right.model)
    || left.series_code.localeCompare(right.series_code) || left.body_style.localeCompare(right.body_style);
}
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) {
  const buffer = fs.readFileSync(file);
  return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex") };
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
