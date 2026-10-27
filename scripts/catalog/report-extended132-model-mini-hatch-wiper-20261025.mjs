import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_EXTENDED_80_VEHICLE_GROUPS, buildPopularAliasIndex, popularGroupMatchesApplication } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, "outputs/extended132-model-mini-hatch-wiper-20261025");
const WIPERTECH = path.resolve(ROOT, "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json");
const PRIOR_REVIEW = path.resolve(ROOT, "outputs/core103-wiper-phase-20261025/multi-candidate-review.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const EXTENDED132_AY_DENOMINATOR = 46_676;

if (process.argv.includes("--apply")) throw new Error("Report-only script: --apply is intentionally unsupported.");
if (process.argv.slice(2).length) throw new Error(`Unknown argument(s): ${process.argv.slice(2).join(", ")}`);
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
if (!fs.existsSync(WIPERTECH) || !fs.existsSync(PRIOR_REVIEW)) throw new Error("Missing local WiperTech or prior-review evidence.");

const group = POPULAR_EXTENDED_80_VEHICLE_GROUPS.find((row) => row.rank === 69);
if (!group || group.label !== "MINI hatch family") throw new Error("Maintained rank 69 group changed; review the scope before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const sourceRows = JSON.parse(fs.readFileSync(WIPERTECH, "utf8")).sourceRows.map(sourceRow).filter((row) => upper(row.make) === "MINI");
const priorReviewRows = readJsonl(PRIOR_REVIEW).filter((row) => row.family_id === "mini_hatch");
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
  const bladesByConfiguration = groupBy(data.blades, (row) => row.wiper_configuration_id);
  const publishedByApp = groupBy(data.fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const sellablePairs = new Map();
  for (const row of data.wiperSets.filter(isSellableFrontPair)) {
    const key = pairKey(row.driver_length_in, row.passenger_length_in);
    const values = sellablePairs.get(key) ?? []; values.push(row); sellablePairs.set(key, values);
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
    if (!popularGroupMatchesApplication(group, { bodyStyle: variant?.body_style, variantName: variant?.display_name })) continue;
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
  const multiApps = decisions.filter((row) => row.outcome === "multi_candidate");
  const alreadyApps = decisions.filter((row) => row.outcome === "already_covered");
  const productizationApps = decisions.filter((row) => row.outcome === "productization" || row.productization_required);
  const safe = aggregate(safeApps); const blocked = aggregate(blockedApps); const multi = aggregate(multiApps);
  const productization = aggregate(productizationApps, true); const allGroups = aggregate(decisions);
  const beforeKnowledge = new Set(applications.filter((row) => row.knowledge_covered).map((row) => row.application_id));
  const beforeProduct = new Set(applications.filter((row) => row.product_covered).map((row) => row.application_id));
  const afterKnowledge = new Set([...beforeKnowledge, ...safeApps.map((row) => row.application_id)]);
  const afterProduct = new Set([...beforeProduct, ...safeApps.filter((row) => row.product_skus.length).map((row) => row.application_id)]);
  const gaps = applications.filter((row) => !row.knowledge_covered);
  const evidenceCeiling = multiApps.filter((row) => row.local_evidence_available);
  const summary = {
    generated_at: new Date().toISOString(), mode: "report-only", production_writes: 0,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, period: PERIOD, aliases: group.aliases,
      strict_family_body: "hatchback" },
    policy: {
      grouping: "make/model alias + generation/chassis + normalized body + outcome + configuration candidate set",
      safe: "Only exact generation/chassis and hatch body evidence with one configuration, no published conflict, and body-compatible rear evidence.",
      non_hatch: "Convertible, coupe, wagon/Clubman and other bodies remain blocked outside the MINI hatch family even when another local MINI source row exists.",
      j01: "J01 cannot inherit F65/F66: local rows disagree on rear blade and the catalog lacks a 3-door/5-door discriminator.",
      productization: "Knowledge and sellable front-pair coverage are separate; unresolved knowledge never creates a product task."
    },
    sources: { wipertech: fileIdentity(WIPERTECH), prior_review: fileIdentity(PRIOR_REVIEW),
      production_snapshot: { fetched_at: data.fetched_at, mode: "read-only", table_counts: data.table_counts } },
    counts: { applications: applications.length, application_years: sumAy(applications), groups: allGroups.length,
      already_covered_applications: alreadyApps.length, already_covered_application_years: sumAy(alreadyApps),
      gap_applications: gaps.length, gap_application_years: sumAy(gaps) },
    gap: { applications: gaps.length, application_years: sumAy(gaps), expected_input_gap_application_years: 12,
      reconciles_expected_gap: sumAy(gaps) === 12 },
    local_evidence: { ceiling_applications: evidenceCeiling.length, ceiling_application_years: sumAy(evidenceCeiling),
      ceiling_definition: "Existing J01 review rows with local same-body candidates; not safe publication.", safe_application_years: sumAy(safeApps) },
    queues: {
      safe: queueSummary(safeApps, safe), blocked: queueSummary(blockedApps, blocked),
      multi_candidate: queueSummary(multiApps, multi), productization: queueSummary(productizationApps, productization)
    },
    coverage: { knowledge_before: coverage(applications, beforeKnowledge), knowledge_after_safe: coverage(applications, afterKnowledge),
      product_before: coverage(applications, beforeProduct), product_after_safe: coverage(applications, afterProduct) },
    uplift: { mini_hatch_safe_application_years: sumAy(safeApps), mini_hatch_safe_pp: percent(sumAy(safeApps), sumAy(applications)),
      extended132_safe_pp: percent(sumAy(safeApps), EXTENDED132_AY_DENOMINATOR) },
    integrity: { gap_partition: safeApps.length + blockedApps.length + multiApps.length === gaps.length,
      gap_ay_partition: sumAy(safeApps) + sumAy(blockedApps) + sumAy(multiApps) === sumAy(gaps),
      duplicate_application_outcomes: duplicates(decisions.map((row) => row.application_id)),
      local_evidence_ceiling_is_12_ay: sumAy(evidenceCeiling) === 12 }
  };
  return { safe, blocked, multi, productization, allGroups, summary };

  function assess(application) {
    const base = { ...application, rank: group.rank, group_id: group.id, popular_group: group.label,
      current_configuration_keys: application.published_configuration_keys };
    if (application.published_rows.length > 1 || application.published_configuration_keys.length > 1) {
      return { ...base, outcome: "multi_candidate", reason: "duplicate_or_conflicting_published_fitments",
        candidate_configurations: application.published_configuration_keys, local_evidence_available: false,
        requested_evidence: "Resolve the published configuration conflict before any propagation." };
    }
    if (application.knowledge_covered) {
      if (!application.product_covered) return { ...base, outcome: "productization", reason: "published_knowledge_without_sellable_front_pair",
        configuration_key: application.known_configuration_key, candidate_configurations: [application.known_configuration_key],
        productization_required: true, local_evidence_available: true };
      return { ...base, outcome: "already_covered", reason: "published_knowledge_and_sellable_front_pair",
        configuration_key: application.known_configuration_key, candidate_configurations: [application.known_configuration_key],
        productization_required: false, local_evidence_available: true };
    }
    if (application.body !== "hatchback") {
      return { ...base, outcome: "blocked", reason: "non_hatch_body_outside_mini_hatch_family",
        candidate_configurations: localCandidates(application), local_evidence_available: false,
        requested_evidence: "Refine the popular-family scope or establish a separately governed MINI body family; do not reuse hatch fitment." };
    }
    if (!application.series_code) {
      return { ...base, outcome: "blocked", reason: "missing_chassis_generation_identity", candidate_configurations: [],
        local_evidence_available: false, requested_evidence: "Correct the chassis/generation identity before fitment work." };
    }
    const exactRows = exactHatchRows(application);
    const exactConfigs = unique(exactRows.map((row) => row.configuration));
    if (exactRows.length && exactConfigs.length === 1) {
      const configurationKey = exactConfigs[0];
      return { ...base, outcome: "safe", reason: "exact_chassis_hatch_unique_local_configuration_no_conflict",
        configuration_key: configurationKey, candidate_configurations: exactConfigs, source_vehicle_ids: exactRows.map((row) => row.vehicle_id),
        source_rows: exactRows, product_skus: sellablePairSkus(configurationKey, sellablePairs), local_evidence_available: true,
        productization_required: sellablePairSkus(configurationKey, sellablePairs).length === 0 };
    }
    const review = priorReviewByApplication.get(application.application_id);
    const candidates = unique([...(review?.candidate_configurations ?? []), ...localCandidates(application)]);
    if (candidates.length > 1) {
      return { ...base, outcome: "multi_candidate", reason: application.series_code === "J01"
        ? "j01_has_no_exact_local_row_and_f65_f66_rear_configs_disagree" : "multiple_local_configurations_without_exact_chassis_bridge",
        candidate_configurations: candidates, source_vehicle_ids: review?.source_vehicle_ids ?? [], source_rows: review?.source_rows ?? [],
        prior_review_reason: review?.reason ?? null, local_evidence_available: Boolean(review),
        requested_evidence: "Obtain an authoritative exact-chassis/body row; stop if 3-door versus 5-door cannot be represented." };
    }
    return { ...base, outcome: "blocked", reason: exactRows.length ? "exact_chassis_has_multiple_configurations" : "no_exact_chassis_hatch_evidence",
      candidate_configurations: candidates, local_evidence_available: false,
      requested_evidence: "Obtain exact generation/chassis and hatch-body evidence; make/model/year overlap is insufficient." };
  }
}

function exactHatchRows(application) {
  return sourceRows.filter((row) => row.model_key === "cooper" && row.body === "hatchback"
    && row.series_tokens.includes(application.series_code));
}
function localCandidates(application) {
  const review = priorReviewByApplication.get(application.application_id);
  if (review) return review.candidate_configurations ?? [];
  if (application.body !== "hatchback") return [];
  return unique(sourceRows.filter((row) => row.model_key === "cooper" && row.body === "hatchback"
    && application.years.some((year) => year >= row.year_from && year <= row.year_to)).map((row) => row.configuration));
}
function aggregate(rows, productization = false) {
  const buckets = groupBy(rows, (row) => [row.outcome, row.make, row.model, row.generation || row.series_code || "NO_CHASSIS", row.body,
    (row.candidate_configurations ?? []).join(","), row.reason].join("|"));
  return [...buckets.values()].map((items) => {
    const first = items[0]; const years = unique(items.flatMap((row) => row.years)).sort((a, b) => a - b);
    return { rank: group.rank, group_id: group.id, popular_group: group.label, outcome: first.outcome,
      make: first.make, models: unique(items.map((row) => row.model)), generation: first.generation,
      series_chassis: unique(items.map((row) => row.series_code)), body: first.body,
      variants: unique(items.map((row) => row.variant)), years, application_ids: items.map((row) => row.application_id).sort(),
      applications: items.length, application_years: sumAy(items), configuration_key: first.configuration_key ?? null,
      candidate_configurations: unique(items.flatMap((row) => row.candidate_configurations ?? [])),
      current_configuration_keys: unique(items.flatMap((row) => row.current_configuration_keys ?? [])),
      sellable_front_pair_skus: unique(items.flatMap((row) => row.product_skus ?? [])), reason: first.reason,
      source_vehicle_ids: unique(items.flatMap((row) => row.source_vehicle_ids ?? [])),
      source_rows: uniqueBy(items.flatMap((row) => row.source_rows ?? []), (row) => row.vehicle_id),
      requested_evidence: first.requested_evidence ?? null, productization_required: productization || items.some((row) => row.productization_required),
      production_write: false };
  }).sort((a, b) => a.outcome.localeCompare(b.outcome) || a.generation.localeCompare(b.generation) || a.body.localeCompare(b.body));
}

function coverage(applications, coveredIds) {
  const ayTotal = sumAy(applications); const covered = applications.filter((row) => coveredIds.has(row.application_id));
  const years = unique(applications.flatMap((row) => row.years)).sort((a, b) => a - b);
  let any = 0; let full = 0;
  for (const year of years) { const yearApps = applications.filter((row) => row.years.includes(year)); const n = yearApps.filter((row) => coveredIds.has(row.application_id)).length;
    if (n) any += 1; if (n === yearApps.length) full += 1; }
  return { applications_total: applications.length, applications_covered: covered.length,
    application_coverage_percent: percent(covered.length, applications.length), application_years_total: ayTotal,
    application_years_covered: sumAy(covered), application_year_coverage_percent: percent(sumAy(covered), ayTotal),
    model_years_total: years.length, model_years_any_covered: any, model_year_any_coverage_percent: percent(any, years.length),
    model_years_fully_covered: full, model_year_full_coverage_percent: percent(full, years.length) };
}
function queueSummary(apps, groups) { return { groups: groups.length, applications: apps.length, application_years: sumAy(apps), reasons: countBy(apps, (row) => row.reason) }; }

async function loadProduction() {
  const [makes, models, configurations, blades, wiperSets] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"), fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("wiper_configurations", "id,configuration_key,configuration_status,rear_status"),
    fetchAll("wiper_configuration_blades", "wiper_configuration_id,position,length_in"),
    fetchAll("wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled")
  ]);
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const targetModelIds = models.filter((model) => {
    const make = makeById.get(model.make_id);
    return make && aliasIndex.get(canonicalModelKey(make.name, model.name))?.id === group.id;
  }).map((row) => row.model_id);
  const applications = await selectIn("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status", "model_id", targetModelIds);
  const appIds = applications.map((row) => row.application_id);
  const seriesIds = unique(applications.map((row) => row.series_id));
  const variantIds = unique(applications.map((row) => row.variant_id));
  const [series, variants, years, fitments] = await Promise.all([
    selectIn("vehicle_catalog_series", "series_id,model_id,code,display_name,status", "series_id", seriesIds),
    selectIn("vehicle_catalog_variants", "variant_id,display_name,body_style", "variant_id", variantIds),
    selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", appIds),
    selectIn("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", "application_id", appIds)
  ]);
  const values = { makes, models, series, variants, applications, years, fitments, configurations, blades, wiperSets };
  return { ...values, fetched_at: new Date().toISOString(),
    table_counts: { vehicle_catalog_makes: makes.length, vehicle_catalog_models: models.length,
      target_vehicle_catalog_series: series.length, target_vehicle_catalog_variants: variants.length,
      target_vehicle_catalog_applications: applications.length, target_vehicle_catalog_application_years: years.length,
      target_vehicle_catalog_wiper_fitments: fitments.length, wiper_configurations: configurations.length,
      wiper_configuration_blades: blades.length, wiper_sets: wiperSets.length } };
}
function writeOutputs(prepared) {
  fs.mkdirSync(OUT, { recursive: true });
  writeJson("summary.json", prepared.summary); writeJsonl("safe-to-publish.jsonl", prepared.safe);
  writeJsonl("blocked.jsonl", prepared.blocked); writeJsonl("multi-candidate-review.jsonl", prepared.multi);
  writeJsonl("productization.jsonl", prepared.productization); writeJsonl("all-groups.jsonl", prepared.allGroups);
  writeJson("source-audit.json", { generated_at: prepared.summary.generated_at, sources: prepared.summary.sources,
    safeguards: ["Local sources only; no web or AI search.", "No production writes.", "Non-hatch bodies do not inherit hatch evidence.",
      "J01 remains review because local F65/F66 rows disagree on rear configuration."] });
  fs.writeFileSync(path.join(OUT, "README"), `Extended-132 model-first wiper report: MINI hatch family (rank 69)\n\n` +
    `Scope: ${prepared.summary.counts.applications} applications / ${prepared.summary.counts.application_years} AY, 2000-2026.\n` +
    `Current knowledge gap: ${prepared.summary.gap.applications} applications / ${prepared.summary.gap.application_years} AY.\n` +
    `Local evidence ceiling: ${prepared.summary.local_evidence.ceiling_application_years} AY; safe uplift: ${prepared.summary.queues.safe.application_years} AY.\n\n` +
    `J01 remains multi-candidate. Convertible/coupe/wagon and other non-hatch bodies remain blocked outside this family.\n` +
    `No web research, AI search, production write, or inferred product creation was performed.\n\n` +
    `Re-run: node outputs/extended132-model-mini-hatch-wiper-20261025/rerun.mjs\n`);
  fs.writeFileSync(path.join(OUT, "rerun.mjs"), `import "../../scripts/catalog/report-extended132-model-mini-hatch-wiper-20261025.mjs";\n`);
}

