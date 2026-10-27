import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  FileBlob,
  SpreadsheetFile
} from "file:///C:/Users/Sanli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";
import { normalKey } from "./enrich-wipertech-fitments.mjs";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import {
  DEFAULT_POPULAR_VEHICLE_GROUPS,
  REQUESTED_POPULAR_VEHICLE_GROUPS,
  buildPopularAliasIndex
} from "./popular-vehicle-models.mjs";

const POPULAR_INDEX = buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS);
const OUTPUT_DIR = path.resolve("outputs/wiper-popular-gaps-20261024");
const REVIEW_WORKBOOK = path.resolve("outputs/wipertech-cross-ai-review-20261022/NexAuto_WiperTech_交叉AI审核_完整审核_2026-10-22.xlsx");

loadEnv(path.resolve(".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const crossAiRows = await readReviewRows(REVIEW_WORKBOOK);
const crossAiByApplication = new Map(crossAiRows.map((row) => [text(row.application_id), row]));

const [applications, years, variants, series, models, makes, fitments, configurations, reviews] = await Promise.all([
  fetchAll(db, "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"),
  fetchAll(db, "vehicle_catalog_application_years", "application_id,model_year"),
  fetchAll(db, "vehicle_catalog_variants", "variant_id,body_style,display_name"),
  fetchAll(db, "vehicle_catalog_series", "series_id,model_id,code,display_name"),
  fetchAll(db, "vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll(db, "vehicle_catalog_makes", "make_id,name,status"),
  fetchAll(db, "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source"),
  fetchAll(db, "wiper_configurations", "id,configuration_key"),
  fetchAll(db, "fitment_review_queue", "issue_type,review_status,payload")
]);

const variantById = new Map(variants.map((row) => [row.variant_id, row]));
const seriesById = new Map(series.map((row) => [row.series_id, row]));
const modelById = new Map(models.map((row) => [row.model_id, row]));
const makeById = new Map(makes.map((row) => [row.make_id, row]));
const configurationById = new Map(configurations.map((row) => [row.id, row.configuration_key]));
const yearsByApplication = groupBy(years, (row) => row.application_id);
const publishedRows = fitments.filter((row) => row.fitment_status === "published");
const publishedByApplication = groupBy(publishedRows, (row) => row.application_id);
const reviewByApplication = buildReviewIndex(reviews);
const activeApplications = applications.filter((row) => row.status === "active");

const enriched = activeApplications.map((application) => {
  const model = modelById.get(application.model_id);
  const make = makeById.get(model?.make_id);
  const generation = seriesById.get(application.series_id);
  const variant = variantById.get(application.variant_id);
  const modelYears = (yearsByApplication.get(application.application_id) ?? [])
    .map((row) => Number(row.model_year))
    .filter((year) => year >= 2000 && year <= 2026)
    .sort((a, b) => a - b);
  return {
    ...application,
    make: make?.name ?? "",
    model: model?.name ?? "",
    modelKey: canonicalModelKey(make?.name, model?.name),
    popularGroup: POPULAR_INDEX.get(canonicalModelKey(make?.name, model?.name)) ?? null,
    seriesCode: generation?.code ?? "",
    seriesName: generation?.display_name ?? "",
    bodyStyle: variant?.body_style ?? "",
    bodyKey: normalKey(variant?.body_style),
    variantName: variant?.display_name ?? "",
    modelYears
  };
});

const popularApplications = enriched.filter((row) => row.popularGroup && row.modelYears.length);
const missingApplications = popularApplications.filter((row) => !publishedByApplication.has(row.application_id));

const rows = missingApplications.map((application) => {
  const crossAi = crossAiByApplication.get(application.application_id) ?? {};
  const exactPeers = popularApplications.filter((peer) =>
    peer.model_id === application.model_id &&
    peer.series_id === application.series_id &&
    peer.bodyKey === application.bodyKey
  );
  const sameSeriesPeers = popularApplications.filter((peer) =>
    peer.model_id === application.model_id && peer.series_id === application.series_id
  );
  const overlappingModelPeers = popularApplications.filter((peer) =>
    peer.model_id === application.model_id && overlaps(peer.modelYears, application.modelYears)
  );
  return {
    popular_rank: application.popularGroup.rank ?? "",
    popular_group: application.popularGroup.label,
    popular_source: application.popularGroup.source,
    application_id: application.application_id,
    make: application.make,
    model: application.model,
    series_code: application.seriesCode,
    series_name: application.seriesName,
    body_style: application.bodyStyle,
    variant: application.variantName,
    years: compactYears(application.modelYears),
    application_years: application.modelYears.length,
    exact_series_body_configs: configurationsFor(exactPeers, publishedByApplication, configurationById),
    exact_series_body_wipertech_configs: configurationsFor(exactPeers, publishedByApplication, configurationById, true),
    same_series_configs: configurationsFor(sameSeriesPeers, publishedByApplication, configurationById),
    same_series_wipertech_configs: configurationsFor(sameSeriesPeers, publishedByApplication, configurationById, true),
    overlapping_model_wipertech_configs: configurationsFor(overlappingModelPeers, publishedByApplication, configurationById, true),
    open_review_issue: reviewByApplication.get(application.application_id)?.issue_type ?? "",
    open_review_candidates: (reviewByApplication.get(application.application_id)?.detail?.candidates ?? []).join(" | "),
    open_review_missing_years: (reviewByApplication.get(application.application_id)?.detail?.missing_years ?? []).join(" | "),
    cross_ai_conclusion: text(crossAi["审核结论"]),
    cross_ai_final_configuration: text(crossAi["最终配置"]),
    cross_ai_confidence: text(crossAi["审核置信度"]),
    cross_ai_reason: text(crossAi["审核理由"]),
    cross_ai_evidence: text(crossAi["审核证据"])
  };
}).sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || a.series_code.localeCompare(b.series_code) || a.body_style.localeCompare(b.body_style));

const report = {
  generatedAt: new Date().toISOString(),
  period: "2000-2026",
  popularScope: "default_core_75",
  popularModels: DEFAULT_POPULAR_VEHICLE_GROUPS.length,
  historicalPopularGroups: REQUESTED_POPULAR_VEHICLE_GROUPS.length,
  defaultPopularGroups: DEFAULT_POPULAR_VEHICLE_GROUPS.length,
  matchedPopularGroups: new Set(popularApplications.map((row) => row.popularGroup.id)).size,
  unmatchedPopularGroups: DEFAULT_POPULAR_VEHICLE_GROUPS.filter((group) => !popularApplications.some((row) => row.popularGroup.id === group.id)).map((group) => group.label),
  missingApplications: rows.length,
  missingApplicationYears: rows.reduce((sum, row) => sum + row.application_years, 0),
  byPopularGroup: countSumBy(rows, (row) => row.popular_group, (row) => row.application_years),
  byModel: countSumBy(rows, (row) => `${row.make} ${row.model}`, (row) => row.application_years),
  byReviewIssue: countSumBy(rows, (row) => row.open_review_issue || "no_open_review", (row) => row.application_years),
  byCrossAiConclusion: countSumBy(rows, (row) => row.cross_ai_conclusion || "blank", (row) => row.application_years),
  rows
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "popular_wiper_gaps.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUTPUT_DIR, "popular_wiper_gaps.csv"), toCsv(rows));
console.log(JSON.stringify(report, null, 2));

function configurationsFor(peers, publishedMap, configurationMap, wiperTechOnly = false) {
  const keys = new Set();
  for (const peer of peers) {
    for (const fitment of publishedMap.get(peer.application_id) ?? []) {
      if (wiperTechOnly && !String(fitment.source ?? "").startsWith("WIPERTECH_")) continue;
      const key = configurationMap.get(fitment.wiper_configuration_id);
      if (key) keys.add(key);
    }
  }
  return [...keys].sort().join(" | ");
}

function buildReviewIndex(reviewRows) {
  const index = new Map();
  for (const review of reviewRows) {
    if (review.review_status !== "open" || !String(review.issue_type).startsWith("wipertech_direct_")) continue;
    for (const detail of review.payload?.applications ?? []) {
      if (detail.application_id) index.set(detail.application_id, { issue_type: review.issue_type, detail });
    }
  }
  return index;
}

async function readReviewRows(file) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const values = workbook.worksheets.getItem("交叉审核任务").getUsedRange().values;
  const headers = values[0].map(text);
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  return values.slice(1)
    .filter((row) => text(row[index["审核ID"]]))
    .map((row) => Object.fromEntries(headers.map((header, position) => [header, row[position]])));
}

function compactYears(values) {
  if (!values.length) return "";
  const ranges = [];
  let start = values[0];
  let end = values[0];
  for (const value of values.slice(1)) {
    if (value === end + 1) end = value;
    else { ranges.push(start === end ? `${start}` : `${start}-${end}`); start = value; end = value; }
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(" | ");
}

function overlaps(left, right) {
  const rightSet = new Set(right);
  return left.some((value) => rightSet.has(value));
}

function countSumBy(values, keyFn, valueFn) {
  const output = {};
  for (const value of values) {
    const key = keyFn(value);
    const current = output[key] ?? { applications: 0, applicationYears: 0 };
    current.applications += 1;
    current.applicationYears += valueFn(value);
    output[key] = current;
  }
  return Object.fromEntries(Object.entries(output).sort((a, b) => b[1].applicationYears - a[1].applicationYears || a[0].localeCompare(b[0])));
}

function toCsv(values) {
  if (!values.length) return "";
  const headers = Object.keys(values[0]);
  return `${headers.map(csvCell).join(",")}\n${values.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const group = output.get(key) ?? [];
    group.push(value);
    output.set(key, group);
  }
  return output;
}

function loadEnv(file) {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

async function fetchAll(client, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
