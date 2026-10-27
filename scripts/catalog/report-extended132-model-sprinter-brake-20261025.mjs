import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_EXTENDED_80_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";
import { bodyKey, chassisTokens, compact, driveKey, strictChassisMatch } from "./brake-pad-strict-policy.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "extended132-model-sprinter-brake-20261025");
const WORKBOOK = "C:/Users/Sanli/Desktop/database/Bendix刹车片_全量车找件_V01.xlsx";
const FULL_REF = path.join(ROOT, "outputs", "bendix-full-reference-fitments-20261025");
const TARGET = POPULAR_EXTENDED_80_VEHICLE_GROUPS.find((group) => group.rank === 130);
const YEARS = [2000, 2026];

loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

const production = await loadProduction();
const sources = loadBendix();
const report = analyze(production, sources);
fs.mkdirSync(OUT, { recursive: true });
writeJson("summary.json", report.summary);
writeJsonl("ready-reference-fitments.jsonl", report.ready);
writeJsonl("existing-same-db-confirmations.jsonl", report.confirmations);
writeJsonl("deferred.jsonl", report.deferred);
writeJsonl("rear-drum-not-applicable.jsonl", report.rearDrum);
writeJson("source-audit.json", report.sourceAudit);
fs.writeFileSync(path.join(OUT, "README"), readme(report.summary));
if (process.env.SPRINTER_BRAKE_RUNNER) fs.copyFileSync(path.resolve(ROOT, process.env.SPRINTER_BRAKE_RUNNER), path.join(OUT, "rerun.mjs"));
console.log(JSON.stringify({ output_dir: OUT, counts: report.summary.counts, coverage: report.summary.coverage }, null, 2));

