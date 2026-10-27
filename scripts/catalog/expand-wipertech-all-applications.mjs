import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { buildWiperTechRecords } from "./enrich-wipertech-fitments.mjs";
import { canonicalModelKey, resolveWiperTechPartialApplication } from "./wipertech-direct-matcher.mjs";

const ROOT = process.cwd();
const SOURCE_DIR = "C:/Users/Sanli/Desktop/database/wipertech";
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "wiper-all-catalog-expansion-20261024");
const SOURCE_CODE = "WIPERTECH_ALL_CATALOG_2026_10_24";
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--report-only") ? "report-only" : null;
if (!mode) throw new Error("Choose --report-only or --apply.");

loadEnv(path.resolve(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sourceVehicles = readCsv(path.join(SOURCE_DIR, "wipertech_vehicles.csv"));
const sourceProducts = readCsv(path.join(SOURCE_DIR, "wipertech_wipers.csv"));
const sourceMappings = readCsv(path.join(SOURCE_DIR, "wipertech_mapping.csv"));
const built = buildWiperTechRecords(sourceVehicles, sourceProducts, sourceMappings);
if (built.anomalies.length) throw new Error(`WiperTech source contains ${built.anomalies.length} mapping anomalies.`);
const sourceByModel = groupBy(built.records, (row) => canonicalModelKey(row.make, row.model));

const data = await loadProduction();
const prepared = prepare(data, sourceByModel);
const report = buildReport(prepared, data);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJson(path.join(OUTPUT_DIR, "preflight-report.json"), report);
writeCsv(path.join(OUTPUT_DIR, "publish-candidates.csv"), prepared.additions.map(flattenCandidate));
writeCsv(path.join(OUTPUT_DIR, "uncovered-review-queue.csv"), prepared.uncoveredReviews.map(flattenReview));
writeCsv(path.join(OUTPUT_DIR, "uncovered-summary-by-model.csv"), summarizeReviews(prepared.uncoveredReviews));
writeCsv(path.join(OUTPUT_DIR, "existing-conflicts.csv"), prepared.existingConflicts.map(flattenConflict));
console.log(JSON.stringify(report, null, 2));

if (mode === "apply") {
  if (prepared.duplicatePublished.length) throw new Error(`Refusing to apply with ${prepared.duplicatePublished.length} duplicate published applications.`);
  const applied = await apply(prepared, data);
  writeJson(path.join(OUTPUT_DIR, "applied-result.json"), { ...report, applied });
  console.log(JSON.stringify({ applied }, null, 2));
}

function prepare(data, sourceIndex) {
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const publishedByApplication = groupBy(data.fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const duplicatePublished = [...publishedByApplication.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([applicationId, rows]) => ({ applicationId, count: rows.length }));

  const applications = data.applications.filter((row) => row.status === "active").map((row) => {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(row.series_id);
    const variant = variantById.get(row.variant_id);
    return {
      applicationId: row.application_id,
      make: make?.name ?? "",
      model: model?.name ?? "",
      seriesCode: series?.code ?? "",
      seriesName: series?.display_name ?? "",
      variantName: variant?.display_name ?? "",
      bodyStyle: variant?.body_style ?? "",
      years: (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b),
    };
  });

  const additions = [];
  const uncoveredReviews = [];
  const corroboratedExisting = [];
  const existingConflicts = [];
  for (const application of applications) {
    const decision = resolveWiperTechPartialApplication(application, sourceIndex.get(canonicalModelKey(application.make, application.model)) ?? []);
    const published = publishedByApplication.get(application.applicationId) ?? [];
    if (decision.status !== "published") {
      if (!published.length) uncoveredReviews.push({ ...application, ...decision });
      continue;
    }
    const candidate = {
      ...application,
      configurationKey: decision.configurationKey,
      frontKey: decision.frontKey,
      driverLengthIn: decision.driverLengthIn,
      passengerLengthIn: decision.passengerLengthIn,
      rearLengthIn: decision.rearLengthIn,
      rule: decision.rule,
      confidence: decision.confidence,
      sourceVehicleIds: decision.sourceVehicleIds,
    };
    if (!published.length) {
      additions.push(candidate);
      continue;
    }
    const currentKeys = [...new Set(published.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key).filter(Boolean))];
    if (currentKeys.length === 1 && currentKeys[0] === candidate.configurationKey) corroboratedExisting.push(candidate);
    else existingConflicts.push({ ...candidate, currentConfigurationKeys: currentKeys });
  }
  return { applications, additions, uncoveredReviews, corroboratedExisting, existingConflicts, duplicatePublished };
}

function buildReport(prepared, data) {
  const publishedBefore = new Set(data.fitments.filter((row) => row.fitment_status === "published").map((row) => row.application_id));
  const activeIds = new Set(prepared.applications.map((row) => row.applicationId));
  const activePublishedBefore = new Set([...publishedBefore].filter((id) => activeIds.has(id)));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const addedYears = prepared.additions.reduce((sum, row) => sum + (yearsByApplication.get(row.applicationId) ?? []).length, 0);
  return {
    generated_at: new Date().toISOString(),
    source: SOURCE_CODE,
    policy: "All active production applications; publish only previously uncovered direct WiperTech partial/full matches. Existing conflicts are never overwritten.",
    source_rows: { vehicles: sourceVehicles.length, products: sourceProducts.length, mappings: sourceMappings.length },
    production_before: {
      active_applications: activeIds.size,
      active_published_applications: activePublishedBefore.size,
      active_application_coverage_percent: percent(activePublishedBefore.size, activeIds.size),
    },
    matching: {
      new_publish_candidates: prepared.additions.length,
      new_candidate_application_years: addedYears,
      corroborated_existing: prepared.corroboratedExisting.length,
      existing_conflicts_kept_for_review: prepared.existingConflicts.length,
      uncovered_review_applications: prepared.uncoveredReviews.length,
      uncovered_review_reasons: countBy(prepared.uncoveredReviews, (row) => row.reason),
      configurations: countBy(prepared.additions, (row) => row.configurationKey),
      makes: countBy(prepared.additions, (row) => row.make),
      duplicate_published_applications: prepared.duplicatePublished.length,
    },
    projected_after: {
      active_published_applications: activePublishedBefore.size + prepared.additions.length,
      active_application_coverage_percent: percent(activePublishedBefore.size + prepared.additions.length, activeIds.size),
    },
  };
}

async function apply(prepared, data) {
  const backupDir = await writeBackup(data);
  const configurationByKey = new Map(data.configurations.map((row) => [row.configuration_key, row.id]));
  for (const row of prepared.additions) {
    if (configurationByKey.has(row.configurationKey)) continue;
    const { data: id, error } = await db.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: row.driverLengthIn,
      p_passenger_length_in: row.passengerLengthIn,
      p_rear_length_in: row.rearLengthIn,
    });
    if (error) throw error;
    configurationByKey.set(row.configurationKey, id);
  }
  const now = new Date().toISOString();
  const payload = prepared.additions.map((row) => ({
    application_id: row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: [
      `rule=${row.rule}`,
      `confidence=${row.confidence}`,
      `configuration=${row.configurationKey}`,
      `source_vehicle_ids=${row.sourceVehicleIds.join(",")}`,
    ].join("; "),
    updated_at: now,
  }));
  for (const rows of chunks(payload, 200)) {
    const { error } = await db.from("vehicle_catalog_wiper_fitments").upsert(rows, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
  const configurationIds = [...new Set(payload.map((row) => row.wiper_configuration_id))];
  for (const ids of chunks(configurationIds, 200)) {
    const { error } = await db.from("wiper_configurations").update({ configuration_status: "published", updated_at: now }).in("id", ids);
    if (error) throw error;
  }
  const verified = await selectInChunks("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", "application_id", payload.map((row) => row.application_id));
  const publishedByApplication = groupBy(verified.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const expected = new Map(payload.map((row) => [row.application_id, row.wiper_configuration_id]));
  const failures = payload.filter((row) => {
    const rows = publishedByApplication.get(row.application_id) ?? [];
    return rows.length !== 1 || rows[0].wiper_configuration_id !== expected.get(row.application_id);
  });
  if (failures.length) throw new Error(`Post-apply verification failed for ${failures.length} application(s).`);
  return {
    applied_at: now,
    backup_directory: backupDir,
    published_applications: payload.length,
    verified_applications: payload.length,
    duplicate_or_wrong_targets: 0,
  };
}

async function loadProduction() {
  const [applications, years, models, makes, series, variants, fitments, configurations, blades, sizes] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,code,display_name,status"),
    fetchAll("vehicle_catalog_variants", "variant_id,body_style,display_name"),
    fetchAll("vehicle_catalog_wiper_fitments", "*"),
    fetchAll("wiper_configurations", "*"),
    fetchAll("wiper_configuration_blades", "*"),
    fetchAll("wiper_sizes", "*"),
  ]);
  return { applications, years, models, makes, series, variants, fitments, configurations, blades, sizes };
}

async function writeBackup(data) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp", "production-backups", `wiper-all-catalog-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "vehicle_catalog_wiper_fitments.json"), data.fitments);
  writeJson(path.join(directory, "wiper_configurations.json"), data.configurations);
  writeJson(path.join(directory, "wiper_configuration_blades.json"), data.blades);
  writeJson(path.join(directory, "wiper_sizes.json"), data.sizes);
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), source: SOURCE_CODE });
  return directory;
}

