import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { bodyKey, brakeFamily, configEngineMatch, driveKey } from "./brake-pad-strict-policy.mjs";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const APPLY = process.argv.includes("--apply");
const ROLLBACK = process.argv.find((value) => value.startsWith("--rollback="));
const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "brake-priority-exact-config-publish-20261025");
const POLICY = "BRAKE_EXACT_CONFIG_NO_CHASSIS_BRIDGE_V1_2026_10_25";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const ANALYSIS = path.join(ROOT, "outputs", "brake-priority-exact-config-analysis-20261025", "safe.jsonl");
loadEnv(path.join(ROOT, ".env.local"));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK.slice("--rollback=".length))), null, 2));
  process.exit(0);
}
const source = readBendixWorkbook();
const analysisRows = fs.readFileSync(ANALYSIS, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
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
      application_id: row.application_id, part_reference_id: row.part_reference_id, position: row.position,
      data_source_id: row.data_source_id, fitment_status: "published", confidence: "exact",
      source_row_numbers: row.source_row_numbers,
      match_reasons: ["exact_make_model", "exact_engine_code_rounded_displacement", "exact_body_drive", "full_source_year_coverage", "unique_db_after_exact_config"],
      metadata: { policy_version: POLICY, source_code: SOURCE_CODE, source_sha256: source.sha256, nexauto_series: row.series,
        engine_codes: row.engine_codes, displacement_rule: "exact engine code; displacement difference <= max(50cc, 5%) to allow nominal rounding",
        evidence_rule: "chassis-independent only because exact configuration and all years resolve to one DB", product_write: false },
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
  const restored = await rollback(backup, true);
  throw new Error(`Apply failed and rollback verified=${restored.verified}: ${error.message}`);
}

