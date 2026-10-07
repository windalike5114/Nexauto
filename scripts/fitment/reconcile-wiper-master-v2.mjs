import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const args = parseArgs(process.argv.slice(2));
// User-provided Wiper Master data is authoritative by default. The opt-out is
// retained for audit-only comparisons with the previous consensus policy.
const authoritative = !Boolean(args["require-external-consensus"]);
loadEnvFile(path.join(process.cwd(), ".env.local"));
if (!args.screen || !args.assisted) {
  throw new Error("Pass --screen <screening.xlsx> and --assisted <legacy-assisted.xlsx>. Add --apply only after reviewing the report.");
}
const screenPath = path.resolve(args.screen ?? "");
const assistedPath = path.resolve(args.assisted ?? "");
const reportPath = path.resolve(args.output ?? path.join(process.cwd(), "tmp", "wiper-master-promotion-report.json"));
if (!fs.existsSync(screenPath) || !fs.existsSync(assistedPath)) throw new Error("Screening and assisted-mapping workbooks are required.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Database credentials are not configured.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const screen = XLSX.readFile(screenPath, { raw: false });
const assisted = XLSX.readFile(assistedPath, { raw: false });
const alreadyMatched = readSheet(screen, "A_已安全匹配");
const autoReady = readSheet(screen, "B_可自动确认");
const fieldReview = readSheet(screen, "D_实车人工确认");
const coverageReview = readSheet(screen, "E_外源资料补充");
const assistedReady = readSheet(assisted, "老库辅助唯一匹配");

const toAccept = [
  ...autoReady.map((row) => ({ ...row, promotion_rule: "unique_multi_source_match", target_application_id: row.proposed_application_id })),
  ...assistedReady.map((row) => ({ ...row, promotion_rule: "approved_legacy_bridge_exact_fitment", target_application_id: row.assisted_application_id }))
];
const trusted = [
  ...alreadyMatched.map((row) => ({ ...row, promotion_rule: "existing_unique_multi_source_match", target_application_id: row.proposed_application_id })),
  ...toAccept
];
const sourceExceptions = [...fieldReview, ...coverageReview]
  .filter((row) => row.current_database_status === "accepted")
  .map((row) => ({ ...row, target_application_id: row.proposed_application_id }));

assertUnique(toAccept, "database_observation_id", "Rows selected for acceptance");
assertUnique(trusted, "database_observation_id", "Trusted rows");

const configurations = await selectAll(db.from("wiper_configurations").select("*"));
const configByKey = new Map(configurations.map((row) => [row.configuration_key, row]));
const configKeyById = new Map(configurations.map((row) => [row.id, row.configuration_key]));
const applications = await selectAll(db.from("vehicle_fitment_applications").select("id,active,fitment_status"));
const appById = new Map(applications.map((row) => [row.id, row]));
const observations = await selectAll(db.from("wiper_fitment_observations").select("*"));
const acceptedObservationIds = new Set(observations.filter((row) => row.observation_status === "accepted").map((row) => row.id));
for (const row of sourceExceptions) acceptedObservationIds.delete(row.database_observation_id);
for (const row of toAccept) acceptedObservationIds.add(row.database_observation_id);

const hypotheticalAccepted = new Map(observations
  .filter((row) => acceptedObservationIds.has(row.id))
  .map((row) => [row.id, { ...row, proposed_configuration_key: configKeyById.get(row.wiper_configuration_id) ?? null }]));
for (const row of toAccept) {
  const current = hypotheticalAccepted.get(row.database_observation_id) ?? observations.find((item) => item.id === row.database_observation_id);
  const configuration = configByKey.get(row.configuration_key);
  if (!current) throw new Error(`Observation not found: ${row.database_observation_id}`);
  hypotheticalAccepted.set(current.id, {
    ...current,
    observation_status: "accepted",
    vehicle_application_id: row.target_application_id,
    wiper_configuration_id: configuration?.id ?? null,
    proposed_configuration_key: row.configuration_key
  });
}

const blades = await selectAll(db.from("wiper_configuration_blades").select("wiper_configuration_id,position,length_in"));
const bladesByConfig = groupBy(blades, (row) => row.wiper_configuration_id);
const products = await selectAll(db.from("wiper_sets")
  .select("id,driver_length_in,passenger_length_in,active,set_type")
  .eq("active", true)
  .eq("set_type", "front_pair"));
const productKeys = new Set(products.map((row) => frontPairKey(row.driver_length_in, row.passenger_length_in)));
const existingFitments = await selectAll(db.from("vehicle_wiper_fitments").select("*"));
const fitmentsByPair = new Map(existingFitments.map((row) => [`${row.vehicle_application_id}:${row.wiper_configuration_id}`, row]));
const acceptedByApp = groupBy([...hypotheticalAccepted.values()].filter((row) => row.vehicle_application_id), (row) => row.vehicle_application_id);
const trustedByApp = groupBy(trusted, (row) => row.target_application_id);

const publishable = [];
const blocked = [];
for (const [applicationId, rows] of trustedByApp.entries()) {
  const trustedConfigKeys = unique(rows.map((row) => row.configuration_key));
  const acceptedRows = acceptedByApp.get(applicationId) ?? [];
  const acceptedConfigKeys = unique(acceptedRows.map((row) => row.proposed_configuration_key).filter(Boolean));
  const config = trustedConfigKeys.length === 1 ? configByKey.get(trustedConfigKeys[0]) : null;
  const application = appById.get(applicationId);
  const configBlades = config ? bladesByConfig.get(config.id) ?? [] : [];
  const parsedConfig = trustedConfigKeys.length === 1 ? parseConfigurationKey(trustedConfigKeys[0]) : null;
  const driver = configBlades.find((blade) => blade.position === "driver")?.length_in ?? parsedConfig?.driver ?? null;
  const passenger = configBlades.find((blade) => blade.position === "passenger")?.length_in ?? parsedConfig?.passenger ?? null;
  const reasons = [];
  if (!applicationId || !application) reasons.push("canonical_application_missing");
  if (application && (!application.active || application.fitment_status !== "published")) reasons.push("canonical_application_not_published");
  if (trustedConfigKeys.length !== 1) reasons.push("trusted_configuration_conflict");
  if (trustedConfigKeys.length === 1 && !parsedConfig) reasons.push("configuration_key_invalid");
  const conflictingAcceptedRows = trustedConfigKeys.length === 1
    ? acceptedRows.filter((row) => row.proposed_configuration_key && row.proposed_configuration_key !== trustedConfigKeys[0])
    : [];
  if (!authoritative && (acceptedConfigKeys.length !== 1 || acceptedConfigKeys[0] !== trustedConfigKeys[0])) {
    reasons.push("accepted_observation_conflict");
  }
  if (trustedConfigKeys.length === 1 && (!driver || !passenger)) reasons.push("front_blades_missing");
  if (trustedConfigKeys.length === 1 && driver && passenger && !productKeys.has(frontPairKey(driver, passenger))) reasons.push("active_front_product_missing");
  const result = {
    vehicle_application_id: applicationId,
    wiper_configuration_id: config?.id ?? "",
    configuration_key: trustedConfigKeys.join(" | "),
    supporting_wiper_master_rows: rows.map((row) => row.source_row).join(" | "),
    supporting_observation_count: rows.length,
    accepted_configuration_count: acceptedConfigKeys.length,
    existing_fitment_id: config ? fitmentsByPair.get(`${applicationId}:${config.id}`)?.id ?? "" : "",
    overridden_observation_ids: authoritative ? conflictingAcceptedRows.map((row) => row.id).join(" | ") : "",
    block_reasons: reasons.join(" | ")
  };
  if (reasons.length) blocked.push(result);
  else publishable.push(result);
}

const report = {
  generated_at: new Date().toISOString(),
  mode: args.apply ? "apply" : "read_only_preflight",
  inputs: { screen: screenPath, assisted: assistedPath },
  policy: {
    multi_source_master_required: true,
    wiper_master_authoritative: authoritative,
    exact_legacy_bridge_allowed: true,
    unique_configuration_required: true,
    active_front_product_required: true,
    source_exceptions_published: false
  },
  counts: {
    already_safe_observations: alreadyMatched.length,
    direct_auto_accept: autoReady.length,
    legacy_assisted_accept: assistedReady.length,
    source_exceptions_to_reopen: sourceExceptions.length,
    trusted_observations_after_apply: trusted.length,
    publishable_applications: publishable.length,
    blocked_applications: blocked.length,
    configurations_to_create: unique(toAccept.map((row) => row.configuration_key).filter((value) => !configByKey.has(value))).length,
    observations_to_supersede: unique(publishable.flatMap((row) => row.overridden_observation_ids.split(" | ").filter(Boolean))).length
  },
  blocked_reason_counts: countBy(blocked.flatMap((row) => row.block_reasons.split(" | ").filter(Boolean)), (reason) => reason),
  accept_rows: toAccept,
  reopen_rows: sourceExceptions,
  publishable,
  blocked
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output: reportPath, ...report.counts, blocked_reason_counts: report.blocked_reason_counts }, null, 2));

