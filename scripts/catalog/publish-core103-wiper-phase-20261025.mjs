import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(ROOT, "outputs", "core103-wiper-phase-20261025", "ready-to-publish.jsonl");
const WIPERTECH_FILE = path.resolve(ROOT, "outputs", "wipertech-enrichment-20261022", "wipertech_enriched_data.json");
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "core103-wiper-publish-20261025");
const SOURCE_CODE = "CORE103_WIPER_PHASE_20261025";
const APPLY = process.argv.includes("--apply");
if (APPLY && process.argv.includes("--report-only")) throw new Error("Choose --apply or --report-only, not both.");

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (!fs.existsSync(INPUT_FILE)) throw new Error(`Missing ready input: ${INPUT_FILE}`);
if (!fs.existsSync(WIPERTECH_FILE)) throw new Error(`Missing WiperTech snapshot: ${WIPERTECH_FILE}`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const readyRows = readJsonl(INPUT_FILE);
const targets = flattenTargets(readyRows);
const sourceIdentity = fileIdentity(INPUT_FILE);
const wiperTechIdentity = fileIdentity(WIPERTECH_FILE);
const rawSourceByVehicleId = loadRawSourceByVehicleId(WIPERTECH_FILE);
const snapshot = await loadCurrentProduction(targets);
const prepared = preparePreflight(targets, readyRows, snapshot, rawSourceByVehicleId);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(prepared.report, null, 2)}\n`);
writeJsonl(path.join(OUTPUT_DIR, "preflight-by-application.jsonl"), prepared.preflight);
fs.writeFileSync(path.join(OUTPUT_DIR, "backup-plan.json"), `${JSON.stringify(prepared.backupPlan, null, 2)}\n`);

if (APPLY) {
  if (prepared.blockers.length) throw new Error(`Apply blocked by ${prepared.blockers.length} preflight blocker(s).`);
  const applied = await applyPrepared(prepared, snapshot);
  fs.writeFileSync(path.join(OUTPUT_DIR, "applied.json"), `${JSON.stringify(applied, null, 2)}\n`);
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "report-only",
  outputDir: OUTPUT_DIR,
  readyForApply: prepared.blockers.length === 0,
  blockers: prepared.blockers.length,
  targets: prepared.report.totals.targetApplications,
  applicationYears: prepared.report.totals.targetApplicationYears,
  expectedFitmentWrites: prepared.report.expectedWrites.fitmentRows,
  expectedConfigurationStatusWrites: prepared.report.expectedWrites.configurationStatusRows,
}, null, 2));

function preparePreflight(targetRows, aggregateRows, data, rawByVehicleId) {
  const duplicateInputIds = duplicateValues(targetRows.map((row) => row.applicationId));
  const applicationById = new Map(data.applications.map((row) => [row.application_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const configurationsByKey = groupBy(data.configurations, (row) => row.configuration_key);
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const bladesByConfiguration = groupBy(data.blades, (row) => row.wiper_configuration_id);
  const targetFitmentsByApplication = groupBy(data.targetFitments, (row) => row.application_id);
  const publishedByApplication = groupBy(data.allPublishedFitments, (row) => row.application_id);
  const sellableSetsByPair = groupBy(data.wiperSets.filter(isSellableFrontPair), (row) => pairKey(row.driver_length_in, row.passenger_length_in));
  const globalDuplicatePublished = [...publishedByApplication.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([applicationId, rows]) => ({ applicationId, count: rows.length, configurationIds: rows.map((row) => row.wiper_configuration_id) }));
  const blockers = [];
  if (duplicateInputIds.length) blockers.push({ reason: "duplicate_target_application_ids", applicationIds: duplicateInputIds });
  if (globalDuplicatePublished.length) blockers.push({ reason: "global_duplicate_published_fitments", applications: globalDuplicatePublished });

  const sourceAuditByAggregate = new Map();
  for (const row of aggregateRows) {
    const sourceChecks = row.source_vehicle_ids.map((vehicleId) => {
      const raw = rawByVehicleId.get(String(vehicleId));
      const actualConfiguration = raw ? rawConfiguration(raw) : null;
      return {
        vehicleId: String(vehicleId),
        exists: Boolean(raw),
        expectedConfiguration: row.configuration_key,
        actualConfiguration,
        ok: Boolean(raw) && actualConfiguration === row.configuration_key,
      };
    });
    sourceAuditByAggregate.set(rowKey(row), sourceChecks);
    for (const check of sourceChecks) if (!check.ok) blockers.push({ reason: "wipertech_source_validation_failed", family: row.family, series: row.series_code, body: row.body_style, ...check });
  }

  const preflight = [];
  for (const target of targetRows) {
    const failures = [];
    const application = applicationById.get(target.applicationId);
    const currentYears = uniqueNumbers((yearsByApplication.get(target.applicationId) ?? []).map((row) => row.model_year)).sort((a, b) => a - b);
    const model = modelById.get(application?.model_id);
    const make = makeById.get(model?.make_id);
    const itemSeries = seriesById.get(application?.series_id);
    const variant = variantById.get(application?.variant_id);
    const currentIdentity = {
      make: upper(make?.name), model: upper(model?.name), series: upper(itemSeries?.code), body: bodyKey(variant?.body_style ?? variant?.display_name),
    };
    if (!application) failures.push("missing_application");
    if (application && application.status !== "active") failures.push("inactive_application");
    if (!currentYears.length) failures.push("missing_application_years");
    if (currentYears.some((year) => !target.aggregateYears.includes(year))) failures.push("current_year_outside_ready_evidence");
    if (currentIdentity.make !== target.make || currentIdentity.model !== target.model || currentIdentity.series !== target.seriesCode || currentIdentity.body !== target.bodyStyle) failures.push("vehicle_identity_changed");

    const matchingConfigurations = configurationsByKey.get(target.configurationKey) ?? [];
    if (matchingConfigurations.length !== 1) failures.push(matchingConfigurations.length ? "duplicate_configuration_key" : "missing_configuration");
    const configuration = matchingConfigurations[0];
    const bladeConfiguration = configuration ? configurationKeyFromBlades(bladesByConfiguration.get(configuration.id) ?? []) : null;
    if (configuration && bladeConfiguration !== target.configurationKey) failures.push("configuration_blades_mismatch");
    const [driver, passenger] = target.configurationKey.split("/");
    if (!driver || !passenger || driver === "-" || passenger === "-") failures.push("front_pair_is_partial");
    const sellableSets = sellableSetsByPair.get(pairKey(driver, passenger)) ?? [];
    if (!sellableSets.length) failures.push("sellable_front_pair_missing");

    const published = publishedByApplication.get(target.applicationId) ?? [];
    const publishedKeys = published.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`);
    if (published.length > 1) failures.push("duplicate_published_fitments");
    if (published.length === 1 && publishedKeys[0] !== target.configurationKey) failures.push("published_configuration_conflict");
    const alreadyPublished = published.length === 1 && publishedKeys[0] === target.configurationKey;
    const existingTargetRows = targetFitmentsByApplication.get(target.applicationId) ?? [];
    const sameConfigurationRow = configuration ? existingTargetRows.find((row) => row.wiper_configuration_id === configuration.id) : null;
    const sourceChecks = sourceAuditByAggregate.get(target.aggregateKey) ?? [];
    if (sourceChecks.some((row) => !row.ok)) failures.push("wipertech_source_validation_failed");
    const action = failures.length ? "blocked" : alreadyPublished ? "already_published" : sameConfigurationRow ? "update_existing_fitment" : "insert_fitment";

    const result = {
      application_id: target.applicationId,
      family: target.family,
      make: target.make,
      model: target.model,
      series_code: target.seriesCode,
      body_style: target.bodyStyle,
      current_identity: currentIdentity,
      current_status: application?.status ?? null,
      current_years: currentYears,
      application_years: currentYears.length,
      expected_configuration_key: target.configurationKey,
      configuration_id: configuration?.id ?? null,
      configuration_status: configuration?.configuration_status ?? null,
      configuration_blades_key: bladeConfiguration,
      sellable_front_pair_skus: sellableSets.map((row) => row.sku).sort(),
      current_published_configuration_keys: publishedKeys,
      current_target_fitment_rows: existingTargetRows.length,
      source_vehicle_ids: target.sourceVehicleIds,
      source_validation_ok: sourceChecks.length > 0 && sourceChecks.every((row) => row.ok),
      action,
      failures: uniqueStrings(failures),
    };
    preflight.push(result);
    for (const reason of result.failures) blockers.push({ reason, applicationId: target.applicationId });
  }

  for (const aggregate of aggregateRows) {
    const rows = preflight.filter((row) => aggregate.application_ids.includes(row.application_id));
    const actualApplicationYears = rows.reduce((sum, row) => sum + row.application_years, 0);
    if (actualApplicationYears !== aggregate.application_years) blockers.push({
      reason: "aggregate_application_year_count_changed", family: aggregate.family, series: aggregate.series_code,
      expected: aggregate.application_years, actual: actualApplicationYears,
    });
  }

  const actionable = preflight.filter((row) => ["insert_fitment", "update_existing_fitment"].includes(row.action));
  const targetConfigurationIds = uniqueStrings(preflight.map((row) => row.configuration_id));
  const configurationStatusWrites = data.configurations.filter((row) => targetConfigurationIds.includes(row.id) && row.configuration_status !== "published");
  const rollbackKeys = {
    inserted_fitment_keys: actionable.filter((row) => row.action === "insert_fitment").map((row) => ({ application_id: row.application_id, wiper_configuration_id: row.configuration_id })),
    updated_fitment_keys: actionable.filter((row) => row.action === "update_existing_fitment").map((row) => ({ application_id: row.application_id, wiper_configuration_id: row.configuration_id })),
    configuration_status_keys: configurationStatusWrites.map((row) => ({ id: row.id, previous_configuration_status: row.configuration_status })),
  };
  const backupPlan = {
    generatedAt: new Date().toISOString(),
    applyBackupDirectoryTemplate: "tmp/production-backups/core103-wiper-publish-<ISO timestamp>",
    targetApplicationIds: uniqueStrings(targetRows.map((row) => row.applicationId)),
    targetConfigurationIds,
    tables: {
      vehicle_catalog_applications: { selector: "application_id IN targetApplicationIds", rows: data.applications.length },
      vehicle_catalog_application_years: { selector: "application_id IN targetApplicationIds", rows: data.years.length },
      vehicle_catalog_wiper_fitments: { selector: "application_id IN targetApplicationIds", rows: data.targetFitments.length, written: true },
      wiper_configurations: { selector: "id IN targetConfigurationIds", rows: data.configurations.filter((row) => targetConfigurationIds.includes(row.id)).length, written: configurationStatusWrites.length > 0 },
      wiper_configuration_blades: { selector: "wiper_configuration_id IN targetConfigurationIds", rows: data.blades.filter((row) => targetConfigurationIds.includes(row.wiper_configuration_id)).length },
      wiper_sets: { selector: "matching sellable front pairs", rows: data.wiperSets.filter((row) => isSellableFrontPair(row) && targetRows.some((target) => configurationPairKey(target.configurationKey) === pairKey(row.driver_length_in, row.passenger_length_in))).length },
    },
    rollbackKeys,
    rollbackProcedure: [
      "Delete only inserted vehicle_catalog_wiper_fitments keys listed in inserted_fitment_keys.",
      "Restore updated fitment rows from the target backup file by application_id,wiper_configuration_id.",
      "Restore changed wiper_configurations.configuration_status values by id.",
      "Read every target application back and require its pre-backup published set to match exactly.",
    ],
  };
  const report = {
    generatedAt: backupPlan.generatedAt,
    mode: APPLY ? "apply" : "report-only",
    sourceCode: SOURCE_CODE,
    input: sourceIdentity,
    wipertechSnapshot: wiperTechIdentity,
    productionWritesPerformed: false,
    totals: {
      aggregateRows: aggregateRows.length,
      targetApplications: preflight.length,
      targetApplicationYears: preflight.reduce((sum, row) => sum + row.application_years, 0),
      sourceVehicleIds: uniqueStrings(targetRows.flatMap((row) => row.sourceVehicleIds)).length,
      configurations: targetConfigurationIds.length,
      sellableFrontPairs: uniqueStrings(targetRows.map((row) => configurationPairKey(row.configurationKey))).length,
    },
    preflight: {
      readyForApply: blockers.length === 0,
      blockers: blockers.length,
      blockerReasons: countBy(blockers, (row) => row.reason),
      actions: countBy(preflight, (row) => row.action),
      globalDuplicatePublishedApplications: globalDuplicatePublished.length,
      inputDuplicateApplicationIds: duplicateInputIds.length,
      sourceRowsValidated: [...sourceAuditByAggregate.values()].flat().length,
      sourceRowsInvalid: [...sourceAuditByAggregate.values()].flat().filter((row) => !row.ok).length,
    },
    expectedWrites: {
      fitmentRows: actionable.length,
      fitmentInserts: actionable.filter((row) => row.action === "insert_fitment").length,
      fitmentUpdates: actionable.filter((row) => row.action === "update_existing_fitment").length,
      configurationStatusRows: configurationStatusWrites.length,
      applicationYears: actionable.reduce((sum, row) => sum + row.application_years, 0),
    },
    rollbackKeys,
    blockers,
  };
  return { report, backupPlan, preflight, blockers, actionable, configurationStatusWrites, targetConfigurationIds };
}

