import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { POPULAR_EXTENDED_80_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, "outputs/bmw-3-series-wiper-productization-20261025");
const BASELINE_FILE = path.resolve(ROOT, "outputs/popular-extended132-product-gaps-20261025/coverage-by-model.json");
const PRIOR_PRODUCT_GAPS = path.resolve(ROOT, "outputs/core103-wiper-phase-20261025/sellable-combinations-to-create.jsonl");
const PERIOD = { from: 2000, to: 2026 };
const EXPECTED_PRODUCT_ONLY_AY = 107;

if (process.argv.includes("--apply")) throw new Error("Report-only script: --apply is intentionally unsupported.");
if (process.argv.slice(2).length) throw new Error(`Unknown argument(s): ${process.argv.slice(2).join(", ")}`);
loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase read credentials.");
for (const file of [BASELINE_FILE, PRIOR_PRODUCT_GAPS]) if (!fs.existsSync(file)) throw new Error(`Missing local input: ${file}`);

const group = POPULAR_EXTENDED_80_VEHICLE_GROUPS.find((row) => row.rank === 40);
if (!group || group.label !== "BMW 3 Series") throw new Error("Maintained rank 40 group changed; review scope before rerunning.");
const aliasIndex = buildPopularAliasIndex([group]);
const baselineDocument = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
const baseline = baselineDocument.groups.find((row) => row.popular_group === group.label);
if (!baseline) throw new Error(`Baseline group missing: ${group.label}`);
if (baseline.wiper_product_without_knowledge_gap_years !== EXPECTED_PRODUCT_ONLY_AY) {
  throw new Error(`Expected ${EXPECTED_PRODUCT_ONLY_AY} product-only AY, found ${baseline.wiper_product_without_knowledge_gap_years}`);
}
const priorProductRows = readJsonl(PRIOR_PRODUCT_GAPS).filter((row) => row.family_id === "bmw_3_series");
const priorByApplication = new Map(priorProductRows.flatMap((row) => (row.application_ids ?? []).map((id) => [id, row])));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const data = await loadProduction();
const prepared = prepare(data);
writeOutputs(prepared);
console.log(JSON.stringify({
  output_dir: path.relative(ROOT, OUTPUT_DIR).replaceAll("\\", "/"),
  scoped_applications: prepared.summary.live_reconciliation.scoped_active_applications,
  scoped_application_years: prepared.summary.live_reconciliation.scoped_application_years,
  product_only_applications: prepared.summary.live_reconciliation.product_only_applications,
  product_only_application_years: prepared.summary.live_reconciliation.product_only_application_years,
  ...prepared.summary.action_application_years,
  production_writes: 0
}, null, 2));

