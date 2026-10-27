import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "pajero-generation-correction-20261025");
const BLOCKED_FILE = path.join(ROOT, "outputs", "extended132-model-pajero-wiper-20261025", "blocked.jsonl");
const SOURCE = "WIPERTECH_PAJERO_GENERATION_SPLIT_2026_10_25";
const V67_CODES = new Set(["V67W", "V68W", "V72W", "V78W"]);
const V89_CODES = new Set(["V83W", "V87W", "V88W", "V93W", "V97W", "V98W"]);

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const blockedRows = readJsonl(BLOCKED_FILE);
const targetRows = blockedRows.filter((row) => V67_CODES.has(row.series_code) || V89_CODES.has(row.series_code));
assert(targetRows.length === 10, `Expected 10 Pajero generation targets, got ${targetRows.length}`);
const targetEntries = targetRows.flatMap((row) => row.application_ids.map((applicationId) => ({ ...row, application_id: applicationId })));
const targetIds = targetEntries.map((row) => row.application_id);
assert(targetIds.length === 10 && new Set(targetIds).size === 10, "Expected 10 unique Pajero application IDs");

const [applications, years, provenance, products, wipers, references, configs, blades, wiperSets, allApplications,
  customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
  selectIn("vehicle_catalog_applications", "application_id", targetIds), selectIn("vehicle_catalog_application_years", "application_id", targetIds),
  selectIn("vehicle_catalog_application_provenance", "application_id", targetIds), selectIn("vehicle_catalog_product_fitments", "application_id", targetIds),
  selectIn("vehicle_catalog_wiper_fitments", "application_id", targetIds), selectIn("vehicle_catalog_part_reference_fitments", "application_id", targetIds),
  fetchAll("wiper_configurations", "*"), fetchAll("wiper_configuration_blades", "*"), fetchAll("wiper_sets", "*"),
  fetchAll("vehicle_catalog_applications", "*"), selectIn("customer_vehicles", "vehicle_catalog_application_id", targetIds),
  selectIn("order_items", "vehicle_catalog_application_id", targetIds), selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", targetIds),
  selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", targetIds),
]);
assert(applications.length === 10, "Target application count changed");
assert(customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length === 0,
  "A target Pajero application has commerce references; transactional manual correction is required");

const appById = new Map(applications.map((row) => [row.application_id, row]));
const yearsByApp = groupBy(years, (row) => row.application_id);
const provenanceByApp = groupBy(provenance, (row) => row.application_id);
const productsByApp = groupBy(products, (row) => row.application_id);
const wipersByApp = groupBy(wipers, (row) => row.application_id);
const referencesByApp = groupBy(references, (row) => row.application_id);
const configByKey = new Map(configs.map((row) => [row.configuration_key, row]));
const liveCanonicalKeys = new Set(allApplications.filter((row) => row.status === "active" && !targetIds.includes(row.application_id)).map((row) => row.canonical_key));
const allIds = new Set(allApplications.map((row) => row.application_id));

for (const key of ["19/19/16", "22/20/14", "24/19/12", "22/20/12"]) validateConfiguration(key);

const plan = {
  generated_at: new Date().toISOString(), mode: APPLY ? "apply" : "report-only", production_writes: APPLY, source: SOURCE,
  evidence: {
    local_file: "outputs/wipertech-enrichment-20261022/wipertech_enriched_data.json",
    pajero_iii: { market_generations: ["NM", "NP"], chassis: [...V67_CODES], through_year: 2007, configuration: "19/19/16" },
    pajero_iv: { chassis: [...V89_CODES], segments: [
      { market_generation: "NS", years: "2006-2007", configuration: "22/20/14" },
      { transition: 2008, candidates: ["22/20/14", "24/19/12"] },
      { market_generations: ["NT", "NW"], years: "2009-2013", configuration: "24/19/12" },
      { transition: 2014, candidates: ["24/19/12", "22/20/12"] },
      { market_generation: "NX", years: "2015-2021", configuration: "22/20/12" },
    ] },
  },
  simple_corrections: [], complex_splits: [],
  totals: { source_applications: 10, application_years_removed: 0, new_applications: 0, published_application_years: 0,
    transition_review_application_years: 0, product_fitments_to_copy: 0, reference_fitments_to_copy: 0, provenance_rows_to_copy: 0, review_wipers_to_copy: 0 },
};

