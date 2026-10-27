import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, "outputs/extended132-model-ford-focus-wiper-20261025");
const BASELINE_FILE = path.resolve(ROOT, "outputs/popular-extended132-product-gaps-20261025/coverage-by-model.json");
const SOURCE_FILE = path.resolve(ROOT, "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json");
const REVIEW_FILE = path.resolve(ROOT, "outputs/core103-wiper-phase-20261025/multi-candidate-review.jsonl");
const PRODUCT_FILE = path.resolve(ROOT, "outputs/core103-wiper-phase-20261025/sellable-combinations-to-create.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const GROUP = "Ford Focus";

for (const file of [BASELINE_FILE, SOURCE_FILE, REVIEW_FILE, PRODUCT_FILE]) if (!fs.existsSync(file)) throw new Error(`Missing input: ${file}`);
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");

const baselineDocument = readJson(BASELINE_FILE);
const baseline = baselineDocument.groups.find((row) => row.popular_group === GROUP);
if (!baseline) throw new Error(`Missing baseline group: ${GROUP}`);
const expectedKnowledgeGapAy = Number(baseline.wiper_knowledge_application_years_missing);
const expectedProductOnlyAy = Number(baseline.wiper_product_without_knowledge_gap_years);
if (expectedKnowledgeGapAy !== 116 || expectedProductOnlyAy !== 83) throw new Error(`Unexpected baseline: knowledge=${expectedKnowledgeGapAy}, product-only=${expectedProductOnlyAy}`);

const sourceDocument = readJson(SOURCE_FILE);
const sourceRows = sourceDocument.sourceRows.filter((row) => upper(row.make) === "FORD" && upper(row.model) === "FOCUS").map(normalizeSource);
const priorReviewRows = readJsonl(REVIEW_FILE).filter((row) => row.family_id === "ford_focus");
const priorProductRows = readJsonl(PRODUCT_FILE).filter((row) => row.family_id === "ford_focus");
const priorReviewByApplication = new Map();
for (const row of priorReviewRows) for (const id of row.application_ids ?? []) priorReviewByApplication.set(id, row);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const specs = [
  ["makes", "vehicle_catalog_makes", "make_id,name,status"],
  ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
  ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"],
  ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
  ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status,year_from,year_to"],
  ["years", "vehicle_catalog_application_years", "application_id,model_year"],
  ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
  ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"],
  ["sets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"],
];
const values = await Promise.all(specs.map(([, table, columns]) => fetchAll(table, columns)));
const data = Object.fromEntries(specs.map(([name], index) => [name, values[index]]));
const tableCounts = Object.fromEntries(specs.map(([, table], index) => [table, values[index].length]));

const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
const modelById = new Map(data.models.map((row) => [row.model_id, row]));
const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
const yearsByApplication = groupBy(data.years, (row) => row.application_id);
const configById = new Map(data.configurations.map((row) => [row.id, row]));
const publishedByApplication = groupBy(data.fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
const sets = data.sets.map(auditSet);
const activePairKeys = new Set(sets.filter((row) => row.active && row.set_type === "front_pair").map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));

const applications = data.applications.filter((row) => row.status === "active").map((row) => {
  const model = modelById.get(row.model_id);
  const make = makeById.get(model?.make_id);
  if (upper(make?.name) !== "FORD" || upper(model?.name) !== "FOCUS") return null;
  const years = uniqueNumbers((yearsByApplication.get(row.application_id) ?? []).map((item) => item.model_year))
    .filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b);
  if (!years.length) return null;
  const series = seriesById.get(row.series_id);
  const variant = variantById.get(row.variant_id);
  const published = (publishedByApplication.get(row.application_id) ?? []).map((fitment) => ({
    configuration_id: fitment.wiper_configuration_id,
    configuration_key: configById.get(fitment.wiper_configuration_id)?.configuration_key ?? null,
    configuration_status: configById.get(fitment.wiper_configuration_id)?.configuration_status ?? null,
    source: fitment.source,
  }));
  const coveredByActivePair = published.some((item) => configurationHasPair(item.configuration_key, activePairKeys));
  return {
    application_id: row.application_id,
    make: "FORD",
    model: "FOCUS",
    series_code: upper(series?.code),
    series_name: String(series?.display_name ?? "").trim(),
    body_style: bodyKey(variant?.body_style ?? variant?.display_name),
    variant: String(variant?.display_name ?? "").trim(),
    years,
    application_years: years.length,
    published_configurations: published,
    knowledge_published: published.length > 0,
    product_covered_by_active_pair: coveredByActivePair,
  };
}).filter(Boolean);

