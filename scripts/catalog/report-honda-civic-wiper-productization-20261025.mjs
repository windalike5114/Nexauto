import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_75_ADDITIONAL_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-model-honda-civic-wiper-productization-20261025");
const BASELINE_FILE = path.join(ROOT, "outputs", "popular-extended132-product-gaps-20261025", "coverage-by-model.json");
const PERIOD = { from: 2000, to: 2026 };
const EXPECTED_PRODUCT_ONLY_AY = 114;
const APPROVED_FRONT_LENGTHS = new Set([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 27, 28, 30]);

if (process.argv.includes("--apply")) throw new Error("This script is report-only and never writes production.");
loadEnv(path.join(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
if (!fs.existsSync(BASELINE_FILE)) throw new Error(`Missing baseline: ${BASELINE_FILE}`);

const group = POPULAR_75_ADDITIONAL_VEHICLE_GROUPS.find((row) => row.rank === 60);
if (!group || group.label !== "Honda Civic") throw new Error("Maintained rank 60 Honda Civic group changed; review before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const baselineDocument = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
const baseline = baselineDocument.groups.find((row) => row.popular_group === group.label);
if (!baseline) throw new Error("Honda Civic baseline row missing.");
if (baseline.wiper_product_without_knowledge_gap_years !== EXPECTED_PRODUCT_ONLY_AY) throw new Error(`Expected baseline product-only ${EXPECTED_PRODUCT_ONLY_AY} AY, found ${baseline.wiper_product_without_knowledge_gap_years}.`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const data = await loadProduction();
const report = prepare(data);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJsonl("application-audit.jsonl", report.productOnly);
writeJsonl("configuration-summary.jsonl", report.configurationSummary);
writeJsonl("ready-to-link.jsonl", report.readyToLink);
writeJsonl("direct-create.jsonl", report.directCreate);
writeJsonl("procurement.jsonl", report.procurement);
writeJsonl("incomplete-blocked.jsonl", report.incompleteBlocked);
writeJson("wiper-set-audit.json", report.wiperSetAudit);
writeJson("summary.json", report.summary);
fs.writeFileSync(path.join(OUTPUT_DIR, "README.txt"), readme(report.summary));
console.log(JSON.stringify({ output_dir: OUTPUT_DIR, product_only: report.summary.product_only,
  classifications: report.summary.classifications, integrity: report.summary.integrity }, null, 2));

function prepare(data) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row])); const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row])); const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApp = groupBy(data.years, (row) => row.application_id); const fitmentsByApp = groupBy(data.fitments, (row) => row.application_id);
  const configById = new Map(data.configurations.map((row) => [row.id, row])); const bladesByConfig = groupBy(data.blades, (row) => row.wiper_configuration_id);
  const setAudits = data.wiperSets.map(auditSet); const activePairs = new Set(setAudits.filter((row) => row.active && row.set_type === "front_pair").map((row) => pairKey(row.driver_length_in, row.passenger_length_in)));
  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id); const make = makeById.get(model?.make_id);
    const matched = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null; if (matched?.id !== group.id) continue;
    const years = uniqueNumbers((yearsByApp.get(application.application_id) ?? []).map((row) => row.model_year)).filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b); if (!years.length) continue;
    const series = seriesById.get(application.series_id); const variant = variantById.get(application.variant_id);
    const publishedFitments = (fitmentsByApp.get(application.application_id) ?? []).filter((row) => row.fitment_status === "published");
    const published = publishedFitments.map((fitment) => auditPublishedConfiguration(fitment, configById, bladesByConfig));
    const baselineProductCovered = published.some((item) => item.front_complete && item.blade_integrity_ok && activePairs.has(pairKey(item.driver_length_in, item.passenger_length_in)));
    applications.push({ application_id: application.application_id, make: upper(make?.name), model: upper(model?.name), series_code: upper(series?.code),
      series_name: String(series?.display_name ?? "").trim(), body_style: String(variant?.body_style ?? "").trim(), variant_name: String(variant?.display_name ?? "").trim(),
      years, application_years: years.length, knowledge_published: published.length > 0, baseline_product_covered: baselineProductCovered,
      published_configurations: published });
  }
  const productOnly = applications.filter((row) => row.knowledge_published && !row.baseline_product_covered).map((row) => classify(row, setAudits));
  const readyToLink = productOnly.filter((row) => row.classification === "ready_to_link");
  const directCreate = productOnly.filter((row) => row.classification === "direct_create");
  const procurement = productOnly.filter((row) => row.classification === "procurement");
  const incompleteBlocked = productOnly.filter((row) => row.classification === "incomplete_blocked");
  const configurationSummary = [...groupBy(productOnly, (row) => `${row.configuration_id ?? "none"}|${row.configuration_key ?? "none"}|${row.classification}`).values()].map(summarizeConfiguration).sort((a, b) => b.application_years - a.application_years || String(a.configuration_key).localeCompare(String(b.configuration_key)));
  const productOnlyAy = sumAy(productOnly);
  const classifiedAy = sumAy(readyToLink) + sumAy(directCreate) + sumAy(procurement) + sumAy(incompleteBlocked);
  const relevantLengths = new Set(productOnly.flatMap((row) => [row.driver_length_in, row.passenger_length_in].filter((value) => value !== null)));
  const wiperSetAudit = { all_sets: setAudits, relevant_sets: setAudits.filter((row) => relevantLengths.has(row.driver_length_in) || relevantLengths.has(row.passenger_length_in)),
    relevant_front_lengths: [...relevantLengths].sort((a, b) => a - b) };
  const summary = { generated_at: new Date().toISOString(), mode: "report-only", production_writes: false, period: PERIOD,
    scope: { rank: group.rank, group_id: group.id, popular_group: group.label, fleet_count: group.fleetCount },
    definitions: { product_only: "published wiper knowledge without an active exact front-pair wiper_set, matching the maintained coverage baseline",
      ready_to_link: "complete validated published front sizes and an existing strict sellable exact front pair",
      direct_create: "complete validated published front sizes, no exact wiper_set exists, and both lengths are permitted by the current schema",
      procurement: "complete validated published front sizes with an exact existing set that is not sellable, or a schema-disallowed length requiring commercial intervention",
      incomplete_blocked: "published configuration cannot supply one validated driver and passenger length; no missing size is inferred" },
    baseline: { source: path.relative(ROOT, BASELINE_FILE).replaceAll("\\", "/"), applications_total: baseline.applications_total,
      application_years_total: baseline.application_years_total, knowledge_application_years_covered: baseline.wiper_knowledge_application_years_covered,
      product_application_years_covered: baseline.wiper_product_application_years_covered, product_only_application_years: baseline.wiper_product_without_knowledge_gap_years,
      extended132_application_years: baselineDocument.totals.wiper_product.application_years_total },
    live_scope: { applications: applications.length, application_years: sumAy(applications), knowledge_published_applications: applications.filter((row) => row.knowledge_published).length,
      knowledge_published_application_years: sumAy(applications.filter((row) => row.knowledge_published)) },
    product_only: { applications: productOnly.length, application_years: productOnlyAy, pp_of_extended132: percent(productOnlyAy, baselineDocument.totals.wiper_product.application_years_total) },
    classifications: { ready_to_link: queueMetrics(readyToLink), direct_create: queueMetrics(directCreate), procurement: queueMetrics(procurement), incomplete_blocked: queueMetrics(incompleteBlocked) },
    projected_product_uplift: { immediately_safe_application_years: sumAy(readyToLink), after_direct_create_application_years: sumAy(directCreate),
      after_procurement_application_years: sumAy(procurement), total_resolvable_with_complete_sizes_application_years: sumAy([...readyToLink, ...directCreate, ...procurement]),
      total_resolvable_pp_of_extended132: percent(sumAy([...readyToLink, ...directCreate, ...procurement]), baselineDocument.totals.wiper_product.application_years_total) },
    published_configuration_summary: configurationSummary,
    sources: { production_snapshot: { mode: "fresh read-only", table_counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])) },
      product_gate: "front_pair + active + public + approved + commerce active + checkout enabled", blade_source: "wiper_configuration_blades; configuration_key is cross-checked only" },
    integrity: { expected_product_only_application_years: EXPECTED_PRODUCT_ONLY_AY, observed_product_only_application_years: productOnlyAy,
      expected_product_only_matches: productOnlyAy === EXPECTED_PRODUCT_ONLY_AY, classification_partition_matches: classifiedAy === productOnlyAy,
      duplicate_application_ids: duplicateValues(productOnly.map((row) => row.application_id)), inferred_missing_blade_lengths: 0,
      ready_to_link_with_incomplete_front: readyToLink.filter((row) => !row.front_complete).map((row) => row.application_id),
      direct_create_with_incomplete_front: directCreate.filter((row) => !row.front_complete).map((row) => row.application_id),
      procurement_with_incomplete_front: procurement.filter((row) => !row.front_complete).map((row) => row.application_id) } };
  return { productOnly, readyToLink, directCreate, procurement, incompleteBlocked, configurationSummary, wiperSetAudit, summary };
}

