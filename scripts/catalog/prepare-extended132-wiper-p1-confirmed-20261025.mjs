import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const TASKS_FILE = path.join(ROOT, "outputs", "extended132-wiper-ai-minimal-20261025", "tasks.jsonl");
const RESULTS_DIR = path.join(ROOT, "outputs", "extended132-wiper-ai-minimal-20261025", "results");
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-wiper-p1-confirmed-20261025");
const EXTENDED132_AY_DENOMINATOR = 46_676;

if (process.argv.includes("--apply")) throw new Error("This preflight is report-only; --apply is intentionally unsupported.");
loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");

const taskRows = readJsonl(TASKS_FILE);
const taskById = new Map(taskRows.map((row) => [row.task_id, row]));
const resultFiles = fs.readdirSync(RESULTS_DIR).filter((name) => /^p1-.*\.jsonl$/i.test(name)).sort();
const allResults = resultFiles.flatMap((name) => readJsonl(path.join(RESULTS_DIR, name)).map((row) => ({ ...row, result_file: name })));
const confirmedResults = allResults.filter((row) => row.conclusion === "confirmed");
if (confirmedResults.length !== 4) throw new Error(`Expected exactly 4 confirmed P1 results, found ${confirmedResults.length}.`);
if (duplicateValues(confirmedResults.map((row) => row.task_id)).length) throw new Error("Confirmed task IDs are duplicated across P1 result files.");

