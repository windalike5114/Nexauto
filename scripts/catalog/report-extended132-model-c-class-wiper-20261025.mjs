import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_EXTENDED_80_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, "outputs/extended132-model-c-class-wiper-20261025");
const WIPERTECH = path.resolve(ROOT, "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json");
const PHASE_MULTI = path.resolve(ROOT, "outputs/extended132-wiper-phase-20261025/multi-candidate-review.jsonl");
const PHASE_PRODUCT = path.resolve(ROOT, "outputs/extended132-wiper-phase-20261025/product-missing.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const EXTENDED132_AY_DENOMINATOR = 46_676;

if (process.argv.includes("--apply")) throw new Error("Report-only script: --apply is intentionally unsupported.");
if (process.argv.slice(2).length) throw new Error(`Unknown argument(s): ${process.argv.slice(2).join(", ")}`);
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
for (const file of [WIPERTECH, PHASE_MULTI, PHASE_PRODUCT]) if (!fs.existsSync(file)) throw new Error(`Missing local evidence: ${file}`);

const group = POPULAR_EXTENDED_80_VEHICLE_GROUPS.find((row) => row.rank === 110);
if (!group || group.label !== "Mercedes-Benz C-Class") throw new Error("Maintained rank 110 group changed; review scope before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const sourceRows = JSON.parse(fs.readFileSync(WIPERTECH, "utf8")).sourceRows.map(sourceRow)
  .filter((row) => normalizeName(row.make) === "MERCEDES BENZ" && normalizeName(row.model) === "C CLASS");
const phaseMultiRows = readJsonl(PHASE_MULTI).filter((row) => row.group_id === group.id);
const phaseProductRows = readJsonl(PHASE_PRODUCT).filter((row) => row.group_id === group.id);
const priorMultiByApplication = indexApplications(phaseMultiRows);
const priorProductByApplication = indexApplications(phaseProductRows);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const data = await loadProduction();
const prepared = prepare(data);
writeOutputs(prepared);
console.log(JSON.stringify({
  output_dir: path.relative(ROOT, OUT).replaceAll("\\", "/"),
  ...prepared.summary.counts,
  gap_application_years: prepared.summary.gap.application_years,
  local_evidence_ceiling_application_years: prepared.summary.local_evidence.ceiling_application_years,
  safe_application_years: prepared.summary.queues.safe.application_years,
  multi_candidate_application_years: prepared.summary.queues.multi_candidate.application_years,
  productization_application_years: prepared.summary.queues.productization.application_years,
  production_writes: 0
}, null, 2));

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
    const key = pairKey(row.driver_length_in, row.passenger_length_in);
    const rows = sellablePairs.get(key) ?? [];
    rows.push(row);
    sellablePairs.set(key, rows);
  }

  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const matched = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (matched?.id !== group.id) continue;
    const years = unique((yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b);
    if (!years.length) continue;
    const series = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id);
    const publishedRows = publishedByApp.get(application.application_id) ?? [];
    const publishedKeys = unique(publishedRows.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key));
    const knownKey = publishedRows.length === 1 && publishedKeys.length === 1 ? publishedKeys[0] : null;
    const productSkus = knownKey ? sellablePairSkus(knownKey, sellablePairs) : [];
    applications.push({
      application_id: application.application_id,
      make: upper(make.name), model: upper(model.name),
      series_code: upper(series?.code), series_name: String(series?.display_name ?? "").trim(),
      generation: generationKey(series?.code ?? series?.display_name),
      body: bodyKey(variant?.body_style ?? variant?.display_name), variant: String(variant?.display_name ?? "").trim(),
      years, application_years: years.length,
      published_rows: publishedRows, published_configuration_keys: publishedKeys,
      known_configuration_key: knownKey, product_skus: productSkus,
      knowledge_covered: Boolean(knownKey), product_covered: productSkus.length > 0
    });
  }

  const decisions = applications.map(assess);
  const safeApps = decisions.filter((row) => row.outcome === "safe");
  const blockedApps = decisions.filter((row) => row.outcome === "blocked");
  const multiApps = decisions.filter((row) => row.outcome === "multi_candidate");
  const alreadyApps = decisions.filter((row) => row.outcome === "already_covered");
  const productizationApps = decisions.filter((row) => row.outcome === "productization" || row.productization_required);
  const gaps = applications.filter((row) => !row.knowledge_covered);
  const evidenceCeiling = [...safeApps, ...blockedApps, ...multiApps].filter((row) => row.local_evidence_available);
  const safe = aggregate(safeApps);
  const blocked = aggregate(blockedApps);
  const multiCandidate = aggregate(multiApps);
  const productization = aggregate(productizationApps, true);
  const allGroups = aggregate(decisions);
  const beforeKnowledge = new Set(applications.filter((row) => row.knowledge_covered).map((row) => row.application_id));
  const beforeProduct = new Set(applications.filter((row) => row.product_covered).map((row) => row.application_id));
  const afterKnowledge = new Set([...beforeKnowledge, ...safeApps.map((row) => row.application_id)]);
  const afterProduct = new Set([...beforeProduct, ...safeApps.filter((row) => row.product_skus.length).map((row) => row.application_id)]);
  const summary = {
    generated_at: new Date().toISOString(), mode: "report-only", production_writes: 0,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, period: PERIOD, aliases: group.aliases },
    policy: {
      grouping: "generation root + exact chassis/series + normalized body + complete NexAuto year set + outcome",
      generation_bridge: "Numeric 202/203 chassis codes are compared only with the body-compatible W/S/CL platform of the same generation.",
      safe: "One body-compatible same-generation configuration covers the target identity and there is no published conflict.",
      multi_candidate: "Pre-facelift/facelift configuration changes inside one application year set remain multi-candidate.",
      unrepresentable_split: "No single configuration is assigned when an application spans a configuration boundary that the relationship schema cannot express.",
      productization: "Reliable published knowledge without a complete active sellable front pair is kept separate from knowledge gaps."
    },
    sources: {
      wipertech: fileIdentity(WIPERTECH), phase_multi_candidate: fileIdentity(PHASE_MULTI),
      phase_product_missing: fileIdentity(PHASE_PRODUCT),
      production_snapshot: { fetched_at: data.fetched_at, mode: "read-only", table_counts: data.table_counts }
    },
    source_rows: sourceRows,
    counts: {
      applications: applications.length, application_years: sumAy(applications), groups: allGroups.length,
      already_covered_applications: alreadyApps.length, already_covered_application_years: sumAy(alreadyApps),
      gap_applications: gaps.length, gap_application_years: sumAy(gaps)
    },
    gap: {
      applications: gaps.length, application_years: sumAy(gaps), expected_input_gap_application_years: 22,
      reconciles_expected_gap: sumAy(gaps) === 22
    },
    local_evidence: {
      ceiling_applications: evidenceCeiling.length, ceiling_application_years: sumAy(evidenceCeiling),
      expected_ceiling_application_years: 22, ceiling_reconciles: sumAy(evidenceCeiling) === 22,
      safe_application_years: sumAy(safeApps)
    },
    product_only: {
      applications: productizationApps.length, application_years: sumAy(productizationApps), expected_application_years: 22,
      reconciles_expected: sumAy(productizationApps) === 22,
      note: "These are already-published partial 202-generation configurations, not missing knowledge."
    },
    queues: {
      safe: queueSummary(safeApps, safe), blocked: queueSummary(blockedApps, blocked),
      multi_candidate: queueSummary(multiApps, multiCandidate), productization: queueSummary(productizationApps, productization)
    },
    coverage: {
      knowledge_before: coverage(applications, beforeKnowledge), knowledge_after_safe: coverage(applications, afterKnowledge),
      product_before: coverage(applications, beforeProduct), product_after_safe: coverage(applications, afterProduct)
    },
    uplift: {
      c_class_safe_application_years: sumAy(safeApps), c_class_safe_pp: percent(sumAy(safeApps), sumAy(applications)),
      extended132_safe_pp: percent(sumAy(safeApps), EXTENDED132_AY_DENOMINATOR),
      commercial_priority: { fleet_count: group.fleetCount, gap_rate: Number((sumAy(gaps) / sumAy(applications)).toFixed(4)),
        fleet_gap_proxy: Math.round(group.fleetCount * sumAy(gaps) / sumAy(applications)) }
    },
    integrity: {
      gap_partition: safeApps.length + blockedApps.length + multiApps.length === gaps.length,
      gap_ay_partition: sumAy(safeApps) + sumAy(blockedApps) + sumAy(multiApps) === sumAy(gaps),
      duplicate_application_outcomes: duplicates(decisions.map((row) => row.application_id)),
      local_evidence_ceiling_is_22_ay: sumAy(evidenceCeiling) === 22,
      product_only_is_22_ay: sumAy(productizationApps) === 22
    }
  };
  return { safe, blocked, multiCandidate, productization, allGroups, summary };

  function assess(application) {
    const base = {
      ...application, rank: group.rank, group_id: group.id, popular_group: group.label,
      current_configuration_keys: application.published_configuration_keys
    };
    if (application.published_rows.length > 1 || application.published_configuration_keys.length > 1) {
      return { ...base, outcome: "blocked", blocker_class: "published_conflict", reason: "duplicate_or_conflicting_published_fitments",
        candidate_configurations: application.published_configuration_keys, local_evidence_available: false,
        requested_evidence: "Resolve the published conflict before any propagation." };
    }
    if (application.knowledge_covered) {
      if (!application.product_covered) {
        const prior = priorProductByApplication.get(application.application_id);
        return { ...base, outcome: "productization", reason: "published_knowledge_without_sellable_front_pair",
          configuration_key: application.known_configuration_key, candidate_configurations: [application.known_configuration_key],
          productization_required: true, local_evidence_available: true, prior_phase_row: prior ?? null,
          requested_evidence: application.known_configuration_key.includes("-")
            ? "Preserve the valid partial fitment; complete front-position knowledge before a sellable pair can be linked."
            : "Create or link a complete active sellable front pair for the published configuration." };
      }
      return { ...base, outcome: "already_covered", reason: "published_knowledge_and_sellable_front_pair",
        configuration_key: application.known_configuration_key, candidate_configurations: [application.known_configuration_key],
        productization_required: false, local_evidence_available: true };
    }
    if (!application.series_code || application.generation === "NO_CHASSIS" || application.body === "unknown") {
      return { ...base, outcome: "blocked", blocker_class: "missing_identity", reason: "missing_generation_or_body_identity",
        candidate_configurations: priorCandidates(application), local_evidence_available: Boolean(priorMultiByApplication.get(application.application_id)),
        requested_evidence: "Correct generation/body identity before fitment publication." };
    }
    const candidates = strictSourceCandidates(application);
    const prior = priorMultiByApplication.get(application.application_id);
    const configs = unique(candidates.map((row) => row.configuration));
    if (configs.length > 1) {
      return { ...base, outcome: "multi_candidate", blocker_class: "multi_candidate", reason: "configuration_changes_within_application_years",
        candidate_configurations: configs, prior_candidate_configurations: prior?.candidate_configurations ?? [],
        source_vehicle_ids: candidates.map((row) => row.vehicle_id), source_rows: candidates,
        local_evidence_available: true,
        requested_evidence: "Split the application years at the pre-facelift/facelift boundary before assigning a configuration." };
    }
    if (!configs.length) {
      return { ...base, outcome: "blocked", blocker_class: "no_same_generation_body_evidence", reason: "no_same_generation_body_source_row",
        candidate_configurations: priorCandidates(application), source_vehicle_ids: prior?.source_vehicle_ids ?? [],
        local_evidence_available: Boolean(prior),
        requested_evidence: "Obtain an authoritative same-generation, body-specific catalog row." };
    }
    const configurationKey = configs[0];
    const productSkus = sellablePairSkus(configurationKey, sellablePairs);
    return { ...base, outcome: "safe", reason: "same_generation_body_unique_configuration_no_conflict",
      configuration_key: configurationKey, candidate_configurations: configs,
      source_vehicle_ids: candidates.map((row) => row.vehicle_id), source_rows: candidates,
      local_evidence_available: true, product_skus: productSkus, productization_required: productSkus.length === 0 };
  }
}