const knowledgeGap = applications.filter((row) => !row.knowledge_published);
const productOnly = applications.filter((row) => row.knowledge_published && !row.product_covered_by_active_pair);
assertAy("knowledge gap", knowledgeGap, expectedKnowledgeGapAy);
assertAy("product-only gap", productOnly, expectedProductOnlyAy);

const knowledgeDecisions = knowledgeGap.map((application) => assessKnowledge(application));
const safeKnowledge = knowledgeDecisions.filter((row) => row.outcome === "safe_to_publish");
const blockedKnowledge = knowledgeDecisions.filter((row) => row.outcome === "blocked");
const localCandidateAy = sum(knowledgeDecisions.filter((row) => row.local_candidate), (row) => row.application_years);
if (localCandidateAy !== 95) throw new Error(`Expected 95 local-candidate AY, got ${localCandidateAy}`);
if (sum(safeKnowledge, (row) => row.application_years) !== 0) throw new Error("Unexpected Focus safe knowledge row; review strict gates.");

const productDecisions = productOnly.map(assessProduct);
const incompleteProduct = productDecisions.filter((row) => row.outcome === "incomplete_configuration_blocked");
const actionableProduct = productDecisions.filter((row) => row.outcome === "product_to_create_or_activate");
if (sum(incompleteProduct, (row) => row.application_years) !== 83 || actionableProduct.length !== 0) {
  throw new Error("Focus product queue no longer reconciles to 83 AY incomplete and 0 actionable.");
}

const knowledgeGroups = aggregate(knowledgeDecisions, (row) => [row.series_code, row.body_style, row.outcome, row.reason].join("|"));
const productGroups = aggregate(productDecisions, (row) => [row.configuration_key, row.outcome, row.reason].join("|"));
const summary = {
  generated_at: new Date().toISOString(),
  mode: "report-only",
  production_writes: false,
  scope: { rank: baseline.rank, popular_group: GROUP, period: PERIOD },
  denominator: {
    applications: applications.length,
    application_years: sum(applications, (row) => row.application_years),
  },
  knowledge: {
    gap_applications: knowledgeGap.length,
    gap_application_years: expectedKnowledgeGapAy,
    local_candidate_applications: knowledgeDecisions.filter((row) => row.local_candidate).length,
    local_candidate_application_years: localCandidateAy,
    safe_applications: safeKnowledge.length,
    safe_application_years: sum(safeKnowledge, (row) => row.application_years),
    audited_deferred_applications: blockedKnowledge.length,
    audited_deferred_application_years: sum(blockedKnowledge, (row) => row.application_years),
    reasons: countBy(blockedKnowledge, (row) => row.reason),
  },
  product: {
    product_only_applications: productOnly.length,
    product_only_application_years: expectedProductOnlyAy,
    actionable_applications: actionableProduct.length,
    actionable_application_years: sum(actionableProduct, (row) => row.application_years),
    incomplete_configuration_blocked_applications: incompleteProduct.length,
    incomplete_configuration_blocked_application_years: sum(incompleteProduct, (row) => row.application_years),
    configuration_summary: productGroups,
  },
  projected_uplift: {
    safe_knowledge_application_years: 0,
    safe_product_application_years: 0,
    safe_knowledge_pp_of_46676: 0,
    safe_product_pp_of_46676: 0,
  },
  integrity: {
    knowledge_gap_matches_baseline: sum(knowledgeGap, (row) => row.application_years) === expectedKnowledgeGapAy,
    product_only_matches_baseline: sum(productOnly, (row) => row.application_years) === expectedProductOnlyAy,
    knowledge_partition_matches: sum(safeKnowledge, (row) => row.application_years) + sum(blockedKnowledge, (row) => row.application_years) === expectedKnowledgeGapAy,
    product_partition_matches: sum(incompleteProduct, (row) => row.application_years) + sum(actionableProduct, (row) => row.application_years) === expectedProductOnlyAy,
    queue_overlap_application_ids: overlapIds(safeKnowledge, blockedKnowledge, incompleteProduct, actionableProduct),
  },
  sources: {
    baseline: fileAudit(BASELINE_FILE),
    wipertech: fileAudit(SOURCE_FILE),
    prior_review: fileAudit(REVIEW_FILE),
    prior_product_queue: fileAudit(PRODUCT_FILE),
    production_read_only_tables: tableCounts,
    wipertech_rows: sourceRows,
  },
};
if (!Object.values(summary.integrity).slice(0, 4).every(Boolean) || summary.integrity.queue_overlap_application_ids.length) throw new Error(`Integrity failure: ${JSON.stringify(summary.integrity)}`);

