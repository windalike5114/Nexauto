import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { normalKey } from "./enrich-wipertech-fitments.mjs";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { EXPANDED_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const FRONT_ONLY = process.argv.includes("--front-only");
const SOURCE_CODE = FRONT_ONLY
  ? "WIPERTECH_EQUIVALENT_FRONT_ONLY_2026_10_23"
  : "WIPERTECH_EQUIVALENT_APPLICATION_2026_10_23";
const OUTPUT_DIR = path.resolve(FRONT_ONLY
  ? "outputs/wiper-equivalence-front-only-20261023"
  : "outputs/wiper-equivalence-propagation-20261023");
const POPULAR_INDEX = buildPopularAliasIndex(EXPANDED_POPULAR_VEHICLE_GROUPS);

if (!process.argv.includes("--report-only") && !process.argv.includes("--apply")) {
  throw new Error("Choose --report-only or --apply.");
}

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const data = await loadData(db);
const prepared = preparePropagation(data);
const selectedCandidates = FRONT_ONLY ? prepared.frontOnlyCandidates : prepared.candidates;
const report = buildReport(data, prepared, selectedCandidates);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "equivalent_application_report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes("--apply")) {
  const applied = await applyPropagation(db, data, prepared, selectedCandidates, report);
  fs.writeFileSync(path.join(OUTPUT_DIR, "equivalent_application_applied.json"), JSON.stringify(applied, null, 2));
  console.log(JSON.stringify({ applied: true, ...applied }, null, 2));
}

