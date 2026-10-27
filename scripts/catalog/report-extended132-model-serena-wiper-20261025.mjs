import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_EXTENDED_80_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, "outputs/extended132-model-serena-wiper-20261025");
const WIPERTECH = path.resolve(ROOT, "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json");
const PRIOR_REVIEW = path.resolve(ROOT, "outputs/core103-wiper-phase-20261025/multi-candidate-review.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const EXTENDED132_AY_DENOMINATOR = 46_676;

if (process.argv.includes("--apply")) throw new Error("Report-only script: --apply is intentionally unsupported.");
if (process.argv.slice(2).length) throw new Error(`Unknown argument(s): ${process.argv.slice(2).join(", ")}`);
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
if (!fs.existsSync(WIPERTECH) || !fs.existsSync(PRIOR_REVIEW)) throw new Error("Missing local WiperTech or prior-review evidence.");

const group = POPULAR_EXTENDED_80_VEHICLE_GROUPS.find((row) => row.rank === 68);
if (!group || group.label !== "Nissan Serena") throw new Error("Maintained rank 68 group changed; review the scope before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const sourceRows = JSON.parse(fs.readFileSync(WIPERTECH, "utf8")).sourceRows.map(sourceRow)
  .filter((row) => upper(row.make) === "NISSAN" && upper(row.model) === "SERENA");
const priorReviewRows = readJsonl(PRIOR_REVIEW).filter((row) => row.family_id === "nissan_serena");
const priorReviewByApplication = new Map(priorReviewRows.flatMap((row) => (row.application_ids ?? []).map((id) => [id, row])));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const data = await loadProduction();
const prepared = prepare(data);
writeOutputs(prepared);
console.log(JSON.stringify({ output_dir: path.relative(ROOT, OUT).replaceAll("\\", "/"), ...prepared.summary.counts,
  gap_application_years: prepared.summary.gap.application_years,
  local_evidence_ceiling_application_years: prepared.summary.local_evidence.ceiling_application_years,
  safe_application_years: prepared.summary.queues.safe.application_years,
  production_writes: 0 }, null, 2));

function prepare(data) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApp = groupBy(data.years, (row) => row.application_id);
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const publishedByApp = groupBy(data.fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const sellablePairs = new Map();
  for (const row of data.wiperSets.filter(isSellableFrontPair)) {
    const key = pairKey(row.driver_length_in, row.passenger_length_in); const values = sellablePairs.get(key) ?? [];
    values.push(row); sellablePairs.set(key, values);
  }

  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id); const make = makeById.get(model?.make_id);
    const matched = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (matched?.id !== group.id) continue;
    const years = unique((yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b);
    if (!years.length) continue;
    const series = seriesById.get(application.series_id); const variant = variantById.get(application.variant_id);
    const publishedRows = publishedByApp.get(application.application_id) ?? [];
    const publishedKeys = unique(publishedRows.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key));
    const knownKey = publishedRows.length === 1 && publishedKeys.length === 1 ? publishedKeys[0] : null;
    const productSkus = knownKey ? sellablePairSkus(knownKey, sellablePairs) : [];
    applications.push({ application_id: application.application_id, make: upper(make.name), model: upper(model.name),
      series_code: upper(series?.code), series_name: String(series?.display_name ?? "").trim(),
      generation: generationKey(series?.code ?? series?.display_name), body: bodyKey(variant?.body_style ?? variant?.display_name),
      variant: String(variant?.display_name ?? "").trim(), years, application_years: years.length,
      published_rows: publishedRows, published_configuration_keys: publishedKeys, known_configuration_key: knownKey,
      product_skus: productSkus, knowledge_covered: Boolean(knownKey), product_covered: productSkus.length > 0 });
  }

  const decisions = applications.map(assess);
  const safeApps = decisions.filter((row) => row.outcome === "safe");
  const blockedApps = decisions.filter((row) => row.outcome === "blocked");
  const alreadyApps = decisions.filter((row) => row.outcome === "already_covered");
  const productizationApps = decisions.filter((row) => row.outcome === "productization" || row.productization_required);
  const gaps = applications.filter((row) => !row.knowledge_covered);
  const evidenceCeiling = blockedApps.filter((row) => row.local_evidence_available);
  const safe = aggregate(safeApps); const blocked = aggregate(blockedApps); const productization = aggregate(productizationApps, true);
  const allGroups = aggregate(decisions);
  const beforeKnowledge = new Set(applications.filter((row) => row.knowledge_covered).map((row) => row.application_id));
  const beforeProduct = new Set(applications.filter((row) => row.product_covered).map((row) => row.application_id));
  const afterKnowledge = new Set([...beforeKnowledge, ...safeApps.map((row) => row.application_id)]);
  const afterProduct = new Set([...beforeProduct, ...safeApps.filter((row) => row.product_skus.length).map((row) => row.application_id)]);
  const summary = {
    generated_at: new Date().toISOString(), mode: "report-only", production_writes: 0,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, period: PERIOD, aliases: group.aliases },
    policy: {
      grouping: "generation root + exact series/chassis + normalized body + complete NexAuto year set + outcome",
      safe: "Exact source series, one configuration, compatible body/rear evidence, all application years attributable, and no published conflict.",
      multi_candidate: "Multiple local configurations without a deterministic series/body/year discriminator remain blocked.",
      year_split: "C24/C27 generation spans were corrected on 2026-10-25. Remaining C24 gaps stay blocked until exact C24 length evidence exists.",
      body: "WiperTech Serena rows have blank body. Rear 16 cannot be promoted across MPV/van without independent body evidence.",
      productization: "Only reliable knowledge missing a complete active sellable front pair enters productization."
    },
    sources: { wipertech: fileIdentity(WIPERTECH), prior_review: fileIdentity(PRIOR_REVIEW),
      production_snapshot: { fetched_at: data.fetched_at, mode: "read-only", table_counts: data.table_counts } },
    source_rows: sourceRows,
    counts: { applications: applications.length, application_years: sumAy(applications), groups: allGroups.length,
      already_covered_applications: alreadyApps.length, already_covered_application_years: sumAy(alreadyApps),
      gap_applications: gaps.length, gap_application_years: sumAy(gaps) },
    gap: { applications: gaps.length, application_years: sumAy(gaps), expected_input_gap_application_years: 90,
      reconciles_expected_gap: sumAy(gaps) === 90 },
    local_evidence: { ceiling_applications: evidenceCeiling.length, ceiling_application_years: sumAy(evidenceCeiling),
      expected_ceiling_application_years: 90, ceiling_reconciles: sumAy(evidenceCeiling) === 90,
      ceiling_definition: "Every missing application has local WiperTech/prior-review candidates, but none passes strict publication gates.",
      safe_application_years: sumAy(safeApps) },
    queues: { safe: queueSummary(safeApps, safe), blocked: queueSummary(blockedApps, blocked),
      productization: queueSummary(productizationApps, productization) },
    coverage: { knowledge_before: coverage(applications, beforeKnowledge), knowledge_after_safe: coverage(applications, afterKnowledge),
      product_before: coverage(applications, beforeProduct), product_after_safe: coverage(applications, afterProduct) },
    uplift: { serena_safe_application_years: sumAy(safeApps), serena_safe_pp: percent(sumAy(safeApps), sumAy(applications)),
      extended132_safe_pp: percent(sumAy(safeApps), EXTENDED132_AY_DENOMINATOR),
      commercial_priority: { fleet_count: group.fleetCount, gap_rate: Number((sumAy(gaps) / sumAy(applications)).toFixed(4)),
        fleet_gap_proxy: Math.round(group.fleetCount * sumAy(gaps) / sumAy(applications)) } },
    integrity: { gap_partition: safeApps.length + blockedApps.length === gaps.length,
      gap_ay_partition: sumAy(safeApps) + sumAy(blockedApps) === sumAy(gaps),
      duplicate_application_outcomes: duplicates(decisions.map((row) => row.application_id)),
      local_evidence_ceiling_is_90_ay: sumAy(evidenceCeiling) === 90 }
  };
  return { safe, blocked, productization, allGroups, summary };

  function assess(application) {
    const base = { ...application, rank: group.rank, group_id: group.id, popular_group: group.label,
      current_configuration_keys: application.published_configuration_keys };
    if (application.published_rows.length > 1 || application.published_configuration_keys.length > 1) {
      return { ...base, outcome: "blocked", blocker_class: "published_conflict", reason: "duplicate_or_conflicting_published_fitments",
        candidate_configurations: application.published_configuration_keys, local_evidence_available: false,
        requested_evidence: "Resolve the published conflict before any propagation." };
    }
    if (application.knowledge_covered) {
      if (!application.product_covered) return { ...base, outcome: "productization", reason: "published_knowledge_without_sellable_front_pair",
        configuration_key: application.known_configuration_key, candidate_configurations: [application.known_configuration_key],
        productization_required: true, local_evidence_available: true };
      return { ...base, outcome: "already_covered", reason: "published_knowledge_and_sellable_front_pair",
        configuration_key: application.known_configuration_key, candidate_configurations: [application.known_configuration_key],
        productization_required: false, local_evidence_available: true };
    }
    if (!application.series_code || application.generation === "NO_CHASSIS") {
      return { ...base, outcome: "blocked", blocker_class: "missing_identity", reason: "missing_series_or_generation_identity",
        candidate_configurations: reviewCandidates(application), local_evidence_available: Boolean(priorReviewByApplication.get(application.application_id)),
        requested_evidence: "Correct series/generation identity before fitment publication." };
    }
    if (spansGenerationBoundary(application)) {
      return { ...base, outcome: "blocked", blocker_class: "unrepresentable_year_split", reason: "application_years_cross_generation_boundaries",
        candidate_configurations: reviewCandidates(application), local_evidence_available: Boolean(priorReviewByApplication.get(application.application_id)),
        requested_evidence: "Split the application years by generation before assigning any configuration." };
    }
    const exactRows = sourceRows.filter((row) => row.series_tokens.includes(application.series_code));
    const exactConfigs = unique(exactRows.map((row) => row.configuration));
    const missingSourceYears = application.years.filter((year) => !exactRows.some((row) => year >= row.year_from && year <= row.year_to));
    const prior = priorReviewByApplication.get(application.application_id);
    const candidates = unique([...(prior?.candidate_configurations ?? []), ...exactConfigs]);
    if (!exactRows.length || candidates.length > 1) {
      return { ...base, outcome: "blocked", blocker_class: candidates.length > 1 ? "multi_candidate" : "no_exact_series",
        reason: candidates.length > 1 ? "multiple_local_configurations_without_deterministic_series_bridge" : "no_exact_series_source_row",
        candidate_configurations: candidates, source_vehicle_ids: prior?.source_vehicle_ids ?? [], source_rows: prior?.source_rows ?? [],
        missing_source_years: application.years, local_evidence_available: Boolean(prior) || candidates.length > 0,
        requested_evidence: "Obtain an exact-series, body-specific authoritative row; do not infer from adjacent Serena generations." };
    }
    if (["mpv", "van", "wagon", "suv"].includes(application.body) && exactRows.every((row) => row.body === "unknown")) {
      return { ...base, outcome: "blocked", blocker_class: "body_rear_unknown", reason: "source_body_blank_rear_fitment_not_transferable",
        candidate_configurations: exactConfigs, source_vehicle_ids: exactRows.map((row) => row.vehicle_id), source_rows: exactRows,
        missing_source_years: missingSourceYears, local_evidence_available: true,
        requested_evidence: "Confirm MPV/van body and rear-blade applicability for the exact series." };
    }
    const configurationKey = exactConfigs[0]; const productSkus = sellablePairSkus(configurationKey, sellablePairs);
    return { ...base, outcome: "safe", reason: "exact_series_body_unique_configuration_no_conflict",
      configuration_key: configurationKey, candidate_configurations: exactConfigs, source_vehicle_ids: exactRows.map((row) => row.vehicle_id),
      source_rows: exactRows, missing_source_years: missingSourceYears, local_evidence_available: true,
      product_skus: productSkus, productization_required: productSkus.length === 0 };
  }
}

