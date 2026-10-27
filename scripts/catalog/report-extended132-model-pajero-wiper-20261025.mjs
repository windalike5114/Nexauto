import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_75_ADDITIONAL_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-model-pajero-wiper-20261025");
const WIPERTECH_FILE = path.join(ROOT, "outputs", "wipertech-enrichment-20261022", "wipertech_enriched_data.json");
const CORE_REVIEW_FILE = path.join(ROOT, "outputs", "core103-wiper-phase-20261025", "multi-candidate-review.jsonl");
const AI_REVIEW_FILES = [
  "multiple_front_configurations_009.json",
  "incomplete_year_coverage_030.json",
  "incomplete_year_coverage_034.json",
  "incomplete_year_coverage_035.json"
].map((name) => path.join(ROOT, "outputs", "wipertech-cross-ai-review-20261022", "_ai_review", "results", name));
const PERIOD = { from: 2000, to: 2026 };
const EXPECTED_GAP_AY = 13;
const EXPECTED_LOCAL_EVIDENCE_CEILING_AY = 7;

if (process.argv.includes("--apply")) throw new Error("This script is report-only and never writes production.");
loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");

const group = POPULAR_75_ADDITIONAL_VEHICLE_GROUPS.find((row) => row.rank === 82);
if (!group || group.label !== "Mitsubishi Pajero") throw new Error("Maintained rank 82 Pajero group changed; review before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const local = loadLocalEvidence();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const production = await loadProduction();
const report = prepare(production, local);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), report.safe);
writeJsonl(path.join(OUTPUT_DIR, "blocked.jsonl"), report.blocked);
writeJsonl(path.join(OUTPUT_DIR, "productization.jsonl"), report.productization);
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(report.summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), readme(report.summary));
console.log(JSON.stringify({ output_dir: OUTPUT_DIR, denominator: report.summary.denominator, current_gap: report.summary.current_gap,
  local_evidence_ceiling: report.summary.local_evidence_ceiling, queues: report.summary.queues, integrity: report.summary.integrity }, null, 2));