export function preparePropagation(data) {
  const variantsById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const modelsById = new Map(data.models.map((row) => [row.model_id, row]));
  const makesById = new Map(data.makes.map((row) => [row.make_id, row]));
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const configurationByKey = new Map(data.configurations.map((row) => [row.configuration_key, row]));
  const publishedByApplication = groupBy(data.published, (row) => row.application_id);
  const duplicatePublishedApplications = [...publishedByApplication.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([applicationId, rows]) => ({ applicationId, count: rows.length }));
  if (duplicatePublishedApplications.length) {
    throw new Error(`Found ${duplicatePublishedApplications.length} applications with duplicate published fitments.`);
  }

  const activeApplications = data.applications.filter((row) => row.status === "active");
  const skippedApplications = [];
  const groups = new Map();
  for (const application of activeApplications) {
    const variant = variantsById.get(application.variant_id);
    const generation = seriesById.get(application.series_id);
    const model = modelsById.get(application.model_id);
    const make = makesById.get(model?.make_id);
    const body = normalKey(variant?.body_style);
    if (!application.series_id || !generation || !body || body === "unknown" || !model || !make) {
      skippedApplications.push({ applicationId: application.application_id, reason: "missing_series_body_or_model" });
      continue;
    }
    const key = `${application.model_id}|${application.series_id}|${body}`;
    const group = groups.get(key) ?? {
      key,
      make: make.name,
      model: model.name,
      modelKey: canonicalModelKey(make.name, model.name),
      seriesId: application.series_id,
      seriesCode: generation.code,
      seriesName: generation.display_name,
      bodyStyle: variant.body_style,
      applications: []
    };
    group.applications.push(application);
    groups.set(key, group);
  }

  const safeGroups = [];
  const conflictGroups = [];
  const noWiperTechEvidenceGroups = [];
  const candidates = [];
  const frontOnlyCandidates = [];
  for (const group of groups.values()) {
    const publishedRows = group.applications.flatMap((application) => publishedByApplication.get(application.application_id) ?? []);
    const wiperTechRows = publishedRows.filter((row) => String(row.source ?? "").startsWith("WIPERTECH_"));
    if (!wiperTechRows.length) {
      noWiperTechEvidenceGroups.push(group);
      continue;
    }
    const configurationIds = [...new Set(publishedRows.map((row) => row.wiper_configuration_id))];
    if (configurationIds.length !== 1) {
      const configurationKeys = configurationIds.map((id) => configurationById.get(id)?.configuration_key).filter(Boolean);
      const frontKeys = [...new Set(configurationKeys.map((key) => key.split("/").slice(0, 2).join("/")))];
      const targets = group.applications.filter((application) => !publishedByApplication.has(application.application_id));
      const donorApplicationIds = [...new Set(wiperTechRows.map((row) => row.application_id))];
      const donorSources = [...new Set(wiperTechRows.map((row) => row.source))].sort();
      if (targets.length && frontKeys.length === 1 && frontKeys[0] !== "-/-") {
        const frontOnlyConfigurationKey = `${frontKeys[0]}/-`;
        for (const application of targets) {
          frontOnlyCandidates.push({
            applicationId: application.application_id,
            configurationId: configurationByKey.get(frontOnlyConfigurationKey)?.id ?? null,
            configurationKey: frontOnlyConfigurationKey,
            equivalenceKey: group.key,
            make: group.make,
            model: group.model,
            modelKey: group.modelKey,
            seriesCode: group.seriesCode,
            seriesName: group.seriesName,
            bodyStyle: group.bodyStyle,
            donorApplicationIds,
            donorSources
          });
        }
      }
      conflictGroups.push({
        ...compactGroup(group),
        configurations: configurationKeys,
        frontKeys,
        frontOnlyEligibleTargets: frontKeys.length === 1 ? targets.length : 0,
        publishedApplications: publishedRows.length,
        uncoveredApplications: group.applications.filter((application) => !publishedByApplication.has(application.application_id)).length
      });
      continue;
    }
    const configurationId = configurationIds[0];
    const configurationKey = configurationById.get(configurationId)?.configuration_key;
    if (!configurationKey) throw new Error(`Missing configuration ${configurationId}.`);
    const targets = group.applications.filter((application) => !publishedByApplication.has(application.application_id));
    const donorApplicationIds = [...new Set(wiperTechRows.map((row) => row.application_id))];
    const donorSources = [...new Set(wiperTechRows.map((row) => row.source))].sort();
    safeGroups.push({ ...compactGroup(group), configurationId, configurationKey, donorApplicationIds, donorSources, targetCount: targets.length });
    for (const application of targets) {
      candidates.push({
        applicationId: application.application_id,
        configurationId,
        configurationKey,
        equivalenceKey: group.key,
        make: group.make,
        model: group.model,
        modelKey: group.modelKey,
        seriesCode: group.seriesCode,
        seriesName: group.seriesName,
        bodyStyle: group.bodyStyle,
        donorApplicationIds,
        donorSources
      });
    }
  }

  return {
    activeApplications,
    publishedByApplication,
    groups,
    safeGroups,
    conflictGroups,
    noWiperTechEvidenceGroups,
    skippedApplications,
    candidates,
    frontOnlyCandidates,
    duplicatePublishedApplications
  };
}