function analyze(p, source) {
  const makeById = new Map(p.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(p.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(p.series.map((row) => [row.series_id, row]));
  const variantById = new Map(p.variants.map((row) => [row.variant_id, row]));
  const yearsByApp = groupSet(p.years, (row) => row.application_id, (row) => Number(row.model_year));
  const alias = buildPopularAliasIndex([TARGET]);
  const apps = p.applications.filter((row) => row.status === "active").map((row) => {
    const model = modelById.get(row.model_id); const make = makeById.get(model?.make_id);
    const group = make && model ? alias.get(canonicalModelKey(make.name, model.name)) : null;
    const years = [...(yearsByApp.get(row.application_id) ?? [])].filter((year) => year >= YEARS[0] && year <= YEARS[1]).sort((a, b) => a - b);
    if (!group || !years.length) return null;
    const series = seriesById.get(row.series_id); const variant = variantById.get(row.variant_id);
    return { application_id: row.application_id, make: make.name, model: model.name,
      platform: series?.code ?? series?.display_name ?? "", body: variant?.body_style ?? "",
      drive: variant?.drive_type ?? "", years };
  }).filter(Boolean);
  const ids = new Set(apps.map((row) => row.application_id));
  const refById = new Map(p.partReferences.map((row) => [row.id, row]));
  const dbByVariant = groupSet(p.productIdentifiers.filter((row) => row.identifier_type === "cross_reference"
    && /^DB\d+[A-Z]?$/.test(row.normalized_value ?? "")), (row) => row.product_variant_id, (row) => row.normalized_value);
  const liveByCase = new Map();
  for (const row of p.referenceFitments) {
    if (!ids.has(row.application_id) || row.fitment_status !== "published") continue;
    const ref = refById.get(row.part_reference_id); if (ref?.product_type !== "brake_pad") continue;
    addLive(liveByCase, row.application_id, row.position, [ref.normalized_value], "published_reference");
  }
  for (const row of p.productFitments) {
    if (!ids.has(row.application_id) || row.fitment_status !== "published") continue;
    addLive(liveByCase, row.application_id, row.position, [...(dbByVariant.get(row.product_variant_id) ?? [])], "published_product");
  }
  const baselineApps = new Set([...liveByCase.keys()].map((key) => key.split("|")[0]));
  const padRows = source.padRows.filter((row) => compact(row.make) === "MERCEDESBENZ" && compact(row.model) === "SPRINTER35T");
  const shoeRows = source.shoeRows.filter((row) => compact(row.make) === "MERCEDESBENZ" && compact(row.model) === "SPRINTER35T");
  const grouped = groupApplications(apps);
  const ready = [], confirmations = [], deferred = [], rearDrum = [];
  for (const group of grouped) {
    const sourceRows = padRows.filter((row) => row.position === group.position && sprinterChassisMatch(group.platform, row.tokens)
      && bodyKey(row.body) === group.body_key && driveKey(row.drive) === group.drive_key);
    const evidence = evaluateGroup(group, sourceRows, liveByCase);
    const base = { ...publicGroup(group), candidate_db: evidence.candidate_db, live_published_db: evidence.live_published_db,
      source_rows: evidence.source_rows, source_year_ranges: evidence.source_year_ranges,
      production_write: false, proposed_nbp: null };
    if (!evidence.safe) {
      deferred.push({ ...base, decision: "deferred", deferred_reason: evidence.reason,
        missing_application_years: evidence.missing_application_years, requested_discriminator: evidence.discriminator });
      continue;
    }
    const dbRef = evidence.candidate_db[0];
    const existingIds = group.applications.filter((app) => (liveByCase.get(`${app.application_id}|${group.position}`)?.dbs ?? new Set()).has(dbRef));
    const newIds = group.applications.filter((app) => !(liveByCase.get(`${app.application_id}|${group.position}`)?.dbs?.size));
    if (existingIds.length) confirmations.push({ ...base, ...subset(existingIds), decision: "existing_same_db_confirmation",
      decision_reason: "The strict Bendix result equals the existing published DB reference." });
    if (newIds.length) ready.push({ ...base, ...subset(newIds), decision: "ready",
      decision_reason: "One DB after exact Sprinter generation-root, body, drive, position, and complete source-year checks; no live conflict." });
  }
  for (const group of grouped.filter((item) => item.position === "rear")) {
    const matched = shoeRows.filter((row) => sprinterChassisMatch(group.platform, row.tokens) && bodyKey(row.body) === group.body_key
      && driveKey(row.drive) === group.drive_key);
    if (!matched.length) continue;
    const complete = group.applications.every((app) => app.years.every((year) => matched.some((row) => year >= row.from && year <= row.to)));
    if (!complete) continue;
    rearDrum.push({ ...publicGroup(group), rear_shoe_references: unique(matched.map((row) => row.reference)),
      source_rows: unique(matched.map((row) => row.row_id)), decision: "rear_drum_not_pad_gap", production_write: false, proposed_nbp: null });
  }
  const allYearKeys = appYearKeys(apps);
  const baselineYearKeys = appYearKeys(apps.filter((app) => baselineApps.has(app.application_id)));
  const readyIds = new Set(ready.flatMap((row) => row.application_ids).filter((id) => !baselineApps.has(id)));
  const safeYearKeys = appYearKeys(apps.filter((app) => readyIds.has(app.application_id)));
  const projectedYearKeys = union(baselineYearKeys, safeYearKeys);
  const readyPositions = new Set(ready.flatMap((row) => row.application_ids.map((id) => `${id}|${row.position}`)));
  const drumIds = new Set(rearDrum.flatMap((row) => row.application_ids));
  const fullApps = new Set(apps.filter((app) => (liveByCase.has(`${app.application_id}|front`) || readyPositions.has(`${app.application_id}|front`))
    && (liveByCase.has(`${app.application_id}|rear`) || readyPositions.has(`${app.application_id}|rear`) || drumIds.has(app.application_id)))
    .map((app) => app.application_id));
  const projectedFullYears = appYearKeys(apps.filter((app) => fullApps.has(app.application_id)));
  const modelYears = unique(apps.flatMap((app) => app.years)).sort((a, b) => a - b);
  const modelYearAny = modelYears.filter((year) => apps.some((app) => app.years.includes(year)
    && (baselineApps.has(app.application_id) || readyIds.has(app.application_id))));
  const modelYearFull = modelYears.filter((year) => apps.filter((app) => app.years.includes(year))
    .every((app) => baselineApps.has(app.application_id) || readyIds.has(app.application_id)));
  const summary = {
    generated_at: new Date().toISOString(), mode: "report_only", production_writes: 0,
    scope: { rank: 130, group: TARGET.label, model_years: YEARS, applications: apps.length, application_years: allYearKeys.size },
    policy: {
      platform: "Sprinter-only explicit generation bridge B90x -> 90x.xxx; no arbitrary substring matching.",
      ready: "Exactly one DB after exact model subfamily, generation-root, body, drive, position, and complete source-year coverage, with no different live DB.",
      confirmation: "Existing same DB is separated and never counted as uplift.",
      deferred: "Multiple DBs, missing identity, source-year gaps, live conflicts, or configuration discrimination remain deferred.",
      rear_drum: "Rear shoe evidence is an axle exemption, not a rear-pad fitment."
    },
    counts: { platform_body_drive_position_groups: grouped.length, ready_groups: ready.length,
      existing_same_db_confirmation_groups: confirmations.length, deferred_groups: deferred.length,
      rear_drum_exempt_groups: rearDrum.length },
    coverage: {
      baseline_knowledge_application_years: baselineYearKeys.size,
      baseline_knowledge_percent: percent(baselineYearKeys.size, allYearKeys.size),
      safe_new_application_years: safeYearKeys.size,
      safe_coverage_uplift_percentage_points: percent(safeYearKeys.size, allYearKeys.size),
      projected_knowledge_application_years: projectedYearKeys.size,
      projected_knowledge_percent: percent(projectedYearKeys.size, allYearKeys.size),
      projected_full_axle_application_years: projectedFullYears.size,
      projected_full_axle_percent: percent(projectedFullYears.size, allYearKeys.size),
      model_year_any: { covered: modelYearAny.length, denominator: modelYears.length, percent: percent(modelYearAny.length, modelYears.length) },
      model_year_full: { covered: modelYearFull.length, denominator: modelYears.length, percent: percent(modelYearFull.length, modelYears.length) }
    },
    deferred_reasons: countBy(deferred, (row) => row.deferred_reason)
  };
  return { ready, confirmations, deferred, rearDrum, summary,
    sourceAudit: { sources: source.audit, production_snapshot: { fetched_at: p.fetchedAt, target_applications: apps.length,
      target_application_years: allYearKeys.size, baseline_knowledge_application_years: baselineYearKeys.size },
      safeguards: ["No web browsing or AI search used.", "No production mutation issued.", "No NBP SKU synthesized from DB references."] } };
}

function evaluateGroup(group, rows, liveByCase) {
  const live = unique(group.applications.flatMap((app) => [...(liveByCase.get(`${app.application_id}|${group.position}`)?.dbs ?? [])]));
  if (!group.platform || !group.body_key || !group.drive_key) return result(false, "missing_platform_body_or_drive_identity", [], live, [], [], [], "Correct vehicle identity first.");
  if (!rows.length) return result(false, "no_exact_bendix_configuration_rows", [], live, [], [], [], "Exact model/generation/body/drive/position evidence required.");
  const used = rows.filter((row) => group.applications.some((app) => app.years.some((year) => year >= row.from && year <= row.to)));
  const missing = [];
  for (const app of group.applications) for (const year of app.years) if (!used.some((row) => year >= row.from && year <= row.to)) missing.push(`${app.application_id}|${year}`);
  const candidates = unique(used.map((row) => row.reference));
  const sourceRows = unique(used.map((row) => row.row_id));
  const ranges = unique(used.map((row) => `${row.from}-${row.to}`));
  if (missing.length) return result(false, candidates.length > 1 ? "source_year_boundary_and_multi_db" : "source_year_boundary",
    candidates, live, sourceRows, ranges, missing, candidates.length > 1
      ? "Production/year split plus caliper/disc/OE discriminator required." : "Production/year split required.");
  if (candidates.length !== 1) return result(false, candidates.length ? "multiple_db_requires_deep_discriminator" : "no_db_candidate",
    candidates, live, sourceRows, ranges, [], "Caliper/disc/OE/production-date discriminator required.");
  const conflict = live.some((dbRef) => dbRef !== candidates[0]);
  if (conflict) return result(false, "published_online_db_conflict", candidates, live, sourceRows, ranges, [], "Manual governance review required.");
  return result(true, "strict_unique_no_conflict", candidates, live, sourceRows, ranges, [], null);
}
function result(safe, reason, candidate_db, live_published_db, source_rows, source_year_ranges, missing_application_years, discriminator) {
  return { safe, reason, candidate_db, live_published_db, source_rows, source_year_ranges, missing_application_years, discriminator };
}
function groupApplications(apps) {
  const map = new Map();
  for (const app of apps) for (const position of ["front", "rear"]) {
    const bk = bodyKey(app.body), dk = driveKey(app.drive);
    const key = [app.platform || "NO_PLATFORM", bk || "NO_BODY", dk || "NO_DRIVE", position].join("|");
    const item = map.get(key) ?? { platform: app.platform, body: app.body, drive: app.drive, body_key: bk, drive_key: dk, position, applications: [] };
    item.applications.push(app); map.set(key, item);
  }
  return [...map.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.body.localeCompare(b.body)
    || a.drive.localeCompare(b.drive) || a.position.localeCompare(b.position));
}
function publicGroup(group) { return { rank: 130, group: TARGET.label, make: "MERCEDES-BENZ", models: ["SPRINTER 3,5-t"],
  platform: group.platform, body: group.body, drive: group.drive, position: group.position, ...subset(group.applications) }; }
function subset(apps) { return { application_ids: apps.map((app) => app.application_id).sort(), applications: apps.length,
  application_years: appYearKeys(apps).size, years: unique(apps.flatMap((app) => app.years)).sort((a, b) => a - b) }; }
function sprinterChassisMatch(platform, tokens) {
  if (tokens.some((token) => strictChassisMatch(platform, token))) return true;
  const local = compact(platform);
  return tokens.some((token) => { const match = compact(token).match(/^B(90[1-9]|910)$/); return match && local.startsWith(match[1]) && local.length > match[1].length; });
}

function loadBendix() {
  const workbook = XLSX.readFile(WORKBOOK, { cellDates: false });
  const normalize = (row, shoe = false) => ({ row_id: Number(row["行ID"]), make: row["品牌(英文)"], model: row["车型"],
    series: row["车系"], tokens: chassisTokens({ seriesName: row["车系"] }), from: Number(row["年款起"] || 0), to: Number(row["年款止"] || 9999),
    body: row["车身"], drive: row["驱动"], position: String(row["位置"]).includes("前") ? "front" : "rear",
    reference: String(row["件号"]).match(shoe ? /BS\d+[A-Z]?/i : /DB\d+[A-Z]?/i)?.[0]?.toUpperCase() ?? "", status: row["状态"] });
  const padRows = XLSX.utils.sheet_to_json(workbook.Sheets["01刹车片"], { defval: "", raw: true }).map((row) => normalize(row)).filter((row) => row.reference);
  const shoeRows = XLSX.utils.sheet_to_json(workbook.Sheets["03刹车蹄"], { defval: "", raw: true }).map((row) => normalize(row, true)).filter((row) => row.reference);
  const published = path.join(FULL_REF, "published-reference-fitments.csv"), review = path.join(FULL_REF, "review-reference-fitments.csv");
  const targetLayerRows = (file) => XLSX.utils.sheet_to_json(XLSX.readFile(file, { raw: true }).Sheets.Sheet1, { defval: "", raw: false })
    .filter((row) => compact(row.make) === "MERCEDESBENZ" && compact(row.model) === "SPRINTER35T").length;
  return { padRows, shoeRows, audit: [auditFile(WORKBOOK, { workbook_sheets: workbook.SheetNames,
    sprinter_35t_pad_rows: padRows.filter((row) => compact(row.make) === "MERCEDESBENZ" && compact(row.model) === "SPRINTER35T").length,
    sprinter_35t_shoe_rows: shoeRows.filter((row) => compact(row.make) === "MERCEDESBENZ" && compact(row.model) === "SPRINTER35T").length }),
    auditFile(published, { role: "existing full-reference published layer", target_rows: targetLayerRows(published) }),
    auditFile(review, { role: "existing full-reference review layer", target_rows: targetLayerRows(review) })] };
}

async function loadProduction() {
  const fetchedAt = new Date().toISOString();
  const [makes, models, series, variants] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"), fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,code,display_name"), fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type,display_name")
  ]);
  const makeIds = new Set(makes.filter((row) => compact(row.name) === "MERCEDESBENZ").map((row) => row.make_id));
  const modelIds = models.filter((row) => makeIds.has(row.make_id) && compact(row.name) === "SPRINTER35T").map((row) => row.model_id);
  const applications = await fetchIn("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,powertrain_id,status", "model_id", modelIds);
  const appIds = applications.map((row) => row.application_id);
  const [years, productFitments, referenceFitments] = await Promise.all([
    fetchIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", appIds),
    fetchIn("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status", "application_id", appIds),
    fetchIn("vehicle_catalog_part_reference_fitments", "application_id,part_reference_id,position,fitment_status", "application_id", appIds)
  ]);
  const refIds = unique(referenceFitments.map((row) => row.part_reference_id));
  const variantIds = unique(productFitments.map((row) => row.product_variant_id));
  const [partReferences, productIdentifiers] = await Promise.all([
    fetchIn("catalog_part_references", "id,product_type,normalized_value", "id", refIds),
    fetchIn("product_identifiers", "product_variant_id,identifier_type,normalized_value", "product_variant_id", variantIds)
  ]);
  return { fetchedAt, makes, models, series, variants, applications, years, productFitments, referenceFitments, partReferences, productIdentifiers };
}