function spansGenerationBoundary(application) {
  const bounds = { C23: [1991, 2001], C24: [1999, 2005], C25: [2005, 2012], C26: [2010, 2018], C27: [2016, 2022], C28: [2022, 2026] };
  const range = bounds[application.generation];
  return !range || application.years.some((year) => year < range[0] || year > range[1]);
}
function reviewCandidates(application) { return priorReviewByApplication.get(application.application_id)?.candidate_configurations ?? []; }
function aggregate(rows, productization = false) {
  const buckets = groupBy(rows, (row) => [row.outcome, row.generation, row.series_code, row.body, row.years.join(","),
    (row.candidate_configurations ?? []).join(","), row.reason].join("|"));
  return [...buckets.values()].map((items) => { const first = items[0];
    return { rank: group.rank, group_id: group.id, popular_group: group.label, outcome: first.outcome,
      generation: first.generation, series_chassis: first.series_code, body: first.body, variants: unique(items.map((row) => row.variant)),
      years: first.years, application_ids: items.map((row) => row.application_id).sort(), applications: items.length,
      application_years: sumAy(items), configuration_key: first.configuration_key ?? null,
      candidate_configurations: unique(items.flatMap((row) => row.candidate_configurations ?? [])),
      current_configuration_keys: unique(items.flatMap((row) => row.current_configuration_keys ?? [])),
      sellable_front_pair_skus: unique(items.flatMap((row) => row.product_skus ?? [])), blocker_class: first.blocker_class ?? null,
      reason: first.reason, source_vehicle_ids: unique(items.flatMap((row) => row.source_vehicle_ids ?? [])),
      source_rows: uniqueBy(items.flatMap((row) => row.source_rows ?? []), (row) => row.vehicle_id),
      missing_source_years: unique(items.flatMap((row) => row.missing_source_years ?? [])).sort((a, b) => a - b),
      requested_evidence: first.requested_evidence ?? null, productization_required: productization || items.some((row) => row.productization_required),
      production_write: false };
  }).sort((a, b) => a.generation.localeCompare(b.generation) || a.series_chassis.localeCompare(b.series_chassis)
    || a.body.localeCompare(b.body) || a.reason.localeCompare(b.reason));
}
function coverage(applications, coveredIds) {
  const ayTotal = sumAy(applications); const covered = applications.filter((row) => coveredIds.has(row.application_id));
  const years = unique(applications.flatMap((row) => row.years)).sort((a, b) => a - b); let any = 0; let full = 0;
  for (const year of years) { const rows = applications.filter((row) => row.years.includes(year)); const n = rows.filter((row) => coveredIds.has(row.application_id)).length;
    if (n) any += 1; if (n === rows.length) full += 1; }
  return { applications_total: applications.length, applications_covered: covered.length, application_coverage_percent: percent(covered.length, applications.length),
    application_years_total: ayTotal, application_years_covered: sumAy(covered), application_year_coverage_percent: percent(sumAy(covered), ayTotal),
    model_years_total: years.length, model_years_any_covered: any, model_year_any_coverage_percent: percent(any, years.length),
    model_years_fully_covered: full, model_year_full_coverage_percent: percent(full, years.length) };
}
function queueSummary(apps, groups) { return { groups: groups.length, applications: apps.length, application_years: sumAy(apps),
  reasons: countBy(apps, (row) => row.reason), blocker_classes: countBy(apps.filter((row) => row.blocker_class), (row) => row.blocker_class) }; }

