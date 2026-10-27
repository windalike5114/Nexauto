import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const PROFILE = process.env.NEXAUTO_WIPER_PUBLISH_PROFILE ?? "p1_safe6";
const L300_MODEL_BATCH = PROFILE === "l300_model21";
const CARAVAN_MODEL_BATCH = PROFILE === "caravan_e26_front9";
const MODEL_BATCH = L300_MODEL_BATCH || CARAVAN_MODEL_BATCH;
if (!MODEL_BATCH && PROFILE !== "p1_safe6") throw new Error(`Unknown publish profile: ${PROFILE}`);
const INPUT_FILE = CARAVAN_MODEL_BATCH
  ? path.join(ROOT, "outputs", "extended132-model-caravan-nv350-front-only-20261025", "safe-to-publish.jsonl")
  : L300_MODEL_BATCH
    ? path.join(ROOT, "outputs", "extended132-model-l300-wiper-20261025", "safe-to-publish.jsonl")
    : path.join(ROOT, "outputs", "extended132-wiper-p1-confirmed-20261025", "safe-to-publish.jsonl");
const BLOCKED_FILE = CARAVAN_MODEL_BATCH
  ? path.join(ROOT, "outputs", "extended132-model-caravan-nv350-front-only-20261025", "remaining-blocked.jsonl")
  : L300_MODEL_BATCH
    ? path.join(ROOT, "outputs", "extended132-model-l300-wiper-20261025", "blocked.jsonl")
    : path.join(ROOT, "outputs", "extended132-wiper-p1-confirmed-20261025", "blocked.jsonl");
const OUTPUT_DIR = CARAVAN_MODEL_BATCH
  ? path.join(ROOT, "outputs", "extended132-model-caravan-nv350-front-only-publish-20261025")
  : L300_MODEL_BATCH
    ? path.join(ROOT, "outputs", "extended132-model-l300-wiper-publish-20261025")
    : path.join(ROOT, "outputs", "extended132-wiper-p1-safe-20261025");
const SOURCE_CODE = CARAVAN_MODEL_BATCH ? "EXT132_NISSAN_E26_FRONT_ONLY_WIPERTECH_20261025"
  : L300_MODEL_BATCH ? "EXT132_MODEL_L300_DENSO_20261025" : "EXT132_WIPER_P1_CONFIRMED_20261025";
const EXPECTED_TARGETS = CARAVAN_MODEL_BATCH ? 9 : L300_MODEL_BATCH ? 21 : 6;
const EXPECTED_APPLICATION_YEARS = CARAVAN_MODEL_BATCH ? 135 : L300_MODEL_BATCH ? 117 : 48;
const CONFIGURATION = CARAVAN_MODEL_BATCH
  ? { key: "17/17/-", driver: 17, passenger: 17, rear: null, rearStatus: "unknown" }
  : { key: "16/16/14", driver: 16, passenger: 16, rear: 14, rearStatus: "fitted" };
const BACKUP_PREFIX = CARAVAN_MODEL_BATCH ? "extended132-model-caravan-nv350-front-only-wiper"
  : MODEL_BATCH ? "extended132-model-l300-wiper" : "extended132-wiper-p1-safe";
const SOURCE_NOTE = CARAVAN_MODEL_BATCH
  ? "Confirmed WiperTech E26/NV350 platform front pair 17/17; rear deliberately unknown because Bus rear evidence is absent"
  : "Confirmed DENSO L300 III Bus P0_W/P1_W/P2_W/P3_W";
const PERIOD = { from: 2000, to: 2026 };
const EXTENDED132_AY_DENOMINATOR = 46_676;
const APPLY = process.argv.includes("--apply");

loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
const targets = loadAndValidateInput();
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const snapshot = await readProduction(db, targets.map((row) => row.application_id));
const prepared = preparePreflight(targets, snapshot);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeReportFiles(prepared);

