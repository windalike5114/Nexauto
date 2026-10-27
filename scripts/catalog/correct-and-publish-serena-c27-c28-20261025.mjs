import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "serena-c27-c28-correction-20261025");
const SOURCE = "PIAA_SERENA_C27_C28_EXACT_2026_10_25";
const TARGET_CONFIGURATION = "26/14/12";
const PIAA_C27 = "https://wsearch.piaa.co.jp/result/584";
const PIAA_C28 = "https://www.piaa.co.jp/wp/wp-content/uploads/2025/04/2025_SLIMVOGUE_tekiyo1.pdf";

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const [makes, models, series, variants, applications, years, fitments, configurations, configurationBlades, wiperSets] = await Promise.all([
  fetchAll("vehicle_catalog_makes", "*"),
  fetchAll("vehicle_catalog_models", "*"),
  fetchAll("vehicle_catalog_series", "*"),
  fetchAll("vehicle_catalog_variants", "*"),
  fetchAll("vehicle_catalog_applications", "*"),
  fetchAll("vehicle_catalog_application_years", "*"),
  fetchAll("vehicle_catalog_wiper_fitments", "*"),
  fetchAll("wiper_configurations", "*"),
  fetchAll("wiper_configuration_blades", "*"),
  fetchAll("wiper_sets", "*"),
]);

const makeById = new Map(makes.map((row) => [row.make_id, row]));
const modelById = new Map(models.map((row) => [row.model_id, row]));
const seriesById = new Map(series.map((row) => [row.series_id, row]));
const yearsByApp = groupBy(years, (row) => row.application_id);
const fitmentsByApp = groupBy(fitments, (row) => row.application_id);
const configurationById = new Map(configurations.map((row) => [row.id, row]));
const configuration = required(configurations.find((row) => row.configuration_key === TARGET_CONFIGURATION && row.configuration_status === "published"), `published configuration ${TARGET_CONFIGURATION}`);
const bladeRows = configurationBlades.filter((row) => row.wiper_configuration_id === configuration.id);
assert(bladeRows.some((row) => row.position === "driver" && Number(row.length_in) === 26), "Target driver blade mismatch");
assert(bladeRows.some((row) => row.position === "passenger" && Number(row.length_in) === 14), "Target passenger blade mismatch");
assert(bladeRows.some((row) => row.position === "rear" && Number(row.length_in) === 12), "Target rear blade mismatch");
const sellableFrontPairs = wiperSets.filter((row) => row.set_type === "front_pair" && row.active === true
  && Number(row.driver_length_in) === 26 && Number(row.passenger_length_in) === 14);
assert(sellableFrontPairs.length > 0, "No active 26/14 sellable front pair exists");

const serenaApps = applications.filter((application) => {
  if (application.status !== "active") return false;
  const model = modelById.get(application.model_id);
  const make = makeById.get(model?.make_id);
  return upper(make?.name) === "NISSAN" && upper(model?.name) === "SERENA";
});

const corrections = [];
const publication = [];
const blocked = [];
const applicationById = new Map(applications.map((row) => [row.application_id, row]));

for (const application of serenaApps) {
  const code = upper(seriesById.get(application.series_id)?.code);
  const generation = generationOf(code);
  const currentYears = (yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  const window = generationWindow(generation);
  if (window) {
    const keptYears = currentYears.filter((year) => year >= window.from && year <= window.to);
    const removedYears = currentYears.filter((year) => !keptYears.includes(year));
    assert(keptYears.length > 0, `Generation correction would empty ${application.application_id}`);
    if (removedYears.length) {
      const newYearFrom = Math.min(...keptYears);
      const newYearTo = Math.max(...keptYears);
      const newCanonicalKey = [application.model_id, application.series_id, application.variant_id, application.powertrain_id, newYearFrom, newYearTo].join("|");
      const collision = applications.find((row) => row.application_id !== application.application_id && row.status === "active" && row.canonical_key === newCanonicalKey);
      if (collision) {
        blocked.push({ application_id: application.application_id, series_code: code, reason: "canonical_key_collision_after_year_trim", collision_application_id: collision.application_id });
      } else {
        corrections.push({ application_id: application.application_id, series_code: code, generation, current_years: currentYears, kept_years: keptYears, removed_years: removedYears,
          current_year_from: application.year_from, current_year_to: application.year_to, new_year_from: newYearFrom, new_year_to: newYearTo,
          current_canonical_key: application.canonical_key, new_canonical_key: newCanonicalKey });
      }
    }
  }

  if (!['C27', 'C28'].includes(generation)) continue;
  const published = (fitmentsByApp.get(application.application_id) ?? []).filter((row) => row.fitment_status === "published");
  const publishedKeys = unique(published.map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key));
  publication.push({ application_id: application.application_id, series_code: code, generation, current_years: currentYears,
    configuration_id: configuration.id, configuration_key: TARGET_CONFIGURATION,
    evidence_url: generation === "C27" ? PIAA_C27 : PIAA_C28,
    current_published_configuration_keys: publishedKeys,
    action: publishedKeys.length === 1 && publishedKeys[0] === TARGET_CONFIGURATION ? "already_published" : "publish_exact_and_reject_other_candidates" });
}