function prepare(data) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const configById = new Map(data.configurations.map((row) => [row.id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const fitmentsByApplication = groupBy(data.fitments.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const setAudits = data.wiperSets.map(auditSet);

  const applications = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const matched = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (matched?.id !== group.id) continue;
    const years = uniqueNumbers((yearsByApplication.get(application.application_id) ?? []).map((row) => row.model_year))
      .filter((year) => year >= PERIOD.from && year <= PERIOD.to).sort((a, b) => a - b);
    if (!years.length) continue;
    const series = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id);
    const publishedConfigurations = (fitmentsByApplication.get(application.application_id) ?? []).map((fitment) => {
      const configuration = configById.get(fitment.wiper_configuration_id);
      return {
        configuration_id: fitment.wiper_configuration_id,
        configuration_key: configuration?.configuration_key ?? null,
        configuration_status: configuration?.configuration_status ?? null,
        rear_status: configuration?.rear_status ?? null,
        source: fitment.source, notes: fitment.notes
      };
    });
    applications.push({
      application_id: application.application_id, make: upper(make?.name), model: upper(model?.name),
      series_code: upper(series?.code), series_name: String(series?.display_name ?? "").trim(),
      body_style: String(variant?.body_style ?? "").trim(), variant: String(variant?.display_name ?? "").trim(),
      years, application_years: years.length, published_configurations: publishedConfigurations
    });
  }

  const applicationAudit = applications.map((application) => classifyApplication(application, setAudits));
  const productOnly = applicationAudit.filter((row) => row.knowledge_published && !row.sellable_product_covered);
  const productOnlyAy = sumAy(productOnly);
  if (productOnlyAy !== EXPECTED_PRODUCT_ONLY_AY) {
    throw new Error(`Live product-only AY ${productOnlyAy} does not reconcile to expected ${EXPECTED_PRODUCT_ONLY_AY}`);
  }
  const readyToLink = productOnly.filter((row) => row.classification === "ready-to-link");
  const directCreate = productOnly.filter((row) => row.classification === "direct-create");
  const procurement = productOnly.filter((row) => row.classification === "procurement");
  const incomplete = productOnly.filter((row) => row.classification === "incomplete");
  const review = productOnly.filter((row) => row.classification === "review");
  const configurationSummary = [...groupBy(productOnly, (row) => row.front_configuration_complete
    ? `front:${pairKey(row.driver_length_in, row.passenger_length_in)}` : `partial:${row.configuration_key ?? "<multiple>"}`).values()]
    .map((rows) => summarizeConfiguration(rows, setAudits));
  const readyToLinkGroups = configurationSummary.filter((row) => row.classification === "ready-to-link");
  const directCreateGroups = configurationSummary.filter((row) => row.classification === "direct-create");
  const procurementGroups = configurationSummary.filter((row) => row.classification === "procurement");
  const incompleteGroups = configurationSummary.filter((row) => row.classification === "incomplete");
  const reviewGroups = configurationSummary.filter((row) => row.classification === "review");
  const actionApplicationYears = {
    ready_to_link_ay: sumAy(readyToLink), direct_create_ay: sumAy(directCreate), procurement_ay: sumAy(procurement),
    incomplete_ay: sumAy(incomplete), review_ay: sumAy(review)
  };
  const immediatelyActionable = [...readyToLink, ...directCreate];
  const summary = {
    generated_at: new Date().toISOString(), mode: "report-only", production_writes: 0,
    product_line: "wiper", explicitly_excluded_product_lines: ["brake_pad", "brake_reference", "NBP"],
    period: PERIOD, group: { rank: group.rank, id: group.id, label: group.label, aliases: group.aliases },
    classification_policy: {
      "ready-to-link": "Complete published front sizes and an exact active/public/approved/commerce-active/checkout-enabled front_pair exists.",
      "direct-create": "Complete published front sizes; no exact wiper_set exists; both blade lengths already occur in sellable front-pair inventory.",
      procurement: "Complete published front sizes, but an exact non-sellable set exists or at least one blade length is absent from sellable inventory.",
      incomplete: "At least one published front blade length is unknown; no size is inferred from another body or source.",
      review: "Duplicate or invalid published configuration requires catalog review."
    },
    baseline: {
      source: path.relative(ROOT, BASELINE_FILE).replaceAll("\\", "/"),
      applications_total: baseline.applications_total, application_years_total: baseline.application_years_total,
      knowledge_application_years_covered: baseline.wiper_knowledge_application_years_covered,
      product_application_years_covered: baseline.wiper_product_application_years_covered,
      product_application_years_missing: baseline.wiper_product_application_years_missing,
      product_only_application_years: baseline.wiper_product_without_knowledge_gap_years,
      extended132_denominator_application_years: baselineDocument.totals.wiper_product.application_years_total
    },
    live_reconciliation: {
      scoped_active_applications: applications.length, scoped_application_years: sumAy(applications),
      product_only_applications: productOnly.length, product_only_application_years: productOnlyAy,
      expected_product_only_application_years: EXPECTED_PRODUCT_ONLY_AY,
      product_only_reconciles: productOnlyAy === EXPECTED_PRODUCT_ONLY_AY
    },
    action_counts: actionCounts(productOnly), action_application_years: actionApplicationYears,
    conclusion: {
      immediately_actionable_applications: immediatelyActionable.length,
      immediately_actionable_application_years: sumAy(immediatelyActionable),
      immediately_actionable_bmw_product_pp: percent(sumAy(immediatelyActionable), sumAy(applications)),
      immediately_actionable_extended132_pp: percent(sumAy(immediatelyActionable), baselineDocument.totals.wiper_product.application_years_total),
      procurement_application_years: sumAy(procurement), incomplete_application_years: sumAy(incomplete), review_application_years: sumAy(review),
      note: "Only complete published front sizes are commercialized. Existing inventory never fills a missing blade length."
    },
    integrity: {
      action_partition_applications: readyToLink.length + directCreate.length + procurement.length + incomplete.length + review.length === productOnly.length,
      action_partition_application_years: Object.values(actionApplicationYears).reduce((a, b) => a + b, 0) === productOnlyAy,
      prior_product_gap_application_years: priorProductRows.reduce((sum, row) => sum + row.application_years, 0),
      prior_product_gap_reconciles: priorProductRows.reduce((sum, row) => sum + row.application_years, 0) === EXPECTED_PRODUCT_ONLY_AY,
      missing_prior_application_ids: productOnly.filter((row) => !priorByApplication.has(row.application_id)).map((row) => row.application_id)
    },
    configuration_summary: configurationSummary,
    sources: {
      baseline: fileIdentity(BASELINE_FILE), prior_product_gap: fileIdentity(PRIOR_PRODUCT_GAPS),
      production_snapshot: { fetched_at: data.fetched_at, mode: "read-only", queried_tables: data.table_counts },
      product_gate: "front_pair + active + public + approved + commerce active + checkout enabled",
      brake_tables_queried: []
    }
  };
  return { summary, productOnly, configurationSummary, readyToLink: readyToLinkGroups, directCreate: directCreateGroups,
    procurement: procurementGroups, incomplete: incompleteGroups, review: reviewGroups, setAudits };
}

function classifyApplication(application, sets) {
  const published = application.published_configurations;
  if (published.length !== 1 || !published[0].configuration_key) {
    return {
      ...application, knowledge_published: published.length > 0, configuration_key: null,
      driver_length_in: null, passenger_length_in: null, rear_length_in: null,
      front_configuration_complete: false, exact_wiper_sets: [], exact_sellable_wiper_sets: [],
      driver_size_sellable_sets: [], passenger_size_sellable_sets: [], sellable_product_covered: false,
      classification: "review", reason: published.length > 1 ? "multiple_published_wiper_fitments" : "published_configuration_missing_key",
      prior_product_gap: priorByApplication.get(application.application_id) ?? null, production_write: false
    };
  }
  const configurationKey = published[0].configuration_key;
  const [driver, passenger, rear] = configurationKey.split("/").map(parseLength);
  const complete = driver !== null && passenger !== null;
  const exactSets = complete ? sets.filter((set) => set.set_type === "front_pair" && samePair(set, driver, passenger)) : [];
  const exactSellable = exactSets.filter((set) => set.sellable);
  const driverInventory = driver === null ? [] : sets.filter((set) => set.sellable && setContainsFrontLength(set, driver));
  const passengerInventory = passenger === null ? [] : sets.filter((set) => set.sellable && setContainsFrontLength(set, passenger));
  let classification; let reason;
  if (!complete) {
    classification = "incomplete";
    reason = driver === null && passenger === null ? "both_front_lengths_missing" : "one_front_length_missing";
  } else if (exactSellable.length) {
    classification = "ready-to-link";
    reason = "exact_sellable_front_pair_exists";
  } else if (exactSets.length) {
    classification = "procurement";
    reason = "exact_front_pair_exists_but_is_not_sellable";
  } else if (driverInventory.length && passengerInventory.length) {
    classification = "direct-create";
    reason = "missing_exact_combination_but_both_blade_sizes_exist_in_sellable_inventory";
  } else {
    classification = "procurement";
    reason = !driverInventory.length && !passengerInventory.length ? "both_blade_sizes_absent_from_sellable_inventory"
      : !driverInventory.length ? "driver_blade_size_absent_from_sellable_inventory" : "passenger_blade_size_absent_from_sellable_inventory";
  }
  return {
    ...application, knowledge_published: true, configuration_key: configurationKey,
    driver_length_in: driver, passenger_length_in: passenger, rear_length_in: rear,
    front_configuration_complete: complete, exact_wiper_sets: exactSets, exact_sellable_wiper_sets: exactSellable,
    driver_size_sellable_sets: driverInventory, passenger_size_sellable_sets: passengerInventory,
    sellable_product_covered: exactSellable.length > 0, classification, reason,
    prior_product_gap: priorByApplication.get(application.application_id) ?? null, production_write: false
  };
}

function summarizeConfiguration(rows, sets) {
  const first = rows[0];
  return {
    front_pair_key: first.front_configuration_complete ? pairKey(first.driver_length_in, first.passenger_length_in) : null,
    configuration_keys: uniqueStrings(rows.map((row) => row.configuration_key)), driver_length_in: first.driver_length_in,
    passenger_length_in: first.passenger_length_in, rear_length_in: first.rear_length_in,
    rear_lengths_in: [...new Set(rows.map((row) => row.rear_length_in))],
    front_configuration_complete: first.front_configuration_complete,
    series_codes: uniqueStrings(rows.map((row) => row.series_code)), body_styles: uniqueStrings(rows.map((row) => row.body_style)),
    application_ids: rows.map((row) => row.application_id).sort(), applications: rows.length,
    application_years: sumAy(rows), years: uniqueNumbers(rows.flatMap((row) => row.years)).sort((a, b) => a - b),
    classification: first.classification, reason: first.reason,
    exact_wiper_sets: first.exact_wiper_sets, exact_sellable_wiper_sets: first.exact_sellable_wiper_sets,
    sellable_sets_containing_driver_size: first.driver_length_in === null ? [] : sets.filter((set) => set.sellable && setContainsFrontLength(set, first.driver_length_in)),
    sellable_sets_containing_passenger_size: first.passenger_length_in === null ? [] : sets.filter((set) => set.sellable && setContainsFrontLength(set, first.passenger_length_in)),
    production_write: false
  };
}

async function loadProduction() {
  const [makes, models, configurations, wiperSets] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("wiper_configurations", "id,configuration_key,configuration_status,rear_status"),
    fetchAll("wiper_sets", "id,sku,set_type,driver_length_in,passenger_length_in,rear_length_in,active,visibility_status,content_status,commerce_status,checkout_enabled")
  ]);
  const makeById = new Map(makes.map((row) => [row.make_id, row]));
  const targetModelIds = models.filter((model) => {
    const make = makeById.get(model.make_id);
    return make && aliasIndex.get(canonicalModelKey(make.name, model.name))?.id === group.id;
  }).map((row) => row.model_id);
  const applications = await selectIn("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status", "model_id", targetModelIds);
  const appIds = applications.map((row) => row.application_id);
  const seriesIds = uniqueStrings(applications.map((row) => row.series_id));
  const variantIds = uniqueStrings(applications.map((row) => row.variant_id));
  const [series, variants, years, fitments] = await Promise.all([
    selectIn("vehicle_catalog_series", "series_id,model_id,code,display_name,status", "series_id", seriesIds),
    selectIn("vehicle_catalog_variants", "variant_id,display_name,body_style", "variant_id", variantIds),
    selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", appIds),
    selectIn("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", "application_id", appIds)
  ]);
  return {
    makes, models, configurations, wiperSets, applications, series, variants, years, fitments,
    fetched_at: new Date().toISOString(),
    table_counts: {
      vehicle_catalog_makes: makes.length, vehicle_catalog_models: models.length,
      target_vehicle_catalog_series: series.length, target_vehicle_catalog_variants: variants.length,
      target_vehicle_catalog_applications: applications.length, target_vehicle_catalog_application_years: years.length,
      target_vehicle_catalog_wiper_fitments: fitments.length, wiper_configurations: configurations.length, wiper_sets: wiperSets.length
    }
  };
}