function sourceRow(row) { const configuration = [row.driver_in, row.passenger_in, row.rear_in].map((v) => v === "" || v == null ? "-" : Number(v)).join("/");
  return { vehicle_id: String(row.vehicle_id), make: row.make, model: row.model, model_key: compact(row.model), series: row.series,
    series_tokens: String(row.series ?? "").toUpperCase().replace(/\bFACELIFT\b/g, "").split(/[,/]+/).map((v) => v.trim()).filter(Boolean),
    body: bodyKey(row.body), year_from: Number(row.year_from), year_to: Number(row.year_to), configuration };
}
function generationKey(value) { const code = upper(value); const match = code.match(/\b([RFJ]\d{2})\b/); return match?.[1] ?? (code || "NO_CHASSIS"); }
function bodyKey(value) { const text = String(value ?? "").toLowerCase(); if (/hatch|liftback/.test(text)) return "hatchback";
  if (/convertible|cabrio|roadster/.test(text)) return "convertible"; if (/wagon|estate|clubman/.test(text)) return "wagon";
  if (/coupe/.test(text)) return "coupe"; if (/suv|sport utility/.test(text)) return "suv"; if (/sedan|saloon/.test(text)) return "sedan"; return text.trim() || "unknown"; }
function sellablePairSkus(configurationKey, sellablePairs) { const [a, b] = String(configurationKey ?? "").split("/");
  if (!a || !b || a === "-" || b === "-") return []; return (sellablePairs.get(pairKey(a, b)) ?? []).map((row) => row.sku).sort(); }
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => y - x).join("/"); }
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
  && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function sumAy(rows) { return rows.reduce((sum, row) => sum + row.application_years, 0); }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(2)) : 0; }
function upper(v) { return String(v ?? "").trim().toUpperCase(); }
function compact(v) { return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
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
async function selectIn(table, columns, field, values) { const out = []; for (let index = 0; index < values.length; index += 50) {
  const batch = values.slice(index, index + 50); if (!batch.length) continue; const { data, error } = await db.from(table).select(columns).in(field, batch);
  if (error) throw new Error(`${table}: ${error.message}`); out.push(...(data ?? [])); } return out; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