for (const row of targetEntries) {
  const source = required(appById.get(row.application_id), row.application_id);
  const currentYears = (yearsByApp.get(source.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
  assert(source.status === "active", `Source not active: ${source.application_id}`);
  if (V67_CODES.has(row.series_code)) {
    const keptYears = currentYears.filter((year) => year <= 2007);
    const removedYears = currentYears.filter((year) => year > 2007);
    const newBounds = bounds(keptYears);
    const newCanonicalKey = canonicalKey(source, newBounds.from, newBounds.to);
    reserveCanonical(newCanonicalKey, source.application_id);
    plan.simple_corrections.push({ application_id: source.application_id, series_code: row.series_code, current_years: currentYears, kept_years: keptYears,
      removed_years: removedYears, new_year_from: newBounds.from, new_year_to: newBounds.to, new_canonical_key: newCanonicalKey,
      configuration_key: "19/19/16", configuration_id: configByKey.get("19/19/16").id });
    plan.totals.application_years_removed += removedYears.length;
    plan.totals.published_application_years += keptYears.length;
    continue;
  }

  const keptYears = currentYears.filter((year) => year <= 2021);
  const removedYears = currentYears.filter((year) => year > 2021);
  const segmentSpecs = [
    { segment: "ns", years: keptYears.filter((year) => year <= 2007), configuration_key: "22/20/14", published: true },
    { segment: "transition_2008", years: keptYears.filter((year) => year === 2008), candidates: ["22/20/14", "24/19/12"], published: false, reuse_source: true },
    { segment: "nt_nw", years: keptYears.filter((year) => year >= 2009 && year <= 2013), configuration_key: "24/19/12", published: true },
    { segment: "transition_2014", years: keptYears.filter((year) => year === 2014), candidates: ["24/19/12", "22/20/12"], published: false },
    { segment: "nx", years: keptYears.filter((year) => year >= 2015), configuration_key: "22/20/12", published: true },
  ].filter((segment) => segment.years.length);
  const sourceSegment = required(segmentSpecs.find((segment) => segment.reuse_source), `2008 transition ${source.application_id}`);
  const sourceBounds = bounds(sourceSegment.years);
  const sourceCanonicalKey = canonicalKey(source, sourceBounds.from, sourceBounds.to);
  reserveCanonical(sourceCanonicalKey, source.application_id);
  const children = [];
  for (const spec of segmentSpecs.filter((segment) => !segment.reuse_source)) {
    const childBounds = bounds(spec.years);
    const key = canonicalKey(source, childBounds.from, childBounds.to);
    reserveCanonical(key, source.application_id);
    const application = { application_id: applicationId(key), model_id: source.model_id, series_id: source.series_id, variant_id: source.variant_id,
      powertrain_id: source.powertrain_id, year_from: childBounds.from, year_to: childBounds.to, year_status: source.year_status,
      canonical_key: key, status: "active", review_status: spec.published ? "approved" : "needs_review" };
    assert(!allIds.has(application.application_id), `Child application ID collision: ${application.application_id}`);
    allIds.add(application.application_id);
    const child = { ...spec, application,
      productFitments: copyProductRows(source.application_id, application.application_id, spec.segment),
      referenceFitments: copyReferenceRows(source.application_id, application.application_id),
      provenance: copyProvenanceRows(source.application_id, application.application_id),
      reviewWipers: spec.published ? [] : copyReviewWipers(source.application_id, application.application_id, spec.segment) };
    children.push(child);
    plan.totals.product_fitments_to_copy += child.productFitments.length;
    plan.totals.reference_fitments_to_copy += child.referenceFitments.length;
    plan.totals.provenance_rows_to_copy += child.provenance.length;
    plan.totals.review_wipers_to_copy += child.reviewWipers.length;
    plan.totals.new_applications += 1;
    if (spec.published) plan.totals.published_application_years += spec.years.length;
    else plan.totals.transition_review_application_years += spec.years.length;
  }
  plan.totals.transition_review_application_years += sourceSegment.years.length;
  plan.totals.application_years_removed += removedYears.length;
  plan.complex_splits.push({ source_application_id: source.application_id, series_code: row.series_code, current_years: currentYears, kept_years: keptYears,
    removed_years: removedYears, source_transition: { ...sourceSegment, new_canonical_key: sourceCanonicalKey }, children });
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, APPLY ? "apply-plan.json" : "preflight.json"), JSON.stringify(plan, null, 2));

let backup_dir = null;
if (APPLY) {
  backup_dir = createBackup({ applications, years, provenance, products, wipers, references, customerVehicles, orderItems, orderSnapshots, orderWipers });
  for (const item of plan.simple_corrections) {
    await deleteYears(item.application_id, item.removed_years);
    await updateApplication(item.application_id, item.new_year_from, item.new_year_to, item.new_canonical_key, "approved");
    await resolveWipers(item.application_id, item.configuration_id, item.configuration_key, item.series_code, item.kept_years);
  }
  for (const split of plan.complex_splits) {
    const keep = split.source_transition.years;
    const removeFromSource = split.current_years.filter((year) => !keep.includes(year));
    await deleteYears(split.source_application_id, removeFromSource);
    await updateApplication(split.source_application_id, keep[0], keep.at(-1), split.source_transition.new_canonical_key, "needs_review");
    for (const child of split.children) {
      const { error: appError } = await db.from("vehicle_catalog_applications").insert(child.application); if (appError) throw appError;
      const { error: yearsError } = await db.from("vehicle_catalog_application_years").insert(child.years.map((year) => ({ application_id: child.application.application_id, model_year: year }))); if (yearsError) throw yearsError;
      await upsert("vehicle_catalog_application_provenance", child.provenance, "application_id,source_group,source_url");
      await upsert("vehicle_catalog_product_fitments", child.productFitments, "application_id,product_variant_id,position");
      await upsert("vehicle_catalog_part_reference_fitments", child.referenceFitments, "application_id,part_reference_id,position,data_source_id");
      if (child.published) {
        const config = required(configByKey.get(child.configuration_key), child.configuration_key);
        const { error } = await db.from("vehicle_catalog_wiper_fitments").insert({ application_id: child.application.application_id, wiper_configuration_id: config.id,
          fitment_status: "published", source: SOURCE, notes: `source=WiperTech; exact_generation=V8/V9; segment=${child.segment}; years=${child.years[0]}-${child.years.at(-1)}; split_from=${split.source_application_id}` });
        if (error) throw error;
      } else {
        await upsert("vehicle_catalog_wiper_fitments", child.reviewWipers, "application_id,wiper_configuration_id");
      }
    }
  }
}

const verification = APPLY ? await verify(plan) : null;
const result = { ...plan, backup_dir, verification };
const resultPath = path.join(OUT, APPLY ? "applied.json" : "report.json");
fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ resultPath, backup_dir, totals: plan.totals, verification }, null, 2));

