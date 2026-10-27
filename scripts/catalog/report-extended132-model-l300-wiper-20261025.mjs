import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_80_ADDITIONAL_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-model-l300-wiper-20261025");
const SOURCE_RESULT_FILE = path.join(ROOT, "outputs", "extended132-wiper-ai-minimal-20261025", "results", "p1-08-10.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const SOURCE_RANGE = { from: 1986, to: 2013 };
const EXTENDED132_AY_DENOMINATOR = 46_676;
const CONFIGURATION_KEY = "16/16/14";
const SERIES_PATTERN = /^P[0-3][A-Z0-9]W$/;

if (process.argv.includes("--apply")) throw new Error("This script is report-only and never writes production.");
loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");

const group = POPULAR_80_ADDITIONAL_VEHICLE_GROUPS.find((row) => row.rank === 129);
if (!group || group.label !== "Mitsubishi L300") throw new Error("Maintained rank 129 group changed; review before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const evidence = loadEvidence();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const data = await loadProduction();
const prepared = prepare(data);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), prepared.safe);
writeJsonl(path.join(OUTPUT_DIR, "blocked.jsonl"), prepared.blocked);
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify(prepared.summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), readme(prepared.summary));

console.log(JSON.stringify({
  output_dir: OUTPUT_DIR,
  rank129_applications: prepared.summary.denominator.applications,
  rank129_application_years: prepared.summary.denominator.application_years,
  current_knowledge_gap_applications: prepared.summary.current_gap.applications,
  current_knowledge_gap_application_years: prepared.summary.current_gap.application_years,
  safe_applications: prepared.summary.queues.safe_to_publish.applications,
  safe_application_years: prepared.summary.queues.safe_to_publish.application_years,
  blocked_applications: prepared.summary.queues.blocked.applications,
  blocked_application_years: prepared.summary.queues.blocked.application_years,
  projected_extended132_pp: prepared.summary.projected_uplift.extended132_knowledge_pp
}, null, 2));

function loadEvidence() {
  const rows = readJsonl(SOURCE_RESULT_FILE).filter((row) => row.conclusion === "confirmed" && row.configuration?.startsWith("16/16/14"));
  if (rows.length !== 2) throw new Error(`Expected two confirmed L300 DENSO rows, found ${rows.length}.`);
  if (unique(rows.map((row) => row.source_url)).length !== 1 || unique(rows.map((row) => row.source_locator)).length !== 1) {
    throw new Error("Confirmed L300 evidence rows disagree on source identity.");
  }
  return {
    source_url: rows[0].source_url,
    source_locator: rows[0].source_locator,
    task_ids: rows.map((row) => row.task_id).sort(),
    reviewed_at: rows.map((row) => row.reviewed_at).sort().at(-1),
    input: fileIdentity(SOURCE_RESULT_FILE)
  };
}