function writeOutputs(prepared) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson("summary.json", prepared.summary);
  writeJsonl("application-audit.jsonl", prepared.productOnly);
  writeJsonl("configuration-summary.jsonl", prepared.configurationSummary);
  writeJsonl("ready-to-link.jsonl", prepared.readyToLink);
  writeJsonl("direct-create.jsonl", prepared.directCreate);
  writeJsonl("procurement.jsonl", prepared.procurement);
  writeJsonl("incomplete.jsonl", prepared.incomplete);
  writeJsonl("review.jsonl", prepared.review);
  writeJson("wiper-set-audit.json", {
    relevant_configuration_keys: uniqueStrings(prepared.configurationSummary.flatMap((row) => row.configuration_keys)),
    relevant_sets: prepared.setAudits.filter((set) => prepared.configurationSummary.some((row) =>
      samePair(set, row.driver_length_in, row.passenger_length_in)
      || setContainsFrontLength(set, row.driver_length_in) || setContainsFrontLength(set, row.passenger_length_in)))
  });
  writeJson("source-audit.json", {
    generated_at: prepared.summary.generated_at, sources: prepared.summary.sources,
    safeguards: [
      "Wiper tables and vehicle identity tables only; no brake table or brake artifact was queried.",
      "Report-only; --apply and all other arguments are rejected.",
      "Published configuration sizes are preserved exactly; missing sizes are never inferred.",
      "A product classification does not mutate fitment knowledge or create a product."
    ]
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, "README.md"), readme(prepared.summary), "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "rerun.mjs"), `import "../../scripts/catalog/report-bmw-3-series-wiper-productization-20261025.mjs";\n`);
}