function copyProductRows(sourceId, targetId, segment) { return (productsByApp.get(sourceId) ?? []).map((row) => ({ ...stripTimes(row), application_id: targetId,
  notes: appendNote(row.notes, `${SOURCE}; split_from=${sourceId}; segment=${segment}`) })); }
function copyReferenceRows(sourceId, targetId) { return (referencesByApp.get(sourceId) ?? []).map((row) => ({ ...stripTimes(row), application_id: targetId })); }
function copyProvenanceRows(sourceId, targetId) { return (provenanceByApp.get(sourceId) ?? []).map((row) => ({ ...row, application_id: targetId })); }
function copyReviewWipers(sourceId, targetId, segment) { return (wipersByApp.get(sourceId) ?? []).filter((row) => row.fitment_status !== "published").map((row) => ({ ...stripTimes(row), application_id: targetId,
  fitment_status: "review", notes: appendNote(row.notes, `${SOURCE}; split_from=${sourceId}; transition_segment=${segment}`) })); }

async function resolveWipers(applicationId, targetConfigId, targetKey, seriesCode, keptYears) {
  for (const row of (wipersByApp.get(applicationId) ?? []).filter((item) => item.wiper_configuration_id !== targetConfigId && item.fitment_status !== "rejected")) {
    const { error } = await db.from("vehicle_catalog_wiper_fitments").update({ fitment_status: "rejected", notes: appendNote(row.notes, `${SOURCE}; superseded_by_exact_generation_config=${targetKey}`) })
      .eq("application_id", applicationId).eq("wiper_configuration_id", row.wiper_configuration_id); if (error) throw error;
  }
  const { error } = await db.from("vehicle_catalog_wiper_fitments").upsert({ application_id: applicationId, wiper_configuration_id: targetConfigId, fitment_status: "published", source: SOURCE,
    notes: `source=WiperTech; exact_generation=V6/V7; chassis=${seriesCode}; years=${keptYears[0]}-${keptYears.at(-1)}; configuration=${targetKey}` }, { onConflict: "application_id,wiper_configuration_id" });
  if (error) throw error;
}
async function deleteYears(applicationId, removedYears) { if (!removedYears.length) return; const { error } = await db.from("vehicle_catalog_application_years").delete().eq("application_id", applicationId).in("model_year", removedYears); if (error) throw error; }
async function updateApplication(applicationId, yearFrom, yearTo, canonicalKeyValue, reviewStatus) { const { error } = await db.from("vehicle_catalog_applications").update({ year_from: yearFrom, year_to: yearTo,
  canonical_key: canonicalKeyValue, review_status: reviewStatus }).eq("application_id", applicationId).eq("status", "active"); if (error) throw error; }