function auditPublishedConfiguration(fitment, configById, bladesByConfig) {
  const config = configById.get(fitment.wiper_configuration_id) ?? null; const blades = bladesByConfig.get(fitment.wiper_configuration_id) ?? [];
  const positions = Object.fromEntries(["driver", "passenger", "rear"].map((position) => [position, blades.filter((row) => row.position === position).map((row) => numberOrNull(row.length_in))]));
  const driver = positions.driver.length === 1 ? positions.driver[0] : null; const passenger = positions.passenger.length === 1 ? positions.passenger[0] : null; const rear = positions.rear.length === 1 ? positions.rear[0] : null;
  const bladeKey = [driver ?? "-", passenger ?? "-", rear ?? "-"].join("/"); const keyParts = parseConfigurationKey(config?.configuration_key);
  const positionCardinalityOk = positions.driver.length <= 1 && positions.passenger.length <= 1 && positions.rear.length <= 1;
  const keyMatchesBlades = Boolean(config?.configuration_key) && keyParts && keyParts.driver === driver && keyParts.passenger === passenger && keyParts.rear === rear;
  const statusOk = Boolean(config) && !["rejected", "superseded"].includes(config.configuration_status);
  return { fitment_source: fitment.source, fitment_notes: fitment.notes, configuration_id: fitment.wiper_configuration_id,
    configuration_exists: Boolean(config), configuration_key: config?.configuration_key ?? null, configuration_status: config?.configuration_status ?? null,
    rear_status: config?.rear_status ?? null, blade_rows: blades.map((row) => ({ position: row.position, length_in: numberOrNull(row.length_in) })),
    blade_position_counts: Object.fromEntries(Object.entries(positions).map(([key, values]) => [key, values.length])), blade_key: bladeKey,
    driver_length_in: driver, passenger_length_in: passenger, rear_length_in: rear, front_complete: driver !== null && passenger !== null,
    position_cardinality_ok: positionCardinalityOk, configuration_key_matches_blades: keyMatchesBlades,
    blade_integrity_ok: Boolean(config) && statusOk && positionCardinalityOk && keyMatchesBlades };
}

