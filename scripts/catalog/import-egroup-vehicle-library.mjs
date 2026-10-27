import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const ROOT = process.cwd();
const DEFAULT_PACKAGE_DIR = path.join(ROOT, "outputs", "vehicle-library-egroup-20261024", "package");
const OUTPUT_DIR = path.join(ROOT, "outputs", "vehicle-library-egroup-20261024");
const RELEASE_ID = "nexauto-vehicle-catalog-egroup-2026-10-24";
const SOURCE_NAME = "Repco Egroup additive vehicle catalogue (2026-10-24)";

const FILES = {
  makes: ["make.csv", "vehicle_catalog_makes", ["make_id"]],
  models: ["model.csv", "vehicle_catalog_models", ["model_id"]],
  series: ["series.csv", "vehicle_catalog_series", ["series_id"]],
  variants: ["variant.csv", "vehicle_catalog_variants", ["variant_id"]],
  powertrains: ["powertrain.csv", "vehicle_catalog_powertrains", ["powertrain_id"]],
  engineCodes: ["engine_code.csv", "vehicle_catalog_engine_codes", ["engine_code_id"]],
  powertrainEngineCodes: ["powertrain_engine_code.csv", "vehicle_catalog_powertrain_engine_codes", ["powertrain_id", "engine_code_id"]],
  applications: ["vehicle_application.csv", "vehicle_catalog_applications", ["application_id"]],
  applicationYears: ["application_year.csv", "vehicle_catalog_application_years", ["application_id", "model_year"]],
  provenance: ["application_provenance.csv", "vehicle_catalog_application_provenance", ["application_id", "source_group", "source_url"]],
  reviewIssues: ["review_issue.csv", "vehicle_catalog_review_issues", ["issue_id"]],
  sourceFailures: ["source_failure.csv", "vehicle_catalog_source_failures", ["failure_id"]],
};

const DIMENSIONS = ["makes", "models", "series", "variants", "powertrains", "engineCodes"];
const INSERT_ORDER = ["makes", "models", "variants", "powertrains", "engineCodes", "powertrainEngineCodes", "series"];