fs.mkdirSync(OUT, { recursive: true });
writeJson("summary.json", summary);
writeJsonl("safe-to-publish.jsonl", safeKnowledge);
writeJsonl("blocked-knowledge.jsonl", knowledgeGroups);
writeJsonl("knowledge-application-audit.jsonl", knowledgeDecisions);
writeJsonl("product-actionable.jsonl", actionableProduct);
writeJsonl("incomplete-configuration-blocked.jsonl", productGroups.filter((row) => row.outcome === "incomplete_configuration_blocked"));
writeJsonl("product-application-audit.jsonl", productDecisions);
writeJson("source-audit.json", { source_rows: sourceRows, wiper_sets: sets, table_counts: tableCounts });
fs.writeFileSync(path.join(OUT, "README.md"), readme(), "utf8");
console.log(JSON.stringify({ output: rel(OUT), knowledge: summary.knowledge, product: summary.product, projected_uplift: summary.projected_uplift }, null, 2));

function assessKnowledge(application) {
  const prior = priorReviewByApplication.get(application.application_id);
  const localCandidate = Boolean(prior && ((prior.candidate_configurations ?? []).length || (prior.source_rows ?? []).length));
  const exactRows = sourceRows.filter((row) => row.series_tokens.includes(application.series_code) && row.body_style === application.body_style);
  const exactConfigurations = uniqueStrings(exactRows.map((row) => row.configuration_key));
  let reason;
  if (!application.series_code) reason = "missing_series_cross_generation";
  else if (!exactRows.length) reason = "no_exact_series_body_local_evidence";
  else if (exactConfigurations.length !== 1) reason = "multiple_exact_series_body_configurations";
  else reason = "strict_candidate_requires_manual_review";
  return {
    ...application,
    outcome: "blocked",
    reason,
    local_candidate: localCandidate,
    prior_candidate_configurations: prior?.candidate_configurations ?? [],
    exact_source_configurations: exactConfigurations,
    exact_source_vehicle_ids: exactRows.map((row) => row.vehicle_id),
    source_rows: exactRows,
    production_write: false,
  };
}

function assessProduct(application) {
  const keys = uniqueStrings(application.published_configurations.map((row) => row.configuration_key));
  if (keys.length !== 1) return { ...application, outcome: "product_to_create_or_activate", configuration_key: null, reason: "multiple_or_invalid_published_configurations" };
  const key = keys[0];
  const [driver, passenger, rear] = key.split("/").map(parseLength);
  if (driver === null || passenger === null) {
    return {
      ...application,
      outcome: "incomplete_configuration_blocked",
      reason: driver === null && passenger === null ? "both_front_lengths_missing" : "passenger_or_driver_length_missing",
      configuration_key: key,
      driver_length_in: driver,
      passenger_length_in: passenger,
      rear_length_in: rear,
      exact_matching_sets: [],
      known_driver_sets: driver === null ? [] : sets.filter((row) => row.driver_length_in === driver),
      production_write: false,
    };
  }
  return {
    ...application,
    outcome: "product_to_create_or_activate",
    reason: "complete_published_pair_without_active_exact_set",
    configuration_key: key,
    driver_length_in: driver,
    passenger_length_in: passenger,
    rear_length_in: rear,
    exact_matching_sets: sets.filter((row) => pairKey(row.driver_length_in, row.passenger_length_in) === pairKey(driver, passenger)),
    production_write: false,
  };
}

function aggregate(rows, keyFn) {
  return [...groupBy(rows, keyFn).values()].map((items) => {
    const first = items[0];
    return {
      outcome: first.outcome,
      reason: first.reason,
      series_codes: uniqueStrings(items.map((row) => row.series_code || "<missing>")),
      body_styles: uniqueStrings(items.map((row) => row.body_style)),
      configuration_key: first.configuration_key ?? null,
      application_ids: items.map((row) => row.application_id).sort(),
      applications: items.length,
      application_years: sum(items, (row) => row.application_years),
      years: uniqueNumbers(items.flatMap((row) => row.years)).sort((a, b) => a - b),
      local_candidate_applications: items.filter((row) => row.local_candidate).length,
      local_candidate_application_years: sum(items.filter((row) => row.local_candidate), (row) => row.application_years),
      production_write: false,
    };
  }).sort((a, b) => b.application_years - a.application_years || String(a.series_code).localeCompare(String(b.series_code)));
}