function classify(application, sets) {
  const failures = [];
  if (application.published_configurations.length !== 1) failures.push("multiple_published_wiper_fitments");
  const published = application.published_configurations.length === 1 ? application.published_configurations[0] : null;
  if (!published?.configuration_exists) failures.push("published_configuration_row_missing");
  if (published && ["rejected", "superseded"].includes(published.configuration_status)) failures.push("published_configuration_status_invalid");
  if (published && !published.position_cardinality_ok) failures.push("duplicate_blade_positions");
  if (published && !published.configuration_key_matches_blades) failures.push("configuration_key_blade_rows_mismatch");
  if (published && !published.front_complete) failures.push(published.driver_length_in === null && published.passenger_length_in === null ? "both_front_lengths_missing" : "one_front_length_missing");
  const driver = published?.driver_length_in ?? null; const passenger = published?.passenger_length_in ?? null; const rear = published?.rear_length_in ?? null;
  const exactSets = driver !== null && passenger !== null ? sets.filter((row) => row.set_type === "front_pair" && pairKey(row.driver_length_in, row.passenger_length_in) === pairKey(driver, passenger)) : [];
  const sellableSets = exactSets.filter((row) => row.sellable); let classification = "incomplete_blocked"; let reason = failures.join("|") || "invalid_published_configuration";
  if (!failures.length && sellableSets.length) { classification = "ready_to_link"; reason = "strict_sellable_exact_front_pair_exists"; }
  else if (!failures.length && exactSets.length) { classification = "procurement"; reason = "exact_front_pair_exists_but_not_sellable"; }
  else if (!failures.length && APPROVED_FRONT_LENGTHS.has(driver) && APPROVED_FRONT_LENGTHS.has(passenger)) { classification = "direct_create"; reason = "complete_validated_sizes_no_exact_wiper_set"; }
  else if (!failures.length) { classification = "procurement"; reason = "complete_sizes_not_permitted_by_current_wiper_set_schema"; }
  return { ...application, classification, reason, blocker_reasons: failures, configuration_id: published?.configuration_id ?? null,
    configuration_key: published?.configuration_key ?? null, configuration_status: published?.configuration_status ?? null, rear_status: published?.rear_status ?? null,
    blade_key: published?.blade_key ?? null, blade_rows: published?.blade_rows ?? [], blade_position_counts: published?.blade_position_counts ?? {},
    configuration_key_matches_blades: published?.configuration_key_matches_blades ?? false, front_complete: published?.front_complete ?? false,
    driver_length_in: driver, passenger_length_in: passenger, rear_length_in: rear,
    matching_wiper_sets: exactSets, matching_sellable_wiper_sets: sellableSets,
    required_action: requiredAction(classification, reason) };
}