function validateConfiguration(key) { const config = required(configByKey.get(key), `configuration ${key}`); assert(config.configuration_status === "published", `${key} not published`);
  const [driver, passenger] = key.split("/").map(Number); assert(blades.some((row) => row.wiper_configuration_id === config.id && row.position === "driver" && Number(row.length_in) === driver), `${key} driver mismatch`);
  assert(blades.some((row) => row.wiper_configuration_id === config.id && row.position === "passenger" && Number(row.length_in) === passenger), `${key} passenger mismatch`);
  assert(wiperSets.some((row) => row.set_type === "front_pair" && row.active === true && Number(row.driver_length_in) === driver && Number(row.passenger_length_in) === passenger), `No sellable ${driver}/${passenger}`); }
function bounds(values) { assert(values.length, "Empty year segment"); return { from: Math.min(...values), to: Math.max(...values) }; }
function canonicalKey(source, from, to) { return [source.model_id, source.series_id, source.variant_id, source.powertrain_id, from, to].join("|"); }
function reserveCanonical(key, sourceId) { assert(!liveCanonicalKeys.has(key), `Canonical collision for ${sourceId}: ${key}`); liveCanonicalKeys.add(key); }
function applicationId(key) { return `ap_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`; }

async function verify(current) {
  const childIds = current.complex_splits.flatMap((split) => split.children.map((child) => child.application.application_id));
  const allTouched = [...targetIds, ...childIds];
  const [appsNow, yearsNow, wipersNow, productsNow, refsNow] = await Promise.all([selectIn("vehicle_catalog_applications", "application_id", allTouched),
    selectIn("vehicle_catalog_application_years", "application_id", allTouched), selectIn("vehicle_catalog_wiper_fitments", "application_id", allTouched),
    selectIn("vehicle_catalog_product_fitments", "application_id", childIds), selectIn("vehicle_catalog_part_reference_fitments", "application_id", childIds)]);
  const appMap = new Map(appsNow.map((row) => [row.application_id, row])); const yearMap = groupBy(yearsNow, (row) => row.application_id); const wiperMap = groupBy(wipersNow, (row) => row.application_id);
  const productMap = groupBy(productsNow, (row) => row.application_id); const refMap = groupBy(refsNow, (row) => row.application_id);
  const checks = {
    simple_years_and_fitments: current.simple_corrections.every((item) => { const app = appMap.get(item.application_id); const actualYears = (yearMap.get(item.application_id) ?? []).map((row) => Number(row.model_year)).sort((a,b)=>a-b);
      const published = (wiperMap.get(item.application_id) ?? []).filter((row) => row.fitment_status === "published"); return app?.canonical_key === item.new_canonical_key && JSON.stringify(actualYears) === JSON.stringify(item.kept_years)
        && published.length === 1 && published[0].wiper_configuration_id === item.configuration_id; }),
    source_transitions_preserved: current.complex_splits.every((split) => { const app = appMap.get(split.source_application_id); const actual = (yearMap.get(split.source_application_id) ?? []).map((row) => Number(row.model_year)); return app?.year_from === 2008 && app?.year_to === 2008 && actual.length === 1 && actual[0] === 2008; }),
    children_created_and_exact: current.complex_splits.every((split) => split.children.every((child) => { const app = appMap.get(child.application.application_id); const actual = (yearMap.get(child.application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a,b)=>a-b);
      if (!app || JSON.stringify(actual) !== JSON.stringify(child.years)) return false; const published = (wiperMap.get(child.application.application_id) ?? []).filter((row) => row.fitment_status === "published");
      return child.published ? published.length === 1 && published[0].wiper_configuration_id === configByKey.get(child.configuration_key)?.id : published.length === 0; })),
    product_fitments_copied: current.complex_splits.every((split) => split.children.every((child) => (productMap.get(child.application.application_id) ?? []).length === child.productFitments.length)),
    reference_fitments_copied: current.complex_splits.every((split) => split.children.every((child) => (refMap.get(child.application.application_id) ?? []).length === child.referenceFitments.length)),
  };
  assert(Object.values(checks).every(Boolean), "Post-apply Pajero verification failed"); return { ok: true, ...checks };
}