async function prepare() {
  const applicationIds = unique(analysisRows.map((row) => row.application_id));
  const [applications, years, productFitments, referenceFitments, dataSource, brakeProducts] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", applicationIds), selectIn("vehicle_catalog_application_years", "application_id", applicationIds),
    selectIn("vehicle_catalog_product_fitments", "application_id", applicationIds), selectIn("vehicle_catalog_part_reference_fitments", "application_id", applicationIds),
    fetchSingle("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)), fetchFiltered("products", "*", (query) => query.eq("category_slug", "brake-pad")),
  ]);
  const seriesIds = unique(applications.map((row) => row.series_id));
  const variantIds = unique(applications.map((row) => row.variant_id));
  const powertrainIds = unique(applications.map((row) => row.powertrain_id));
  const [series, variants, powertrains, engineLinks, brakeVariants, usedReferences, targetReferences] = await Promise.all([
    selectIn("vehicle_catalog_series", "series_id", seriesIds), selectIn("vehicle_catalog_variants", "variant_id", variantIds),
    selectIn("vehicle_catalog_powertrains", "powertrain_id", powertrainIds), selectIn("vehicle_catalog_powertrain_engine_codes", "powertrain_id", powertrainIds),
    selectIn("product_variants", "product_id", brakeProducts.map((row) => row.id)),
    selectIn("catalog_part_references", "id", unique(referenceFitments.map((row) => row.part_reference_id))),
    selectIn("catalog_part_references", "normalized_value", unique(analysisRows.flatMap((row) => row.candidates))),
  ]);
  const engineCodes = await selectIn("vehicle_catalog_engine_codes", "engine_code_id", unique(engineLinks.map((row) => row.engine_code_id)));
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const seriesById = new Map(series.map((row) => [row.series_id, row]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));
  const powertrainById = new Map(powertrains.map((row) => [row.powertrain_id, row]));
  const engineCodeById = new Map(engineCodes.map((row) => [row.engine_code_id, row]));
  const engineLinksByPowertrain = groupBy(engineLinks, (row) => row.powertrain_id);
  const currentRefById = new Map(usedReferences.map((row) => [row.id, row]));
  const targetRefByValue = new Map(targetReferences.map((row) => [row.normalized_value, row]));
  const activeBrakeVariantIds = new Set(brakeVariants.filter((row) => row.active !== false).map((row) => row.id));
  const productCovered = new Set(productFitments.filter((row) => row.fitment_status === "published" && activeBrakeVariantIds.has(row.product_variant_id)).map((row) => row.application_id));
  const referenceCovered = new Set(referenceFitments.filter((row) => row.fitment_status === "published" && currentRefById.get(row.part_reference_id)?.product_type === "brake_pad").map((row) => row.application_id));
  const sourceById = new Map(source.uniqueRows.map((row) => [row.sourceRowId, row]));
  const safe = [];
  const skipped = [];
  const blockers = [];
  for (const row of analysisRows) {
    if (productCovered.has(row.application_id) || referenceCovered.has(row.application_id)) {
      skipped.push({ ...row, reason: "already_covered_live" });
      continue;
    }
    const application = appById.get(row.application_id);
    if (!application || application.status !== "active") { blockers.push({ application_id: row.application_id, reason: "application_not_active" }); continue; }
    const liveYears = (yearsByApp.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
    const liveSeries = seriesById.get(application.series_id)?.code ?? "";
    const liveVariant = variantById.get(application.variant_id);
    const livePowertrain = powertrainById.get(application.powertrain_id);
    const liveEngines = unique((engineLinksByPowertrain.get(application.powertrain_id) ?? []).map((item) => engineCodeById.get(item.engine_code_id)?.code));
    const identityMatches = liveSeries === row.series && bodyKey(liveVariant?.body_style) === bodyKey(row.body)
      && driveKey(liveVariant?.drive_type) === driveKey(row.drive) && Number(livePowertrain?.displacement_cc) === Number(row.displacement_cc)
      && JSON.stringify(liveEngines) === JSON.stringify(row.engine_codes) && JSON.stringify(liveYears) === JSON.stringify(row.years);
    if (!identityMatches) { blockers.push({ application_id: row.application_id, reason: "live_identity_changed" }); continue; }
    const dbReference = row.candidates[0];
    const partReference = targetRefByValue.get(dbReference);
    if (!partReference || partReference.product_type !== "brake_pad" || !["active", "to_be_discontinued"].includes(partReference.lifecycle_status)) {
      blockers.push({ application_id: row.application_id, position: row.position, reason: "invalid_target_reference", db_reference: dbReference }); continue;
    }
    const evidenceRows = row.source_row_numbers.map((id) => sourceById.get(id));
    const evidenceValid = evidenceRows.length > 0 && evidenceRows.every((item) => item && item.bendixReference === dbReference && item.position === row.position
      && bodyKey(item.bodyStyle) === bodyKey(row.body) && driveKey(item.driveType) === driveKey(row.drive)
      && brakeFamily(item.makeName, item.modelName) === brakeFamily(row.make, row.model)
      && exactCodeRoundedDisplacementMatch({ engineCodes: row.engine_codes, displacementCc: row.displacement_cc }, item))
      && row.years.every((year) => evidenceRows.some((sourceRow) => year >= sourceRow.yearFrom && year <= sourceRow.yearTo));
    if (!evidenceValid) { blockers.push({ application_id: row.application_id, position: row.position, reason: "source_evidence_revalidation_failed" }); continue; }
    const publishedConflicts = referenceFitments.filter((item) => item.application_id === row.application_id && item.position === row.position
      && item.fitment_status === "published" && currentRefById.get(item.part_reference_id)?.normalized_value !== dbReference);
    if (publishedConflicts.length) { blockers.push({ application_id: row.application_id, position: row.position, reason: "published_conflict" }); continue; }
    safe.push({ ...row, db_reference: dbReference, part_reference_id: partReference.id, data_source_id: dataSource.id });
  }
  const safeIds = new Set(safe.map((row) => row.application_id));
  const protectedProducts = productFitments.filter((row) => safeIds.has(row.application_id));
  const preimageRefs = referenceFitments.filter((row) => safeIds.has(row.application_id));
  return { generated_at: new Date().toISOString(), safe, skipped, blockers, snapshot: { protectedProducts, referenceFitments: preimageRefs },
    product_hash: stableHash(protectedProducts), plan_hash: stableHash(safe.map(publicSafe)) };
}