const affectedIds = unique([...corrections.map((row) => row.application_id), ...publication.map((row) => row.application_id)]);
const [customerVehicles, orderItems, orderSnapshots, orderWipers, affectedProvenance, affectedProducts, affectedReferences] = await Promise.all([
  selectIn("customer_vehicles", "vehicle_catalog_application_id", corrections.map((row) => row.application_id)),
  selectIn("order_items", "vehicle_catalog_application_id", corrections.map((row) => row.application_id)),
  selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", corrections.map((row) => row.application_id)),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", corrections.map((row) => row.application_id)),
  selectIn("vehicle_catalog_application_provenance", "application_id", affectedIds),
  selectIn("vehicle_catalog_product_fitments", "application_id", affectedIds),
  selectIn("vehicle_catalog_part_reference_fitments", "application_id", affectedIds),
]);
assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0,
  "A year-corrected application has commerce references; transactional review is required");
assert(blocked.length === 0, `Blocked corrections exist: ${JSON.stringify(blocked)}`);

const report = {
  generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", production_writes: APPLY,
  source: SOURCE,
  evidence: {
    C27: { years: "2016-08 to 2022-11", chassis: ["C27", "GC27", "GFC27", "GFNC27", "GNC27", "HC27", "HFC27"], configuration: TARGET_CONFIGURATION, url: PIAA_C27 },
    C28: { years: "2022-12 onward", chassis: ["C28", "GC28", "GFC28"], configuration: TARGET_CONFIGURATION, url: PIAA_C28 },
    C24: { years: "1999-06 to 2005-05", publication: "not_published_without_exact_length_evidence" },
  },
  product: { sellable_front_pair_skus: sellableFrontPairs.map((row) => row.sku).sort() },
  corrections,
  publication,
  blocked,
  totals: {
    year_corrected_applications: corrections.length,
    application_years_removed: corrections.reduce((sum, row) => sum + row.removed_years.length, 0),
    exact_publication_applications: publication.length,
    exact_publication_application_years_after_trim: publication.reduce((sum, row) => {
      const correction = corrections.find((item) => item.application_id === row.application_id);
      return sum + (correction?.kept_years.length ?? row.current_years.length);
    }, 0),
    already_published_exact: publication.filter((row) => row.action === "already_published").length,
    publication_writes: publication.filter((row) => row.action !== "already_published").length,
  },
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, APPLY ? "apply-plan.json" : "preflight.json"), JSON.stringify(report, null, 2));