function prepare(data) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApp = groupBy(data.years, (row) => row.application_id);
  const configById = new Map(data.configurations.map((row) => [row.id, row]));
  const configsByKey = groupBy(data.configurations, (row) => row.configuration_key);
  const bladesByConfig = groupBy(data.blades, (row) => row.wiper_configuration_id);
  const fitmentsByApp = groupBy(data.fitments, (row) => row.application_id);
  const activePairs = new Map();
  for (const row of data.wiperSets.filter(isSellableFrontPair)) {
    const key = pairKey(row.driver_length_in, row.passenger_length_in);
    const values = activePairs.get(key) ?? []; values.push(row); activePairs.set(key, values);
  }
  const sellable1616 = activePairs.get("16/16") ?? [];
  const targetConfigurationRows = configsByKey.get(CONFIGURATION_KEY) ?? [];
  const targetConfiguration = targetConfigurationRows[0] ?? null;
  const targetBladeKey = targetConfiguration ? bladeKey(bladesByConfig.get(targetConfiguration.id) ?? []) : null;
  const globalRuleFailures = [];
  if (targetConfigurationRows.length > 1) globalRuleFailures.push("duplicate_target_configuration_key");
  if (targetConfiguration && targetBladeKey !== CONFIGURATION_KEY) globalRuleFailures.push("target_configuration_blades_mismatch");
  if (targetConfiguration && targetConfiguration.rear_status !== "fitted") globalRuleFailures.push("target_configuration_rear_status_mismatch");
  if (targetConfiguration && ["rejected", "superseded"].includes(targetConfiguration.configuration_status)) globalRuleFailures.push("target_configuration_not_publishable");
  if (!sellable1616.length) globalRuleFailures.push("active_sellable_wp1616_missing");

  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const matchedGroup = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (matchedGroup?.id !== group.id) continue;
    const allYears = unique((yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year))).sort((a, b) => a - b);
    const scopedYears = allYears.filter((year) => year >= PERIOD.from && year <= PERIOD.to);
    if (!scopedYears.length) continue;
    const series = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id);
    const published = (fitmentsByApp.get(application.application_id) ?? []).filter((row) => row.fitment_status === "published");
    const publishedKeys = published.map((row) => configById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`);
    const productCovered = publishedKeys.some((key) => {
      const [driver, passenger] = String(key).split("/");
      return driver && passenger && driver !== "-" && passenger !== "-" && activePairs.has(pairKey(driver, passenger));
    });
    applications.push({
      application_id: application.application_id,
      make: upper(make?.name), model: upper(model?.name), series_code: upper(series?.code),
      series_name: String(series?.display_name ?? "").trim(), body_style: bodyKey(variant?.body_style ?? variant?.display_name),
      variant_name: String(variant?.display_name ?? "").trim(), all_nexauto_years: allYears, years: scopedYears,
      application_years: scopedYears.length, published_configuration_keys: publishedKeys,
      current_knowledge_covered: published.length > 0, current_product_covered: productCovered,
      existing_fitment_rows: fitmentsByApp.get(application.application_id) ?? []
    });
  }

  const gaps = applications.filter((row) => !row.current_knowledge_covered);
  const safe = [];
  const blocked = [];
  for (const row of gaps) {
    const failures = [...globalRuleFailures];
    if (row.body_style !== "bus") failures.push("body_not_bus");
    if (!SERIES_PATTERN.test(row.series_code)) failures.push("series_outside_denso_p0w_p1w_p2w_p3w_pattern");
    if (!row.all_nexauto_years.length) failures.push("missing_nexauto_years");
    if (row.all_nexauto_years.some((year) => year < SOURCE_RANGE.from || year > SOURCE_RANGE.to)) failures.push("nexauto_years_outside_denso_1986_2013");
    if (row.published_configuration_keys.length) failures.push("published_configuration_conflict");
    const sameRelation = targetConfiguration ? row.existing_fitment_rows.find((fitment) => fitment.wiper_configuration_id === targetConfiguration.id) : null;
    const common = {
      rank: group.rank, group_id: group.id, popular_group: group.label, fleet_count: group.fleetCount,
      application_id: row.application_id, make: row.make, model: row.model, series_code: row.series_code,
      body_style: row.body_style, variant_name: row.variant_name, all_nexauto_years: row.all_nexauto_years,
      years_2000_2026: row.years, application_years: row.application_years,
      expected_configuration_key: CONFIGURATION_KEY, expected_rear_status: "fitted",
      configuration_id: targetConfiguration?.id ?? null, configuration_exists: Boolean(targetConfiguration),
      configuration_blades_key: targetBladeKey,
      sellable_front_pair_skus: sellable1616.map((item) => item.sku).sort(),
      source_url: evidence.source_url, source_locator: evidence.source_locator, source_task_ids: evidence.task_ids,
      current_published_configuration_keys: row.published_configuration_keys
    };
    if (failures.length) {
      blocked.push({ ...common, outcome: "blocked", blocker_reasons: unique(failures),
        next_requirement: nextRequirement(failures) });
    } else {
      safe.push({ ...common, outcome: "safe_to_publish",
        action: targetConfiguration ? sameRelation ? "publish_existing_relation" : "insert_fitment" : "create_configuration_then_insert_fitment",
        product_ready: true, rule: "denso_l300_iii_bus_exact_series_body_all_years", failures: [] });
    }
  }
  safe.sort(queueSort); blocked.sort(queueSort);

  const currentKnowledgeIds = new Set(applications.filter((row) => row.current_knowledge_covered).map((row) => row.application_id));
  const currentProductIds = new Set(applications.filter((row) => row.current_product_covered).map((row) => row.application_id));
  const projectedKnowledgeIds = new Set([...currentKnowledgeIds, ...safe.map((row) => row.application_id)]);
  const projectedProductIds = new Set([...currentProductIds, ...safe.filter((row) => row.product_ready).map((row) => row.application_id)]);
  const safeAy = safe.reduce((sum, row) => sum + row.application_years, 0);
  const summary = {
    generated_at: new Date().toISOString(), mode: "report-only", production_writes: false,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, period: PERIOD,
      source_applicability: { body: "bus", series_wildcards: ["P0_W", "P1_W", "P2_W", "P3_W"], year_from: 1986, year_to: 2013 },
      configuration_key: CONFIGURATION_KEY },
    evidence: { ...evidence, rule: "DENSO L300 III Bus exact body; P0_W/P1_W/P2_W/P3_W; 08/86-12/13; DM-040/DM-040/DM-035 = 16/16/14 inches" },
    production: {
      source: "fresh read-only snapshot", configuration_exists: Boolean(targetConfiguration),
      configuration_id: targetConfiguration?.id ?? null, configuration_status: targetConfiguration?.configuration_status ?? null,
      configuration_rear_status: targetConfiguration?.rear_status ?? null, configuration_blades_key: targetBladeKey,
      sellable_front_pair_skus: sellable1616.map((row) => row.sku).sort(), global_rule_failures: globalRuleFailures
    },
    denominator: { applications: applications.length, application_years: applications.reduce((sum, row) => sum + row.application_years, 0), model_years: unique(applications.flatMap((row) => row.years)).length },
    current_gap: { applications: gaps.length, application_years: gaps.reduce((sum, row) => sum + row.application_years, 0) },
    coverage: {
      knowledge_before: coverageMetric(applications, currentKnowledgeIds), knowledge_after_safe: coverageMetric(applications, projectedKnowledgeIds),
      product_before: coverageMetric(applications, currentProductIds), product_after_safe: coverageMetric(applications, projectedProductIds)
    },
    queues: {
      safe_to_publish: { applications: safe.length, application_years: safeAy },
      blocked: { applications: blocked.length, application_years: blocked.reduce((sum, row) => sum + row.application_years, 0),
        reasons: countBy(blocked.flatMap((row) => row.blocker_reasons), (value) => value) }
    },
    projected_uplift: {
      rank129_knowledge_application_years: safeAy,
      rank129_knowledge_pp: percent(safeAy, applications.reduce((sum, row) => sum + row.application_years, 0)),
      rank129_product_application_years: safeAy,
      rank129_product_pp: percent(safeAy, applications.reduce((sum, row) => sum + row.application_years, 0)),
      extended132_knowledge_application_years: safeAy,
      extended132_knowledge_pp: percent(safeAy, EXTENDED132_AY_DENOMINATOR),
      extended132_product_application_years: safeAy,
      extended132_product_pp: percent(safeAy, EXTENDED132_AY_DENOMINATOR)
    },
    integrity: {
      gap_partition_matches: safe.length + blocked.length === gaps.length,
      gap_application_year_partition_matches: safeAy + blocked.reduce((sum, row) => sum + row.application_years, 0) === gaps.reduce((sum, row) => sum + row.application_years, 0),
      duplicate_queue_application_ids: duplicateValues([...safe, ...blocked].map((row) => row.application_id))
    }
  };
  return { safe, blocked, summary };
}

function coverageMetric(applications, coveredIds) {
  const applicationYearsTotal = applications.reduce((sum, row) => sum + row.application_years, 0);
  const applicationYearsCovered = applications.filter((row) => coveredIds.has(row.application_id)).reduce((sum, row) => sum + row.application_years, 0);
  const modelYears = unique(applications.flatMap((row) => row.years)).sort((a, b) => a - b);
  let any = 0; let full = 0;
  for (const year of modelYears) {
    const ids = applications.filter((row) => row.years.includes(year)).map((row) => row.application_id);
    const count = ids.filter((id) => coveredIds.has(id)).length;
    if (count > 0) any += 1;
    if (count === ids.length) full += 1;
  }
  return {
    applications_total: applications.length, applications_covered: applications.filter((row) => coveredIds.has(row.application_id)).length,
    application_coverage_percent: percent(applications.filter((row) => coveredIds.has(row.application_id)).length, applications.length),
    application_years_total: applicationYearsTotal, application_years_covered: applicationYearsCovered,
    application_year_coverage_percent: percent(applicationYearsCovered, applicationYearsTotal),
    model_years_total: modelYears.length, model_years_any_covered: any, model_year_any_coverage_percent: percent(any, modelYears.length),
    model_years_fully_covered: full, model_year_full_coverage_percent: percent(full, modelYears.length)
  };
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

async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999);
  if (error) throw new Error(`${table}: ${error.message}`); output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
function nextRequirement(failures) {
  if (failures.includes("body_not_bus")) return "Obtain body-specific evidence; DENSO L300 III Bus evidence cannot be reused for this body.";
  if (failures.includes("series_outside_denso_p0w_p1w_p2w_p3w_pattern")) return "Obtain exact-series evidence matching the current chassis code.";
  if (failures.includes("nexauto_years_outside_denso_1986_2013")) return "Obtain evidence covering every attached NexAuto year or split the application before publication.";
  if (failures.includes("active_sellable_wp1616_missing")) return "Restore or create a complete active sellable 16/16 front pair before counting product coverage.";
  return "Resolve production configuration integrity or publication conflict before fitment publication.";
}
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
  && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function bladeKey(rows) { const map = new Map(rows.map((row) => [row.position, Number(row.length_in)])); return [map.get("driver") ?? "-", map.get("passenger") ?? "-", map.get("rear") ?? "-"].join("/"); }
function bodyKey(value) { const key = String(value ?? "").toLowerCase(); if (/\bbus\b|minibus/.test(key)) return "bus"; if (/panel van|cargo van|\bvan\b/.test(key)) return "van";
  if (/cab.*chassis|chassis.*cab|flatbed/.test(key)) return "cab chassis"; if (/pickup|ute|utility/.test(key)) return "ute"; return key.trim(); }
function queueSort(a, b) { return a.series_code.localeCompare(b.series_code) || a.body_style.localeCompare(b.body_style) || a.application_id.localeCompare(b.application_id); }
function pairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return output; }
function duplicateValues(values) { return Object.entries(countBy(values, (value) => value)).filter(([, count]) => count > 1).map(([value]) => value); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(4)) : 0; }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
function readme(summary) { return `Extended-132 Rank 129 Mitsubishi L300 Wiper Report - 2026-10-25\n\n` +
  `Mode: report-only; production writes: none.\n` +
  `Rule: DENSO L300 III Bus, P0_W/P1_W/P2_W/P3_W, 08/1986-12/2013, 16/16/14.\n` +
  `Only body=bus, strict wildcard series matches, and applications whose complete NexAuto year set is within the source range can enter safe-to-publish.\n\n` +
  `Current rank-129 gap: ${summary.current_gap.applications} applications / ${summary.current_gap.application_years} AY.\n` +
  `Safe: ${summary.queues.safe_to_publish.applications} applications / ${summary.queues.safe_to_publish.application_years} AY.\n` +
  `Blocked: ${summary.queues.blocked.applications} applications / ${summary.queues.blocked.application_years} AY.\n` +
  `Projected Extended-132 knowledge/product uplift: ${summary.projected_uplift.extended132_knowledge_application_years} AY / ${summary.projected_uplift.extended132_knowledge_pp}pp.\n`;
}