function flattenCandidate(row) {
  return {
    application_id: row.applicationId, make: row.make, model: row.model, series: row.seriesCode,
    variant: row.variantName, body_style: row.bodyStyle, years: row.years.join("|"),
    application_years: row.years.length, configuration: row.configurationKey,
    driver_in: row.driverLengthIn, passenger_in: row.passengerLengthIn, rear_in: row.rearLengthIn,
    rule: row.rule, confidence: row.confidence, source_vehicle_ids: row.sourceVehicleIds.join("|"),
  };
}

function flattenReview(row) {
  return {
    application_id: row.applicationId, make: row.make, model: row.model, series: row.seriesCode,
    variant: row.variantName, body_style: row.bodyStyle, years: row.years.join("|"), reason: row.reason,
    missing_years: (row.missingYears ?? []).join("|"),
    candidate_configurations: (row.candidateConfigurationKeys ?? row.candidateFrontKeys ?? []).join("|"),
    source_vehicle_ids: (row.candidateVehicleIds ?? []).join("|"),
  };
}

function flattenConflict(row) {
  return { ...flattenCandidate(row), current_configurations: row.currentConfigurationKeys.join("|") };
}

function summarizeReviews(rows) {
  const groups = groupBy(rows, (row) => `${row.reason}|${row.make}|${row.model}`);
  return [...groups.values()].map((items) => {
    const first = items[0];
    const yearSet = new Set(items.flatMap((row) => row.years));
    const missingYearSet = new Set(items.flatMap((row) => row.missingYears ?? []));
    const candidateConfigurations = new Set(items.flatMap((row) => row.candidateConfigurationKeys ?? row.candidateFrontKeys ?? []));
    return {
      priority: first.reason === "multiple_wipertech_configurations" ? "P0" : first.reason === "incomplete_year_coverage" ? "P1" : "P2",
      reason: first.reason,
      make: first.make,
      model: first.model,
      applications: items.length,
      application_years: items.reduce((sum, row) => sum + row.years.length, 0),
      catalog_year_min: yearSet.size ? Math.min(...yearSet) : "",
      catalog_year_max: yearSet.size ? Math.max(...yearSet) : "",
      missing_years: [...missingYearSet].sort((a, b) => a - b).join("|"),
      series_examples: [...new Set(items.map((row) => row.seriesCode).filter(Boolean))].slice(0, 20).join("|"),
      body_examples: [...new Set(items.map((row) => row.bodyStyle).filter(Boolean))].slice(0, 20).join("|"),
      candidate_configurations: [...candidateConfigurations].sort().join("|"),
      requested_evidence: first.reason === "no_make_model_source"
        ? "新增权威车型雨刷目录或车型别名证据"
        : first.reason === "incomplete_year_coverage"
          ? "确认WiperTech平台/代际与NexAuto底盘对应关系；确认后按NexAuto年份扩展"
          : "确认候选配置分别对应的底盘、车身和代际",
    };
  }).sort((left, right) => left.priority.localeCompare(right.priority) || right.application_years - left.application_years || left.make.localeCompare(right.make) || left.model.localeCompare(right.model));
}

function readCsv(file) {
  const book = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { defval: "", raw: false });
}
function writeCsv(file, rows) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  fs.writeFileSync(file, `\uFEFF${XLSX.utils.sheet_to_csv(sheet)}`, "utf8");
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function countBy(rows, keyFn) { const out = {}; for (const row of rows) { const key = keyFn(row) || "(blank)"; out[key] = (out[key] ?? 0) + 1; } return out; }
function groupBy(rows, keyFn) { const out = new Map(); for (const row of rows) { const key = keyFn(row); const values = out.get(key) ?? []; values.push(row); out.set(key, values); } return out; }
function chunks(rows, size) { const out = []; for (let index = 0; index < rows.length; index += size) out.push(rows.slice(index, index + size)); return out; }
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(1)) : 0; }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
async function fetchAll(table, columns) { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) return out; } }
async function selectInChunks(table, columns, column, values) { const out = []; for (const part of chunks([...new Set(values)], 200)) { const { data, error } = await db.from(table).select(columns).in(column, part); if (error) throw error; out.push(...data); } return out; }