async function loadProduction() {
  const [makes, models, configurations, wiperSets] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"), fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("wiper_configurations", "id,configuration_key,configuration_status,rear_status"),
    fetchAll("wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled")
  ]);
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const targetModelIds = models.filter((model) => { const make = makeById.get(model.make_id);
    return make && aliasIndex.get(canonicalModelKey(make.name, model.name))?.id === group.id; }).map((row) => row.model_id);
  const applications = await selectIn("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status", "model_id", targetModelIds);
  const appIds = applications.map((row) => row.application_id); const seriesIds = unique(applications.map((row) => row.series_id));
  const variantIds = unique(applications.map((row) => row.variant_id));
  const [series, variants, years, fitments] = await Promise.all([
    selectIn("vehicle_catalog_series", "series_id,model_id,code,display_name,status", "series_id", seriesIds),
    selectIn("vehicle_catalog_variants", "variant_id,display_name,body_style", "variant_id", variantIds),
    selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", appIds),
    selectIn("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", "application_id", appIds)
  ]);
  return { makes, models, series, variants, applications, years, fitments, configurations, wiperSets, fetched_at: new Date().toISOString(),
    table_counts: { vehicle_catalog_makes: makes.length, vehicle_catalog_models: models.length,
      target_vehicle_catalog_series: series.length, target_vehicle_catalog_variants: variants.length,
      target_vehicle_catalog_applications: applications.length, target_vehicle_catalog_application_years: years.length,
      target_vehicle_catalog_wiper_fitments: fitments.length, wiper_configurations: configurations.length, wiper_sets: wiperSets.length } };
}
function writeOutputs(prepared) {
  fs.mkdirSync(OUT, { recursive: true }); writeJson("summary.json", prepared.summary);
  writeJsonl("safe-to-publish.jsonl", prepared.safe); writeJsonl("blocked.jsonl", prepared.blocked);
  writeJsonl("productization.jsonl", prepared.productization); writeJsonl("all-groups.jsonl", prepared.allGroups);
  writeJson("source-audit.json", { generated_at: prepared.summary.generated_at, sources: prepared.summary.sources,
    exact_local_rows: sourceRows, safeguards: ["Local sources and existing review only; no web or AI search.", "No production writes.",
      "Multi-configuration groups remain blocked.", "Blank source body does not establish rear applicability across MPV and van.",
      "Applications spanning generation boundaries remain blocked until year-split support exists."] });
  fs.writeFileSync(path.join(OUT, "README"), `Extended-132 model-first wiper report: Nissan Serena (rank 68)\n\n` +
    `Scope: ${prepared.summary.counts.applications} applications / ${prepared.summary.counts.application_years} AY, 2000-2026.\n` +
    `Current knowledge gap: ${prepared.summary.gap.applications} applications / ${prepared.summary.gap.application_years} AY.\n` +
    `Local evidence ceiling: ${prepared.summary.local_evidence.ceiling_application_years} AY; strict safe uplift: ${prepared.summary.queues.safe.application_years} AY.\n\n` +
    `C27/C28 exact PIAA evidence is published after generation-boundary correction. Remaining C24 candidates stay blocked; blank WiperTech body does not establish rear applicability across MPV/van.\n` +
    `This report is read-only; the separate Serena correction batch contains the production write and official evidence.\n\n` +
    `Re-run: node outputs/extended132-model-serena-wiper-20261025/rerun.mjs\n`);
  fs.writeFileSync(path.join(OUT, "rerun.mjs"), `import "../../scripts/catalog/report-extended132-model-serena-wiper-20261025.mjs";\n`);
}
function sourceRow(row) { return { vehicle_id: String(row.vehicle_id), make: row.make, model: row.model, series: row.series,
  series_tokens: String(row.series ?? "").toUpperCase().split(/[,/]+/).map((v) => v.trim()).filter(Boolean), body: bodyKey(row.body),
  year_from: Number(row.year_from), year_to: Number(row.year_to),
  configuration: [row.driver_in, row.passenger_in, row.rear_in].map((v) => v === "" || v == null ? "-" : Number(v)).join("/") }; }