function strictSourceCandidates(application) {
  return sourceRows.filter((row) => row.generation === application.generation && row.body === application.body
    && application.years.some((year) => year >= row.year_from && year <= row.year_to));
}
function priorCandidates(application) {
  return priorMultiByApplication.get(application.application_id)?.candidate_configurations ?? [];
}
function aggregate(rows, productization = false) {
  const buckets = groupBy(rows, (row) => [row.outcome, row.generation, row.series_code, row.body, row.years.join(","),
    (row.candidate_configurations ?? []).join(","), row.reason].join("|"));
  return [...buckets.values()].map((items) => {
    const first = items[0];
    return {
      rank: group.rank, group_id: group.id, popular_group: group.label, outcome: first.outcome,
      generation: first.generation, series_chassis: first.series_code, body: first.body,
      variants: unique(items.map((row) => row.variant)), years: first.years,
      application_ids: items.map((row) => row.application_id).sort(), applications: items.length,
      application_years: sumAy(items), configuration_key: first.configuration_key ?? null,
      candidate_configurations: unique(items.flatMap((row) => row.candidate_configurations ?? [])),
      prior_candidate_configurations: unique(items.flatMap((row) => row.prior_candidate_configurations ?? [])),
      current_configuration_keys: unique(items.flatMap((row) => row.current_configuration_keys ?? [])),
      sellable_front_pair_skus: unique(items.flatMap((row) => row.product_skus ?? [])),
      blocker_class: first.blocker_class ?? null, reason: first.reason,
      source_vehicle_ids: unique(items.flatMap((row) => row.source_vehicle_ids ?? [])),
      source_rows: uniqueBy(items.flatMap((row) => row.source_rows ?? []), (row) => row.vehicle_id),
      requested_evidence: first.requested_evidence ?? null,
      productization_required: productization || items.some((row) => row.productization_required), production_write: false
    };
  }).sort((a, b) => a.generation.localeCompare(b.generation) || a.series_chassis.localeCompare(b.series_chassis)
    || a.body.localeCompare(b.body) || a.reason.localeCompare(b.reason));
}
function coverage(applications, coveredIds) {
  const covered = applications.filter((row) => coveredIds.has(row.application_id));
  const years = unique(applications.flatMap((row) => row.years)).sort((a, b) => a - b);
  let any = 0; let full = 0;
  for (const year of years) {
    const rows = applications.filter((row) => row.years.includes(year));
    const count = rows.filter((row) => coveredIds.has(row.application_id)).length;
    if (count) any += 1;
    if (count === rows.length) full += 1;
  }
  return {
    applications_total: applications.length, applications_covered: covered.length,
    application_coverage_percent: percent(covered.length, applications.length),
    application_years_total: sumAy(applications), application_years_covered: sumAy(covered),
    application_year_coverage_percent: percent(sumAy(covered), sumAy(applications)),
    model_years_total: years.length, model_years_any_covered: any,
    model_year_any_coverage_percent: percent(any, years.length), model_years_fully_covered: full,
    model_year_full_coverage_percent: percent(full, years.length)
  };
}
function queueSummary(apps, groups) {
  return { groups: groups.length, applications: apps.length, application_years: sumAy(apps),
    reasons: countBy(apps, (row) => row.reason), blocker_classes: countBy(apps.filter((row) => row.blocker_class), (row) => row.blocker_class) };
}

