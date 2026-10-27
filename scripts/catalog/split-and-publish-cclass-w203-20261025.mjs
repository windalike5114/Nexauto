import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "cclass-w203-generation-split-20261025");
const REVIEW_FILE = path.join(ROOT, "outputs", "extended132-model-c-class-wiper-20261025", "multi-candidate-review.jsonl");
const SOURCE = "WIPERTECH_W203_EXACT_YEAR_SPLIT_2026_10_25";
const TRANSITION_YEAR = 2003;

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const reviewGroups = readJsonl(REVIEW_FILE);
const targets = reviewGroups.flatMap((group) => group.application_ids.map((applicationId) => ({ applicationId, body: group.body, seriesChassis: group.series_chassis })));
assert(targets.length === 22 && new Set(targets.map((row) => row.applicationId)).size === 22, "Expected 22 unique W203 transition applications");

const targetIds = targets.map((row) => row.applicationId);
const [applications, years, provenance, products, wipers, references, configs, blades, wiperSets, allApplications,
  customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_applications", "application_id", targetIds),
  selectIn("vehicle_catalog_application_years", "application_id", targetIds),
  selectIn("vehicle_catalog_application_provenance", "application_id", targetIds),
  selectIn("vehicle_catalog_product_fitments", "application_id", targetIds),
  selectIn("vehicle_catalog_wiper_fitments", "application_id", targetIds),
  selectIn("vehicle_catalog_part_reference_fitments", "application_id", targetIds),
  fetchAll("wiper_configurations", "*"),
  fetchAll("wiper_configuration_blades", "*"),
  fetchAll("wiper_sets", "*"),
  fetchAll("vehicle_catalog_applications", "*"),
  selectIn("customer_vehicles", "vehicle_catalog_application_id", targetIds),
  selectIn("order_items", "vehicle_catalog_application_id", targetIds),
  selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", targetIds),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", targetIds),
]);

assert(applications.length === 22, `Expected 22 current applications, got ${applications.length}`);
assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0,
  "A source W203 application has commerce references; transactional manual split is required");

const appById = new Map(applications.map((row) => [row.application_id, row]));
const yearsByApp = groupBy(years, (row) => row.application_id);
const provenanceByApp = groupBy(provenance, (row) => row.application_id);
const productsByApp = groupBy(products, (row) => row.application_id);
const wipersByApp = groupBy(wipers, (row) => row.application_id);
const referencesByApp = groupBy(references, (row) => row.application_id);
const configByKey = new Map(configs.map((row) => [row.configuration_key, row]));
const allCanonicalKeys = new Set(allApplications.filter((row) => row.status === "active" && !targetIds.includes(row.application_id)).map((row) => row.canonical_key));
const allApplicationIds = new Set(allApplications.map((row) => row.application_id));

for (const key of ["24/22/15", "24/22/16", "22/22/16", "22/22/-"]) {
  const config = required(configByKey.get(key), `configuration ${key}`);
  assert(config.configuration_status === "published", `Configuration ${key} is not published`);
  const [driver, passenger] = key.split("/").map(Number);
  assert(blades.some((row) => row.wiper_configuration_id === config.id && row.position === "driver" && Number(row.length_in) === driver), `${key} driver blade mismatch`);
  assert(blades.some((row) => row.wiper_configuration_id === config.id && row.position === "passenger" && Number(row.length_in) === passenger), `${key} passenger blade mismatch`);
  assert(wiperSets.some((row) => row.set_type === "front_pair" && row.active === true && Number(row.driver_length_in) === driver && Number(row.passenger_length_in) === passenger), `No active sellable ${driver}/${passenger} front pair`);
}

const plan = {
  generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", production_writes: APPLY,
  source: SOURCE,
  evidence: {
    local_file: "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json",
    rule: "W203 exact WiperTech rows change in model year 2003. Year-only catalog cannot distinguish the within-year transition, so 2003 remains review-only while <=2002 and >=2004 are split and published.",
    configurations: {
      sedan: { through_2002: "24/22/15", transition_2003: ["24/22/15", "22/22/16"], from_2004: "22/22/16" },
      wagon: { through_2002: "24/22/16", transition_2003: ["24/22/16", "22/22/16"], from_2004: "22/22/16" },
      coupe: { through_2002: "24/22/16", transition_2003: ["24/22/16", "22/22/-"], from_2004: "22/22/-" },
    },
  },
  splits: [],
  totals: { source_applications: 22, transition_review_application_years: 22, new_applications: 0, published_application_years: 0,
    product_fitments_to_copy: 0, reference_fitments_to_copy: 0, provenance_rows_to_copy: 0 },
};