if (args.apply) await applyChanges(report);

async function applyChanges(currentReport) {
  if (currentReport.counts.direct_auto_accept !== 183) throw new Error("Expected 183 direct auto-accept rows; aborting.");
  if (currentReport.counts.legacy_assisted_accept !== 10) throw new Error("Expected 10 legacy-assisted rows; aborting.");
  if (currentReport.counts.source_exceptions_to_reopen !== 52) throw new Error("Expected 52 source exceptions to reopen; aborting.");
  if (!currentReport.publishable.length) throw new Error("No fitments passed publication safeguards.");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.resolve(args.backup ?? path.join(path.dirname(reportPath), `wiper-master-before-apply-${timestamp}.json`));
  const overriddenObservationIds = unique(publishable.flatMap((row) => row.overridden_observation_ids.split(" | ").filter(Boolean)));
  const affectedObservationIds = unique([
    ...[...toAccept, ...sourceExceptions].map((row) => row.database_observation_id),
    ...overriddenObservationIds
  ]);
  const affectedRecordIds = unique(observations.filter((row) => affectedObservationIds.includes(row.id)).map((row) => row.source_record_id));
  const affectedAppIds = unique(publishable.map((row) => row.vehicle_application_id));
  const publicationConfigKeys = unique(publishable.map((row) => row.configuration_key));
  const acceptanceConfigKeys = unique(toAccept.map((row) => row.configuration_key));
  const configKeysToEnsure = unique([...publicationConfigKeys, ...acceptanceConfigKeys]);
  const affectedConfigIdsBefore = unique(configKeysToEnsure.map((value) => configByKey.get(value)?.id).filter(Boolean));
  const backup = {
    created_at: new Date().toISOString(),
    observations: observations.filter((row) => affectedObservationIds.includes(row.id)),
    mappings: await selectInChunks(db, "source_entity_mappings", "source_record_id", affectedRecordIds, "*"),
    reviews: await selectInChunks(db, "fitment_review_queue", "source_record_id", affectedRecordIds, "*"),
    configurations: configurations.filter((row) => affectedConfigIdsBefore.includes(row.id)),
    configurations_missing_before_apply: configKeysToEnsure.filter((value) => !configByKey.has(value)),
    fitments: existingFitments.filter((row) => affectedAppIds.includes(row.vehicle_application_id)),
    data_sources: (await db.from("catalog_data_sources").select("*").eq("code", "WIPER_MASTER")).data ?? []
  };
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));

  for (const configurationKey of configKeysToEnsure.filter((value) => !configByKey.has(value))) {
    const parsed = parseConfigurationKey(configurationKey);
    if (!parsed) throw new Error(`Invalid configuration key: ${configurationKey}`);
    const { data, error } = await db.rpc("upsert_wiper_configuration", {
      p_driver_length_in: parsed.driver,
      p_passenger_length_in: parsed.passenger,
      p_rear_length_in: parsed.rear
    });
    if (error) throw error;
    configByKey.set(configurationKey, { id: data, configuration_key: configurationKey });
  }

  const observationById = new Map(observations.map((row) => [row.id, row]));
  const recordIdByObservationId = new Map(observations.map((row) => [row.id, row.source_record_id]));
  const acceptanceUpdates = toAccept.map((row) => {
    const current = observationById.get(row.database_observation_id);
    const config = configByKey.get(row.configuration_key);
    return {
      ...current,
      vehicle_application_id: row.target_application_id,
      wiper_configuration_id: config.id,
      observation_status: "accepted",
      notes: unique([...(current.notes ?? []), `Automatically accepted by ${row.promotion_rule}.`])
    };
  });
  await upsertChunks(db, "wiper_fitment_observations", acceptanceUpdates, 100, "id");

  const exceptionUpdates = sourceExceptions.map((row) => {
    const current = observationById.get(row.database_observation_id);
    return {
      ...current,
      observation_status: "review",
      notes: unique([...(current.notes ?? []), `Returned to review from source disposition: ${row.source_disposition}.`])
    };
  });
  await upsertChunks(db, "wiper_fitment_observations", exceptionUpdates, 100, "id");

  const overriddenUpdates = overriddenObservationIds.map((id) => {
    const current = observationById.get(id);
    return {
      ...current,
      observation_status: "superseded",
      notes: unique([...(current.notes ?? []), "Superseded by the user-provided authoritative Wiper Master."])
    };
  });
  await upsertChunks(db, "wiper_fitment_observations", overriddenUpdates, 100, "id");

  const overriddenPairs = unique(overriddenUpdates
    .filter((row) => row.vehicle_application_id && row.wiper_configuration_id)
    .map((row) => `${row.vehicle_application_id}:${row.wiper_configuration_id}`));
  for (const pair of overriddenPairs) {
    const [vehicleApplicationId, wiperConfigurationId] = pair.split(":");
    const { error } = await db.from("vehicle_wiper_fitments")
      .update({
        fitment_status: "superseded",
        notes: "Superseded by the user-provided authoritative Wiper Master."
      })
      .eq("vehicle_application_id", vehicleApplicationId)
      .eq("wiper_configuration_id", wiperConfigurationId);
    if (error) throw error;
  }

  const mappingRows = toAccept.map((row) => ({
    source_record_id: recordIdByObservationId.get(row.database_observation_id),
    entity_type: "application",
    mapping_index: 0,
    mapping_status: "approved",
    confidence: row.promotion_rule === "approved_legacy_bridge_exact_fitment" ? 0.97 : 0.99,
    vehicle_application_id: row.target_application_id,
    match_reasons: [row.promotion_rule],
    reviewed_at: new Date().toISOString(),
    reviewed_by: "automation:wiper-master-reconciliation-v1"
  }));
  await upsertChunks(db, "source_entity_mappings", mappingRows, 100, "source_record_id,entity_type,mapping_index");

  const exceptionRecordIds = unique(sourceExceptions.map((row) => recordIdByObservationId.get(row.database_observation_id)).filter(Boolean));
  if (exceptionRecordIds.length) {
    const { error } = await db.from("source_entity_mappings").update({
      mapping_status: "candidate",
      reviewed_at: null,
      reviewed_by: null,
      match_reasons: ["source_evidence_requires_review"]
    }).in("source_record_id", exceptionRecordIds).eq("entity_type", "application").eq("mapping_status", "approved");
    if (error) throw error;
  }

  const acceptedRecordIds = unique(toAccept.map((row) => recordIdByObservationId.get(row.database_observation_id)).filter(Boolean));
  if (acceptedRecordIds.length) {
    const { error } = await db.from("fitment_review_queue").update({
      review_status: "resolved",
      resolution_notes: "Resolved automatically by deterministic Wiper Master reconciliation.",
      reviewed_by: "automation:wiper-master-reconciliation-v1",
      reviewed_at: new Date().toISOString()
    }).in("source_record_id", acceptedRecordIds).eq("review_status", "open")
      .in("issue_type", ["vehicle_identity_match", "wiper_size_or_source_parse"]);
    if (error) throw error;
  }

  const existingExceptionReviews = await selectInChunks(db, "fitment_review_queue", "source_record_id", exceptionRecordIds, "source_record_id,issue_type,review_status");
  const openExceptionKeys = new Set(existingExceptionReviews
    .filter((row) => row.issue_type === "source_evidence_review" && row.review_status === "open")
    .map((row) => row.source_record_id));
  const reviewRows = sourceExceptions
    .map((row) => ({ row, source_record_id: recordIdByObservationId.get(row.database_observation_id) }))
    .filter(({ source_record_id }) => source_record_id && !openExceptionKeys.has(source_record_id))
    .map(({ row, source_record_id }) => ({
      source_record_id,
      issue_type: "source_evidence_review",
      severity: row.source_disposition === "field_verification" ? "warning" : "info",
      review_status: "open",
      summary: row.source_disposition === "field_verification"
        ? "Wiper Master marks this record for field verification or reports a source disagreement."
        : "Wiper Master marks this record as not covered by external sources.",
      payload: { source_row: row.source_row, source_disposition: row.source_disposition }
    }));
  await insertChunks(db, "fitment_review_queue", reviewRows, 100);

  const affectedConfigIds = unique(publicationConfigKeys.map((value) => configByKey.get(value)?.id).filter(Boolean));
  const { error: configError } = await db.from("wiper_configurations")
    .update({ configuration_status: "published", notes: "Published by deterministic Wiper Master reconciliation v1." })
    .in("id", affectedConfigIds);
  if (configError) throw configError;

  const fitmentRows = publishable.map((row) => ({
    vehicle_application_id: row.vehicle_application_id,
    wiper_configuration_id: configByKey.get(row.configuration_key).id,
    fitment_status: "published",
    confidence: authoritative ? 1 : 0.99,
    notes: authoritative
      ? `Published from authoritative user-provided Wiper Master rows ${row.supporting_wiper_master_rows}.`
      : `Published from corroborated Wiper Master rows ${row.supporting_wiper_master_rows}.`
  }));
  await upsertChunks(db, "vehicle_wiper_fitments", fitmentRows, 100, "vehicle_application_id,wiper_configuration_id");

  if (authoritative) {
    const { data: source, error: sourceError } = await db.from("catalog_data_sources")
      .select("id,metadata").eq("code", "WIPER_MASTER").single();
    if (sourceError) throw sourceError;
    const { error: priorityError } = await db.from("catalog_data_sources").update({
      vehicle_identity_priority: 5,
      product_fitment_priority: 1,
      metadata: {
        ...(source.metadata ?? {}),
        authoritative_vehicle_identity: true,
        authoritative_product_fitment: true,
        conflict_policy: "user_source_overrides_external_sources"
      }
    }).eq("id", source.id);
    if (priorityError) throw priorityError;
  }

  console.log(JSON.stringify({
    applied: true,
    authoritative,
    backup: backupPath,
    published_fitments: fitmentRows.length,
    superseded_observations: overriddenObservationIds.length
  }, null, 2));
}