function buildReport(data, prepared, selectedCandidates) {
  const publishedBefore = new Set(data.published.map((row) => row.application_id));
  const publishedAfter = new Set([...publishedBefore, ...selectedCandidates.map((row) => row.applicationId)]);
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  return {
    source: SOURCE_CODE,
    mode: FRONT_ONLY ? "unique_front_with_ambiguous_rear_omitted" : "unique_complete_configuration",
    rule: FRONT_ONLY
      ? "exact model_id + exact series_id + normalized exact body_style; require one unique front pair across published configurations; omit ambiguous rear"
      : "exact model_id + exact series_id + normalized exact body_style; ignore engine, powertrain, drive, transmission and trim; require one published configuration across the entire group and at least one WiperTech donor",
    productionBefore: {
      activeApplications: prepared.activeApplications.length,
      publishedApplications: publishedBefore.size
    },
    grouping: {
      equivalenceGroups: prepared.groups.size,
      safeGroups: prepared.safeGroups.length,
      safeGroupsWithTargets: prepared.safeGroups.filter((row) => row.targetCount > 0).length,
      conflictingGroups: prepared.conflictGroups.length,
      groupsWithoutWiperTechEvidence: prepared.noWiperTechEvidenceGroups.length,
      skippedApplicationsMissingKeyFields: prepared.skippedApplications.length
    },
    propagation: {
      candidateApplications: selectedCandidates.length,
      projectedPublishedApplications: publishedAfter.size,
      configurations: countBy(selectedCandidates, (row) => row.configurationKey),
      makes: countBy(selectedCandidates, (row) => row.make),
      popularCandidateApplications: selectedCandidates.filter((row) => isPopular(row.modelKey)).length,
      allFrontOnlyOpportunityApplications: prepared.frontOnlyCandidates.length
    },
    popular2010To2026: {
      before: coverage2010To2026(prepared.activeApplications, yearsByApplication, data.models, data.makes, publishedBefore),
      projectedAfter: coverage2010To2026(prepared.activeApplications, yearsByApplication, data.models, data.makes, publishedAfter)
    },
    conflictExamples: prepared.conflictGroups.slice(0, 50)
  };
}

async function applyPropagation(client, data, prepared, candidates, report) {
  if (prepared.duplicatePublishedApplications.length) throw new Error("Refusing to apply with duplicate published applications.");
  const backupDir = await writeBackup(client, report);
  const now = new Date().toISOString();
  const configurationByKey = new Map(data.configurations.map((row) => [row.configuration_key, row.id]));
  for (const row of candidates) {
    if (configurationByKey.has(row.configurationKey)) continue;
    const [driver, passenger, rear] = row.configurationKey.split("/").map((value) => value === "-" ? null : Number(value));
    const { data: configurationId, error } = await client.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: driver,
      p_passenger_length_in: passenger,
      p_rear_length_in: rear
    });
    if (error) throw error;
    configurationByKey.set(row.configurationKey, configurationId);
  }
  const payload = candidates.map((row) => ({
    application_id: row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: [
      `rule=${FRONT_ONLY ? "exact_model_series_body_unique_front_rear_omitted" : "exact_model_series_body_unique_configuration"}`,
      `equivalence_key=${row.equivalenceKey}`,
      `configuration=${row.configurationKey}`,
      `donor_applications=${row.donorApplicationIds.join(",")}`,
      `donor_sources=${row.donorSources.join(",")}`
    ].join("; "),
    updated_at: now
  }));
  for (const rows of chunks(payload, 200)) {
    const { error } = await client.from("vehicle_catalog_wiper_fitments").upsert(rows, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }

  const targetIds = payload.map((row) => row.application_id);
  const verified = await selectInChunks(client, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", "application_id", targetIds);
  const published = verified.filter((row) => row.fitment_status === "published");
  const byApplication = groupBy(published, (row) => row.application_id);
  const duplicates = [...byApplication.values()].filter((rows) => rows.length !== 1);
  const expected = new Map(payload.map((row) => [row.application_id, row.wiper_configuration_id]));
  const missingOrWrong = targetIds.filter((id) => {
    const rows = byApplication.get(id) ?? [];
    return rows.length !== 1 || rows[0].wiper_configuration_id !== expected.get(id);
  });
  if (duplicates.length || missingOrWrong.length) {
    throw new Error(`Post-apply verification failed: duplicate=${duplicates.length}, missing_or_wrong=${missingOrWrong.length}`);
  }
  const totalPublished = await exactCount(client, "vehicle_catalog_wiper_fitments", (query) => query.eq("fitment_status", "published"));
  return {
    appliedAt: now,
    backupDir,
    propagatedApplications: payload.length,
    totalPublishedApplications: totalPublished,
    duplicateTargetApplications: 0,
    missingOrWrongTargetApplications: 0,
    source: SOURCE_CODE,
    popular2010To2026ProjectedAfter: report.popular2010To2026.projectedAfter
  };
}

function coverage2010To2026(applications, yearsByApplication, models, makes, publishedIds) {
  const modelById = new Map(models.map((row) => [row.model_id, row]));
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const groups = new Map();
  for (const application of applications) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const modelKey = canonicalModelKey(make?.name, model?.name);
    if (!isPopular(modelKey)) continue;
    for (const row of yearsByApplication.get(application.application_id) ?? []) {
      const year = Number(row.model_year);
      if (year < 2010 || year > 2026) continue;
      const key = `${POPULAR_INDEX.get(modelKey).id}|${year}`;
      const ids = groups.get(key) ?? new Set();
      ids.add(application.application_id);
      groups.set(key, ids);
    }
  }
  let any = 0;
  let full = 0;
  let applicationYears = 0;
  let publishedApplicationYears = 0;
  for (const ids of groups.values()) {
    const covered = [...ids].filter((id) => publishedIds.has(id)).length;
    any += Number(covered > 0);
    full += Number(covered === ids.size);
    applicationYears += ids.size;
    publishedApplicationYears += covered;
  }
  return {
    modelYears: groups.size,
    anyPublishedModelYears: any,
    anyPublishedPercent: percent(any, groups.size),
    fullyPublishedModelYears: full,
    fullyPublishedPercent: percent(full, groups.size),
    applicationYears,
    publishedApplicationYears,
    applicationYearPercent: percent(publishedApplicationYears, applicationYears)
  };
}