let applied = null;
if (APPLY) {
  if (prepared.blockers.length) throw new Error(`Apply blocked by ${prepared.blockers.length} preflight blocker(s).`);
  const backupDirectory = writePreimageBackup(prepared, snapshot);
  applied = await applyPublication(db, prepared, backupDirectory);
  fs.writeFileSync(path.join(OUTPUT_DIR, "applied.json"), `${JSON.stringify(applied, null, 2)}\n`);
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "report-only", output_dir: OUTPUT_DIR,
  target_applications: targets.length, target_application_years: prepared.report.targets.application_years,
  ready_for_apply: prepared.blockers.length === 0, blockers: prepared.blockers.length,
  expected_fitment_writes: prepared.report.expected_writes.fitment_rows,
  expected_configuration_creates: prepared.report.expected_writes.configuration_rows,
  expected_size_creates: prepared.report.expected_writes.wiper_size_rows,
  knowledge_uplift_ay: prepared.report.coverage.expected_knowledge_uplift_application_years,
  product_uplift_ay: prepared.report.coverage.expected_product_uplift_application_years,
  production_writes_performed: Boolean(applied)
}, null, 2));

function loadAndValidateInput() {
  const rawRows = readJsonl(INPUT_FILE);
  const rows = rawRows.map((row) => MODEL_BATCH ? {
    application_id: row.application_id,
    task_id: (row.source_task_ids ?? []).join(","),
    expected_identity: { make: row.make, models: [row.model], series: row.series_code, body: row.body_style },
    current_years: row.years_2000_2026,
    all_nexauto_years: row.all_nexauto_years,
    expected_configuration_key: row.expected_configuration_key,
    expected_rear_status: row.expected_rear_status,
    source_url: row.source_url,
    source_locator: row.source_locator,
    failures: row.failures ?? []
  } : row);
  const blockedIds = new Set(readJsonl(BLOCKED_FILE).map((row) => row.application_id));
  if (rows.length !== EXPECTED_TARGETS) throw new Error(`Expected exactly ${EXPECTED_TARGETS} safe rows, found ${rows.length}.`);
  if (duplicateValues(rows.map((row) => row.application_id)).length) throw new Error("Safe input contains duplicate application IDs.");
  for (const row of rows) {
    if (blockedIds.has(row.application_id)) throw new Error(`Blocked application leaked into safe input: ${row.application_id}`);
    if (!targetIdentityAllowed(row.expected_identity)) {
      throw new Error(`Out-of-scope identity in safe input: ${row.application_id}`);
    }
    if (L300_MODEL_BATCH && (row.all_nexauto_years ?? []).some((year) => year < 1986 || year > 2013)) {
      throw new Error(`Out-of-source-range year in model batch: ${row.application_id}`);
    }
    if (CARAVAN_MODEL_BATCH && (!arraysEqual(row.all_nexauto_years ?? [], row.current_years ?? [])
      || (row.all_nexauto_years ?? []).some((year) => year < 2012 || year > 2026))) {
      throw new Error(`Out-of-source-range E26 year in model batch: ${row.application_id}`);
    }
    if (row.expected_configuration_key !== CONFIGURATION.key || row.expected_rear_status !== CONFIGURATION.rearStatus) {
      throw new Error(`Unexpected configuration in safe input: ${row.application_id}`);
    }
    if (row.failures?.length || !row.source_url || !row.source_locator) throw new Error(`Invalid safe evidence row: ${row.application_id}`);
  }
  return rows.sort((a, b) => a.application_id.localeCompare(b.application_id));
}