async function verify(plan) {
  const ids = unique(plan.safe.map((row) => row.application_id));
  const [refs, products] = await Promise.all([selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids)]);
  const failures = plan.safe.filter((row) => !refs.some((item) => item.application_id === row.application_id && item.part_reference_id === row.part_reference_id
    && item.position === row.position && item.data_source_id === row.data_source_id && item.fitment_status === "published"));
  assert(failures.length === 0, `Readback failed for ${failures.length} relationships`);
  assert(stableHash(products) === plan.product_hash, "Protected product layer changed");
  return { ok: true, verified_at: new Date().toISOString(), relationships: plan.safe.length, applications: ids.length,
    application_years: unique(plan.safe.map((row) => row.application_id)).reduce((sum, id) => sum + plan.safe.find((row) => row.application_id === id).years.filter((year) => year >= 2000 && year <= 2026).length, 0), product_layer_unchanged: true };
}

function createBackup(plan) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `brake-priority-exact-config-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "referenceFitments.json"), plan.snapshot.referenceFitments);
  writeJson(path.join(directory, "productFitments.json"), plan.snapshot.protectedProducts);
  writeJson(path.join(directory, "safe.json"), plan.safe.map(publicSafe));
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/publish-priority-brake-exact-config-20261025.mjs --rollback=${path.relative(ROOT, directory).replaceAll("\\", "/")}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const root = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${root}${path.sep}`) && path.basename(directory).startsWith("brake-priority-exact-config-"), "Invalid rollback directory");
  const before = readJson(path.join(directory, "referenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const ids = unique(readJson(path.join(directory, "safe.json")).map((row) => row.application_id));
  let response = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (response.error) throw response.error;
  if (before.length) { response = await db.from("vehicle_catalog_part_reference_fitments").insert(before); if (response.error) throw response.error; }
  const [after, productsAfter] = await Promise.all([selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids)]);
  const checks = { references_restored: semanticHash(after) === semanticHash(before), product_layer_unchanged: stableHash(productsAfter) === stableHash(productsBefore) };
  assert(Object.values(checks).every(Boolean), `Rollback verification failed: ${JSON.stringify(checks)}`);
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), checks };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function summary(plan, mode) {
  const appYears = new Map(plan.safe.map((row) => [row.application_id, row.years.filter((year) => year >= 2000 && year <= 2026).length]));
  return { generated_at: plan.generated_at, mode, production_writes: mode === "apply" ? plan.safe.length : 0, policy: POLICY,
    safe_relationships: plan.safe.length, safe_applications: appYears.size,
    safe_application_years_2000_2026: [...appYears.values()].reduce((sum, value) => sum + value, 0),
    by_group: [...groupBy(plan.safe, (row) => row.group)].map(([group, rows]) => ({ group, relationships: rows.length,
      applications: new Set(rows.map((row) => row.application_id)).size,
      application_years: [...new Map(rows.map((row) => [row.application_id, row.years.filter((year) => year >= 2000 && year <= 2026).length])).values()].reduce((sum, value) => sum + value, 0) }))
      .sort((a, b) => b.application_years - a.application_years),
    already_covered_skipped_relationships: plan.skipped.length, blockers: plan.blockers, product_writes: 0, plan_sha256: plan.plan_hash };
}
function writeOutputs(plan, mode) { fs.mkdirSync(OUT, { recursive: true }); writeJson(path.join(OUT, "preflight-summary.json"), summary(plan, mode));
  writeJsonl(path.join(OUT, "safe.jsonl"), plan.safe.map(publicSafe)); writeJsonl(path.join(OUT, "skipped.jsonl"), plan.skipped); }
function publicSafe(row) { return { group: row.group, application_id: row.application_id, make: row.make, model: row.model, series: row.series,
  body: row.body, drive: row.drive, engine_codes: row.engine_codes, displacement_cc: row.displacement_cc, years: row.years,
  position: row.position, db_reference: row.db_reference, source_row_numbers: row.source_row_numbers, product_write: false }; }
function assert(value, message) { if (!value) throw new Error(message); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupBy(values, keyFn) { const map = new Map(); for (const value of values) { const key = keyFn(value); const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); } return map; }
function exactCodeRoundedDisplacementMatch(application, sourceRow) {
  if (configEngineMatch(application, sourceRow)) return true;
  const appCodes = new Set((application.engineCodes ?? []).map(compact));
  const exactCode = (sourceRow.engineCodes ?? []).some((code) => appCodes.has(compact(code)));
  const appCc = Number(application.displacementCc), sourceCc = Number(sourceRow.displacementCc);
  return exactCode && appCc > 0 && sourceCc > 0 && Math.abs(appCc - sourceCc) <= Math.max(50, sourceCc * 0.05);
}
function compact(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
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