function loadLocalEvidence() {
  const snapshot = JSON.parse(fs.readFileSync(WIPERTECH_FILE, "utf8"));
  const rows = (snapshot.sourceRows ?? []).filter((row) => upper(row.make) === "MITSUBISHI" && upper(row.model) === "PAJERO").map((row) => ({
    vehicle_id: String(row.vehicle_id), series: String(row.series ?? "").trim(), generation: sourceGeneration(row.series),
    year_from: Number(row.year_from), year_to: Number(row.year_to),
    configuration_key: [row.driver_in, row.passenger_in, row.rear_in || "-"].join("/")
  }));
  if (!rows.length) throw new Error("No exact Mitsubishi Pajero rows found in local WiperTech snapshot.");
  const coreRows = readJsonl(CORE_REVIEW_FILE).filter((row) => row.family_id === "mitsubishi_pajero");
  const aiReviews = [];
  for (const file of AI_REVIEW_FILES) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const review of parsed.reviews ?? []) {
      const text = `${review["审核理由"] ?? ""} ${review["最终配置"] ?? ""}`;
      const codes = unique(text.toUpperCase().match(/\b(?:K99W|KH4W|V(?:21|23|24|67|68|72|78|83|87|88|93|97|98)W?|V(?:21|23|24)C)\b/g) ?? []);
      for (const seriesCode of codes) aiReviews.push({ series_code: seriesCode, review_id: review.review_id,
        conclusion: review["审核结论"], final_configuration: review["最终配置"], confidence: review["审核置信度"], reason: review["审核理由"] });
    }
  }
  return { rows, coreByApplication: indexByApplication(coreRows), aiBySeries: groupBy(aiReviews, (row) => row.series_code),
    identities: { wipertech_snapshot: fileIdentity(WIPERTECH_FILE), core103_review: fileIdentity(CORE_REVIEW_FILE),
      existing_ai_reviews: AI_REVIEW_FILES.map(fileIdentity) } };
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
    const model = modelById.get(application.model_id); const make = makeById.get(model?.make_id);
    const matched = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (matched?.id !== group.id) continue;
    const years = unique((yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year))).filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b);
    if (!years.length) continue;
    const series = seriesById.get(application.series_id); const variant = variantById.get(application.variant_id);
    const published = (fitmentsByApp.get(application.application_id) ?? []).filter((row) => row.fitment_status === "published");
    applications.push({ application_id: application.application_id, make: upper(make?.name), model: upper(model?.name),
      series_code: upper(series?.code), series_name: String(series?.display_name ?? "").trim(),
      body_style: bodyKey(variant?.body_style ?? variant?.display_name), variant_name: String(variant?.display_name ?? "").trim(),
      years, application_years: years.length, current_knowledge_covered: published.length > 0,
      published_configuration_keys: unique(published.map((row) => configById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`)) });
  }
  const gaps = applications.filter((row) => !row.current_knowledge_covered);
  const assessed = gaps.map((row) => assess(row, local, configsByKey, bladesByConfig, sellablePairs));
  const safeApps = assessed.filter((row) => row.outcome === "safe_to_publish");
  const productApps = assessed.filter((row) => row.outcome === "productization");
  const blockedApps = assessed.filter((row) => row.outcome === "blocked");
  const safe = aggregate(safeApps); const productization = aggregate(productApps); const blocked = aggregate(blockedApps);
  const preStrictCeilingAy = assessed.filter((row) => row.existing_review_candidate_configurations.length > 0).reduce((sum, row) => sum + row.application_years, 0);
  const strictEvidenceAy = assessed.reduce((sum, row) => sum + row.locally_supported_years.length, 0);
  const currentKnowledgeIds = new Set(applications.filter((row) => row.current_knowledge_covered).map((row) => row.application_id));
  const afterSafeIds = new Set([...currentKnowledgeIds, ...safeApps.map((row) => row.application_id)]);
  const summary = { generated_at: new Date().toISOString(), mode: "report-only", production_writes: false,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, fleet_count: group.fleetCount, period: PERIOD },
    policy: { aggregation: "application -> Pajero generation -> exact series/chassis -> body -> identical full year vector; engine/trim variants collapse only after these fields agree",
      generation_bridges: { pajero_ii_canvas: "V2_C/V4_C; body-specific review conflict", pajero_iii: "V6_W/V7_W <-> NM/NP", pajero_iv: "V8_W/V9_W <-> NS/NT/NW/NX" },
      safe_gate: "one body-compatible configuration for every application year, no existing unresolved/split/multi review, no published conflict, valid configuration and sellable front pair",
      application_atomicity: "year-split conclusions remain blocked because this report does not silently split an application",
      identity: "K99W/KH4W misclassified Pajero applications were merged into exact Challenger peers on 2026-10-25; Pajero Sport regional-alias records remain separate." },
    sources: { ...local.identities, production_snapshot: { mode: "fresh read-only", table_counts: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length])) } },
    denominator: metrics(applications), current_gap: metrics(gaps),
    local_evidence_ceiling: { application_years: preStrictCeilingAy, percent_of_gap: percent(preStrictCeilingAy, sumAy(gaps)),
      definition: "pre-strict application-years carrying local candidate configurations in the existing core103 review",
      strict_generation_body_year_application_years: strictEvidenceAy, strict_generation_body_year_percent_of_gap: percent(strictEvidenceAy, sumAy(gaps)) },
    queues: { safe_to_publish: queueMetrics(safeApps, safe), productization: { ...queueMetrics(productApps, productization), reasons: countBy(productApps.flatMap((row) => row.blocker_reasons), (value) => value) },
      blocked: { ...queueMetrics(blockedApps, blocked), reasons: countBy(blockedApps.flatMap((row) => row.blocker_reasons), (value) => value) } },
    configuration_productization: productPlan(assessed, configsByKey, bladesByConfig, sellablePairs),
    coverage: { knowledge_before: coverageMetric(applications, currentKnowledgeIds), knowledge_after_safe: coverageMetric(applications, afterSafeIds) },
    projected_uplift: { safe_knowledge_application_years: sumAy(safeApps), safe_knowledge_pp_of_model_denominator: percent(sumAy(safeApps), sumAy(applications)),
      productization_potential_application_years: sumAy(productApps), productization_potential_pp_of_model_denominator: percent(sumAy(productApps), sumAy(applications)) },
    integrity: { expected_gap_application_years: EXPECTED_GAP_AY, observed_gap_application_years: sumAy(gaps), expected_gap_matches: sumAy(gaps) === EXPECTED_GAP_AY,
      expected_local_evidence_ceiling_application_years: EXPECTED_LOCAL_EVIDENCE_CEILING_AY, observed_local_evidence_ceiling_application_years: preStrictCeilingAy,
      expected_local_evidence_ceiling_matches: preStrictCeilingAy === EXPECTED_LOCAL_EVIDENCE_CEILING_AY,
      gap_partition_matches: safeApps.length + productApps.length + blockedApps.length === gaps.length,
      gap_application_year_partition_matches: sumAy(safeApps) + sumAy(productApps) + sumAy(blockedApps) === sumAy(gaps),
      duplicate_queue_application_ids: duplicateValues(assessed.map((row) => row.application_id)),
      safe_contains_existing_unresolved_review: safeApps.filter((row) => row.ai_review_ids.length || row.existing_review_candidate_configurations.length > 1).map((row) => row.application_id),
      safe_contains_unsupported_years: safeApps.filter((row) => row.unsupported_years.length).map((row) => row.application_id) } };
  return { safe, blocked, productization, summary };
}

function assess(row, local, configsByKey, bladesByConfig, sellablePairs) {
  const identity = applicationIdentity(row.series_code);
  const coreReviews = local.coreByApplication.get(row.application_id) ?? [];
  const aiReviews = local.aiBySeries.get(row.series_code) ?? [];
  const existingCandidates = unique(coreReviews.flatMap((item) => item.candidate_configurations ?? [])).sort();
  const sourceRows = identity.generation ? local.rows.filter((source) => source.generation === identity.generation) : [];
  const configsByYear = Object.fromEntries(row.years.map((year) => [year, unique(sourceRows.filter((source) => year >= source.year_from && year <= source.year_to).map((source) => source.configuration_key)).sort()]));
  const supportedYears = row.years.filter((year) => configsByYear[year].length > 0);
  const unsupportedYears = row.years.filter((year) => configsByYear[year].length === 0);
  const candidateConfigurations = unique(Object.values(configsByYear).flat()).sort();
  const failures = [];
  if (identity.catalog_correction) failures.push("catalog_identity_conflict_pajero_sport");
  if (!identity.generation) failures.push("unmapped_pajero_generation");
  if (identity.body === "canvas_top") failures.push("canvas_top_body_configuration_conflict");
  if (!sourceRows.length) failures.push("no_generation_matched_local_evidence");
  if (unsupportedYears.length) failures.push("incomplete_local_year_coverage");
  if (candidateConfigurations.length !== 1) failures.push(candidateConfigurations.length ? "multiple_local_configurations" : "no_local_configuration");
  if (Object.values(configsByYear).some((values) => values.length > 1)) failures.push("multiple_configurations_for_same_year");
  if (existingCandidates.length > 1) failures.push("existing_review_multiple_configurations");
  if (aiReviews.some((item) => item.conclusion !== "确认配置")) failures.push("existing_ai_review_unresolved_or_split");
  if (row.published_configuration_keys.length) failures.push("published_configuration_conflict");
  const configurationKey = candidateConfigurations.length === 1 ? candidateConfigurations[0] : null;
  const readiness = configurationKey ? configurationReadiness(configurationKey, configsByKey, bladesByConfig, sellablePairs) : null;
  let outcome = "blocked"; let blockers = unique(failures);
  if (!blockers.length && readiness?.product_ready) outcome = "safe_to_publish";
  else if (!blockers.length) { outcome = "productization"; blockers = readiness.blocker_reasons; }
  return { ...row, rank: group.rank, group_id: group.id, popular_group: group.label, generation: identity.generation,
    identity_class: identity.identity_class, body_identity: identity.body, outcome, configuration_key: configurationKey,
    candidate_configurations: candidateConfigurations, locally_supported_years: supportedYears, unsupported_years: unsupportedYears,
    configurations_by_year: configsByYear, blocker_reasons: blockers,
    existing_review_reasons: unique(coreReviews.map((item) => item.reason)).sort(), existing_review_candidate_configurations: existingCandidates,
    ai_review_ids: unique(aiReviews.map((item) => item.review_id)).sort(), ai_review_conclusions: unique(aiReviews.map((item) => item.conclusion)).sort(),
    ai_review_final_configurations: unique(aiReviews.map((item) => item.final_configuration)).sort(),
    source_vehicle_ids: unique(sourceRows.map((item) => item.vehicle_id)).sort(),
    source_spans: unique(sourceRows.map((item) => `${item.series}|${item.year_from}-${item.year_to}|${item.configuration_key}`)).sort(),
    product: readiness, next_requirement: nextRequirement(blockers, unsupportedYears) };
}

function applicationIdentity(series) {
  const code = upper(series).replace(/[^A-Z0-9]/g, "");
  if (["K99W", "KH4W"].includes(code)) return { generation: null, identity_class: "misassigned_pajero_sport", body: "suv", catalog_correction: true };
  if (/^V[24][0-9]C$/.test(code) || /^V2[0-9]C$/.test(code)) return { generation: "pajero_ii", identity_class: "pajero_ii_canvas", body: "canvas_top", catalog_correction: false };
  if (/^V[234]/.test(code)) return { generation: "pajero_ii", identity_class: "pajero_ii", body: "closed_suv", catalog_correction: false };
  if (/^V[67]/.test(code)) return { generation: "pajero_iii", identity_class: "pajero_iii", body: "closed_suv", catalog_correction: false };
  if (/^V[89]/.test(code)) return { generation: "pajero_iv", identity_class: "pajero_iv", body: "closed_suv", catalog_correction: false };
  return { generation: null, identity_class: "unmapped", body: null, catalog_correction: false };
}
function sourceGeneration(series) { const text = upper(series); if (/\bNM\b|\bNP\b/.test(text)) return "pajero_iii"; if (/\bNS\b|\bNT\b|\bNW\b|\bNX\b/.test(text)) return "pajero_iv"; if (/\bNH\b|\bNJ\b|\bNK\b|\bNL\b/.test(text)) return "pajero_ii"; if (/\bNG\b/.test(text)) return "pajero_i"; return null; }

function configurationReadiness(key, configsByKey, bladesByConfig, sellablePairs) {
  const configs = configsByKey.get(key) ?? []; const failures = [];
  if (!configs.length) failures.push("wiper_configuration_missing"); if (configs.length > 1) failures.push("duplicate_wiper_configuration_key");
  const config = configs.length === 1 ? configs[0] : null; const bladesKey = config ? bladeKey(bladesByConfig.get(config.id) ?? []) : null;
  if (config && bladesKey !== key) failures.push("wiper_configuration_blades_mismatch");
  if (config && ["rejected", "superseded"].includes(config.configuration_status)) failures.push("wiper_configuration_not_publishable");
  const [driver, passenger] = key.split("/"); const pairs = sellablePairs.get(pairKey(driver, passenger)) ?? [];
  if (!pairs.length) failures.push("active_sellable_front_pair_missing");
  return { configuration_id: config?.id ?? null, configuration_exists: Boolean(config), configuration_status: config?.configuration_status ?? null,
    configuration_blades_key: bladesKey, sellable_front_pair_skus: pairs.map((item) => item.sku).sort(), product_ready: failures.length === 0, blocker_reasons: failures };
}

function aggregate(rows) {
  const grouped = groupBy(rows, (row) => JSON.stringify([row.outcome, row.generation, row.series_code, row.body_style, row.years, row.configuration_key, row.blocker_reasons]));
  return [...grouped.values()].map((items) => { const first = items[0]; return { rank: first.rank, group_id: first.group_id, popular_group: first.popular_group,
    outcome: first.outcome, make: first.make, model: first.model, generation: first.generation, identity_class: first.identity_class,
    series_code: first.series_code, series_name: first.series_name, body_style: first.body_style, body_identity: first.body_identity,
    years: first.years, year_from: Math.min(...first.years), year_to: Math.max(...first.years), application_ids: items.map((row) => row.application_id).sort(),
    applications: items.length, application_years: sumAy(items), variant_names: unique(items.map((row) => row.variant_name)).sort(),
    configuration_key: first.configuration_key, candidate_configurations: first.candidate_configurations,
    locally_supported_years: first.locally_supported_years, unsupported_years: first.unsupported_years, blocker_reasons: first.blocker_reasons,
    next_requirement: first.next_requirement, existing_review_reasons: unique(items.flatMap((row) => row.existing_review_reasons)).sort(),
    existing_review_candidate_configurations: unique(items.flatMap((row) => row.existing_review_candidate_configurations)).sort(),
    ai_review_ids: unique(items.flatMap((row) => row.ai_review_ids)).sort(), ai_review_conclusions: unique(items.flatMap((row) => row.ai_review_conclusions)).sort(),
    ai_review_final_configurations: unique(items.flatMap((row) => row.ai_review_final_configurations)).sort(),
    source_vehicle_ids: unique(items.flatMap((row) => row.source_vehicle_ids)).sort(), source_spans: unique(items.flatMap((row) => row.source_spans)).sort(), product: first.product }; }).sort(queueSort);
}

function productPlan(rows, configsByKey, bladesByConfig, sellablePairs) { return unique(rows.map((row) => row.configuration_key)).sort().map((key) => ({ configuration_key: key,
  ...configurationReadiness(key, configsByKey, bladesByConfig, sellablePairs), eligible_full_application_count: rows.filter((row) => row.configuration_key === key && row.outcome !== "blocked").length,
  eligible_full_application_years: sumAy(rows.filter((row) => row.configuration_key === key && row.outcome !== "blocked")) })); }

async function loadProduction() {
  const specs = [["makes", "vehicle_catalog_makes", "make_id,name,status"], ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
    ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"], ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
    ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"], ["years", "vehicle_catalog_application_years", "application_id,model_year"],
    ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
    ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"], ["blades", "wiper_configuration_blades", "wiper_configuration_id,position,length_in"],
    ["wiperSets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"]];
  const values = await Promise.all(specs.map(([, table, columns]) => fetchAll(table, columns)));
  return Object.fromEntries(specs.map(([name], index) => [name, values[index]]));
}
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw new Error(`${table}: ${error.message}`); output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }

function coverageMetric(applications, coveredIds) { const modelYears = unique(applications.flatMap((row) => row.years)).sort((a, b) => a - b); let any = 0; let full = 0;
  for (const year of modelYears) { const ids = applications.filter((row) => row.years.includes(year)).map((row) => row.application_id); const count = ids.filter((id) => coveredIds.has(id)).length; if (count) any += 1; if (count === ids.length) full += 1; }
  const covered = applications.filter((row) => coveredIds.has(row.application_id)); return { applications_total: applications.length, applications_covered: covered.length,
    application_coverage_percent: percent(covered.length, applications.length), application_years_total: sumAy(applications), application_years_covered: sumAy(covered),
    application_year_coverage_percent: percent(sumAy(covered), sumAy(applications)), model_years_total: modelYears.length, model_years_any_covered: any,
    model_year_any_coverage_percent: percent(any, modelYears.length), model_years_fully_covered: full, model_year_full_coverage_percent: percent(full, modelYears.length) }; }
function nextRequirement(failures, years) { if (failures.includes("catalog_identity_conflict_pajero_sport")) return "Correct the model identity to Pajero Sport/Challenger and rerun against that family's evidence."; if (failures.includes("canvas_top_body_configuration_conflict")) return "Obtain authoritative right-hand-drive Canvas Top front/rear evidence; closed-body rear evidence is not reusable."; if (failures.includes("existing_ai_review_unresolved_or_split") || failures.includes("existing_review_multiple_configurations") || failures.includes("multiple_local_configurations")) return "Keep review-only until one configuration can be selected without a year split or the application is explicitly split."; if (failures.includes("incomplete_local_year_coverage")) return `Obtain generation/chassis evidence for ${years.join(", ")} or correct/split the application years.`; return "Obtain exact generation, chassis, body and complete-year evidence before publication."; }
function bodyKey(value) { const text = String(value ?? "").toLowerCase(); if (/suv|wagon|off-road/.test(text)) return "suv"; if (/convertible|canvas|soft.?top/.test(text)) return "convertible"; return text.trim(); }
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => y - x).join("/"); }
function bladeKey(rows) { const map = new Map(rows.map((row) => [row.position, Number(row.length_in)])); return [map.get("driver") ?? "-", map.get("passenger") ?? "-", map.get("rear") ?? "-"].join("/"); }
function metrics(rows) { return { applications: rows.length, application_years: sumAy(rows), model_years: unique(rows.flatMap((row) => row.years)).length }; }
function queueMetrics(appRows, groupedRows) { return { rows: groupedRows.length, applications: appRows.length, application_years: sumAy(appRows) }; }
function sumAy(rows) { return rows.reduce((sum, row) => sum + Number(row.application_years ?? 0), 0); }
function indexByApplication(rows) { const output = new Map(); for (const row of rows) for (const id of row.application_ids ?? []) { const values = output.get(id) ?? []; values.push(row); output.set(id, values); } return output; }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return Object.fromEntries(Object.entries(output).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))); }
function duplicateValues(values) { return Object.entries(countBy(values, (value) => value)).filter(([, count]) => count > 1).map(([value]) => value); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function percent(n, d) { return d ? Number((100 * n / d).toFixed(4)) : 0; }
function queueSort(a, b) { return String(a.generation).localeCompare(String(b.generation)) || a.series_code.localeCompare(b.series_code) || a.year_from - b.year_from; }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
function readme(summary) { return `Mitsubishi Pajero Wiper Model Report - 2026-10-25\n\nMode: report-only; no production writes. Period: 2000-2026.\n\nInputs: local WiperTech snapshot, existing core103 review, existing cross-AI review results, and a fresh read-only production snapshot. K99W/KH4W identity correction evidence was verified against official Mitsubishi Australia material.\n\nStrict policy: generation + series/chassis + compatible body + every attached application year. Existing multi-candidate, unable-to-determine, or split conclusions remain blocked. Misclassified K99W/KH4W Pajero applications have been merged into exact Challenger peers. Canvas Top is not treated as the same rear-wiper body as closed SUV.\n\nObserved\n- Denominator: ${summary.denominator.applications} applications / ${summary.denominator.application_years} AY.\n- Knowledge gap: ${summary.current_gap.applications} applications / ${summary.current_gap.application_years} AY.\n- Local review evidence ceiling: ${summary.local_evidence_ceiling.application_years} AY.\n- Strict generation/body/year evidence: ${summary.local_evidence_ceiling.strict_generation_body_year_application_years} AY.\n- Safe: ${summary.queues.safe_to_publish.applications} applications / ${summary.queues.safe_to_publish.application_years} AY.\n- Productization: ${summary.queues.productization.applications} applications / ${summary.queues.productization.application_years} AY.\n- Blocked: ${summary.queues.blocked.applications} applications / ${summary.queues.blocked.application_years} AY.\n\nFiles: safe-to-publish.jsonl, blocked.jsonl, productization.jsonl, summary.json.\nRerun: node scripts/catalog/report-extended132-model-pajero-wiper-20261025.mjs\n` + (summary.integrity.expected_gap_matches && summary.integrity.expected_local_evidence_ceiling_matches ? "" : "\nWARNING: expected 13 AY post-correction baseline or 7 AY local-evidence ceiling drifted; inspect summary.integrity.\n"); }