const confirmed = confirmedResults.map((result) => prepareEvidence(result, taskById.get(result.task_id)));
const allTargetIds = unique(confirmed.flatMap((row) => row.task.application_ids));
if (allTargetIds.length !== confirmed.reduce((sum, row) => sum + row.task.application_ids.length, 0)) {
  throw new Error("An application ID appears in more than one confirmed task.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const production = await readCurrentProduction(db, confirmed, allTargetIds);
const prepared = buildPreflight(confirmed, production);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), prepared.safe);
writeJsonl(path.join(OUTPUT_DIR, "blocked.jsonl"), prepared.blocked);
writeJsonl(path.join(OUTPUT_DIR, "configurations-to-create.jsonl"), prepared.configurationPlans);
fs.writeFileSync(path.join(OUTPUT_DIR, "preflight-summary.json"), `${JSON.stringify(prepared.summary, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "rollback-plan.json"), `${JSON.stringify(prepared.rollbackPlan, null, 2)}\n`);

console.log(JSON.stringify({
  output_dir: OUTPUT_DIR,
  confirmed_tasks: confirmed.length,
  target_applications: allTargetIds.length,
  safe_applications: prepared.safe.length,
  blocked_applications: prepared.blocked.length,
  configurations_to_create: prepared.configurationPlans.length,
  knowledge_uplift_ay: prepared.summary.uplift.knowledge_application_years,
  product_uplift_ay: prepared.summary.uplift.product_application_years
}, null, 2));

function prepareEvidence(result, task) {
  if (!task) throw new Error(`Confirmed result has no source task: ${result.task_id}`);
  const failures = [];
  if (stableTaskId(task) !== task.task_id) failures.push("task_id_hash_mismatch");
  if (!Array.isArray(task.application_ids) || !task.application_ids.length) failures.push("task_application_ids_missing");
  if (duplicateValues(task.application_ids ?? []).length) failures.push("task_application_ids_duplicated");
  if (Number(task.applications) !== (task.application_ids ?? []).length) failures.push("task_application_count_mismatch");
  if (!String(result.source_url ?? "").match(/^https:\/\//i)) failures.push("source_url_missing_or_invalid");
  if (!String(result.source_locator ?? "").trim()) failures.push("source_locator_missing");
  const parsed = parseConfiguration(result.configuration, result.notes);
  failures.push(...parsed.failures);
  const applicable = parseYearRange(result.applicability_years);
  if (!applicable) failures.push("applicability_years_unparseable");
  else if ((task.years ?? []).some((year) => year < applicable.from || year > applicable.to)) failures.push("task_years_outside_confirmed_applicability");
  return { result, task, parsed, applicable, evidence_failures: unique(failures) };
}

function buildPreflight(confirmedRows, data) {
  const applicationById = new Map(data.applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupBy(data.years, (row) => row.application_id);
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const configsByKey = groupBy(data.configurations, (row) => row.configuration_key);
  const configById = new Map(data.configurations.map((row) => [row.id, row]));
  const bladesByConfig = groupBy(data.blades, (row) => row.wiper_configuration_id);
  const fitmentsByApp = groupBy(data.fitments, (row) => row.application_id);
  const sellableByPair = groupBy(data.wiperSets.filter(isSellableFrontPair), (row) => pairKey(row.driver_length_in, row.passenger_length_in));
  const rows = [];
  const taskChecks = [];

  for (const confirmed of confirmedRows) {
    const taskCurrentYears = [];
    const missingFetchedIds = confirmed.task.application_ids.filter((id) => !applicationById.has(id));
    const fetchedIds = confirmed.task.application_ids.filter((id) => applicationById.has(id));
    const idsExactlyRecovered = !missingFetchedIds.length && fetchedIds.length === confirmed.task.application_ids.length;
    for (const applicationId of confirmed.task.application_ids) {
      const failures = [...confirmed.evidence_failures];
      const application = applicationById.get(applicationId);
      const currentYears = unique((yearsByApp.get(applicationId) ?? []).map((row) => Number(row.model_year))
        .filter((year) => year >= 2000 && year <= 2026)).sort((a, b) => a - b);
      taskCurrentYears.push(...currentYears.map((year) => `${applicationId}|${year}`));
      const model = modelById.get(application?.model_id);
      const make = makeById.get(model?.make_id);
      const currentSeries = seriesById.get(application?.series_id);
      const variant = variantById.get(application?.variant_id);
      const identity = {
        make: upper(make?.name), model: upper(model?.name), series: upper(currentSeries?.code),
        body: bodyKey(variant?.body_style ?? variant?.display_name),
        make_status: make?.status ?? null, model_status: model?.status ?? null, series_status: currentSeries?.status ?? null
      };
      if (!application) failures.push("missing_application");
      if (application && application.status !== "active") failures.push("inactive_application");
      if (!currentYears.length) failures.push("missing_application_years");
      if (currentYears.some((year) => !(confirmed.task.years ?? []).includes(year))) failures.push("current_year_outside_task_years");
      if (identity.make !== upper(confirmed.task.make) || !(confirmed.task.models ?? []).map(upper).includes(identity.model)
        || identity.series !== upper(confirmed.task.series_chassis) || identity.body !== bodyKey(confirmed.task.body)) failures.push("vehicle_identity_changed");
      if (identity.make_status && identity.make_status !== "active") failures.push("inactive_make");
      if (identity.model_status && identity.model_status !== "active") failures.push("inactive_model");
      if (identity.series_status && identity.series_status !== "active") failures.push("inactive_series");

      const matchingConfigurations = configsByKey.get(confirmed.parsed.key) ?? [];
      if (matchingConfigurations.length > 1) failures.push("duplicate_configuration_key");
      const configuration = matchingConfigurations[0] ?? null;
      const actualBlades = configuration ? bladeMap(bladesByConfig.get(configuration.id) ?? []) : {};
      if (configuration && bladeKey(actualBlades) !== confirmed.parsed.key) failures.push("configuration_blades_mismatch");
      if (configuration && configuration.rear_status !== confirmed.parsed.rear_status) failures.push("configuration_rear_semantics_mismatch");
      if (configuration && ["rejected", "superseded"].includes(configuration.configuration_status)) failures.push("configuration_not_publishable");

      const published = (fitmentsByApp.get(applicationId) ?? []).filter((row) => row.fitment_status === "published");
      const publishedKeys = published.map((row) => configById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`);
      if (published.length > 1) failures.push("duplicate_published_fitments");
      if (published.length === 1 && publishedKeys[0] !== confirmed.parsed.key) failures.push("different_published_configuration_conflict");
      const alreadyPublished = published.length === 1 && publishedKeys[0] === confirmed.parsed.key;
      const existingRows = fitmentsByApp.get(applicationId) ?? [];
      const sameConfigRow = configuration ? existingRows.find((row) => row.wiper_configuration_id === configuration.id) : null;
      const sellableSets = sellableByPair.get(pairKey(confirmed.parsed.driver, confirmed.parsed.passenger)) ?? [];
      const uniqueFailures = unique(failures);
      const action = uniqueFailures.length ? "blocked" : alreadyPublished ? "already_published"
        : sameConfigRow ? "publish_existing_relation" : "insert_fitment_after_configuration_ready";
      rows.push({
        task_id: confirmed.task.task_id, task_priority: confirmed.task.priority, result_file: confirmed.result.result_file,
        application_id: applicationId, family: confirmed.task.family, expected_identity: {
          make: upper(confirmed.task.make), models: confirmed.task.models.map(upper), series: upper(confirmed.task.series_chassis), body: bodyKey(confirmed.task.body)
        }, current_identity: identity, current_status: application?.status ?? null, current_years: currentYears,
        application_years: currentYears.length, task_application_ids_exactly_recovered: idsExactlyRecovered,
        expected_configuration_key: confirmed.parsed.key, expected_rear_status: confirmed.parsed.rear_status,
        configuration_id: configuration?.id ?? null, configuration_status: configuration?.configuration_status ?? null,
        configuration_rear_status: configuration?.rear_status ?? null,
        current_configuration_blades: actualBlades, current_published_configuration_keys: publishedKeys,
        source_url: confirmed.result.source_url, source_locator: confirmed.result.source_locator,
        sellable_front_pair_skus: sellableSets.map((row) => row.sku).sort(), product_ready: sellableSets.length > 0,
        action, failures: uniqueFailures
      });
    }
    const actualAy = unique(taskCurrentYears).length;
    const aggregateYearsOk = actualAy === Number(confirmed.task.application_years);
    taskChecks.push({ task_id: confirmed.task.task_id, expected_application_ids: confirmed.task.application_ids,
      fetched_application_ids: fetchedIds, ids_exactly_recovered: idsExactlyRecovered,
      expected_application_years: Number(confirmed.task.application_years), current_application_years: actualAy,
      application_years_match: aggregateYearsOk, source_url_present: Boolean(confirmed.result.source_url),
      source_locator_present: Boolean(confirmed.result.source_locator), task_id_hash_valid: stableTaskId(confirmed.task) === confirmed.task.task_id });
    if (!aggregateYearsOk || !idsExactlyRecovered) {
      for (const row of rows.filter((row) => row.task_id === confirmed.task.task_id)) {
        if (!aggregateYearsOk) row.failures = unique([...row.failures, "task_application_year_count_changed"]);
        if (!idsExactlyRecovered) row.failures = unique([...row.failures, "task_application_ids_not_recovered"]);
        row.action = "blocked";
      }
    }
  }

  const safe = rows.filter((row) => row.action !== "blocked");
  const blocked = rows.filter((row) => row.action === "blocked");
  const neededConfigKeys = unique(safe.filter((row) => !row.configuration_id).map((row) => row.expected_configuration_key));
  const configurationPlans = neededConfigKeys.map((key) => {
    const evidence = confirmedRows.find((row) => row.parsed.key === key);
    const targetRows = safe.filter((row) => row.expected_configuration_key === key);
    return {
      configuration_key: key, driver_length_in: evidence.parsed.driver, passenger_length_in: evidence.parsed.passenger,
      rear_length_in: evidence.parsed.rear, rear_status: evidence.parsed.rear_status,
      configuration_status_after_publish: "published",
      blade_rows: [
        { position: "driver", length_in: evidence.parsed.driver },
        { position: "passenger", length_in: evidence.parsed.passenger },
        ...(evidence.parsed.rear === null ? [] : [{ position: "rear", length_in: evidence.parsed.rear }])
      ],
      rear_null_semantics: evidence.parsed.rear === null ? "not_applicable: authoritative application row explicitly lists no rear blade" : "fitted",
      task_ids: unique(targetRows.map((row) => row.task_id)), application_ids: targetRows.map((row) => row.application_id),
      source_urls: unique(targetRows.map((row) => row.source_url)), source_locators: unique(targetRows.map((row) => row.source_locator)),
      report_only: true
    };
  });

  const newKnowledgeRows = safe.filter((row) => row.action !== "already_published");
  const newProductRows = newKnowledgeRows.filter((row) => row.product_ready);
  const existingStatusUpdates = unique(safe.filter((row) => row.configuration_id && row.configuration_status !== "published")
    .map((row) => row.configuration_id)).map((id) => ({ id, previous_status: configById.get(id)?.configuration_status, intended_status: "published" }));
  const generatedAt = new Date().toISOString();
  const rollbackPlan = {
    generated_at: generatedAt, mode: "report-only-plan", production_backup_created: false,
    backup_required_before_apply: true,
    target_application_ids: rows.map((row) => row.application_id),
    target_configuration_keys: unique(rows.map((row) => row.expected_configuration_key)),
    backup_selectors: {
      vehicle_catalog_applications: "application_id IN target_application_ids",
      vehicle_catalog_application_years: "application_id IN target_application_ids",
      vehicle_catalog_wiper_fitments: "application_id IN target_application_ids",
      wiper_configurations: "configuration_key IN target_configuration_keys",
      wiper_configuration_blades: "wiper_configuration_id IN resolved target configuration IDs",
      wiper_sizes: "(position_scope,length_in) IN planned blade sizes",
      wiper_sets: "active sellable front pair matching planned driver/passenger lengths"
    },
    rollback_keys: {
      planned_fitment_inserts: newKnowledgeRows.filter((row) => row.action === "insert_fitment_after_configuration_ready")
        .map((row) => ({ application_id: row.application_id, configuration_key: row.expected_configuration_key })),
      planned_existing_relation_updates: newKnowledgeRows.filter((row) => row.action === "publish_existing_relation")
        .map((row) => ({ application_id: row.application_id, configuration_id: row.configuration_id })),
      planned_configuration_creates: configurationPlans.map((row) => ({ configuration_key: row.configuration_key })),
      planned_configuration_status_updates: existingStatusUpdates
    },
    required_apply_sequence: [
      "Save the selected rows and task/result file hashes before any mutation.",
      "Create missing sizes/configurations/blades in one transaction while preserving rear_status semantics.",
      "Insert or publish only the listed application/configuration relations; never demote a conflicting published row.",
      "Read back every target and require one intended published configuration per application.",
      "On rollback, delete only created fitment keys and configuration keys, restore updated relation/status rows from backup, then read back all targets."
    ]
  };
  const summary = {
    generated_at: generatedAt, mode: "report-only", production_writes: false,
    inputs: {
      tasks: fileIdentity(TASKS_FILE),
      result_files: resultFiles.map((name) => fileIdentity(path.join(RESULTS_DIR, name))),
      p1_results_total: allResults.length, confirmed_results: confirmedRows.length
    },
    current_production_read: true,
    denominator: { extended132_application_years: EXTENDED132_AY_DENOMINATOR },
    targets: { tasks: confirmedRows.length, applications: rows.length, application_years: rows.reduce((sum, row) => sum + row.application_years, 0) },
    preflight: {
      safe_applications: safe.length, blocked_applications: blocked.length,
      safe_application_years: safe.reduce((sum, row) => sum + row.application_years, 0),
      blocked_application_years: blocked.reduce((sum, row) => sum + row.application_years, 0),
      actions: countBy(rows, (row) => row.action), blocker_reasons: countBy(blocked.flatMap((row) => row.failures), (value) => value),
      task_checks: taskChecks
    },
    configurations: {
      distinct_keys: unique(rows.map((row) => row.expected_configuration_key)).length,
      existing_valid_for_safe_rows: unique(safe.map((row) => row.configuration_id).filter(Boolean)).length,
      to_create: configurationPlans.length,
      existing_status_updates_planned: existingStatusUpdates.length,
      blade_rows_to_create: configurationPlans.reduce((sum, row) => sum + row.blade_rows.length, 0)
    },
    sellable_front_pairs: Object.fromEntries(unique(rows.map((row) => row.expected_configuration_key)).map((key) => {
      const matching = rows.filter((row) => row.expected_configuration_key === key);
      return [key, unique(matching.flatMap((row) => row.sellable_front_pair_skus))];
    })),
    uplift: {
      knowledge_applications: newKnowledgeRows.length,
      knowledge_application_years: newKnowledgeRows.reduce((sum, row) => sum + row.application_years, 0),
      knowledge_pp: percent(newKnowledgeRows.reduce((sum, row) => sum + row.application_years, 0), EXTENDED132_AY_DENOMINATOR),
      product_applications: newProductRows.length,
      product_application_years: newProductRows.reduce((sum, row) => sum + row.application_years, 0),
      product_pp: percent(newProductRows.reduce((sum, row) => sum + row.application_years, 0), EXTENDED132_AY_DENOMINATOR)
    },
    expected_future_writes_if_separately_approved: {
      fitment_rows: newKnowledgeRows.length, configuration_rows: configurationPlans.length,
      configuration_blade_rows: configurationPlans.reduce((sum, row) => sum + row.blade_rows.length, 0),
      existing_configuration_status_rows: existingStatusUpdates.length
    }
  };
  return { safe, blocked, configurationPlans, rollbackPlan, summary };
}