function addLive(map, applicationId, position, dbs, source) { const key = `${applicationId}|${position}`;
  const item = map.get(key) ?? { dbs: new Set(), sources: new Set() }; dbs.filter(Boolean).forEach((dbRef) => item.dbs.add(dbRef)); item.sources.add(source); map.set(key, item); }
function appYearKeys(apps) { return new Set(apps.flatMap((app) => app.years.map((year) => `${app.application_id}|${year}`))); }
function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function groupSet(values, keyFn, valueFn) { const out = new Map(); for (const value of values) { const key = keyFn(value); const set = out.get(key) ?? new Set(); set.add(valueFn(value)); out.set(key, set); } return out; }
function countBy(values, keyFn) { const out = {}; for (const value of values) { const key = keyFn(value); out[key] = (out[key] ?? 0) + 1; } return out; }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(2)) : 0; }
function auditFile(file, extra = {}) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replace(/\\/g, "/"), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString(), ...extra }; }
function writeJson(name, value) { fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(name, values) { fs.writeFileSync(path.join(OUT, name), values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
function readme(summary) { return `Extended-132 model-first brake report: Mercedes-Benz Sprinter (rank 130)\n\n` +
  `Scope: ${summary.scope.applications} applications / ${summary.scope.application_years} AY, model years 2000-2026.\n` +
  `Baseline knowledge: ${summary.coverage.baseline_knowledge_application_years} AY (${summary.coverage.baseline_knowledge_percent}%).\n` +
  `Safe new knowledge: ${summary.coverage.safe_new_application_years} AY (+${summary.coverage.safe_coverage_uplift_percentage_points} pp).\n` +
  `Projected knowledge: ${summary.coverage.projected_knowledge_application_years} AY (${summary.coverage.projected_knowledge_percent}%).\n\n` +
  `Rules: Sprinter-only B90x -> 90x.xxx bridge, exact 3.5-t model, body, drive and position, with every target year covered by Bendix. Multi-DB, missing identity, year gaps and live conflicts remain deferred.\n` +
  `No web research, production mutation, or NBP synthesis was performed.\n\n` +
  `Re-run from repository root: node outputs/extended132-model-sprinter-brake-20261025/rerun.mjs\n`; }
async function fetchAll(table, columns) { const out = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) return out; } }
async function fetchIn(table, columns, field, values) { if (!values.length) return []; const out = []; for (let index = 0; index < values.length; index += 50) {
  const { data, error } = await db.from(table).select(columns).in(field, values.slice(index, index + 50)); if (error) throw error; out.push(...(data ?? [])); } return out; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
