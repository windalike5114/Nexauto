import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";
import {
  brakeFamily,
  bodyKey,
  chassisTokens,
  configEngineMatch,
  driveKey,
  familyScopedDetailedChassisMatch,
  platformCodeMatch,
} from "./brake-pad-strict-policy.mjs";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import {
  buildPopularAliasIndex,
  groupsForPopularScope,
  popularGroupMatchesApplication,
} from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "extended132-six-brake-gap-diagnosis-20261025");
const TARGET_LABELS = new Set([
  "BMW 3 Series",
  "Ford Mondeo",
  "Fiat Ducato",
  "Land Rover Range Rover",
  "Mercedes-Benz C-Class",
  "Mitsubishi Lancer",
]);

loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const groups = groupsForPopularScope("extended80").filter((group) => TARGET_LABELS.has(group.label));
const aliasIndex = buildPopularAliasIndex(groups);
const source = readBendixWorkbook();
const allSourceRows = source.uniqueRows.filter((row) => row.position);
const sourceRows = allSourceRows.filter((row) => row.position
  && ["active", "to_be_discontinued"].includes(row.lifecycleStatus));

const [makes, models, series, variants, powertrains, applications, years, products, productVariants,
  productFitments, references, referenceFitments, engineCodes, powertrainEngineCodes] = await Promise.all([
  fetchAll("vehicle_catalog_makes", "make_id,name,status"),
  fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
  fetchAll("vehicle_catalog_series", "series_id,code,display_name,status"),
  fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type,display_name"),
  fetchAll("vehicle_catalog_powertrains", "powertrain_id,display_name,displacement_cc"),
  fetchAll("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,powertrain_id,status"),
  fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
  fetchAll("products", "id,category_slug"),
  fetchAll("product_variants", "id,product_id,sku"),
  fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,fitment_status"),
  fetchAll("catalog_part_references", "id,product_type,normalized_value"),
  fetchAll("vehicle_catalog_part_reference_fitments", "application_id,part_reference_id,position,fitment_status,metadata"),
  fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
  fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id"),
]);

const makeById = new Map(makes.filter((row) => row.status === "active").map((row) => [row.make_id, row]));
const modelById = new Map(models.filter((row) => row.status === "active").map((row) => [row.model_id, row]));
const seriesById = new Map(series.map((row) => [row.series_id, row]));
const variantById = new Map(variants.map((row) => [row.variant_id, row]));
const powertrainById = new Map(powertrains.map((row) => [row.powertrain_id, row]));
const engineCodeById = new Map(engineCodes.map((row) => [row.engine_code_id, compact(row.code)]));
const engineCodesByPowertrain = groupBy(powertrainEngineCodes, (row) => row.powertrain_id);
const yearsByApplication = groupBy(years.filter((row) => Number(row.model_year) >= 2000
  && Number(row.model_year) <= 2026), (row) => row.application_id);

const productCategoryById = new Map(products.map((row) => [row.id, row.category_slug]));
const brakeVariantIds = new Set(productVariants.filter((row) => productCategoryById.get(row.product_id) === "brake-pad"
  || productCategoryById.get(row.product_id) === "brake-pads" || /^NBP/i.test(row.sku)).map((row) => row.id));
const productCovered = new Set(productFitments.filter((row) => row.fitment_status === "published"
  && brakeVariantIds.has(row.product_variant_id)).map((row) => row.application_id));
const brakeReferenceIds = new Set(references.filter((row) => row.product_type === "brake_pad").map((row) => row.id));
const referenceValueById = new Map(references.map((row) => [row.id, row.normalized_value]));
const deterministicReferenceCovered = new Set(referenceFitments.filter((row) => row.fitment_status === "published"
  && brakeReferenceIds.has(row.part_reference_id) && !isConditional(row.metadata)).map((row) => row.application_id));
const strictCovered = new Set([...productCovered, ...deterministicReferenceCovered]);