async function applyPrepared(prepared, data) {
  const backupDir = writeBackup(prepared, data);
  const timestamp = new Date().toISOString();
  for (const row of prepared.configurationStatusWrites) {
    const { error } = await db.from("wiper_configurations").update({ configuration_status: "published", updated_at: timestamp }).eq("id", row.id);
    if (error) throw error;
  }
  const payload = prepared.actionable.map((row) => ({
    application_id: row.application_id,
    wiper_configuration_id: row.configuration_id,
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: `family=${row.family}; exact series=${row.series_code}; body=${row.body_style}; WiperTech vehicle IDs=${row.source_vehicle_ids.join(",")}; ready input sha256=${sourceIdentity.sha256}`,
    updated_at: timestamp,
  }));
  for (const rows of chunks(payload, 200)) {
    const { error } = await db.from("vehicle_catalog_wiper_fitments").upsert(rows, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
  const verification = await verifyApplied(prepared.preflight);
  return { appliedAt: timestamp, sourceCode: SOURCE_CODE, backupDir, writes: prepared.report.expectedWrites, verification };
}

function writeBackup(prepared, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp", "production-backups", `core103-wiper-publish-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const configurationIds = new Set(prepared.targetConfigurationIds);
  const files = {
    "manifest.json": { createdAt: new Date().toISOString(), sourceCode: SOURCE_CODE, input: sourceIdentity, backupPlan: prepared.backupPlan },
    "vehicle_catalog_applications.json": data.applications,
    "vehicle_catalog_application_years.json": data.years,
    "vehicle_catalog_wiper_fitments.json": data.targetFitments,
    "wiper_configurations.json": data.configurations.filter((row) => configurationIds.has(row.id)),
    "wiper_configuration_blades.json": data.blades.filter((row) => configurationIds.has(row.wiper_configuration_id)),
    "wiper_sets.json": data.wiperSets.filter(isSellableFrontPair),
  };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  fs.copyFileSync(INPUT_FILE, path.join(directory, "ready-to-publish.jsonl"));
  return directory;
}

async function verifyApplied(preflight) {
  const applicationIds = preflight.map((row) => row.application_id);
  const rows = await selectInChunks("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", "application_id", applicationIds);
  const configurations = await fetchAll("wiper_configurations", "id,configuration_key,configuration_status");
  const configurationById = new Map(configurations.map((row) => [row.id, row]));
  const publishedByApplication = groupBy(rows.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const failures = [];
  for (const expected of preflight) {
    const published = publishedByApplication.get(expected.application_id) ?? [];
    const keys = published.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key);
    if (published.length !== 1 || keys[0] !== expected.expected_configuration_key) failures.push({ applicationId: expected.application_id, expected: expected.expected_configuration_key, actual: keys });
  }
  const allPublished = await fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status", (query) => query.eq("fitment_status", "published"));
  const duplicates = [...groupBy(allPublished, (row) => row.application_id).entries()].filter(([, values]) => values.length > 1).map(([applicationId, values]) => ({ applicationId, count: values.length }));
  if (failures.length || duplicates.length) throw new Error(`Post-apply verification failed: targets=${failures.length}, duplicates=${duplicates.length}`);
  return { ok: true, targetsVerified: preflight.length, targetFailures: [], duplicatePublishedApplications: [] };
}

async function loadCurrentProduction(targetRows) {
  const applicationIds = uniqueStrings(targetRows.map((row) => row.applicationId));
  const configurationKeys = uniqueStrings(targetRows.map((row) => row.configurationKey));
  const [applications, years, targetFitments, allPublishedFitments, configurations, wiperSets, makes, models, series, variants] = await Promise.all([
    selectInChunks("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status,year_from,year_to", "application_id", applicationIds),
    selectInChunks("vehicle_catalog_application_years", "application_id,model_year", "application_id", applicationIds),
    selectInChunks("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes,created_at,updated_at", "application_id", applicationIds),
    fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status", (query) => query.eq("fitment_status", "published")),
    selectInChunks("wiper_configurations", "id,configuration_key,configuration_status,rear_status,name,notes,created_at,updated_at", "configuration_key", configurationKeys),
    fetchAll("wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"),
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,model_id,code,display_name,status"),
    fetchAll("vehicle_catalog_variants", "variant_id,display_name,body_style"),
  ]);
  const configurationIds = configurations.map((row) => row.id);
  const blades = await selectInChunks("wiper_configuration_blades", "wiper_configuration_id,position,length_in", "wiper_configuration_id", configurationIds);
  return { applications, years, targetFitments, allPublishedFitments, configurations, blades, wiperSets, makes, models, series, variants };
}

function flattenTargets(rows) {
  return rows.flatMap((row) => row.application_ids.map((applicationId) => ({
    applicationId,
    aggregateKey: rowKey(row),
    family: row.family,
    make: upper(row.make),
    model: upper(row.model),
    seriesCode: upper(row.series_code),
    bodyStyle: bodyKey(row.body_style),
    aggregateYears: uniqueNumbers(row.years),
    aggregateApplicationYears: Number(row.application_years),
    configurationKey: row.configuration_key,
    sourceVehicleIds: uniqueStrings(row.source_vehicle_ids),
    matcherRules: row.matcher_rules,
    reason: row.reason,
  })));
}

function loadRawSourceByVehicleId(file) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8")).sourceRows ?? [];
  return new Map(rows.map((row) => [String(row.vehicle_id), row]));
}

function rawConfiguration(row) {
  const value = (position) => row[`${position}_in`] === "" || row[`${position}_in`] === null || row[`${position}_in`] === undefined ? "-" : String(Number(row[`${position}_in`]));
  return `${value("driver")}/${value("passenger")}/${value("rear")}`;
}

function configurationKeyFromBlades(rows) {
  const byPosition = new Map(rows.map((row) => [row.position, row.length_in]));
  const value = (position) => byPosition.has(position) ? String(Number(byPosition.get(position))) : "-";
  return `${value("driver")}/${value("passenger")}/${value("rear")}`;
}

function configurationPairKey(configurationKey) {
  const [driver, passenger] = String(configurationKey).split("/");
  return pairKey(driver, passenger);
}

function isSellableFrontPair(row) {
  return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
    && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true
    && Number.isFinite(Number(row.driver_length_in)) && Number.isFinite(Number(row.passenger_length_in));
}

async function selectInChunks(table, columns, column, values) {
  if (!values.length) return [];
  const output = [];
  for (const part of chunks(values, 200)) {
    const { data, error } = await db.from(table).select(columns).in(column, part);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
  }
  return output;
}

async function fetchAll(table, columns, alter = null) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select(columns).range(from, from + 999);
    if (alter) query = alter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}

function rowKey(row) { return [row.family_id, row.make, row.model, row.series_code, row.body_style, row.configuration_key].join("|"); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const value = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: value.length, sha256: crypto.createHash("sha256").update(value).digest("hex") }; }
function chunks(values, size) { const output = []; for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size)); return output; }
function duplicateValues(values) { const counts = countBy(values, (value) => value); return Object.entries(counts).filter(([, count]) => count > 1).map(([value]) => value); }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return output; }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function uniqueNumbers(values) { return [...new Set(values.map(Number).filter(Number.isFinite))].sort((a, b) => a - b); }
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
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