let backup_dir = null;
if (APPLY) {
  const affectedApps = affectedIds.map((id) => required(applicationById.get(id), id));
  backup_dir = createBackup({ affectedApps, affectedYears: years.filter((row) => affectedIds.includes(row.application_id)), affectedFitments: fitments.filter((row) => affectedIds.includes(row.application_id)),
    affectedProvenance, affectedProducts, affectedReferences, customerVehicles, orderItems, orderSnapshots, orderWipers });

  for (const item of corrections) {
    const { error: yearsError } = await db.from("vehicle_catalog_application_years").delete().eq("application_id", item.application_id).in("model_year", item.removed_years);
    if (yearsError) throw yearsError;
    const { error: appError } = await db.from("vehicle_catalog_applications").update({ year_from: item.new_year_from, year_to: item.new_year_to, canonical_key: item.new_canonical_key,
      review_status: "approved" }).eq("application_id", item.application_id).eq("status", "active");
    if (appError) throw appError;
  }

  for (const item of publication) {
    if (item.action === "already_published") continue;
    const existing = fitmentsByApp.get(item.application_id) ?? [];
    for (const row of existing.filter((candidate) => candidate.wiper_configuration_id !== configuration.id && candidate.fitment_status !== "rejected")) {
      const { error } = await db.from("vehicle_catalog_wiper_fitments").update({ fitment_status: "rejected",
        notes: appendNote(row.notes, `${SOURCE}; superseded_by_exact_PIAA_${item.generation}`) })
        .eq("application_id", item.application_id).eq("wiper_configuration_id", row.wiper_configuration_id);
      if (error) throw error;
    }
    const row = { application_id: item.application_id, wiper_configuration_id: configuration.id, fitment_status: "published", source: SOURCE,
      notes: `authority=PIAA; exact_chassis=${item.series_code}; generation=${item.generation}; configuration=${TARGET_CONFIGURATION}; evidence=${item.evidence_url}; rear_status=known` };
    const { error } = await db.from("vehicle_catalog_wiper_fitments").upsert(row, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
}

const verification = APPLY ? await verify(report) : null;
const result = { ...report, backup_dir, verification };
const resultPath = path.join(OUT, APPLY ? "applied.json" : "report.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ resultPath, backup_dir, totals: report.totals, verification }, null, 2));

async function verify(current) {
  const currentApps = await selectIn("vehicle_catalog_applications", "application_id", affectedIds);
  const currentYears = await selectIn("vehicle_catalog_application_years", "application_id", affectedIds);
  const currentFitments = await selectIn("vehicle_catalog_wiper_fitments", "application_id", publication.map((row) => row.application_id));
  const appMap = new Map(currentApps.map((row) => [row.application_id, row]));
  const yearMap = groupBy(currentYears, (row) => row.application_id);
  const fitmentMap = groupBy(currentFitments, (row) => row.application_id);
  const checks = {
    years_corrected: corrections.every((item) => {
      const app = appMap.get(item.application_id);
      const actualYears = (yearMap.get(item.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
      return app?.year_from === item.new_year_from && app?.year_to === item.new_year_to && app?.canonical_key === item.new_canonical_key
        && JSON.stringify(actualYears) === JSON.stringify(item.kept_years);
    }),
    exact_configuration_published: publication.every((item) => (fitmentMap.get(item.application_id) ?? []).some((row) => row.wiper_configuration_id === configuration.id && row.fitment_status === "published")),
    no_other_published_configuration: publication.every((item) => (fitmentMap.get(item.application_id) ?? []).filter((row) => row.fitment_status === "published").every((row) => row.wiper_configuration_id === configuration.id)),
  };
  assert(Object.values(checks).every(Boolean), "Post-apply Serena verification failed");
  return { ok: true, ...checks };
}

function generationOf(code) {
  if (/C24$/.test(code)) return "C24";
  if (/C27$/.test(code)) return "C27";
  if (/C28$/.test(code)) return "C28";
  return null;
}
function generationWindow(generation) {
  if (generation === "C24") return { from: 1999, to: 2005 };
  if (generation === "C27") return { from: 2016, to: 2022 };
  if (generation === "C28") return { from: 2022, to: 2026 };
  return null;
}
function appendNote(value, note) { return [value, note].filter(Boolean).join("; "); }
function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))]; }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }
function required(value, label) { assert(value, `Missing ${label}`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}
async function selectIn(table, field, values) {
  if (!values.length) return [];
  const rows = [];
  for (let index = 0; index < values.length; index += 100) {
    const { data, error } = await db.from(table).select("*").in(field, values.slice(index, index + 100));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}
function createBackup(tables) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(ROOT, "tmp", "production-backups", `serena-c27-c28-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { created_at: new Date().toISOString(), source: SOURCE, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const text = JSON.stringify(rows, null, 2);
    const file = `${name}.json`;
    fs.writeFileSync(path.join(dir, file), text);
    manifest.tables[name] = { rows: rows.length, file, sha256: crypto.createHash("sha256").update(text).digest("hex") };
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dir;
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