function stripTimes(row) { const { created_at, updated_at, ...rest } = row; return rest; }
function appendNote(value, note) { return [value, note].filter(Boolean).join("; "); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse); }
function groupBy(rows, keyFn) { const map = new Map(); for (const row of rows) { const key = keyFn(row); if (!map.has(key)) map.set(key, []); map.get(key).push(row); } return map; }
function required(value, label) { assert(value, `Missing ${label}`); return value; }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function fetchAll(table, columns) { const rows=[]; for(let from=0;;from+=1000){const {data,error}=await db.from(table).select(columns).range(from,from+999);if(error)throw error;rows.push(...(data??[]));if(!data||data.length<1000)return rows;} }
async function selectIn(table, field, values) { if(!values.length)return[];const rows=[];for(let i=0;i<values.length;i+=100){const {data,error}=await db.from(table).select("*").in(field,values.slice(i,i+100));if(error)throw error;rows.push(...(data??[]));}return rows; }
async function upsert(table, rows, onConflict) { if(!rows.length)return;const {error}=await db.from(table).upsert(rows,{onConflict});if(error)throw error; }
function createBackup(tables){const stamp=new Date().toISOString().replace(/[:.]/g,"-");const dir=path.join(ROOT,"tmp","production-backups",`pajero-generation-${stamp}`);fs.mkdirSync(dir,{recursive:true});const manifest={created_at:new Date().toISOString(),source:SOURCE,tables:{}};for(const [name,rows] of Object.entries(tables)){const text=JSON.stringify(rows,null,2);const file=`${name}.json`;fs.writeFileSync(path.join(dir,file),text);manifest.tables[name]={rows:rows.length,file,sha256:crypto.createHash("sha256").update(text).digest("hex")};}fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify(manifest,null,2));return dir;}
function loadEnv(file){if(!fs.existsSync(file))return;for(const line of fs.readFileSync(file,"utf8").split(/\r?\n/)){const match=line.match(/^([^#=]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,"");}}