function summarizeConfiguration(rows) { const first = rows[0]; return { configuration_id: first.configuration_id, configuration_key: first.configuration_key,
  configuration_status: first.configuration_status, blade_key: first.blade_key, blade_rows: first.blade_rows, configuration_key_matches_blades: first.configuration_key_matches_blades,
  driver_length_in: first.driver_length_in, passenger_length_in: first.passenger_length_in, rear_length_in: first.rear_length_in, front_complete: first.front_complete,
  classification: first.classification, reason: first.reason, applications: rows.length, application_years: sumAy(rows), application_ids: rows.map((row) => row.application_id).sort(),
  series_codes: uniqueStrings(rows.map((row) => row.series_code)), bodies: uniqueStrings(rows.map((row) => row.body_style)), years: uniqueNumbers(rows.flatMap((row) => row.years)).sort((a, b) => a - b),
  matching_wiper_sets: first.matching_wiper_sets, matching_sellable_wiper_sets: first.matching_sellable_wiper_sets,
  required_action: first.required_action };
}

function auditSet(row) { return { id: row.id, sku: row.sku, set_type: row.set_type, driver_length_in: numberOrNull(row.driver_length_in), passenger_length_in: numberOrNull(row.passenger_length_in),
  rear_length_in: numberOrNull(row.rear_length_in), active: row.active === true, visibility_status: row.visibility_status, content_status: row.content_status,
  commerce_status: row.commerce_status, checkout_enabled: row.checkout_enabled === true,
  sellable: row.set_type === "front_pair" && row.active === true && row.visibility_status === "public" && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true };
}
function requiredAction(classification, reason) { if (classification === "ready_to_link") return "Use the existing strict sellable exact front pair; no new dimensions or set creation required.";
  if (classification === "direct_create") return "Create and merchandise an exact front_pair wiper_set from the validated published driver/passenger sizes.";
  if (classification === "procurement") return reason.includes("not_sellable") ? "Resolve inventory/content/commerce/checkout state for the existing exact front pair." : "Procurement/schema review is required before an exact front pair can be sold.";
  return "Repair or complete the published configuration from authoritative evidence; do not infer the missing blade length."; }