for (const target of targets) {
  const source = required(appById.get(target.applicationId), target.applicationId);
  assert(source.status === "active", `Source is not active: ${source.application_id}`);
  const sourceYears = (yearsByApp.get(source.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  assert(sourceYears.includes(TRANSITION_YEAR), `Source lacks transition year ${TRANSITION_YEAR}: ${source.application_id}`);
  const preYears = sourceYears.filter((year) => year < TRANSITION_YEAR);
  const postYears = sourceYears.filter((year) => year > TRANSITION_YEAR);
  assert(preYears.length && postYears.length, `Source does not span both W203 configurations: ${source.application_id}`);
  const configurations = bodyConfigurations(target.body);

  const transitionCanonicalKey = canonicalKey(source, TRANSITION_YEAR, TRANSITION_YEAR);
  assert(!allCanonicalKeys.has(transitionCanonicalKey), `Transition canonical collision: ${source.application_id}`);
  allCanonicalKeys.add(transitionCanonicalKey);

  const children = [
    childPlan(source, "pre", preYears, configurations.pre),
    childPlan(source, "post", postYears, configurations.post),
  ];
  for (const child of children) {
    assert(!allCanonicalKeys.has(child.application.canonical_key), `Child canonical collision: ${child.application.canonical_key}`);
    assert(!allApplicationIds.has(child.application.application_id), `Child application ID collision: ${child.application.application_id}`);
    allCanonicalKeys.add(child.application.canonical_key);
    allApplicationIds.add(child.application.application_id);
    const productRows = (productsByApp.get(source.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: child.application.application_id,
      notes: appendNote(row.notes, `${SOURCE}; split_from=${source.application_id}; segment=${child.segment}`) }));
    const referenceRows = (referencesByApp.get(source.application_id) ?? []).map((row) => ({ ...stripTimes(row), application_id: child.application.application_id }));
    const provenanceRows = (provenanceByApp.get(source.application_id) ?? []).map((row) => ({ ...row, application_id: child.application.application_id }));
    child.productFitments = productRows;
    child.referenceFitments = referenceRows;
    child.provenance = provenanceRows;
    plan.totals.product_fitments_to_copy += productRows.length;
    plan.totals.reference_fitments_to_copy += referenceRows.length;
    plan.totals.provenance_rows_to_copy += provenanceRows.length;
    plan.totals.published_application_years += child.years.length;
  }
  plan.totals.new_applications += children.length;
  plan.splits.push({ source_application_id: source.application_id, series_chassis: target.seriesChassis, body: target.body,
    source_years: sourceYears, transition: { year: TRANSITION_YEAR, canonical_key: transitionCanonicalKey, candidate_configurations: configurations.transition }, children });
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, APPLY ? "apply-plan.json" : "preflight.json"), JSON.stringify(plan, null, 2));

let backup_dir = null;
if (APPLY) {
  backup_dir = createBackup({ applications, years, provenance, products, wipers, references, customerVehicles, orderItems, orderSnapshots, orderWipers });
  for (const split of plan.splits) {
    const { error: deleteError } = await db.from("vehicle_catalog_application_years").delete().eq("application_id", split.source_application_id).neq("model_year", TRANSITION_YEAR);
    if (deleteError) throw deleteError;
    const { error: updateError } = await db.from("vehicle_catalog_applications").update({ year_from: TRANSITION_YEAR, year_to: TRANSITION_YEAR,
      canonical_key: split.transition.canonical_key, review_status: "needs_review" }).eq("application_id", split.source_application_id).eq("status", "active");
    if (updateError) throw updateError;

    for (const child of split.children) {
      const { error: appError } = await db.from("vehicle_catalog_applications").insert(child.application);
      if (appError) throw appError;
      const { error: yearsError } = await db.from("vehicle_catalog_application_years").insert(child.years.map((year) => ({ application_id: child.application.application_id, model_year: year })));
      if (yearsError) throw yearsError;
      await upsert("vehicle_catalog_application_provenance", child.provenance, "application_id,source_group,source_url");
      await upsert("vehicle_catalog_product_fitments", child.productFitments, "application_id,product_variant_id,position");
      await upsert("vehicle_catalog_part_reference_fitments", child.referenceFitments, "application_id,part_reference_id,position");
      const config = required(configByKey.get(child.configuration_key), child.configuration_key);
      const { error: fitmentError } = await db.from("vehicle_catalog_wiper_fitments").insert({ application_id: child.application.application_id,
        wiper_configuration_id: config.id, fitment_status: "published", source: SOURCE,
        notes: `source=WiperTech; exact_generation=203; exact_body=${split.body}; segment=${child.segment}; years=${child.years[0]}-${child.years.at(-1)}; split_from=${split.source_application_id}` });
      if (fitmentError) throw fitmentError;
    }
  }
}