function generationKey(value) { const code = upper(value); const match = code.match(/C(2[3-8])$/); return match ? `C${match[1]}` : (code || "NO_CHASSIS"); }
function bodyKey(value) { const text = String(value ?? "").toLowerCase(); if (/minivan|mpv|people mover/.test(text)) return "mpv";
  if (/panel van|cargo van|\bvan\b/.test(text)) return "van"; if (/wagon|estate/.test(text)) return "wagon";
  if (/suv|sport utility/.test(text)) return "suv"; return text.trim() || "unknown"; }
function sellablePairSkus(key, pairs) { const [a, b] = String(key ?? "").split("/"); if (!a || !b || a === "-" || b === "-") return [];
  return (pairs.get(pairKey(a, b)) ?? []).map((row) => row.sku).sort(); }
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => y - x).join("/"); }
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
  && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function sumAy(rows) { return rows.reduce((sum, row) => sum + row.application_years, 0); }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(2)) : 0; }
function upper(v) { return String(v ?? "").trim().toUpperCase(); }
function unique(values) { return [...new Set(values.filter((v) => v !== null && v !== undefined && v !== ""))]; }
function uniqueBy(values, keyFn) { return [...new Map(values.map((value) => [keyFn(value), value])).values()]; }
function groupBy(values, keyFn) { const out = new Map(); for (const value of values) { const key = keyFn(value); const rows = out.get(key) ?? []; rows.push(value); out.set(key, rows); } return out; }
function countBy(values, keyFn) { const out = {}; for (const value of values) { const key = keyFn(value); out[key] = (out[key] ?? 0) + 1; } return out; }
function duplicates(values) { return Object.entries(countBy(values, (v) => v)).filter(([, n]) => n > 1).map(([v]) => v); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJson(name, value) { fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(name, rows) { fs.writeFileSync(path.join(OUT, name), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString() }; }
async function fetchAll(table, columns) { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999);
  if (error) throw new Error(`${table}: ${error.message}`); out.push(...(data ?? [])); if (!data || data.length < 1000) return out; } }
async function selectIn(table, columns, field, values) { const out = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50);
  if (!batch.length) continue; const { data, error } = await db.from(table).select(columns).in(field, batch); if (error) throw new Error(`${table}: ${error.message}`); out.push(...(data ?? [])); } return out; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