function auditSet(row) {
  return {
    id: row.id, sku: row.sku, set_type: row.set_type,
    driver_length_in: numberOrNull(row.driver_length_in), passenger_length_in: numberOrNull(row.passenger_length_in),
    rear_length_in: numberOrNull(row.rear_length_in), active: row.active === true,
    visibility_status: row.visibility_status, content_status: row.content_status,
    commerce_status: row.commerce_status, checkout_enabled: row.checkout_enabled === true,
    sellable: row.set_type === "front_pair" && row.active === true && row.visibility_status === "public"
      && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled === true
  };
}
function samePair(set, driver, passenger) {
  if (driver === null || passenger === null) return false;
  return pairKey(set.driver_length_in, set.passenger_length_in) === pairKey(driver, passenger);
}
function setContainsFrontLength(set, length) {
  if (length === null) return false;
  return set.driver_length_in === length || set.passenger_length_in === length;
}
function pairKey(a, b) { return [Number(a), Number(b)].sort((x, y) => y - x).join("/"); }
function actionCounts(rows) {
  return Object.fromEntries([...groupBy(rows, (row) => row.classification).entries()].map(([key, values]) => [key, {
    applications: values.length, application_years: sumAy(values), configuration_keys: uniqueStrings(values.map((row) => row.configuration_key))
  }]));
}
function readme(summary) {
  const ay = summary.action_application_years;
  return [
    "# BMW 3 Series wiper productization audit — 2026-10-25", "",
    "Report-only audit of published wiper configurations and current wiper_sets. Brake data is entirely out of scope.", "",
    `- Product-only baseline: **${summary.live_reconciliation.product_only_application_years} AY**.`,
    `- Ready to link: **${ay.ready_to_link_ay} AY**.`,
    `- Direct create (missing exact combination; both sizes already represented in sellable inventory): **${ay.direct_create_ay} AY**.`,
    `- Procurement/activation required: **${ay.procurement_ay} AY**.`,
    `- Incomplete published front sizes: **${ay.incomplete_ay} AY**.`,
    `- Review: **${ay.review_ay} AY**.`,
    `- Immediately actionable product uplift ceiling: **${summary.conclusion.immediately_actionable_application_years} AY**.`, "",
    "No missing blade size is inferred. Direct-create identifies a missing exact wiper_set combination only; it does not create or publish that set.", "",
    "Rerun: `node outputs/bmw-3-series-wiper-productization-20261025/rerun.mjs`", ""
  ].join("\n");
}

function parseLength(value) { return value && value !== "-" ? numberOrNull(value) : null; }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function sumAy(rows) { return rows.reduce((total, row) => total + row.application_years, 0); }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(4)) : 0; }
function uniqueNumbers(values) { return [...new Set(values.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0).map(Number))]; }
function uniqueStrings(values) { return [...new Set(values.filter(Boolean).map(String))].sort(); }
function groupBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) { const key = keyFn(row); const values = map.get(key) ?? []; values.push(row); map.set(key, values); }
  return map;
}
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function writeJson(file, value) { fs.writeFileSync(path.join(OUTPUT_DIR, file), `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function writeJsonl(file, rows) { fs.writeFileSync(path.join(OUTPUT_DIR, file), rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), "utf8"); }
function fileIdentity(file) {
  const bytes = fs.readFileSync(file);
  return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString() };
}
async function fetchAll(table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}
async function selectIn(table, columns, field, values) {
  const output = [];
  for (let index = 0; index < values.length; index += 50) {
    const batch = values.slice(index, index + 50);
    if (!batch.length) continue;
    const { data, error } = await db.from(table).select(columns).in(field, batch);
    if (error) throw new Error(`${table}: ${error.message}`);
    output.push(...(data ?? []));
  }
  return output;
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