function readSheet(workbook, name) {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Worksheet not found: ${name}`);
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

function frontPairKey(driver, passenger) {
  const values = [Number(driver), Number(passenger)].sort((left, right) => right - left);
  return `${values[0]}/${values[1]}`;
}

function parseConfigurationKey(value) {
  const match = String(value).match(/^(\d+)\/(\d+)\/(\d+|-)$/);
  if (!match) return null;
  return {
    driver: Number(match[1]),
    passenger: Number(match[2]),
    rear: match[3] === "-" ? null : Number(match[3])
  };
}

function assertUnique(rows, key, label) {
  const values = rows.map((row) => row[key]);
  if (!values.every(Boolean) || new Set(values).size !== values.length) throw new Error(`${label} are missing unique ${key} values.`);
}

async function selectAll(query, size = 500) {
  const rows = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await query.range(from, from + size - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < size) return rows;
  }
}

async function selectInChunks(client, table, column, values, columns) {
  const rows = [];
  for (let index = 0; index < values.length; index += 150) {
    rows.push(...await selectAll(client.from(table).select(columns).in(column, values.slice(index, index + 150))));
  }
  return rows;
}

async function insertChunks(client, table, rows, size) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).insert(rows.slice(index, index + size));
    if (error) throw error;
  }
}

async function upsertChunks(client, table, rows, size, onConflict) {
  for (let index = 0; index < rows.length; index += size) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + size), { onConflict });
    if (error) throw error;
  }
}

function groupBy(rows, keyFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    parsed[key] = next && !next.startsWith("--") ? values[++index] : true;
  }
  return parsed;
}

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