const targetApplications = [];
for (const row of applications) {
  if (row.status !== "active") continue;
  const model = modelById.get(row.model_id);
  const make = makeById.get(model?.make_id);
  const variant = variantById.get(row.variant_id);
  const group = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
  if (!group || !popularGroupMatchesApplication(group, {
    bodyStyle: variant?.body_style,
    variantName: variant?.display_name,
  })) continue;
  const appYears = (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year))
    .sort((left, right) => left - right);
  if (!appYears.length || strictCovered.has(row.application_id)) continue;
  const appSeries = seriesById.get(row.series_id);
  const powertrain = powertrainById.get(row.powertrain_id);
  targetApplications.push({
    application_id: row.application_id,
    popular_group: group.label,
    make: make.name,
    model: model.name,
    family: brakeFamily(make.name, model.name),
    series: appSeries?.code || appSeries?.display_name || "",
    series_display: appSeries?.display_name || "",
    body: variant?.body_style || "",
    drive: variant?.drive_type || "",
    variant: variant?.display_name || "",
    engine: powertrain?.display_name || "",
    displacementCc: Number(powertrain?.displacement_cc) || null,
    engineCodes: (engineCodesByPowertrain.get(row.powertrain_id) ?? [])
      .map((item) => engineCodeById.get(item.engine_code_id)).filter(Boolean),
    years: appYears,
  });
}

const detailRows = [];
for (const application of targetApplications) {
  for (const position of ["front", "rear"]) {
    const diagnosis = diagnosePosition(application, position, sourceRows, allSourceRows);
    detailRows.push({
      popular_group: application.popular_group,
      application_id: application.application_id,
      make: application.make,
      model: application.model,
      series: application.series,
      series_display: application.series_display,
      body: application.body,
      drive: application.drive,
      variant: application.variant,
      engine: application.engine,
      engine_codes: application.engineCodes.join("/"),
      displacement_cc: application.displacementCc,
      years: application.years.join(","),
      application_years: application.years.length,
      position,
      outcome: diagnosis.outcome,
      match_mode: diagnosis.matchMode,
      candidate_db: diagnosis.candidates.join(" | "),
      source_series: diagnosis.rows.map((row) => row.seriesName).filter(uniqueFilter).join(" | "),
      source_rows: diagnosis.rows.map((row) => row.sourceRowId).filter(uniqueFilter).sort((a, b) => a - b).join(","),
      missing_years: diagnosis.missingYears.join(","),
      reason: diagnosis.reason,
    });
  }
}

const appOutcomes = targetApplications.map((application) => {
  const positions = detailRows.filter((row) => row.application_id === application.application_id);
  const best = bestApplicationOutcome(positions);
  return { ...application, ...best };
});