function normalizeSource(row) {
  const configuration = [row.driver_in, row.passenger_in, row.rear_in].map((value) => value === "" || value === null || value === undefined ? "-" : String(Number(value))).join("/");
  return {
    vehicle_id: String(row.vehicle_id),
    series: String(row.series ?? "").trim(),
    series_tokens: String(row.series ?? "").toUpperCase().split(/[,/]/).map((value) => value.trim()).filter(Boolean),
    body_style: bodyKey(row.body),
    year_from: Number(row.year_from),
    year_to: row.year_to === "" || row.year_to === null ? null : Number(row.year_to),
    configuration_key: configuration,
  };
}

function auditSet(row) {
  return {
    id: row.id, sku: row.sku, set_type: row.set_type,
    driver_length_in: numberOrNull(row.driver_length_in), passenger_length_in: numberOrNull(row.passenger_length_in), rear_length_in: numberOrNull(row.rear_length_in),
    active: row.active === true, visibility_status: row.visibility_status, content_status: row.content_status,
    commerce_status: row.commerce_status, checkout_enabled: row.checkout_enabled === true,
    commerce_ready: row.set_type === "front_pair" && row.active === true && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true,
  };
}

function configurationHasPair(key, pairs) { const [driver, passenger] = String(key ?? "").split("/"); return driver && passenger && driver !== "-" && passenger !== "-" && pairs.has(pairKey(driver, passenger)); }
function pairKey(driver, passenger) { return `${Number(driver)}/${Number(passenger)}`; }
function parseLength(value) { return value && value !== "-" ? numberOrNull(value) : null; }
function numberOrNull(value) { const number = Number(value); return value === null || value === "" || !Number.isFinite(number) ? null : number; }
function bodyKey(value) { const key = String(value ?? "").toLowerCase(); if (/hatch|liftback/.test(key)) return "hatchback"; if (/wagon|estate/.test(key)) return "wagon"; if (/sedan|saloon/.test(key)) return "sedan"; if (/convertible|cabrio|roadster/.test(key)) return "convertible"; return key.trim() || "unknown"; }
function assertAy(label, rows, expected) { const observed = sum(rows, (row) => row.application_years); if (observed !== expected) throw new Error(`${label}: expected ${expected}, got ${observed}`); }
function overlapIds(...queues) { const seen = new Set(), duplicates = new Set(); for (const queue of queues) for (const row of queue) { if (seen.has(row.application_id)) duplicates.add(row.application_id); seen.add(row.application_id); } return [...duplicates].sort(); }
function countBy(rows, keyFn) { const output = {}; for (const row of rows) { const key = keyFn(row); output[key] = (output[key] ?? 0) + row.application_years; } return output; }
function sum(rows, selector) { return rows.reduce((total, row) => total + Number(selector(row) || 0), 0); }
function uniqueNumbers(values) { return [...new Set(values.filter((value) => value !== null && value !== "" && Number.isFinite(Number(value))).map(Number))]; }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function rel(value) { return path.relative(ROOT, value).replaceAll("\\", "/"); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function readJsonl(file) { const text = fs.readFileSync(file, "utf8").trim(); return text ? text.split(/\r?\n/).filter(Boolean).map(JSON.parse) : []; }
function fileAudit(file) { const stat = fs.statSync(file); return { path: rel(file), bytes: stat.size, modified_at: stat.mtime.toISOString() }; }
function writeJson(name, value) { fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeJsonl(name, rows) { fs.writeFileSync(path.join(OUT, name), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8"); }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/); if (!match || process.env[match[1]]) continue; let value = match[2]; if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); process.env[match[1]] = value; } }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data: rows, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw new Error(`${table}: ${error.message}`); output.push(...(rows ?? [])); if (!rows || rows.length < 1000) return output; } }
function readme() { return `# Ford Focus wiper audit — 2026-10-25

Report-only strict separation of the **116 AY knowledge gap** and **83 AY product-only gap**.

- Knowledge local-candidate ceiling: 95 AY.
- Strict safe knowledge: 0 AY.
- Audited knowledge deferred: 116 AY.
- Product-only incomplete front configuration: 83 AY.
- Product action: 0 AY.

Missing chassis across generation-spanning applications and non-exact DFW/LR evidence are not promoted. Published \`28/-/12\` retains knowledge but cannot define a sellable front pair.

Rerun: \`node scripts/catalog/report-extended132-model-focus-wiper-20261025.mjs\`

No production write is performed.
`; }