async function loadData(client) {
  const [applications, years, variants, series, models, makes, published, configurations] = await Promise.all([
    fetchAll(client, "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,powertrain_id,status"),
    fetchAll(client, "vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll(client, "vehicle_catalog_variants", "variant_id,body_style,display_name"),
    fetchAll(client, "vehicle_catalog_series", "series_id,model_id,code,display_name,status"),
    fetchAll(client, "vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll(client, "vehicle_catalog_makes", "make_id,name,status"),
    fetchAll(client, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", (query) => query.eq("fitment_status", "published")),
    fetchAll(client, "wiper_configurations", "id,configuration_key,configuration_status")
  ]);
  return { applications, years, variants, series, models, makes, published, configurations };
}

async function writeBackup(client, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve("tmp/production-backups", `wiper-equivalence-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "vehicle_catalog_wiper_fitments.json"), JSON.stringify(await fetchAll(client, "vehicle_catalog_wiper_fitments", "*"), null, 2));
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), source: SOURCE_CODE, report }, null, 2));
  return directory;
}

function compactGroup(group) {
  return {
    equivalenceKey: group.key,
    make: group.make,
    model: group.model,
    seriesCode: group.seriesCode,
    seriesName: group.seriesName,
    bodyStyle: group.bodyStyle,
    applications: group.applications.length
  };
}

function isPopular(modelKey) {
  return POPULAR_INDEX.has(modelKey);
}

function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(1)) : 0; }
function countBy(rows, keyFn) { const output = {}; for (const row of rows) { const key = keyFn(row); output[key] = (output[key] ?? 0) + 1; } return output; }
function groupBy(rows, keyFn) { const output = new Map(); for (const row of rows) { const key = keyFn(row); const values = output.get(key) ?? []; values.push(row); output.set(key, values); } return output; }
function chunks(rows, size) { const output = []; for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size)); return output; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
async function fetchAll(client, table, columns, applyFilter = (query) => query) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await applyFilter(client.from(table).select(columns)).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
async function exactCount(client, table, applyFilter = (query) => query) { const { count, error } = await applyFilter(client.from(table).select("*", { count: "exact", head: true })); if (error) throw error; return count ?? 0; }
async function selectInChunks(client, table, columns, column, values) { const output = []; for (const valueChunk of chunks([...new Set(values)], 200)) { const { data, error } = await client.from(table).select(columns).in(column, valueChunk); if (error) throw error; output.push(...data); } return output; }
