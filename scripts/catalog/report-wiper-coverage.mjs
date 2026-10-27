import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import {
  DEFAULT_POPULAR_VEHICLE_GROUPS,
  POPULAR_EXTENDED_80_VEHICLE_GROUPS,
  REQUESTED_POPULAR_VEHICLE_GROUPS,
  buildPopularAliasIndex
} from "./popular-vehicle-models.mjs";

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const [applications, years, models, makes, fitments] = await Promise.all([
  fetchAll(db, "vehicle_catalog_applications", "application_id,model_id,status"),
  fetchAll(db, "vehicle_catalog_application_years", "application_id,model_year"),
  fetchAll(db, "vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll(db, "vehicle_catalog_makes", "make_id,name,status"),
  fetchAll(db, "vehicle_catalog_wiper_fitments", "application_id,fitment_status,source")
]);

const activeApps = applications.filter((row) => row.status === "active");
const activeIds = new Set(activeApps.map((row) => row.application_id));
const publishedIds = new Set(fitments.filter((row) => row.fitment_status === "published" && activeIds.has(row.application_id)).map((row) => row.application_id));
const modelById = new Map(models.map((row) => [row.model_id, row]));
const makeById = new Map(makes.map((row) => [row.make_id, row]));
const appById = new Map(activeApps.map((row) => [row.application_id, row]));
const activeYears = years.filter((row) => activeIds.has(row.application_id));

const allGroups = buildModelYearGroups(activeYears, appById, modelById, makeById);
const historical50Groups = buildPopularModelYearGroups(activeYears, appById, modelById, makeById, REQUESTED_POPULAR_VEHICLE_GROUPS, 2000, 2026);
const core103Groups = buildPopularModelYearGroups(activeYears, appById, modelById, makeById, DEFAULT_POPULAR_VEHICLE_GROUPS, 2000, 2026);
const extended132Groups = buildPopularModelYearGroups(activeYears, appById, modelById, makeById, POPULAR_EXTENDED_80_VEHICLE_GROUPS, 2000, 2026);
const historical50Summary = summarizePopularGroups(historical50Groups, publishedIds, REQUESTED_POPULAR_VEHICLE_GROUPS);
const core103Summary = summarizePopularGroups(core103Groups, publishedIds, DEFAULT_POPULAR_VEHICLE_GROUPS);
const extended132Summary = summarizePopularGroups(extended132Groups, publishedIds, POPULAR_EXTENDED_80_VEHICLE_GROUPS);

const report = {
  generatedAt: new Date().toISOString(),
  production: {
    activeApplications: activeIds.size,
    publishedWiperApplications: publishedIds.size,
    applicationCoveragePercent: percent(publishedIds.size, activeIds.size),
    activeApplicationYears: activeYears.length,
    publishedApplicationYears: activeYears.filter((row) => publishedIds.has(row.application_id)).length,
    applicationYearCoveragePercent: percent(activeYears.filter((row) => publishedIds.has(row.application_id)).length, activeYears.length),
    modelYears: allGroups.size,
    modelYearsWithAnyPublishedApplication: countGroups(allGroups, publishedIds, "any"),
    modelYearAnyCoveragePercent: percent(countGroups(allGroups, publishedIds, "any"), allGroups.size),
    modelYearsFullyPublished: countGroups(allGroups, publishedIds, "full"),
    modelYearFullCoveragePercent: percent(countGroups(allGroups, publishedIds, "full"), allGroups.size)
  },
  historicalPopular50_2000To2026: historical50Summary,
  defaultPopularCore103_2000To2026: core103Summary,
  extendedPopular132_2000To2026: extended132Summary,
  popular2000To2026: core103Summary,
  popularMissingModelYears: [...core103Groups.entries()].filter(([, group]) => ![...group.applicationIds].some((id) => publishedIds.has(id))).map(([, group]) => `${group.label} ${group.year}`).sort(),
  popularPartiallyCoveredModelYears: [...core103Groups.entries()].filter(([, group]) => {
    const covered = [...group.applicationIds].filter((id) => publishedIds.has(id)).length;
    return covered > 0 && covered < group.applicationIds.size;
  }).map(([, group]) => ({ popularGroup: group.label, year: group.year, coveredApplications: [...group.applicationIds].filter((id) => publishedIds.has(id)).length, totalApplications: group.applicationIds.size }))
};

const outputDir = path.resolve("outputs/wiper-popular-coverage-20261024");
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "wiper_coverage_report.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outputDir, "historical_50_model_coverage.csv"), toCsv(historical50Summary.byPopularGroup));
fs.writeFileSync(path.join(outputDir, "default_core_103_model_coverage.csv"), toCsv(core103Summary.byPopularGroup));
fs.writeFileSync(path.join(outputDir, "extended_132_model_coverage.csv"), toCsv(extended132Summary.byPopularGroup));
console.log(JSON.stringify(report, null, 2));

function buildModelYearGroups(yearRows, applicationsById, modelsById, makesById) {
  const groups = new Map();
  for (const row of yearRows) {
    const application = applicationsById.get(row.application_id);
    const model = modelsById.get(application?.model_id);
    const make = makesById.get(model?.make_id);
    if (!application || !model || !make) continue;
    const year = Number(row.model_year);
    const modelKey = canonicalModelKey(make.name, model.name);
    const key = `${modelKey}|${year}`;
    const group = groups.get(key) ?? { make: make.name, model: model.name, year, applicationIds: new Set() };
    group.applicationIds.add(row.application_id);
    groups.set(key, group);
  }
  return groups;
}

function buildPopularModelYearGroups(yearRows, applicationsById, modelsById, makesById, definitions, yearFrom, yearTo) {
  const aliasIndex = buildPopularAliasIndex(definitions);
  const groups = new Map();
  for (const row of yearRows) {
    const application = applicationsById.get(row.application_id);
    const model = modelsById.get(application?.model_id);
    const make = makesById.get(model?.make_id);
    const year = Number(row.model_year);
    if (!application || !model || !make || year < yearFrom || year > yearTo) continue;
    const popular = aliasIndex.get(canonicalModelKey(make.name, model.name));
    if (!popular) continue;
    const key = `${popular.id}|${year}`;
    const group = groups.get(key) ?? { ...popular, year, applicationIds: new Set(), catalogModels: new Set() };
    group.applicationIds.add(row.application_id);
    group.catalogModels.add(`${make.name} ${model.name}`);
    groups.set(key, group);
  }
  return groups;
}

function summarizePopularGroups(groups, published, definitions) {
  const applicationYears = [...groups.values()].reduce((sum, group) => sum + group.applicationIds.size, 0);
  const publishedApplicationYears = [...groups.values()].reduce((sum, group) => sum + [...group.applicationIds].filter((id) => published.has(id)).length, 0);
  const any = countGroups(groups, published, "any");
  const full = countGroups(groups, published, "full");
  const presentIds = new Set([...groups.values()].map((group) => group.id));
  return {
    modelsRequested: definitions.length,
    modelGroupsRequested: definitions.length,
    modelGroupsPresent: presentIds.size,
    modelGroupsWithoutCatalogYears: definitions.filter((definition) => !presentIds.has(definition.id)).map((definition) => definition.label),
    modelYears: groups.size,
    anyPublishedModelYears: any,
    anyPublishedPercent: percent(any, groups.size),
    fullyPublishedModelYears: full,
    fullyPublishedPercent: percent(full, groups.size),
    applicationYears,
    publishedApplicationYears,
    applicationYearPercent: percent(publishedApplicationYears, applicationYears),
    byPopularGroup: summarizeByPopularGroup(groups, published, definitions)
  };
}

function summarizeByPopularGroup(groups, published, definitions) {
  return definitions.map((definition) => {
    const values = [...groups.values()].filter((group) => group.id === definition.id);
    const applicationYears = values.reduce((sum, group) => sum + group.applicationIds.size, 0);
    const publishedApplicationYears = values.reduce((sum, group) => sum + [...group.applicationIds].filter((id) => published.has(id)).length, 0);
    const any = values.filter((group) => [...group.applicationIds].some((id) => published.has(id))).length;
    const full = values.filter((group) => [...group.applicationIds].every((id) => published.has(id))).length;
    return {
      rank: definition.rank ?? "",
      popular_group: definition.label,
      source: definition.source,
      catalog_models: [...new Set(values.flatMap((group) => [...group.catalogModels]))].sort().join(" | "),
      model_years: values.length,
      any_published_model_years: any,
      any_published_percent: percent(any, values.length),
      fully_published_model_years: full,
      fully_published_percent: percent(full, values.length),
      application_years: applicationYears,
      published_application_years: publishedApplicationYears,
      application_year_percent: percent(publishedApplicationYears, applicationYears)
    };
  });
}

function countGroups(groups, published, mode) {
  let count = 0;
  for (const group of groups.values()) {
    const covered = [...group.applicationIds].filter((id) => published.has(id)).length;
    if (mode === "any" ? covered > 0 : covered === group.applicationIds.size) count += 1;
  }
  return count;
}
function percent(numerator, denominator) { return denominator ? Number((100 * numerator / denominator).toFixed(1)) : 0; }
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return `${headers.map(csvCell).join(",")}\n${rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
}
function csvCell(value) { const string = value === null || value === undefined ? "" : String(value); return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string; }
async function fetchAll(client, table, columns) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await client.from(table).select(columns).range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) return rows; } }
function loadEnv(file) { for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