async function loadProduction() {
  const [makes, models, configurations, wiperSets] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"), fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("wiper_configurations", "id,configuration_key,configuration_status,rear_status"),
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
  return {
    makes, models, series, variants, applications, years, fitments, configurations, wiperSets,
    fetched_at: new Date().toISOString(),
    table_counts: {
      vehicle_catalog_makes: makes.length, vehicle_catalog_models: models.length,
      target_vehicle_catalog_series: series.length, target_vehicle_catalog_variants: variants.length,
      target_vehicle_catalog_applications: applications.length, target_vehicle_catalog_application_years: years.length,
      target_vehicle_catalog_wiper_fitments: fitments.length, wiper_configurations: configurations.length, wiper_sets: wiperSets.length
    }
  };
}
function writeOutputs(prepared) {
  fs.mkdirSync(OUT, { recursive: true });
  writeJson("summary.json", prepared.summary);
  writeJsonl("safe-to-publish.jsonl", prepared.safe);
  writeJsonl("blocked.jsonl", prepared.blocked);
  writeJsonl("multi-candidate-review.jsonl", prepared.multiCandidate);
  writeJsonl("productization.jsonl", prepared.productization);
  writeJsonl("all-groups.jsonl", prepared.allGroups);
  writeJson("source-audit.json", {
    generated_at: prepared.summary.generated_at, sources: prepared.summary.sources,
    exact_local_rows: sourceRows,
    safeguards: [
      "Local WiperTech and existing extended-132 review data only; no web or AI search.",
      "No production writes; --apply is rejected.",
      "Numeric chassis codes are bridged only within the same 202/203 generation and compatible body.",
      "Multiple configurations across an application's years remain multi-candidate.",
      "Product-only rows remain distinct from missing fitment knowledge."
    ]
  });
  fs.writeFileSync(path.join(OUT, "README"), `Extended-132 model-first wiper report: Mercedes-Benz C-Class (rank 110)\n\n` +
    `Scope: ${prepared.summary.counts.applications} applications / ${prepared.summary.counts.application_years} AY, 2000-2026.\n` +
    `Knowledge gap: ${prepared.summary.gap.applications} applications / ${prepared.summary.gap.application_years} AY.\n` +
    `Local evidence ceiling: ${prepared.summary.local_evidence.ceiling_application_years} AY; strict safe uplift: ${prepared.summary.queues.safe.application_years} AY.\n` +
    `Product-only: ${prepared.summary.product_only.applications} applications / ${prepared.summary.product_only.application_years} AY.\n\n` +
    `The 203-generation applications were split around the 2003 transition. Only the 22 transition-year applications remain multi-candidate because month-level build dates are unavailable.\n` +
    `The 202-generation product-only rows retain their valid partial published configurations and are not counted as missing knowledge.\n` +
    `This report is read-only; the separate W203 split batch contains the production write.\n\n` +
    `Re-run: node outputs/extended132-model-c-class-wiper-20261025/rerun.mjs\n`);
  fs.writeFileSync(path.join(OUT, "rerun.mjs"), `import "../../scripts/catalog/report-extended132-model-c-class-wiper-20261025.mjs";\n`);
}