const summary = groups.map((group) => {
  const apps = appOutcomes.filter((row) => row.popular_group === group.label);
  const totalAy = apps.reduce((sum, row) => sum + row.years.length, 0);
  const counts = countByApplicationYears(apps, (row) => row.application_outcome);
  const seriesGroups = aggregateBy(apps, (row) => row.series || "(blank)").map((entry) => ({
    series: entry.key,
    applications: entry.rows.length,
    application_years: entry.rows.reduce((sum, row) => sum + row.years.length, 0),
    outcomes: countByApplicationYears(entry.rows, (row) => row.application_outcome),
    years: sortedUnique(entry.rows.flatMap((row) => row.years)),
    bodies: sortedUnique(entry.rows.map((row) => row.body).filter(Boolean)),
    source_candidates: sortedUnique(entry.rows.flatMap((row) => row.application_candidate_db)),
  })).sort((left, right) => right.application_years - left.application_years);
  return {
    popular_group: group.label,
    missing_applications: apps.length,
    missing_application_years: totalAy,
    outcome_application_years: counts,
    safe_unique_upper_bound_application_years: (counts.unique_source_candidate ?? 0)
      + (counts.historical_unique_source_candidate ?? 0),
    historical_unique_application_years: counts.historical_unique_source_candidate ?? 0,
    partial_year_unique_application_years: counts.unique_partial_year_source_candidate ?? 0,
    multi_candidate_application_years: counts.multiple_source_candidates ?? 0,
    mapping_gap_application_years: (counts.chassis_mapping_required ?? 0) + (counts.source_generation_missing ?? 0),
    no_source_application_years: counts.no_source_family ?? 0,
    series: seriesGroups,
  };
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUTPUT_DIR, "summary.json"), `${JSON.stringify({
  generated_at: new Date().toISOString(),
  mode: "read_only_diagnosis",
  production_writes: false,
  source: { file: source.file, sha256: source.sha256, sheet: source.sheetName },
  definitions: {
    unique_source_candidate: "At least one axle has a single source DB after family/chassis/body/drive/year/engine filtering; publication still requires row-level review.",
    historical_unique_source_candidate: "The only matching source rows are discontinued/superseded, but fitment identity is unique and fully covers the target years. Store as historical reference knowledge, not as a sellable product.",
    unique_partial_year_source_candidate: "One DB remains but the application extends beyond the source generation years. Split/correct application years before publication.",
    multiple_source_candidates: "Source exists but the stored vehicle configuration does not determine one DB.",
    chassis_mapping_required: "Source family exists and overlapping years exist, but the NexAuto chassis is not mapped to the supplier platform token.",
    source_generation_missing: "Source family exists, but the supplied catalogue has no overlapping generation/year rows for this application.",
    no_source_family: "No Bendix brake-pad row exists for the make/model family and axle, including historical lifecycle rows.",
  },
  totals: {
    missing_applications: appOutcomes.length,
    missing_application_years: appOutcomes.reduce((sum, row) => sum + row.years.length, 0),
  },
  groups: summary,
}, null, 2)}\n`);
writeCsv(path.join(OUTPUT_DIR, "applications.csv"), appOutcomes.map(flattenApplication));
writeCsv(path.join(OUTPUT_DIR, "application-positions.csv"), detailRows);
fs.writeFileSync(path.join(OUTPUT_DIR, "applications.jsonl"), `${appOutcomes.map((row) => JSON.stringify(flattenApplication(row))).join("\n")}\n`);
fs.writeFileSync(path.join(OUTPUT_DIR, "application-positions.jsonl"), `${detailRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
console.log(JSON.stringify({ output_dir: OUTPUT_DIR, groups: summary.map((row) => ({
  popular_group: row.popular_group,
  missing_application_years: row.missing_application_years,
  outcome_application_years: row.outcome_application_years,
  top_series: row.series.slice(0, 8),
})) }, null, 2));

function diagnosePosition(application, position, activeSourceRows, completeSourceRows) {
  let sameFamily = activeSourceRows.filter((row) => row.modelFamily === application.family && row.position === position);
  let historical = false;
  if (!sameFamily.length) {
    sameFamily = completeSourceRows.filter((row) => row.modelFamily === application.family && row.position === position);
    historical = sameFamily.length > 0;
  }
  if (!sameFamily.length) return result("no_source_family", "none", [], [], application.years,
    "No source row for this make/model family and position.");
  let platform = sameFamily.filter((row) => chassisTokens(row)
    .some((token) => platformCodeMatch(application.family, application.series, token)));
  let matchMode = "exact_or_named_chassis_rule";
  if (!platform.length) {
    platform = sameFamily.filter((row) => chassisTokens(row)
      .some((token) => familyScopedDetailedChassisMatch(application.series, token)));
    matchMode = platform.length ? "family_scoped_root_chassis" : "none";
  }
  if (!platform.length && !compact(application.series)) {
    platform = sameFamily.filter((row) => application.years.some((year) => year >= row.yearFrom && year <= row.yearTo));
    matchMode = platform.length ? "blank_chassis_year_fallback" : "none";
  }
  if (!platform.length) {
    const overlappingFamily = sameFamily.filter((row) => application.years.some((year) => year >= row.yearFrom && year <= row.yearTo));
    if (overlappingFamily.length) return result("chassis_mapping_required", "none", uniqueDbs(overlappingFamily), overlappingFamily, [],
      "The source has same-family rows in the target years, but no approved chassis bridge.");
    return result("source_generation_missing", "none", [], sameFamily, application.years,
      "The source family exists, but has no row overlapping the target application years.");
  }
  let eligible = platform;
  const body = bodyKey(application.body);
  if (body) {
    const narrowed = eligible.filter((row) => !bodyKey(row.bodyStyle) || bodyKey(row.bodyStyle) === body);
    if (narrowed.length) eligible = narrowed;
  }
  const drive = driveKey(application.drive || application.variant);
  if (drive) {
    const narrowed = eligible.filter((row) => !driveKey(row.driveType) || driveKey(row.driveType) === drive);
    if (narrowed.length) eligible = narrowed;
  }
  const overlap = eligible.filter((row) => application.years.some((year) => year >= row.yearFrom && year <= row.yearTo));
  const missingYears = application.years.filter((year) => !overlap.some((row) => year >= row.yearFrom && year <= row.yearTo));
  if (overlap.length) eligible = overlap;
  let candidates = uniqueDbs(eligible);
  if (candidates.length > 1 && application.engineCodes.length && application.displacementCc) {
    const exact = eligible.filter((row) => configEngineMatch(application, row));
    const unknown = eligible.filter((row) => !row.engineCodes?.length || !row.displacementCc);
    const narrowed = [...exact, ...unknown];
    const narrowedDbs = uniqueDbs(narrowed);
    const exactMissing = application.years.filter((year) => !exact.some((row) => year >= row.yearFrom && year <= row.yearTo));
    if (exact.length && narrowedDbs.length === 1 && !exactMissing.length) {
      eligible = narrowed;
      candidates = narrowedDbs;
      matchMode += "+engine";
    }
  }
  if (candidates.length === 1) {
    const outcome = missingYears.length ? "unique_partial_year_source_candidate"
      : historical ? "historical_unique_source_candidate" : "unique_source_candidate";
    return result(outcome, matchMode, candidates, eligible, missingYears,
      missingYears.length ? "One DB remains, but some application years are outside source years."
        : historical ? "One historical DB remains; lifecycle affects availability, not historical fitment identity."
          : "One DB remains after stored configuration filters.");
  }
  if (candidates.length > 1) return result("multiple_source_candidates", matchMode, candidates, eligible, missingYears,
    "Multiple DB references remain; use a storable discriminator or publish multi-reference search candidates.");
  return result("source_generation_missing", matchMode, [], eligible, application.years,
    "No source row remains after configuration filtering.");
}

function bestApplicationOutcome(positionRows) {
  const uniqueRows = positionRows.filter((row) => row.outcome === "unique_source_candidate");
  const historicalRows = positionRows.filter((row) => row.outcome === "historical_unique_source_candidate");
  const partialRows = positionRows.filter((row) => row.outcome === "unique_partial_year_source_candidate");
  const multiRows = positionRows.filter((row) => row.outcome === "multiple_source_candidates");
  const mappingRows = positionRows.filter((row) => row.outcome === "chassis_mapping_required");
  let applicationOutcome = "no_source_family";
  if (uniqueRows.length) applicationOutcome = "unique_source_candidate";
  else if (historicalRows.length) applicationOutcome = "historical_unique_source_candidate";
  else if (partialRows.length) applicationOutcome = "unique_partial_year_source_candidate";
  else if (multiRows.length) applicationOutcome = "multiple_source_candidates";
  else if (mappingRows.length) applicationOutcome = "chassis_mapping_required";
  else if (positionRows.some((row) => row.outcome === "source_generation_missing")) applicationOutcome = "source_generation_missing";
  return {
    application_outcome: applicationOutcome,
    application_candidate_db: sortedUnique(positionRows.flatMap((row) => row.candidate_db.split(" | ").filter(Boolean))),
    unique_positions: [...uniqueRows, ...historicalRows].map((row) => row.position),
    multi_positions: multiRows.map((row) => row.position),
  };
}

function flattenApplication(row) {
  return {
    popular_group: row.popular_group,
    application_id: row.application_id,
    make: row.make,
    model: row.model,
    series: row.series,
    series_display: row.series_display,
    body: row.body,
    drive: row.drive,
    variant: row.variant,
    engine: row.engine,
    engine_codes: row.engineCodes.join("/"),
    displacement_cc: row.displacementCc,
    years: row.years.join(","),
    application_years: row.years.length,
    application_outcome: row.application_outcome,
    unique_positions: row.unique_positions.join("/"),
    multi_positions: row.multi_positions.join("/"),
    candidate_db: row.application_candidate_db.join(" | "),
  };
}

function result(outcome, matchMode, candidates, rows, missingYears, reason) {
  return { outcome, matchMode, candidates, rows, missingYears, reason };
}
function isConditional(metadata) {
  return metadata?.selection_mode === "conditional_one_of"
    || metadata?.configuration_confirmation_required === true
    || metadata?.exact_knowledge_coverage === false;
}
function compact(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function uniqueDbs(rows) { return sortedUnique(rows.map((row) => row.bendixReference).filter(Boolean)); }
function sortedUnique(values) { return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right), undefined, { numeric: true })); }
function uniqueFilter(value, index, values) { return values.indexOf(value) === index; }
function groupBy(values, keyFn) {
  const output = new Map();
  for (const value of values) {
    const key = keyFn(value);
    const rows = output.get(key) ?? [];
    rows.push(value);
    output.set(key, rows);
  }
  return output;
}
function aggregateBy(values, keyFn) { return [...groupBy(values, keyFn)].map(([key, rows]) => ({ key, rows })); }
function countByApplicationYears(rows, keyFn) {
  const output = {};
  for (const row of rows) {
    const key = keyFn(row);
    output[key] = (output[key] ?? 0) + row.years.length;
  }
  return output;
}
async function fetchAll(table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    output.push(...(data ?? []));
    if ((data ?? []).length < 1000) return output;
  }
}
function writeCsv(file, rows) {
  if (!rows.length) return fs.writeFileSync(file, "");
  const columns = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  fs.writeFileSync(file, `${columns.map(quote).join(",")}\n${rows.map((row) => columns.map((column) => quote(row[column])).join(",")).join("\n")}\n`);
}
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