async function readCurrentProduction(db, confirmedRows, applicationIds) {
  const configurationKeys = unique(confirmedRows.map((row) => row.parsed.key));
  const [applications, years, fitments, configurations, wiperSets, makes, models, series, variants] = await Promise.all([
    selectInChunks(db, "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status,year_from,year_to", "application_id", applicationIds),
    selectInChunks(db, "vehicle_catalog_application_years", "application_id,model_year", "application_id", applicationIds),
    selectInChunks(db, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes,created_at,updated_at", "application_id", applicationIds),
    selectInChunks(db, "wiper_configurations", "id,configuration_key,configuration_status,rear_status,name,notes,created_at,updated_at", "configuration_key", configurationKeys),
    fetchAll(db, "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"),
    fetchAll(db, "vehicle_catalog_makes", "make_id,name,status"),
    fetchAll(db, "vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll(db, "vehicle_catalog_series", "series_id,model_id,code,display_name,status"),
    fetchAll(db, "vehicle_catalog_variants", "variant_id,display_name,body_style")
  ]);
  const referencedConfigurationIds = unique(fitments.map((row) => row.wiper_configuration_id));
  const missingReferencedIds = referencedConfigurationIds.filter((id) => !configurations.some((row) => row.id === id));
  if (missingReferencedIds.length) configurations.push(...await selectInChunks(db, "wiper_configurations",
    "id,configuration_key,configuration_status,rear_status,name,notes,created_at,updated_at", "id", missingReferencedIds));
  const blades = await selectInChunks(db, "wiper_configuration_blades", "wiper_configuration_id,position,length_in,connector_type", "wiper_configuration_id", configurations.map((row) => row.id));
  return { applications, years, fitments, configurations, blades, wiperSets, makes, models, series, variants };
}

function parseConfiguration(value, notes) {
  const failures = [];
  const cleaned = String(value ?? "").toLowerCase().replace(/inches?|inch|\"/g, "").replace(/\s+/g, "").trim();
  const parts = cleaned.split("/");
  if (parts.length !== 3) return { key: null, driver: null, passenger: null, rear: null, rear_status: null, failures: ["configuration_unparseable"] };
  const parsed = parts.map((part) => part === "-" || part === "null" ? null : Number(part));
  if (!Number.isInteger(parsed[0]) || !Number.isInteger(parsed[1]) || parsed.some((number) => number !== null && (!Number.isInteger(number) || number < 5 || number > 40))) failures.push("configuration_unparseable");
  const explicitNoRear = /no rear blade|not an unknown rear|lists no rear|rear.*not_applicable/i.test(String(notes ?? ""));
  if (parsed[2] === null && !explicitNoRear) failures.push("rear_null_semantics_not_explicit");
  const key = parsed.map((number) => number === null ? "-" : String(number)).join("/");
  return { key, driver: parsed[0], passenger: parsed[1], rear: parsed[2], rear_status: parsed[2] === null ? "not_applicable" : "fitted", failures };
}

function parseYearRange(value) {
  const years = String(value ?? "").match(/(?:19|20)\d{2}/g)?.map(Number) ?? [];
  return years.length >= 2 ? { from: Math.min(...years), to: Math.max(...years) } : null;
}

function stableTaskId(row) {
  return `EXT132-WIPER-AI-${crypto.createHash("sha256").update([
    row.make, row.family, row.series_chassis, row.body, (row.candidate_set ?? []).join("/"), (row.application_ids ?? []).join("/")
  ].join("|")).digest("hex").slice(0, 12)}`;
}

function bladeMap(rows) { return Object.fromEntries(rows.map((row) => [row.position, Number(row.length_in)])); }
function bladeKey(map) { return [map.driver ?? "-", map.passenger ?? "-", map.rear ?? "-"].join("/"); }
function isSellableFrontPair(row) {
  return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
    && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true
    && Number.isFinite(Number(row.driver_length_in)) && Number.isFinite(Number(row.passenger_length_in));
}
function pairKey(left, right) { return [Number(left), Number(right)].sort((a, b) => b - a).join("/"); }
function bodyKey(value) {
  const key = String(value ?? "").toLowerCase().trim();
  if (/cab.*chassis|chassis.*cab|flatbed/.test(key)) return "cab chassis";
  if (/hatch|liftback/.test(key)) return "hatchback";
  if (/wagon|estate/.test(key)) return "wagon";
  if (/sport utility|\bsuv\b/.test(key)) return "suv";
  if (/sedan|saloon/.test(key)) return "sedan";
  if (/minivan|\bmpv\b/.test(key)) return "mpv";
  if (/\bbus\b|minibus/.test(key)) return "bus";
  if (/panel van|cargo van|\bvan\b/.test(key)) return "van";
  if (/ute|utility|pickup/.test(key)) return "ute";
  if (/coupe/.test(key)) return "coupe";
  if (/convertible|cabrio|roadster/.test(key)) return "convertible";
  return key;
}

async function selectInChunks(db, table, columns, column, values) {
  const output = [];
  for (const part of chunks(unique(values), 200)) {
    if (!part.length) continue;
    const { data, error } = await db.from(table).select(columns).in(column, part);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
  }
  return output;
}
async function fetchAll(db, table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}

function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; }
function chunks(values, size) { const output = []; for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size)); return output; }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return output; }
function duplicateValues(values) { return Object.entries(countBy(values, (value) => value)).filter(([, count]) => count > 1).map(([value]) => value); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function percent(numerator, denominator) { return Math.round((numerator / denominator * 100 + Number.EPSILON) * 10_000) / 10_000; }
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