loadEnv(path.join(ROOT, ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase service credentials are missing.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const args = new Set(process.argv.slice(2));
const packageArgIndex = process.argv.indexOf("--package");
const packageDir = path.resolve(packageArgIndex >= 0 ? process.argv[packageArgIndex + 1] : DEFAULT_PACKAGE_DIR);
if (!args.has("--report-only") && !args.has("--apply")) throw new Error("Choose --report-only or --apply.");

const source = loadPackage(packageDir);
const production = await loadProduction();
const plan = buildPlan(source, production, packageDir);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const reportPath = path.join(OUTPUT_DIR, args.has("--apply") ? "egroup-import-applied.json" : "egroup-import-preflight.json");
writeJson(reportPath, publicReport(plan));
process.stdout.write(`${JSON.stringify(publicReport(plan), null, 2)}\n`);

if (plan.blockers.length) throw new Error(`Preflight blocked by ${plan.blockers.length} conflict(s). See ${reportPath}`);
if (args.has("--apply")) {
  const backupDir = createBackup(plan, production);
  const baseline = await fitmentCounts();
  await applyPlan(plan);
  const verification = await verify(plan, baseline);
  plan.report.applied = true;
  plan.report.applied_at = new Date().toISOString();
  plan.report.backup_directory = backupDir;
  plan.report.verification = verification;
  writeJson(reportPath, publicReport(plan));
  process.stdout.write(`${JSON.stringify({ applied: true, backupDir, reportPath, verification }, null, 2)}\n`);
}

function loadPackage(directory) {
  const data = {};
  for (const [keyName, [filename]] of Object.entries(FILES)) {
    const filePath = path.join(directory, filename);
    if (!fs.existsSync(filePath)) throw new Error(`Missing package file: ${filePath}`);
    data[keyName] = readCsv(filePath).map(normalizeRow);
  }
  validatePackage(data);
  return data;
}

async function loadProduction() {
  const entries = await Promise.all([
    ...Object.entries(FILES).map(async ([keyName, [, table, keys]]) => [keyName, await fetchAll(table, "*", keys)]),
    ["releases", await fetchAll("vehicle_catalog_releases", "*", ["release_id"])],
  ]);
  return Object.fromEntries(entries);
}

function buildPlan(sourceData, prod, directory) {
  const blockers = [];
  const warnings = [];
  const inserts = {};
  const reused = {};
  const displayDifferences = {};

  for (const keyName of DIMENSIONS) {
    const [,, primaryKeys] = FILES[keyName];
    const existingByPk = mapBy(prod[keyName], (row) => tupleKey(row, primaryKeys));
    const businessFields = businessKeyFields(keyName);
    const existingByBusiness = mapBy(prod[keyName], (row) => tupleKey(row, businessFields));
    inserts[keyName] = [];
    reused[keyName] = [];
    displayDifferences[keyName] = [];
    for (const row of sourceData[keyName]) {
      const pk = tupleKey(row, primaryKeys);
      const business = tupleKey(row, businessFields);
      const byPk = existingByPk.get(pk);
      const byBusiness = existingByBusiness.get(business);
      if (byPk) {
        if (tupleKey(byPk, businessFields) !== business) blockers.push({ type: "PRIMARY_KEY_IDENTITY_CONFLICT", table: FILES[keyName][1], key: pk, source: row, production: byPk });
        else {
          reused[keyName].push(row);
          const changes = changedDisplayFields(keyName, byPk, row);
          if (changes.length) displayDifferences[keyName].push({ key: pk, fields: changes });
        }
      } else if (byBusiness) {
        blockers.push({ type: "BUSINESS_KEY_ID_CONFLICT", table: FILES[keyName][1], key: business, source: row, production: byBusiness });
      } else inserts[keyName].push(row);
    }
  }

  const linkKeys = new Set(prod.powertrainEngineCodes.map((row) => tupleKey(row, FILES.powertrainEngineCodes[2])));
  inserts.powertrainEngineCodes = sourceData.powertrainEngineCodes.filter((row) => !linkKeys.has(tupleKey(row, FILES.powertrainEngineCodes[2])));
  reused.powertrainEngineCodes = sourceData.powertrainEngineCodes.filter((row) => linkKeys.has(tupleKey(row, FILES.powertrainEngineCodes[2])));

  const prodYearsByApp = groupBy(prod.applicationYears, (row) => row.application_id);
  const sourceYearsByApp = groupBy(sourceData.applicationYears, (row) => row.application_id);
  const activeByIdentityYear = new Map();
  for (const app of prod.applications.filter((row) => row.status === "active")) {
    const identity = applicationIdentity(app);
    for (const yearRow of prodYearsByApp.get(app.application_id) ?? []) {
      const keyValue = `${identity}|${Number(yearRow.model_year)}`;
      const list = activeByIdentityYear.get(keyValue) ?? [];
      list.push(app.application_id);
      activeByIdentityYear.set(keyValue, list);
    }
  }

  const sourceAppsByIdentity = groupBy(sourceData.applications, applicationIdentity);
  const yearTarget = new Map();
  const newApplications = [];
  const newApplicationYears = [];
  let sourceYearsReused = 0;
  let sourceYearsNew = 0;

  for (const [identity, apps] of sourceAppsByIdentity) {
    const sourceYears = uniqueSorted(apps.flatMap((app) => (sourceYearsByApp.get(app.application_id) ?? []).map((row) => Number(row.model_year))));
    const missing = [];
    for (const year of sourceYears) {
      const candidates = activeByIdentityYear.get(`${identity}|${year}`) ?? [];
      if (candidates.length > 1) blockers.push({ type: "MULTIPLE_ACTIVE_APPLICATIONS_FOR_IDENTITY_YEAR", identity, model_year: year, application_ids: candidates });
      else if (candidates.length === 1) {
        yearTarget.set(`${identity}|${year}`, candidates[0]);
        sourceYearsReused += 1;
      } else missing.push(year);
    }
    for (const [yearFrom, yearTo] of compressYears(missing)) {
      const example = apps[0];
      const canonicalKey = [example.model_id, example.series_id ?? "", example.variant_id, example.powertrain_id, yearFrom, yearTo].join("|");
      const applicationId = stableId("ap", canonicalKey);
      const newApp = {
        application_id: applicationId,
        model_id: example.model_id,
        series_id: example.series_id,
        variant_id: example.variant_id,
        powertrain_id: example.powertrain_id,
        year_from: yearFrom,
        year_to: yearTo,
        year_status: "observed_range",
        canonical_key: canonicalKey,
        status: "active",
        review_status: "unreviewed",
      };
      const byId = prod.applications.find((row) => row.application_id === applicationId);
      const byCanonical = prod.applications.find((row) => row.canonical_key === canonicalKey);
      if (byId || byCanonical) blockers.push({ type: "INACTIVE_OR_CONFLICTING_APPLICATION_ALREADY_EXISTS", application_id: applicationId, canonical_key: canonicalKey, production: byId ?? byCanonical });
      newApplications.push(newApp);
      for (let year = yearFrom; year <= yearTo; year += 1) {
        newApplicationYears.push({ application_id: applicationId, model_year: year });
        yearTarget.set(`${identity}|${year}`, applicationId);
        sourceYearsNew += 1;
      }
    }
  }

  const targetIdsBySourceApp = new Map();
  for (const sourceApp of sourceData.applications) {
    const identity = applicationIdentity(sourceApp);
    const targets = new Map();
    for (const yearRow of sourceYearsByApp.get(sourceApp.application_id) ?? []) {
      const targetId = yearTarget.get(`${identity}|${Number(yearRow.model_year)}`);
      if (!targetId) blockers.push({ type: "SOURCE_YEAR_WITHOUT_TARGET", application_id: sourceApp.application_id, model_year: yearRow.model_year });
      else targets.set(targetId, (targets.get(targetId) ?? 0) + 1);
    }
    targetIdsBySourceApp.set(sourceApp.application_id, targets);
  }

  const plannedProvenance = [];
  for (const row of sourceData.provenance) {
    const targets = targetIdsBySourceApp.get(row.application_id) ?? new Map();
    const allocations = allocateCount(Number(row.raw_record_count), targets);
    for (const [applicationId, rawRecordCount] of allocations) plannedProvenance.push({
      application_id: applicationId,
      source_group: row.source_group,
      source_url: row.source_url,
      raw_record_count: rawRecordCount,
      first_collected_at: row.first_collected_at,
      last_collected_at: row.last_collected_at,
    });
  }
  const provenance = mergeProvenance(plannedProvenance);

  const reviewIssues = [];
  for (const issue of sourceData.reviewIssues) {
    if (issue.entity_type === "vehicle_application") {
      const targets = targetIdsBySourceApp.get(issue.entity_id) ?? new Map();
      for (const applicationId of targets.keys()) reviewIssues.push({ ...issue, issue_id: stableId("is", applicationId, issue.issue_code), entity_id: applicationId });
    } else reviewIssues.push(issue);
  }
  const uniqueIssues = [...mapBy(reviewIssues, (row) => row.issue_id).values()];

  const productionIssueById = mapBy(prod.reviewIssues, (row) => row.issue_id);
  for (const issue of uniqueIssues) {
    const existing = productionIssueById.get(issue.issue_id);
    if (existing && (existing.entity_id !== issue.entity_id || existing.issue_code !== issue.issue_code)) blockers.push({ type: "REVIEW_ISSUE_ID_CONFLICT", source: issue, production: existing });
  }
  const productionFailureById = mapBy(prod.sourceFailures, (row) => row.failure_id);
  for (const failure of sourceData.sourceFailures) {
    const existing = productionFailureById.get(failure.failure_id);
    if (existing && (existing.message !== failure.message || existing.failure_kind !== failure.failure_kind)) blockers.push({ type: "SOURCE_FAILURE_ID_CONFLICT", source: failure, production: existing });
  }

  const packageHash = hashPackage(directory);
  const existingRelease = prod.releases.find((row) => row.release_id === RELEASE_ID || row.package_sha256 === packageHash);
  if (existingRelease && existingRelease.package_sha256 !== packageHash) blockers.push({ type: "RELEASE_ID_HASH_CONFLICT", production: existingRelease, package_sha256: packageHash });
  if (Object.values(displayDifferences).some((rows) => rows.length)) warnings.push("Existing canonical entities keep their current display text; Egroup display-only differences are not overwritten.");
  if (sourceData.sourceFailures.length) warnings.push(`${sourceData.sourceFailures.length} source collection failures remain recorded as review issues.`);

  inserts.applications = newApplications;
  inserts.applicationYears = newApplicationYears;
  inserts.provenance = provenance;
  inserts.reviewIssues = uniqueIssues.filter((row) => !productionIssueById.has(row.issue_id));
  inserts.sourceFailures = sourceData.sourceFailures.filter((row) => !productionFailureById.has(row.failure_id));

  const mappedExistingTargets = new Set();
  for (const target of yearTarget.values()) if (!newApplications.some((row) => row.application_id === target)) mappedExistingTargets.add(target);
  const report = {
    generated_at: new Date().toISOString(),
    applied: false,
    release_id: RELEASE_ID,
    package_directory: directory,
    package_sha256: packageHash,
    source_counts: Object.fromEntries(Object.entries(sourceData).map(([name, rows]) => [name, rows.length])),
    production_counts_before: Object.fromEntries(Object.entries(prod).map(([name, rows]) => [name, rows.length])),
    dimensions: Object.fromEntries(DIMENSIONS.map((name) => [name, { new: inserts[name].length, reused: reused[name].length, display_differences_kept: displayDifferences[name].length }])),
    engine_code_links: { new: inserts.powertrainEngineCodes.length, reused: reused.powertrainEngineCodes.length },
    applications: {
      source_applications: sourceData.applications.length,
      mapped_to_existing_active_applications: mappedExistingTargets.size,
      new_applications: newApplications.length,
      source_application_years: sourceData.applicationYears.length,
      years_reused_from_existing_applications: sourceYearsReused,
      years_added: sourceYearsNew,
    },
    metadata: {
      provenance_rows_upserted: provenance.length,
      new_review_issues: inserts.reviewIssues.length,
      existing_review_issues_reused: uniqueIssues.length - inserts.reviewIssues.length,
      new_source_failures: inserts.sourceFailures.length,
      release_row_action: existingRelease ? "reuse" : "insert_inactive",
    },
    fitment_policy: "Existing applications retain their product and wiper fitments. New applications receive no automatic fitments.",
    warnings,
  };
  return { source: sourceData, production: prod, inserts, provenance, reviewIssues: uniqueIssues, blockers, warnings, report, mappedExistingTargets: [...mappedExistingTargets], packageHash, existingRelease };
}

async function applyPlan(plan) {
  for (const keyName of INSERT_ORDER) {
    const [, table] = FILES[keyName];
    await insertRows(table, plan.inserts[keyName]);
  }
  await insertRows("vehicle_catalog_applications", plan.inserts.applications);
  await insertRows("vehicle_catalog_application_years", plan.inserts.applicationYears);
  await upsertRows("vehicle_catalog_application_provenance", plan.provenance, "application_id,source_group,source_url");
  await upsertRows("vehicle_catalog_source_failures", plan.source.sourceFailures, "failure_id");
  await upsertRows("vehicle_catalog_review_issues", plan.reviewIssues, "issue_id");
  if (!plan.existingRelease) await insertRows("vehicle_catalog_releases", [{
    release_id: RELEASE_ID,
    package_sha256: plan.packageHash,
    source_name: SOURCE_NAME,
    counts: {
      source: plan.report.source_counts,
      inserted: Object.fromEntries(Object.entries(plan.inserts).map(([name, rows]) => [name, rows.length])),
    },
    active: false,
  }]);
}

async function verify(plan, baselineFitments) {
  const insertedChecks = {};
  for (const [keyName, rows] of Object.entries(plan.inserts)) {
    if (!rows.length || !FILES[keyName]) continue;
    const [, table, keys] = FILES[keyName];
    insertedChecks[keyName] = await verifyRowsExist(table, rows, keys);
  }
  insertedChecks.provenance = await verifyRowsExist("vehicle_catalog_application_provenance", plan.provenance, FILES.provenance[2]);
  insertedChecks.reviewIssues = await verifyRowsExist("vehicle_catalog_review_issues", plan.reviewIssues, FILES.reviewIssues[2]);
  insertedChecks.sourceFailures = await verifyRowsExist("vehicle_catalog_source_failures", plan.source.sourceFailures, FILES.sourceFailures[2]);
  const afterFitments = await fitmentCounts();
  if (afterFitments.product_fitments !== baselineFitments.product_fitments || afterFitments.wiper_fitments !== baselineFitments.wiper_fitments) {
    throw new Error(`Existing fitment counts changed unexpectedly: ${JSON.stringify({ baselineFitments, afterFitments })}`);
  }
  const newAppIds = new Set(plan.inserts.applications.map((row) => row.application_id));
  const duplicateNewYearKeys = plan.inserts.applicationYears.filter((row) => {
    const identity = applicationIdentity(plan.inserts.applications.find((app) => app.application_id === row.application_id));
    const existing = plan.production.applications.filter((app) => app.status === "active" && applicationIdentity(app) === identity);
    const prodYears = groupBy(plan.production.applicationYears, (item) => item.application_id);
    return existing.some((app) => (prodYears.get(app.application_id) ?? []).some((item) => Number(item.model_year) === Number(row.model_year)));
  });
  if (duplicateNewYearKeys.length) throw new Error(`Verification found ${duplicateNewYearKeys.length} new identity/year overlaps.`);
  return {
    ok: true,
    inserted_rows_verified: insertedChecks,
    new_application_ids: newAppIds.size,
    fitment_counts_unchanged: true,
    fitments_before: baselineFitments,
    fitments_after: afterFitments,
    identity_year_overlaps_created: 0,
  };
}

function createBackup(plan, prod) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `egroup-vehicle-import-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const mapped = new Set(plan.mappedExistingTargets);
  const mappedIssues = new Set(plan.reviewIssues.map((row) => row.issue_id));
  const mappedFailures = new Set(plan.source.sourceFailures.map((row) => row.failure_id));
  const tables = {
    vehicle_catalog_releases: prod.releases,
    vehicle_catalog_applications: prod.applications.filter((row) => mapped.has(row.application_id)),
    vehicle_catalog_application_years: prod.applicationYears.filter((row) => mapped.has(row.application_id)),
    vehicle_catalog_application_provenance: prod.provenance.filter((row) => mapped.has(row.application_id)),
    vehicle_catalog_review_issues: prod.reviewIssues.filter((row) => mappedIssues.has(row.issue_id) || mapped.has(row.entity_id)),
    vehicle_catalog_source_failures: prod.sourceFailures.filter((row) => mappedFailures.has(row.failure_id)),
  };
  const manifest = { created_at: new Date().toISOString(), purpose: "Pre-import backup for additive Egroup vehicle catalogue", release_id: RELEASE_ID, package_sha256: plan.packageHash, tables: {} };
  for (const [table, rows] of Object.entries(tables)) {
    const content = JSON.stringify(rows, null, 2);
    const filename = `${table}.json`;
    fs.writeFileSync(path.join(directory, filename), content);
    manifest.tables[table] = { rows: rows.length, file: filename, sha256: sha256(content) };
  }
  writeJson(path.join(directory, "manifest.json"), manifest);
  return directory;
}

function publicReport(plan) {
  return { ...plan.report, blockers: plan.blockers, blocker_count: plan.blockers.length };
}

function validatePackage(data) {
  for (const [keyName, [, , keys]] of Object.entries(FILES)) {
    const seen = new Set();
    for (const row of data[keyName]) {
      const keyValue = tupleKey(row, keys);
      if (keys.some((key) => row[key] === null || row[key] === undefined || row[key] === "")) throw new Error(`Missing package key in ${keyName}: ${keyValue}`);
      if (seen.has(keyValue)) throw new Error(`Duplicate package key in ${keyName}: ${keyValue}`);
      seen.add(keyValue);
    }
  }
  const makeIds = new Set(data.makes.map((row) => row.make_id));
  const modelIds = new Set(data.models.map((row) => row.model_id));
  const seriesIds = new Set(data.series.map((row) => row.series_id));
  const variantIds = new Set(data.variants.map((row) => row.variant_id));
  const powertrainIds = new Set(data.powertrains.map((row) => row.powertrain_id));
  for (const row of data.models) assertRef(makeIds, row.make_id, `model ${row.model_id}`);
  for (const row of data.series) assertRef(modelIds, row.model_id, `series ${row.series_id}`);
  for (const row of data.powertrains) assertRef(makeIds, row.make_id, `powertrain ${row.powertrain_id}`);
  for (const row of data.applications) {
    assertRef(modelIds, row.model_id, `application ${row.application_id}`);
    if (row.series_id) assertRef(seriesIds, row.series_id, `application ${row.application_id}`);
    assertRef(variantIds, row.variant_id, `application ${row.application_id}`);
    assertRef(powertrainIds, row.powertrain_id, `application ${row.application_id}`);
  }
}

function businessKeyFields(keyName) {
  return {
    makes: ["normalized_name"],
    models: ["make_id", "normalized_name"],
    series: ["model_id", "normalized_code"],
    variants: ["normalized_name"],
    powertrains: ["make_id", "normalized_name"],
    engineCodes: ["make_id", "normalized_code"],
  }[keyName];
}

function changedDisplayFields(keyName, productionRow, sourceRow) {
  const fields = {
    makes: ["name"], models: ["name"], series: ["code", "display_name"], variants: ["raw_name", "display_name"],
    powertrains: ["raw_name", "display_name", "short_display_name"], engineCodes: ["code"],
  }[keyName] ?? [];
  return fields.filter((field) => normalizeComparable(productionRow[field]) !== normalizeComparable(sourceRow[field]));
}

function allocateCount(total, targets) {
  const entries = [...targets.entries()].sort(([left], [right]) => left.localeCompare(right));
  const denominator = entries.reduce((sum, [, years]) => sum + years, 0);
  if (!entries.length || denominator === 0) return [];
  const raw = entries.map(([id, years]) => ({ id, exact: total * years / denominator }));
  const output = raw.map((item) => [item.id, Math.floor(item.exact)]);
  let remaining = total - output.reduce((sum, [, value]) => sum + value, 0);
  const order = raw.map((item, index) => ({ index, fraction: item.exact - Math.floor(item.exact), id: item.id }))
    .sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  for (let index = 0; index < remaining; index += 1) output[order[index % order.length].index][1] += 1;
  return output;
}

function mergeProvenance(rows) {
  const groups = groupBy(rows, (row) => tupleKey(row, FILES.provenance[2]));
  return [...groups.values()].map((items) => ({
    ...items[0],
    raw_record_count: items.reduce((sum, row) => sum + Number(row.raw_record_count), 0),
    first_collected_at: items.map((row) => row.first_collected_at).filter(Boolean).sort()[0] ?? null,
    last_collected_at: items.map((row) => row.last_collected_at).filter(Boolean).sort().at(-1) ?? null,
  }));
}

function applicationIdentity(row) { return [row.model_id, row.series_id ?? "", row.variant_id, row.powertrain_id].join("|"); }
function stableId(prefix, ...parts) { return `${prefix}_${crypto.createHash("sha256").update(parts.map((part) => normalizeIdPart(part)).join("\x1f")).digest("hex").slice(0, 20)}`; }
function normalizeIdPart(value) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase(); }
function compressYears(years) {
  const values = uniqueSorted(years);
  const ranges = [];
  for (const year of values) {
    const last = ranges.at(-1);
    if (!last || year > last[1] + 1) ranges.push([year, year]);
    else last[1] = year;
  }
  return ranges;
}

async function fetchAll(table, columns, orderFields = []) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    let query = db.from(table).select(columns).range(from, from + 999);
    for (const field of orderFields) query = query.order(field, { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    output.push(...data);
    if (data.length < 1000) break;
  }
  return output;
}

async function insertRows(table, rows, size = 300) {
  for (let start = 0; start < rows.length; start += size) {
    const { error } = await db.from(table).insert(rows.slice(start, start + size));
    if (error) throw new Error(`Could not insert ${table} at row ${start + 1}: ${error.message}`);
  }
}

async function upsertRows(table, rows, onConflict, size = 300) {
  for (let start = 0; start < rows.length; start += size) {
    const { error } = await db.from(table).upsert(rows.slice(start, start + size), { onConflict });
    if (error) throw new Error(`Could not upsert ${table} at row ${start + 1}: ${error.message}`);
  }
}

async function verifyRowsExist(table, rows, keys) {
  if (!rows.length) return { expected: 0, found: 0 };
  const primary = keys[0];
  const values = [...new Set(rows.map((row) => row[primary]))];
  let foundRows = [];
  // Composite-key child tables can return many rows for each first-key value.
  // Keep each query comfortably below PostgREST's default 1,000-row page cap.
  const batchSize = table === "vehicle_catalog_application_years" ? 20 : 200;
  for (let start = 0; start < values.length; start += batchSize) {
    const { data, error } = await db.from(table).select(keys.join(",")).in(primary, values.slice(start, start + batchSize));
    if (error) throw new Error(`Could not verify ${table}: ${error.message}`);
    foundRows.push(...data);
  }
  const expectedKeys = new Set(rows.map((row) => tupleKey(row, keys)));
  const foundKeys = new Set(foundRows.map((row) => tupleKey(row, keys)));
  const missing = [...expectedKeys].filter((key) => !foundKeys.has(key));
  if (missing.length) throw new Error(`Verification missing ${missing.length} row(s) from ${table}.`);
  return { expected: expectedKeys.size, found: expectedKeys.size };
}

async function fitmentCounts() {
  return {
    product_fitments: await exactCount("vehicle_catalog_product_fitments"),
    wiper_fitments: await exactCount("vehicle_catalog_wiper_fitments"),
  };
}

async function exactCount(table) {
  const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Could not count ${table}: ${error.message}`);
  return count ?? 0;
}

