import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { bodyKey, brakeFamily, configEngineMatch, driveKey } from "./brake-pad-strict-policy.mjs";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.find((value) => value.startsWith("--rollback="));
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "colorado-lwh-brake-reference-20261025");
const POLICY = "COLORADO_LWH_EXACT_CONFIG_V1_2026_10_25";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const source = readBendixWorkbook();
const initial = await prepare();
writeOutputs(initial, "report-only");
console.log(JSON.stringify(summary(initial, "report-only"), null, 2));
if (!APPLY) process.exit(0);
assert(initial.blockers.length === 0, `Preflight blockers: ${JSON.stringify(initial.blockers)}`);
const fresh = await prepare();
assert(fresh.blockers.length === 0, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(fresh.plan_hash === initial.plan_hash, "Fresh plan changed; no writes issued");
const backup = createBackup(fresh);
try {
  for (const row of fresh.safe) {
    const payload = {
      application_id: row.application_id, part_reference_id: row.part_reference_id, position: "front",
      data_source_id: row.data_source_id, fitment_status: "published", confidence: "exact",
      source_row_numbers: row.source_row_numbers,
      match_reasons: ["exact_make_model", "exact_engine_displacement", "exact_body_drive", "full_source_year_coverage", "unique_db_after_engine_disambiguation"],
      metadata: { policy_version: POLICY, source_code: SOURCE_CODE, source_platform: "RG", nexauto_series: row.series,
        engine_code: "LWH", evidence: "Bendix Colorado RG LWH 2.8D 2012-2013 exact body/drive rows", product_write: false },
    };
    const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(payload,
      { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (error) throw error;
  }
  const verification = await verify(fresh);
  const result = { ...summary(fresh, "apply"), backup_directory: path.relative(ROOT, backup).replaceAll("\\", "/"), verification };
  writeJson(path.join(OUT, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const rollbackResult = await rollback(backup, true);
  throw new Error(`Apply failed and rollback verified=${rollbackResult.verified}: ${error.message}`);
}

async function prepare() {
  const { data: make, error: makeError } = await db.from("vehicle_catalog_makes").select("*").eq("normalized_name", "HOLDEN").single();
  if (makeError) throw makeError;
  const { data: model, error: modelError } = await db.from("vehicle_catalog_models").select("*").eq("make_id", make.make_id).eq("normalized_name", "COLORADO").single();
  if (modelError) throw modelError;
  const { data: applications, error: appError } = await db.from("vehicle_catalog_applications").select("*").eq("model_id", model.model_id).eq("status", "active");
  if (appError) throw appError;
  const ids = applications.map((row) => row.application_id);
  const seriesIds = unique(applications.map((row) => row.series_id));
  const variantIds = unique(applications.map((row) => row.variant_id));
  const powertrainIds = unique(applications.map((row) => row.powertrain_id));
  const [years, series, variants, powertrains, engineLinks, productFitments, referenceFitments, brakeProducts, dataSource] = await Promise.all([
    selectIn("vehicle_catalog_application_years", "application_id", ids), selectIn("vehicle_catalog_series", "series_id", seriesIds),
    selectIn("vehicle_catalog_variants", "variant_id", variantIds), selectIn("vehicle_catalog_powertrains", "powertrain_id", powertrainIds),
    selectIn("vehicle_catalog_powertrain_engine_codes", "powertrain_id", powertrainIds),
    selectIn("vehicle_catalog_product_fitments", "application_id", ids), selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids),
    fetchFiltered("products", "*", (query) => query.eq("category_slug", "brake-pad")),
    fetchSingle("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)),
  ]);
  const engineCodeIds = unique(engineLinks.map((row) => row.engine_code_id));
  const [engineCodes, brakeVariants, usedReferences, targetReference] = await Promise.all([
    selectIn("vehicle_catalog_engine_codes", "engine_code_id", engineCodeIds),
    selectIn("product_variants", "product_id", brakeProducts.map((row) => row.id)),
    selectIn("catalog_part_references", "id", unique(referenceFitments.map((row) => row.part_reference_id))),
    fetchSingle("catalog_part_references", "*", (query) => query.eq("product_type", "brake_pad").eq("reference_scheme", "bendix_db").eq("normalized_value", "DB1841")),
  ]);
  const seriesById = new Map(series.map((row) => [row.series_id, row]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));
  const powertrainById = new Map(powertrains.map((row) => [row.powertrain_id, row]));
  const engineCodeById = new Map(engineCodes.map((row) => [row.engine_code_id, row]));
  const engineLinksByPowertrain = groupBy(engineLinks, (row) => row.powertrain_id);
  const yearsByApplication = groupBy(years, (row) => row.application_id);
  const referenceById = new Map(usedReferences.map((row) => [row.id, row]));
  const brakeVariantIds = new Set(brakeVariants.filter((row) => row.active !== false).map((row) => row.id));
  const coveredByProduct = new Set(productFitments.filter((row) => row.fitment_status === "published" && brakeVariantIds.has(row.product_variant_id)).map((row) => row.application_id));
  const coveredByReference = new Set(referenceFitments.filter((row) => row.fitment_status === "published" && referenceById.get(row.part_reference_id)?.product_type === "brake_pad").map((row) => row.application_id));
  const sourceRows = source.uniqueRows.filter((row) => row.modelFamily === brakeFamily("HOLDEN", "COLORADO") && row.position === "front"
    && ["active", "to_be_discontinued"].includes(row.lifecycleStatus));
  const safe = [];
  const unresolved = [];
  const blockers = [];
  for (const application of applications) {
    if (coveredByProduct.has(application.application_id) || coveredByReference.has(application.application_id)) continue;
    const vehicleSeries = seriesById.get(application.series_id)?.code ?? "";
    const variant = variantById.get(application.variant_id);
    const powertrain = powertrainById.get(application.powertrain_id);
    const appYears = (yearsByApplication.get(application.application_id) ?? []).map((row) => Number(row.model_year)).filter((year) => year >= 2000 && year <= 2026).sort((a, b) => a - b);
    const appEngineCodes = unique((engineLinksByPowertrain.get(application.powertrain_id) ?? []).map((row) => engineCodeById.get(row.engine_code_id)?.code));
    if (!appYears.length) continue;
    const policyInput = { engineCodes: appEngineCodes, displacementCc: powertrain?.displacement_cc };
    const exactRows = sourceRows.filter((row) => bodyKey(row.bodyStyle) === bodyKey(variant?.body_style)
      && driveKey(row.driveType) === driveKey(variant?.drive_type) && configEngineMatch(policyInput, row));
    const fullCoverageRows = exactRows.filter((row) => appYears.some((year) => year >= row.yearFrom && year <= row.yearTo));
    const missingYears = appYears.filter((year) => !fullCoverageRows.some((row) => year >= row.yearFrom && year <= row.yearTo));
    const candidates = unique(fullCoverageRows.map((row) => row.bendixReference));
    const record = { application_id: application.application_id, series: vehicleSeries, body: variant?.body_style, drive: variant?.drive_type,
      engine_codes: appEngineCodes, displacement_cc: powertrain?.displacement_cc, years: appYears, candidates,
      source_row_numbers: unique(fullCoverageRows.map((row) => row.sourceRowId)), missing_years: missingYears };
    if (!missingYears.length && candidates.length === 1 && candidates[0] === "DB1841" && appEngineCodes.includes("LWH")) {
      const existing = referenceFitments.find((row) => row.application_id === application.application_id && row.part_reference_id === targetReference.id
        && row.position === "front" && row.data_source_id === dataSource.id);
      safe.push({ ...record, db_reference: "DB1841", part_reference_id: targetReference.id, data_source_id: dataSource.id, previous_row: existing ?? null });
    } else {
      unresolved.push({ ...record, reason: missingYears.length ? "incomplete_source_year_coverage" : candidates.length > 1 ? "multiple_db_requires_discriminator" : "not_exact_lwh_unique_db1841" });
    }
  }
  if (targetReference.lifecycle_status !== "active") blockers.push({ reason: "db1841_not_active", lifecycle_status: targetReference.lifecycle_status });
  if (safe.some((row) => referenceFitments.some((current) => current.application_id === row.application_id && current.position === "front"
    && current.fitment_status === "published" && current.part_reference_id !== targetReference.id))) blockers.push({ reason: "published_front_conflict" });
  const safeIds = new Set(safe.map((row) => row.application_id));
  const protectedProducts = productFitments.filter((row) => safeIds.has(row.application_id));
  return { generated_at: new Date().toISOString(), safe, unresolved, blockers, snapshot: { referenceFitments: referenceFitments.filter((row) => safeIds.has(row.application_id)), protectedProducts },
    product_hash: stableHash(protectedProducts), plan_hash: stableHash(safe.map(publicSafe)), source_hash: source.sha256 };
}

async function verify(plan) {
  const ids = plan.safe.map((row) => row.application_id);
  const [refs, products] = await Promise.all([selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids)]);
  const failures = plan.safe.filter((row) => !refs.some((item) => item.application_id === row.application_id && item.part_reference_id === row.part_reference_id
    && item.position === "front" && item.data_source_id === row.data_source_id && item.fitment_status === "published"));
  assert(failures.length === 0, `Reference readback failed for ${failures.length} applications`);
  assert(stableHash(products) === plan.product_hash, "Protected product layer changed");
  return { ok: true, verified_at: new Date().toISOString(), applications: ids.length,
    application_years: plan.safe.reduce((sum, row) => sum + row.years.length, 0), product_layer_unchanged: true };
}

function createBackup(plan) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `colorado-lwh-brake-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "referenceFitments.json"), plan.snapshot.referenceFitments);
  writeJson(path.join(directory, "productFitments.json"), plan.snapshot.protectedProducts);
  writeJson(path.join(directory, "safe.json"), plan.safe.map(publicSafe));
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/publish-colorado-lwh-brake-reference-20261025.mjs --rollback=${path.relative(ROOT, directory).replaceAll("\\", "/")}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("colorado-lwh-brake-"), "Invalid rollback directory");
  const before = readJson(path.join(directory, "referenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const ids = readJson(path.join(directory, "safe.json")).map((row) => row.application_id);
  let response = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (response.error) throw response.error;
  if (before.length) { response = await db.from("vehicle_catalog_part_reference_fitments").insert(before); if (response.error) throw response.error; }
  const [after, productsAfter] = await Promise.all([selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids)]);
  const checks = { references_restored: semanticHash(after) === semanticHash(before), product_layer_unchanged: stableHash(productsAfter) === stableHash(productsBefore) };
  assert(Object.values(checks).every(Boolean), `Rollback verification failed: ${JSON.stringify(checks)}`);
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), checks };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function summary(plan, mode) { return { generated_at: plan.generated_at, mode, production_writes: mode === "apply" ? plan.safe.length : 0,
  policy: POLICY, source_sha256: plan.source_hash, safe_applications: plan.safe.length,
  safe_application_years: plan.safe.reduce((sum, row) => sum + row.years.length, 0), unresolved_applications: plan.unresolved.length,
  unresolved_by_reason: Object.fromEntries([...groupBy(plan.unresolved, (row) => row.reason)].map(([key, rows]) => [key, rows.length])), blockers: plan.blockers,
  product_writes: 0, plan_sha256: plan.plan_hash }; }
function writeOutputs(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight-summary.json"), summary(plan, mode));
  writeJsonl(path.join(OUT, "safe.jsonl"), plan.safe.map(publicSafe)); writeJsonl(path.join(OUT, "unresolved.jsonl"), plan.unresolved); }
function publicSafe(row) { return { application_id: row.application_id, series: row.series, body: row.body, drive: row.drive,
  engine_codes: row.engine_codes, displacement_cc: row.displacement_cc, years: row.years, position: "front", db_reference: row.db_reference,
  source_row_numbers: row.source_row_numbers, action: row.previous_row ? "promote_or_refresh_exact_reference" : "insert_exact_reference", product_write: false }; }
function assert(value, message) { if (!value) throw new Error(message); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupBy(values, keyFn) { const map = new Map(); for (const value of values) { const key = keyFn(value); const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); } return map; }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(value) { return stableHash(value.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, values) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, values.map(JSON.stringify).join("\n") + (values.length ? "\n" : "")); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function selectIn(table, field, values) { const output = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").in(field, batch).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return output; }
async function fetchFiltered(table, columns, filter) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function fetchSingle(table, columns, filter) { const { data, error } = await filter(db.from(table).select(columns)).single(); if (error) throw error; return data; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