const verification = APPLY ? await verify(plan) : null;
const result = { ...plan, backup_dir, verification };
const resultPath = path.join(OUT, APPLY ? "applied.json" : "report.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ resultPath, backup_dir, totals: plan.totals, verification }, null, 2));

function childPlan(source, segment, childYears, configurationKey) {
  const yearFrom = Math.min(...childYears); const yearTo = Math.max(...childYears);
  const key = canonicalKey(source, yearFrom, yearTo);
  return {
    segment, years: childYears, configuration_key: configurationKey,
    application: {
      application_id: applicationId(key), model_id: source.model_id, series_id: source.series_id, variant_id: source.variant_id,
      powertrain_id: source.powertrain_id, year_from: yearFrom, year_to: yearTo, year_status: source.year_status,
      canonical_key: key, status: "active", review_status: "approved",
    },
  };
}
function bodyConfigurations(body) {
  if (body === "sedan") return { pre: "24/22/15", post: "22/22/16", transition: ["24/22/15", "22/22/16"] };
  if (body === "wagon") return { pre: "24/22/16", post: "22/22/16", transition: ["24/22/16", "22/22/16"] };
  if (body === "coupe") return { pre: "24/22/16", post: "22/22/-", transition: ["24/22/16", "22/22/-"] };
  throw new Error(`Unsupported W203 body: ${body}`);
}
function canonicalKey(source, yearFrom, yearTo) { return [source.model_id, source.series_id, source.variant_id, source.powertrain_id, yearFrom, yearTo].join("|"); }
function applicationId(key) { return `ap_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`; }

async function verify(current) {
  const childIds = current.splits.flatMap((split) => split.children.map((child) => child.application.application_id));
  const [sourceApps, sourceYears, childApps, childYears, childWipers, childProducts, childReferences] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", targetIds), selectIn("vehicle_catalog_application_years", "application_id", targetIds),
    selectIn("vehicle_catalog_applications", "application_id", childIds), selectIn("vehicle_catalog_application_years", "application_id", childIds),
    selectIn("vehicle_catalog_wiper_fitments", "application_id", childIds), selectIn("vehicle_catalog_product_fitments", "application_id", childIds),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", childIds),
  ]);
  const sourceYearMap = groupBy(sourceYears, (row) => row.application_id);
  const childYearMap = groupBy(childYears, (row) => row.application_id);
  const wiperMap = groupBy(childWipers, (row) => row.application_id);
  const productMap = groupBy(childProducts, (row) => row.application_id);
  const referenceMap = groupBy(childReferences, (row) => row.application_id);
  const childById = new Map(childApps.map((row) => [row.application_id, row]));
  const checks = {
    transition_sources_preserved: sourceApps.length === targetIds.length && sourceApps.every((row) => row.status === "active" && row.year_from === TRANSITION_YEAR && row.year_to === TRANSITION_YEAR
      && (sourceYearMap.get(row.application_id) ?? []).length === 1 && Number(sourceYearMap.get(row.application_id)[0].model_year) === TRANSITION_YEAR),
    children_created: childApps.length === childIds.length,
    child_years_exact: current.splits.every((split) => split.children.every((child) => {
      const app = childById.get(child.application.application_id);
      const actual = (childYearMap.get(child.application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
      return app?.canonical_key === child.application.canonical_key && JSON.stringify(actual) === JSON.stringify(child.years);
    })),
    child_wipers_published: current.splits.every((split) => split.children.every((child) => {
      const configId = configByKey.get(child.configuration_key)?.id;
      const rows = wiperMap.get(child.application.application_id) ?? [];
      return rows.length === 1 && rows[0].wiper_configuration_id === configId && rows[0].fitment_status === "published";
    })),
    child_products_copied: current.splits.every((split) => split.children.every((child) => (productMap.get(child.application.application_id) ?? []).length === child.productFitments.length)),
    child_references_copied: current.splits.every((split) => split.children.every((child) => (referenceMap.get(child.application.application_id) ?? []).length === child.referenceFitments.length)),
  };
  assert(Object.values(checks).every(Boolean), "Post-apply W203 verification failed");
  return { ok: true, ...checks };
}

function stripTimes(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function appendNote(value, note) { return [value, note].filter(Boolean).join("; "); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }
function required(value, label) { assert(value, `Missing ${label}`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function fetchAll(table, columns) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; rows.push(...(data ?? [])); if (!data || data.length < 1000) return rows; } }
async function selectIn(table, field, values) { if (!values.length) return []; const rows = []; for (let index = 0; index < values.length; index += 100) { const { data, error } = await db.from(table).select("*").in(field, values.slice(index, index + 100)); if (error) throw error; rows.push(...(data ?? [])); } return rows; }
async function upsert(table, rows, onConflict) { if (!rows.length) return; const { error } = await db.from(table).upsert(rows, { onConflict }); if (error) throw error; }
function createBackup(tables) { const stamp = new Date().toISOString().replace(/[:.]/g, "-"); const dir = path.join(ROOT, "tmp", "production-backups", `cclass-w203-split-${stamp}`); fs.mkdirSync(dir, { recursive: true }); const manifest = { created_at: new Date().toISOString(), source: SOURCE, tables: {} }; for (const [name, rows] of Object.entries(tables)) { const text = JSON.stringify(rows, null, 2); const file = `${name}.json`; fs.writeFileSync(path.join(dir, file), text); manifest.tables[name] = { rows: rows.length, file, sha256: crypto.createHash("sha256").update(text).digest("hex") }; } fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2)); return dir; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