async function loadProduction() { const specs = [["makes", "vehicle_catalog_makes", "make_id,name,status"], ["models", "vehicle_catalog_models", "model_id,make_id,name,status"],
  ["series", "vehicle_catalog_series", "series_id,model_id,code,display_name,status"], ["variants", "vehicle_catalog_variants", "variant_id,display_name,body_style"],
  ["applications", "vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"], ["years", "vehicle_catalog_application_years", "application_id,model_year"],
  ["fitments", "vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes"],
  ["configurations", "wiper_configurations", "id,configuration_key,configuration_status,rear_status"], ["blades", "wiper_configuration_blades", "wiper_configuration_id,position,length_in"],
  ["wiperSets", "wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled"]];
  const values = await Promise.all(specs.map(([, table, columns]) => fetchAll(table, columns))); return Object.fromEntries(specs.map(([name], index) => [name, values[index]])); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw new Error(`${table}: ${error.message}`); output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }

function parseConfigurationKey(value) { const parts = String(value ?? "").split("/"); if (parts.length !== 3) return null; return { driver: parseLength(parts[0]), passenger: parseLength(parts[1]), rear: parseLength(parts[2]) }; }
function parseLength(value) { if (!value || value === "-") return null; return numberOrNull(value); }
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => y - x).join("/"); }
function queueMetrics(rows) { return { applications: rows.length, application_years: sumAy(rows), configurations: uniqueStrings(rows.map((row) => row.configuration_id)).length }; }
function sumAy(rows) { return rows.reduce((sum, row) => sum + Number(row.application_years ?? 0), 0); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function percent(n, d) { return d ? Number((100 * n / d).toFixed(4)) : 0; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function uniqueNumbers(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))).map(Number))]; }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function countBy(values) { const output = {}; for (const value of values) output[value] = (output[value] ?? 0) + 1; return output; }
function duplicateValues(values) { return Object.entries(countBy(values)).filter(([, count]) => count > 1).map(([value]) => value); }
function writeJson(name, value) { fs.writeFileSync(path.join(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(name, rows) { fs.writeFileSync(path.join(OUTPUT_DIR, name), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
function readme(summary) { const c = summary.classifications; return `Honda Civic Wiper Productization Audit - 2026-10-25\n\nMode: report-only; no production writes.\nPeriod: 2000-2026.\n\nThis audit reads published fitments, wiper_configuration rows, blade rows, and current wiper_sets. Blade sizes come only from wiper_configuration_blades and are cross-checked against configuration_key. Missing sizes are never inferred.\n\nProduct-only scope: ${summary.product_only.applications} applications / ${summary.product_only.application_years} AY.\n- Ready to link: ${c.ready_to_link.applications} applications / ${c.ready_to_link.application_years} AY.\n- Direct create: ${c.direct_create.applications} applications / ${c.direct_create.application_years} AY.\n- Procurement/activation: ${c.procurement.applications} applications / ${c.procurement.application_years} AY.\n- Incomplete blocked: ${c.incomplete_blocked.applications} applications / ${c.incomplete_blocked.application_years} AY.\n\nRerun: node scripts/catalog/report-honda-civic-wiper-productization-20261025.mjs\n` + (summary.integrity.expected_product_only_matches ? "" : "\nWARNING: live product-only AY drifted from the expected 114 AY baseline.\n"); }