function sourceRow(row) {
  return {
    vehicle_id: String(row.vehicle_id), make: row.make, model: row.model, series: row.series,
    generation: generationKey(row.series), body: bodyKey(row.body), year_from: Number(row.year_from), year_to: Number(row.year_to),
    configuration: [row.driver_in, row.passenger_in, row.rear_in].map((value) => value === "" || value == null ? "-" : Number(value)).join("/")
  };
}
function generationKey(value) {
  const text = upper(value);
  const match = text.match(/(?:^|[^0-9])(20[2-6])(?:[^0-9]|$)/) ?? text.match(/^(20[2-6])\./);
  return match ? match[1] : (text || "NO_CHASSIS");
}
function bodyKey(value) {
  const text = String(value ?? "").toLowerCase();
  if (/wagon|estate/.test(text)) return "wagon";
  if (/convertible|cabrio/.test(text)) return "convertible";
  if (/coupe/.test(text)) return "coupe";
  if (/sedan|saloon/.test(text)) return "sedan";
  return text.trim() || "unknown";
}
function sellablePairSkus(key, pairs) {
  const [a, b] = String(key ?? "").split("/");
  if (!a || !b || a === "-" || b === "-") return [];
  return (pairs.get(pairKey(a, b)) ?? []).map((row) => row.sku).sort();
}
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => y - x).join("/"); }
function isSellableFrontPair(row) {
  return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
    && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true;
}
function indexApplications(rows) {
  return new Map(rows.flatMap((row) => (row.application_ids ?? []).map((id) => [id, row])));
}
function normalizeName(value) { return upper(value).replace(/[^A-Z0-9]+/g, " ").trim(); }
function sumAy(rows) { return rows.reduce((sum, row) => sum + row.application_years, 0); }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(2)) : 0; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function uniqueBy(values, keyFn) { return [...new Map(values.map((value) => [keyFn(value), value])).values()]; }
function groupBy(values, keyFn) {
  const out = new Map();
  for (const value of values) { const key = keyFn(value); const rows = out.get(key) ?? []; rows.push(value); out.set(key, rows); }
  return out;
}
function countBy(values, keyFn) {
  const out = {};
  for (const value of values) { const key = keyFn(value); out[key] = (out[key] ?? 0) + 1; }
  return out;
}
function duplicates(values) { return Object.entries(countBy(values, (value) => value)).filter(([, count]) => count > 1).map(([value]) => value); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJson(name, value) { fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(name, rows) { fs.writeFileSync(path.join(OUT, name), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString() };
}
async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}
async function selectIn(table, columns, field, values) {
  const out = [];
  for (let index = 0; index < values.length; index += 50) {
    const batch = values.slice(index, index + 50);
    if (!batch.length) continue;
    const { data, error } = await db.from(table).select(columns).in(field, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
  }
  return out;
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