function readCsv(file) {
  const workbook = XLSX.readFile(file, { raw: false });
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
}

function normalizeRow(row) {
  const numeric = new Set(["year_from", "year_to", "model_year", "displacement_cc", "cylinder_count", "valve_count", "raw_record_count", "gross_weight_ton"]);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (value === "") return [key, null];
    if (numeric.has(key)) return [key, Number(value)];
    if (key === "is_primary") return [key, value === "1" || String(value).toLowerCase() === "true"];
    return [key, value];
  }));
}

function mapBy(rows, keyFn) { const map = new Map(); for (const row of rows) map.set(keyFn(row), row); return map; }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const keyValue = keyFn(row); const values = map.get(keyValue) ?? []; values.push(row); map.set(keyValue, values); } return map; }
function tupleKey(row, fields) { return fields.map((field) => String(row[field] ?? "")).join("\x1f"); }
function uniqueSorted(values) { return [...new Set(values.map(Number))].sort((a, b) => a - b); }
function normalizeComparable(value) { return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim(); }
function assertRef(set, id, label) { if (!set.has(id)) throw new Error(`Missing reference ${id} for ${label}.`); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function hashPackage(directory) {
  const hash = crypto.createHash("sha256");
  for (const [filename] of Object.values(FILES)) hash.update(fs.readFileSync(path.join(directory, filename)));
  return hash.digest("hex");
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