function preparePreflight(targetRows, data) {
  const blockers = [];
  const applicationById = new Map(data.applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupBy(data.years, (row) => row.application_id);
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const configById = new Map(data.configurations.map((row) => [row.id, row]));
  const configRows = data.configurations.filter((row) => row.configuration_key === CONFIGURATION.key);
  const configuration = configRows[0] ?? null;
  const blades = configuration ? data.blades.filter((row) => row.wiper_configuration_id === configuration.id) : [];
  const actualBladeKey = bladeKey(blades);
  const fitmentsByApp = groupBy(data.targetFitments, (row) => row.application_id);
  const sellableSets = data.wiperSets.filter((row) => isSellableFrontPair(row)
    && pairKey(row.driver_length_in, row.passenger_length_in) === pairKey(CONFIGURATION.driver, CONFIGURATION.passenger));
  const globalDuplicates = duplicatePublished(data.allPublishedFitments);
  const sizesByKey = new Map(data.wiperSizes.map((row) => [`${row.position_scope}/${row.length_in}`, row]));
  const expectedSizes = unique([
    `${"front"}/${CONFIGURATION.driver}`,
    `${"front"}/${CONFIGURATION.passenger}`,
    ...(CONFIGURATION.rear == null ? [] : [`rear/${CONFIGURATION.rear}`]),
  ]).map((value) => { const [position_scope, length] = value.split("/"); return { position_scope, length_in: Number(length) }; });
  const missingSizes = expectedSizes.filter((row) => !sizesByKey.has(`${row.position_scope}/${row.length_in}`));
  const inactiveSizes = expectedSizes.filter((row) => sizesByKey.has(`${row.position_scope}/${row.length_in}`)
    && sizesByKey.get(`${row.position_scope}/${row.length_in}`).active !== true);

  if (configRows.length > 1) blockers.push({ reason: "duplicate_configuration_key", configuration_key: CONFIGURATION.key });
  if (configuration && actualBladeKey !== CONFIGURATION.key) blockers.push({ reason: "configuration_blades_mismatch", expected: CONFIGURATION.key, actual: actualBladeKey });
  if (configuration && configuration.rear_status !== CONFIGURATION.rearStatus) blockers.push({ reason: "configuration_rear_status_mismatch", expected: CONFIGURATION.rearStatus, actual: configuration.rear_status });
  if (configuration && ["rejected", "superseded"].includes(configuration.configuration_status)) blockers.push({ reason: "configuration_not_publishable", status: configuration.configuration_status });
  if (!sellableSets.length) blockers.push({ reason: "active_sellable_front_pair_missing", pair: pairKey(CONFIGURATION.driver, CONFIGURATION.passenger) });
  if (globalDuplicates.length) blockers.push({ reason: "global_duplicate_published_fitments", applications: globalDuplicates });

  const preflight = [];
  for (const target of targetRows) {
    const failures = [];
    const application = applicationById.get(target.application_id);
    const years = unique((yearsByApp.get(target.application_id) ?? []).map((row) => Number(row.model_year))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to)).sort((a, b) => a - b);
    const model = modelById.get(application?.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(application?.series_id);
    const variant = variantById.get(application?.variant_id);
    const identity = { make: upper(make?.name), model: upper(model?.name), series: upper(series?.code), body: bodyKey(variant?.body_style ?? variant?.display_name) };
    if (!application) failures.push("missing_application");
    if (application && application.status !== "active") failures.push("inactive_application");
    if (!years.length) failures.push("missing_application_years");
    if (!arraysEqual(years, target.current_years)) failures.push("application_years_changed_since_safe_preflight");
    if (!currentIdentityMatchesTarget(identity, target.expected_identity)) failures.push("vehicle_identity_changed");
    const published = (fitmentsByApp.get(target.application_id) ?? []).filter((row) => row.fitment_status === "published");
    const publishedKeys = published.map((row) => configById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`);
    if (published.length > 1) failures.push("duplicate_published_fitments");
    if (published.length === 1 && publishedKeys[0] !== CONFIGURATION.key) failures.push("different_published_configuration_conflict");
    const alreadyPublished = published.length === 1 && publishedKeys[0] === CONFIGURATION.key;
    const existingSameRelation = configuration && (fitmentsByApp.get(target.application_id) ?? []).find((row) => row.wiper_configuration_id === configuration.id);
    const uniqueFailures = unique(failures);
    const action = uniqueFailures.length ? "blocked" : alreadyPublished ? "already_published"
      : existingSameRelation ? "publish_existing_relation" : "insert_fitment";
    const row = {
      application_id: target.application_id, task_id: target.task_id, expected_series: target.expected_identity.series,
      current_identity: identity, current_status: application?.status ?? null, current_years: years,
      application_years: years.length, expected_configuration_key: CONFIGURATION.key,
      configuration_id: configuration?.id ?? null, configuration_status: configuration?.configuration_status ?? null,
      configuration_rear_status: configuration?.rear_status ?? null, configuration_blades_key: configuration ? actualBladeKey : null,
      published_configuration_keys: publishedKeys, sellable_front_pair_skus: sellableSets.map((item) => item.sku).sort(),
      source_url: target.source_url, source_locator: target.source_locator, action, failures: uniqueFailures
    };
    preflight.push(row);
    for (const reason of uniqueFailures) blockers.push({ reason, application_id: target.application_id });
  }

  const currentAy = preflight.reduce((sum, row) => sum + row.application_years, 0);
  if (preflight.length !== EXPECTED_TARGETS || currentAy !== EXPECTED_APPLICATION_YEARS) blockers.push({ reason: "target_denominator_changed", applications: preflight.length, application_years: currentAy });
  const actionable = preflight.filter((row) => ["insert_fitment", "publish_existing_relation"].includes(row.action));
  const beforeKnowledge = preflight.filter((row) => row.published_configuration_keys.length === 1).reduce((sum, row) => sum + row.application_years, 0);
  const beforeProduct = preflight.filter((row) => row.published_configuration_keys.length === 1 && row.sellable_front_pair_skus.length).reduce((sum, row) => sum + row.application_years, 0);
  const expectedKnowledgeAfter = blockers.length ? beforeKnowledge : currentAy;
  const expectedProductAfter = blockers.length ? beforeProduct : currentAy;
  const rollbackKeys = {
    fitment_inserts: actionable.filter((row) => row.action === "insert_fitment").map((row) => ({ application_id: row.application_id, configuration_key: CONFIGURATION.key })),
    fitment_updates: actionable.filter((row) => row.action === "publish_existing_relation").map((row) => ({ application_id: row.application_id, configuration_id: configuration?.id })),
    configuration_create: configuration ? [] : [{ configuration_key: CONFIGURATION.key }],
    configuration_status_update: configuration && configuration.configuration_status !== "published"
      ? [{ id: configuration.id, previous_status: configuration.configuration_status }] : [],
    wiper_size_creates: missingSizes,
    wiper_size_reactivations: inactiveSizes.map((row) => ({ ...row, previous_active: false }))
  };
  const generatedAt = new Date().toISOString();
  const backupPlan = {
    generated_at: generatedAt, required_before_apply: true,
    directory_template: `tmp/production-backups/${BACKUP_PREFIX}-<ISO timestamp>`,
    input_sha256: fileIdentity(INPUT_FILE).sha256,
    target_application_ids: preflight.map((row) => row.application_id), target_configuration_key: CONFIGURATION.key,
    tables: {
      vehicle_catalog_applications: { selector: `application_id IN ${EXPECTED_TARGETS} target IDs`, rows: data.applications.length },
      vehicle_catalog_application_years: { selector: `application_id IN ${EXPECTED_TARGETS} target IDs`, rows: data.years.length },
      vehicle_catalog_wiper_fitments: { selector: `application_id IN ${EXPECTED_TARGETS} target IDs`, rows: data.targetFitments.length, touched: true },
      wiper_sizes: { selector: expectedSizes.map((row) => `${row.position_scope}/${row.length_in}`).join(" and "), rows: expectedSizes.filter((row) => sizesByKey.has(`${row.position_scope}/${row.length_in}`)).length, touched_if_missing_or_inactive: true },
      wiper_configurations: { selector: `configuration_key=${CONFIGURATION.key}`, rows: configRows.length, touched: true },
      wiper_configuration_blades: { selector: "resolved target configuration ID", rows: blades.length, touched: true },
      wiper_sets: { selector: `active sellable ${CONFIGURATION.driver}/${CONFIGURATION.passenger} front pair`, rows: sellableSets.length, touched: false }
    },
    rollback_keys: rollbackKeys
  };
  const report = {
    generated_at: generatedAt, mode: APPLY ? "apply" : "report-only", production_writes_performed: false,
    source_code: SOURCE_CODE, input: fileIdentity(INPUT_FILE), blocked_input: fileIdentity(BLOCKED_FILE),
    scope_guard: { profile: PROFILE, narrow_model_scope: true, blocked_applications_excluded: true },
    targets: { applications: preflight.length, application_years: currentAy, configuration_key: CONFIGURATION.key },
    current_production: {
      configuration_exists: Boolean(configuration), configuration_id: configuration?.id ?? null,
      configuration_status: configuration?.configuration_status ?? null, rear_status: configuration?.rear_status ?? null,
      blades_key: configuration ? actualBladeKey : null, missing_sizes: missingSizes, inactive_sizes: inactiveSizes,
      sellable_front_pair_skus: sellableSets.map((row) => row.sku).sort(), global_duplicate_published_applications: globalDuplicates.length
    },
    product_link_semantics: `Configuration ${CONFIGURATION.key} is product-covered by an existing active sellable ${CONFIGURATION.driver}/${CONFIGURATION.passenger} front pair; this script does not mutate wiper_sets.`,
    preflight: { ready_for_apply: blockers.length === 0, blockers: blockers.length, blocker_reasons: countBy(blockers, (row) => row.reason), actions: countBy(preflight, (row) => row.action) },
    expected_writes: {
      fitment_rows: actionable.length, configuration_rows: configuration ? 0 : 1,
      configuration_status_rows: configuration?.configuration_status === "published" ? 0 : 1,
      configuration_blade_rows: configuration ? 0 : (CONFIGURATION.rear == null ? 2 : 3),
      wiper_size_rows: missingSizes.length + inactiveSizes.length
    },
    coverage: {
      denominator_application_years: EXTENDED132_AY_DENOMINATOR,
      target_knowledge_before_application_years: beforeKnowledge,
      target_knowledge_after_application_years: expectedKnowledgeAfter,
      expected_knowledge_uplift_application_years: expectedKnowledgeAfter - beforeKnowledge,
      expected_knowledge_uplift_pp: percent(expectedKnowledgeAfter - beforeKnowledge, EXTENDED132_AY_DENOMINATOR),
      target_product_before_application_years: beforeProduct,
      target_product_after_application_years: expectedProductAfter,
      expected_product_uplift_application_years: expectedProductAfter - beforeProduct,
      expected_product_uplift_pp: percent(expectedProductAfter - beforeProduct, EXTENDED132_AY_DENOMINATOR)
    },
    rollback_keys: rollbackKeys, blockers
  };
  return { report, backupPlan, rollbackKeys, preflight, blockers, actionable, configuration, missingSizes, inactiveSizes, sellableSets };
}

async function applyPublication(db, prepared, backupDirectory) {
  const appliedAt = new Date().toISOString();
  for (const size of prepared.missingSizes) {
    const { error } = await db.from("wiper_sizes").insert({ ...size, active: true });
    if (error && error.code !== "23505") throw new Error(`wiper_sizes insert: ${error.message}`);
  }
  for (const size of prepared.inactiveSizes) {
    const { error } = await db.from("wiper_sizes").update({ active: true }).eq("position_scope", size.position_scope).eq("length_in", size.length_in);
    if (error) throw new Error(`wiper_sizes reactivate: ${error.message}`);
  }

  let configurationId = prepared.configuration?.id ?? null;
  if (!configurationId) {
    const { data, error } = await db.rpc("upsert_wiper_configuration", {
      p_driver_length_in: CONFIGURATION.driver, p_passenger_length_in: CONFIGURATION.passenger, p_rear_length_in: CONFIGURATION.rear
    });
    if (error) throw new Error(`upsert_wiper_configuration: ${error.message}`);
    configurationId = data;
  }
  if (!prepared.configuration || prepared.configuration.configuration_status !== "published") {
    const { error: configurationError } = await db.from("wiper_configurations").update({
      rear_status: CONFIGURATION.rearStatus, configuration_status: "published",
      notes: `${SOURCE_NOTE}; source=${SOURCE_CODE}; input_sha256=${fileIdentity(INPUT_FILE).sha256}`,
      updated_at: appliedAt
    }).eq("id", configurationId).eq("configuration_key", CONFIGURATION.key);
    if (configurationError) throw new Error(`wiper_configurations publish: ${configurationError.message}`);
  }

  const payload = prepared.actionable.map((row) => ({
    application_id: row.application_id, wiper_configuration_id: configurationId, fitment_status: "published", source: SOURCE_CODE,
    notes: `task=${row.task_id}; series=${row.expected_series}; body=bus; source_url=${row.source_url}; source_locator=${row.source_locator}; input_sha256=${fileIdentity(INPUT_FILE).sha256}`,
    updated_at: appliedAt
  }));
  let written = [];
  if (payload.length) {
    const { data, error: fitmentError } = await db.from("vehicle_catalog_wiper_fitments")
      .upsert(payload, { onConflict: "application_id,wiper_configuration_id" }).select("application_id,wiper_configuration_id,fitment_status");
    if (fitmentError) throw new Error(`vehicle_catalog_wiper_fitments: ${fitmentError.message}`);
    written = data ?? [];
  }
  const verification = await verifyApplied(db, prepared, configurationId);
  return { applied_at: appliedAt, backup_directory: backupDirectory, configuration_id: configurationId,
    fitment_rows_returned: written?.length ?? 0, verification };
}

async function verifyApplied(db, prepared, configurationId) {
  const targetIds = prepared.preflight.map((row) => row.application_id);
  const refreshed = await readProduction(db, targetIds);
  const config = refreshed.configurations.find((row) => row.id === configurationId && row.configuration_key === CONFIGURATION.key);
  const blades = refreshed.blades.filter((row) => row.wiper_configuration_id === configurationId);
  const configurationOk = Boolean(config) && config.configuration_status === "published" && config.rear_status === CONFIGURATION.rearStatus && bladeKey(blades) === CONFIGURATION.key;
  const configById = new Map(refreshed.configurations.map((row) => [row.id, row]));
  const publishedByApp = groupBy(refreshed.targetFitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const applicationChecks = targetIds.map((applicationId) => {
    const rows = publishedByApp.get(applicationId) ?? [];
    const keys = rows.map((row) => configById.get(row.wiper_configuration_id)?.configuration_key ?? `missing:${row.wiper_configuration_id}`);
    return { application_id: applicationId, published_rows: rows.length, configuration_keys: keys, ok: rows.length === 1 && keys[0] === CONFIGURATION.key };
  });
  const duplicates = duplicatePublished(refreshed.allPublishedFitments);
  const yearsByApp = groupBy(refreshed.years, (row) => row.application_id);
  const verifiedAy = targetIds.reduce((sum, id) => sum + unique((yearsByApp.get(id) ?? []).map((row) => Number(row.model_year))
    .filter((year) => year >= PERIOD.from && year <= PERIOD.to)).length, 0);
  const sellable = refreshed.wiperSets.some((row) => isSellableFrontPair(row)
    && pairKey(row.driver_length_in, row.passenger_length_in) === pairKey(CONFIGURATION.driver, CONFIGURATION.passenger));
  const failures = [];
  if (!configurationOk) failures.push("configuration_readback_failed");
  if (applicationChecks.some((row) => !row.ok)) failures.push("application_fitment_readback_failed");
  if (duplicates.length) failures.push("global_duplicate_published_fitments");
  if (verifiedAy !== EXPECTED_APPLICATION_YEARS) failures.push("coverage_denominator_changed");
  if (!sellable) failures.push("sellable_front_pair_missing_after_apply");
  if (failures.length) throw new Error(`Post-apply verification failed: ${failures.join(",")}`);
  return {
    ok: true, configuration_ok: configurationOk, applications_verified: applicationChecks.length,
    application_checks: applicationChecks, global_duplicate_published_applications: 0,
    coverage: { target_application_years: verifiedAy, knowledge_application_years_after: EXPECTED_APPLICATION_YEARS,
      product_application_years_after: EXPECTED_APPLICATION_YEARS, knowledge_uplift_application_years: prepared.report.coverage.expected_knowledge_uplift_application_years,
      product_uplift_application_years: prepared.report.coverage.expected_product_uplift_application_years }
  };
}

function writePreimageBackup(prepared, data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `${BACKUP_PREFIX}-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const configIds = new Set(data.configurations.filter((row) => row.configuration_key === CONFIGURATION.key).map((row) => row.id));
  const files = {
    "manifest.json": { created_at: new Date().toISOString(), source_code: SOURCE_CODE, input: fileIdentity(INPUT_FILE), backup_plan: prepared.backupPlan, rollback_keys: prepared.rollbackKeys },
    "vehicle_catalog_applications.json": data.applications,
    "vehicle_catalog_application_years.json": data.years,
    "vehicle_catalog_wiper_fitments.json": data.targetFitments,
    "wiper_sizes.json": data.wiperSizes.filter((row) => expectedSizeMatch(row)),
    "wiper_configurations.json": data.configurations.filter((row) => row.configuration_key === CONFIGURATION.key),
    "wiper_configuration_blades.json": data.blades.filter((row) => configIds.has(row.wiper_configuration_id)),
    "wiper_sets.json": prepared.sellableSets
  };
  for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
  fs.copyFileSync(INPUT_FILE, path.join(directory, "safe-to-publish.jsonl"));
  return directory;
}

function writeReportFiles(prepared) {
  fs.writeFileSync(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(prepared.report, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "preflight-summary.json"), `${JSON.stringify(prepared.report, null, 2)}\n`);
  writeJsonl(path.join(OUTPUT_DIR, "preflight-by-application.jsonl"), prepared.preflight);
  fs.writeFileSync(path.join(OUTPUT_DIR, "backup-plan.json"), `${JSON.stringify(prepared.backupPlan, null, 2)}\n`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "rollback-keys.json"), `${JSON.stringify(prepared.rollbackKeys, null, 2)}\n`);
}

async function readProduction(db, applicationIds) {
  const [applications, years, targetFitments, allPublishedFitments, exactConfigurations, wiperSets, wiperSizes, makes, models, series, variants] = await Promise.all([
    selectInChunks(db, "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status,year_from,year_to", "application_id", applicationIds),
    selectInChunks(db, "vehicle_catalog_application_years", "application_id,model_year", "application_id", applicationIds),
    selectInChunks(db, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes,created_at,updated_at", "application_id", applicationIds),
    fetchAll(db, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status", (query) => query.eq("fitment_status", "published")),
    selectInChunks(db, "wiper_configurations", "id,configuration_key,configuration_status,rear_status,name,notes,created_at,updated_at", "configuration_key", [CONFIGURATION.key]),
    fetchAll(db, "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"),
    fetchAll(db, "wiper_sizes", "position_scope,length_in,active,created_at"),
    fetchAll(db, "vehicle_catalog_makes", "make_id,name,status"), fetchAll(db, "vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll(db, "vehicle_catalog_series", "series_id,model_id,code,display_name,status"), fetchAll(db, "vehicle_catalog_variants", "variant_id,display_name,body_style")
  ]);
  const referencedIds = unique(targetFitments.map((row) => row.wiper_configuration_id));
  const missingIds = referencedIds.filter((id) => !exactConfigurations.some((row) => row.id === id));
  const configurations = [...exactConfigurations, ...(missingIds.length ? await selectInChunks(db, "wiper_configurations",
    "id,configuration_key,configuration_status,rear_status,name,notes,created_at,updated_at", "id", missingIds) : [])];
  const blades = await selectInChunks(db, "wiper_configuration_blades", "wiper_configuration_id,position,length_in,connector_type,created_at,updated_at", "wiper_configuration_id", configurations.map((row) => row.id));
  return { applications, years, targetFitments, allPublishedFitments, configurations, blades, wiperSets, wiperSizes, makes, models, series, variants };
}

function duplicatePublished(rows) { return [...groupBy(rows, (row) => row.application_id).entries()].filter(([, values]) => values.length > 1)
  .map(([application_id, values]) => ({ application_id, rows: values.length, configuration_ids: values.map((row) => row.wiper_configuration_id) })); }
function bladeKey(rows) { const map = new Map(rows.map((row) => [row.position, Number(row.length_in)])); return [map.get("driver") ?? "-", map.get("passenger") ?? "-", map.get("rear") ?? "-"].join("/"); }
function isSellableFrontPair(row) { return row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
  && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true; }
function pairKey(a, b) { return [Number(a), Number(b)].sort((left, right) => right - left).join("/"); }
function bodyKey(value) { const key = String(value ?? "").toLowerCase(); if (/\bbus\b|minibus/.test(key)) return "bus"; return key.trim(); }
function targetIdentityAllowed(expected) {
  if (CARAVAN_MODEL_BATCH) return expected?.make === "NISSAN" && expected?.models?.join("/") === "NV350"
    && /E26$/.test(expected?.series ?? "") && expected?.body === "bus";
  return expected?.make === "MITSUBISHI" && expected?.models?.join("/") === "L300"
    && /^P[0-3][A-Z0-9]W$/.test(expected?.series ?? "") && expected?.body === "bus";
}
function currentIdentityMatchesTarget(actual, expected) {
  return targetIdentityAllowed(expected) && actual.make === expected.make
    && expected.models.includes(actual.model) && actual.series === expected.series && actual.body === expected.body;
}
function expectedSizeMatch(row) {
  if (row.position_scope === "front" && [CONFIGURATION.driver, CONFIGURATION.passenger].includes(Number(row.length_in))) return true;
  return CONFIGURATION.rear != null && row.position_scope === "rear" && Number(row.length_in) === CONFIGURATION.rear;
}

async function selectInChunks(db, table, columns, column, values) { const output = []; for (const part of chunks(unique(values), 200)) { if (!part.length) continue;
  const { data, error } = await db.from(table).select(columns).in(column, part); if (error) throw new Error(`${table}: ${error.message}`); output.push(...(data ?? [])); } return output; }
async function fetchAll(db, table, columns, alter = null) { const output = []; for (let from = 0; ; from += 1000) { let query = db.from(table).select(columns).range(from, from + 999); if (alter) query = alter(query);
  const { data, error } = await query; if (error) throw new Error(`${table}: ${error.message}`); output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") }; }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return output; }
function duplicateValues(values) { return Object.entries(countBy(values, (value) => value)).filter(([, count]) => count > 1).map(([value]) => value); }
function chunks(values, size) { const output = []; for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size)); return output; }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function arraysEqual(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function percent(numerator, denominator) { return Math.round((numerator / denominator * 100 + Number.EPSILON) * 10_000) / 10_000; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
