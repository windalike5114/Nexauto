import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";
import {
  bodyKey,
  brakeFamily,
  chassisTokens,
  compact,
  configEngineMatch,
  driveKey,
  familyScopedDetailedChassisMatch,
  platformCodeMatch,
} from "./brake-pad-strict-policy.mjs";
import {
  buildPopularAliasIndex,
  groupsForPopularScope,
  popularGroupMatchesApplication,
} from "./popular-vehicle-models.mjs";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "outputs", "brake-lancer-multi-v3-20261026");
const POLICY = "BRAKE_LANCER_MULTI_V3_2026_10_26";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
const unknown = process.argv.slice(2).filter((value) => value !== "--apply" && !value.startsWith("--rollback="));
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
if (APPLY && ROLLBACK_ARG) throw new Error("Choose --apply or --rollback=<backup-directory>.");

const DIRECT_GROUPS = new Set([]);
const MULTI_GROUPS = new Set([
  "Mitsubishi Lancer",
]);
const TARGET_GROUPS = new Set([...DIRECT_GROUPS, ...MULTI_GROUPS]);

loadEnv(path.join(ROOT, ".env.local"));
assert(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (ROLLBACK_ARG) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const bendix = readBendixWorkbook();
// A discontinued/superseded pad is still valid historical fitment knowledge.
// Lifecycle controls commerce and replacement planning, not whether an old
// vehicle used that DB shape. Unknown rows remain excluded.
const sourceRows = bendix.uniqueRows.filter((row) => row.position && row.lifecycleStatus !== "unknown");
const production = await loadProduction();
const prepared = preparePlan(production, sourceRows, bendix.sha256);
writeOutputs(prepared, "report-only");
console.log(JSON.stringify(summary(prepared, "report-only"), null, 2));
if (!APPLY) process.exit(0);

assert(prepared.blockers.length === 0, `Preflight blockers: ${JSON.stringify(prepared.blockers)}`);
const freshProduction = await loadProduction();
const fresh = preparePlan(freshProduction, sourceRows, bendix.sha256);
assert(fresh.blockers.length === 0, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(fresh.plan_hash === prepared.plan_hash, "Production state changed after preflight; no writes issued.");
const backup = createBackup(fresh);
try {
  await applyPlan(fresh);
  const verification = await verify(fresh);
  const result = { ...summary(fresh, "apply"), backup_directory: relative(backup), verification };
  writeJson(path.join(OUTPUT_DIR, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  writeJson(path.join(backup, "automatic-rollback-result.json"), restored);
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}

function preparePlan(data, eligibleRows, sourceSha256) {
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const powertrainById = new Map(data.powertrains.map((row) => [row.powertrain_id, row]));
  const engineCodeById = new Map(data.engineCodes.map((row) => [row.engine_code_id, compact(row.code)]));
  const engineLinksByPowertrain = groupBy(data.engineLinks, (row) => row.powertrain_id);
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const referenceById = new Map(data.references.map((row) => [row.id, row]));
  const referenceByValue = new Map(data.references
    .filter((row) => row.product_type === "brake_pad" && row.reference_scheme === "bendix_db")
    .map((row) => [row.normalized_value, row]));
  const fitmentsByApplication = groupBy(data.referenceFitments, (row) => row.application_id);
  const productFitmentsByApplication = groupBy(data.productFitments, (row) => row.application_id);
  const productVariantType = productVariantTypeMap(data.products, data.productVariants);
  const sourceByFamilyPosition = groupBy(eligibleRows, (row) => `${row.modelFamily}|${row.position}`);
  const aliasIndex = buildPopularAliasIndex(groupsForPopularScope("extended80"));
  const blockers = [];
  const targetStats = new Map([...TARGET_GROUPS].map((label) => [label, {
    matched_applications: 0, matched_application_years: 0,
    skipped_existing_reference: 0, skipped_existing_product: 0,
  }]));
  if (!data.dataSource?.active) blockers.push({ reason: "missing_or_inactive_data_source", source_code: SOURCE_CODE });

  const applications = [];
  for (const row of data.applications.filter((item) => item.status === "active")) {
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const variant = variantById.get(row.variant_id);
    const group = make && model ? aliasIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (!group || !TARGET_GROUPS.has(group.label)) continue;
    if (!popularGroupMatchesApplication(group, { bodyStyle: variant?.body_style, variantName: variant?.display_name })) continue;
    const allYears = (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year)).sort((a, b) => a - b);
    const scopeYears = allYears.filter((year) => year >= 2000 && year <= 2026);
    if (!scopeYears.length) continue;
    const targetStat = targetStats.get(group.label);
    targetStat.matched_applications += 1;
    targetStat.matched_application_years += scopeYears.length;
    const currentReferenceKnowledge = (fitmentsByApplication.get(row.application_id) ?? []).some((fitment) =>
      fitment.fitment_status === "published" && referenceById.get(fitment.part_reference_id)?.product_type === "brake_pad");
    const currentProductKnowledge = (productFitmentsByApplication.get(row.application_id) ?? []).some((fitment) =>
      fitment.fitment_status === "published" && productVariantType.get(fitment.product_variant_id) === "brake_pad");
    if (currentReferenceKnowledge || currentProductKnowledge) {
      if (currentReferenceKnowledge) targetStat.skipped_existing_reference += 1;
      if (currentProductKnowledge) targetStat.skipped_existing_product += 1;
      continue;
    }
    const series = seriesById.get(row.series_id);
    const powertrain = powertrainById.get(row.powertrain_id);
    const engineCodes = unique((engineLinksByPowertrain.get(row.powertrain_id) ?? [])
      .map((item) => engineCodeById.get(item.engine_code_id)).filter(Boolean));
    applications.push({
      application_id: row.application_id,
      group: group.label,
      // Only vehicle families explicitly approved for real factory multi-brake
      // configurations may retain more than one DB option.  Other groups stay
      // unique-only even when a chassis bridge is known.
      mode: MULTI_GROUPS.has(group.label) ? "conditional_multi_allowed" : "unique_only",
      make: make.name,
      model: model.name,
      family: brakeFamily(make.name, model.name),
      series: series?.code ?? series?.display_name ?? "",
      body: variant?.body_style ?? "",
      drive: variant?.drive_type ?? "",
      variant: variant?.display_name ?? "",
      engine: powertrain?.display_name ?? "",
      displacementCc: Number(powertrain?.displacement_cc) || null,
      engineCodes,
      allYears,
      scopeYears,
    });
  }

  const safe = [];
  const unresolved = [];
  for (const application of applications) {
    let applicationHasSafePosition = false;
    for (const position of ["front", "rear"]) {
      const result = analyzePosition(application, position, sourceByFamilyPosition.get(`${application.family}|${position}`) ?? []);
      if (result.candidates.length && (application.mode === "conditional_multi_allowed" || result.candidates.length === 1)) {
        const optionSet = result.candidates.map((item) => item.db_reference).sort();
        for (const candidate of result.candidates) {
          const reference = referenceByValue.get(candidate.db_reference);
          if (!reference) {
            blockers.push({ application_id: application.application_id, position, db_reference: candidate.db_reference,
              reason: "missing_bendix_reference_registry_row" });
            continue;
          }
          const previous = (fitmentsByApplication.get(application.application_id) ?? []).find((fitment) =>
            fitment.part_reference_id === reference.id && fitment.position === position && fitment.data_source_id === data.dataSource.id) ?? null;
          safe.push({ ...publicApplication(application), position, db_reference: candidate.db_reference,
            part_reference_id: reference.id, data_source_id: data.dataSource.id,
            source_row_numbers: candidate.source_row_numbers,
            selection_mode: optionSet.length > 1 ? "conditional_one_of" : "deterministic",
            option_set: optionSet, previous_row: previous, analysis: result.analysis });
        }
        applicationHasSafePosition = true;
      } else if (result.reason !== "no_source_rows_for_family_position") {
        unresolved.push({ ...publicApplication(application), position, reason: result.reason,
          candidate_db: result.candidate_db ?? result.candidates.map((item) => item.db_reference), source_row_numbers: result.source_row_numbers,
          missing_years: result.missing_years, analysis: result.analysis });
      }
    }
    if (!applicationHasSafePosition) {
      const hasAny = unresolved.some((row) => row.application_id === application.application_id);
      if (!hasAny) unresolved.push({ ...publicApplication(application), position: "unknown",
        reason: "no_source_rows_for_family_position", candidate_db: [], source_row_numbers: [], missing_years: application.allYears });
    }
  }

  const safeApplicationIds = new Set(safe.map((row) => row.application_id));
  const publicPlan = safe.map((row) => {
    const { previous_row, analysis, ...rest } = row;
    return { ...rest, previous_status: previous_row?.fitment_status ?? null, analysis };
  });
  const byGroup = [...TARGET_GROUPS].map((group) => {
    const gaps = applications.filter((row) => row.group === group);
    const solved = gaps.filter((row) => safeApplicationIds.has(row.application_id));
    const safeRows = safe.filter((row) => row.group === group);
    return {
      group,
      gap_applications: gaps.length,
      gap_application_years: sum(gaps.map((row) => row.scopeYears.length)),
      safe_applications: solved.length,
      safe_application_years: sum(solved.map((row) => row.scopeYears.length)),
      reference_relationships: safeRows.length,
      conditional_applications: new Set(safeRows.filter((row) => row.selection_mode === "conditional_one_of").map((row) => row.application_id)).size,
      ...targetStats.get(group),
    };
  });
  const protectedProductFitments = data.productFitments.filter((row) => safeApplicationIds.has(row.application_id));
  const productHash = semanticHash(protectedProductFitments);
  const planHash = stableHash({ sourceSha256, publicPlan, productHash });
  return { generated_at: new Date().toISOString(), source_sha256: sourceSha256, applications, safe, unresolved,
    by_group: byGroup, blockers, public_plan: publicPlan, plan_hash: planHash, product_hash: productHash,
    snapshot: { referenceFitments: data.referenceFitments.filter((row) => safeApplicationIds.has(row.application_id)),
      productFitments: protectedProductFitments } };
}

function analyzePosition(application, position, familyRows) {
  if (!familyRows.length) return emptyResult("no_source_rows_for_family_position");
  let platformRows = familyRows.filter((row) => chassisTokens(row).some((token) =>
    platformCodeMatch(application.family, application.series, token) || familyScopedDetailedChassisMatch(application.series, token)));
  let platformBridge = null;
  if (!platformRows.length && application.family === "VOLKSWAGEN|GOLF" && /^AU[12]$/.test(compact(application.series))) {
    platformRows = familyRows.filter((row) => /^GOLF VII(?: |$)/.test(row.seriesName));
    platformBridge = "golf_au_to_5g_generation";
  }
  if (!platformRows.length && application.family === "VOLKSWAGEN|GOLF" && compact(application.series) === "AJ5") {
    platformRows = familyRows.filter((row) => /^GOLF VI(?: |$)/.test(row.seriesName));
    platformBridge = "golf_aj5_variant_to_golf_vi_generation";
  }
  if (!platformRows.length && application.family === "VOLKSWAGEN|GOLF" && /^BC[12]$/.test(compact(application.series))) {
    platformRows = familyRows.filter((row) => /^GOLF VII(?: |$)/.test(row.seriesName));
    platformBridge = "golf_bc1_bc2_to_golf_vii_generation";
  }
  if (!platformRows.length) return emptyResult("no_exact_platform_mapping");

  const bridgeAllowsDriveVariants = platformBridge === "golf_aj5_variant_to_golf_vi_generation"
    || platformBridge === "golf_bc1_bc2_to_golf_vii_generation";
  // Within an exact chassis/platform, body classification did not add brake-pad
  // discrimination in the audited Bendix data.  Keep body in diagnostics but
  // do not fragment an otherwise identical brake application.
  const appBody = bodyKey(application.body);
  const bodyRows = platformRows;
  const appDrive = driveKey(application.drive || application.variant);
  const driveRows = bridgeAllowsDriveVariants || !appDrive
    ? bodyRows
    : bodyRows.filter((row) => !driveKey(row.driveType) || driveKey(row.driveType) === appDrive);
  if (!driveRows.length) return diagnosticResult("drive_mismatch", bodyRows, application.allYears, { platformBridge });

  let configRows = driveRows;
  if (application.engineCodes.length) {
    const exactEngineRows = driveRows.filter((row) => applicationEngineMatch(application, row));
    const unspecifiedRows = driveRows.filter((row) => !row.engineCodes?.length || !row.displacementCc);
    if (exactEngineRows.length) configRows = [...exactEngineRows, ...unspecifiedRows];
  }
  const byDb = groupBy(configRows, (row) => row.bendixReference);
  const candidates = [];
  const partialCandidates = [];
  for (const [dbReference, rows] of byDb) {
    const covered = application.allYears.filter((year) => rows.some((row) => year >= row.yearFrom && year <= row.yearTo));
    const item = { db_reference: dbReference, source_row_numbers: uniqueNumbers(rows
      .filter((row) => application.allYears.some((year) => year >= row.yearFrom && year <= row.yearTo))
      .map((row) => row.sourceRowId)), covered_years: covered };
    if (covered.length === application.allYears.length) candidates.push(item);
    else if (covered.length) partialCandidates.push(item);
  }
  candidates.sort((left, right) => left.db_reference.localeCompare(right.db_reference, undefined, { numeric: true }));
  const missingYears = application.allYears.filter((year) => !configRows.some((row) => year >= row.yearFrom && year <= row.yearTo));
  if (!candidates.length) return {
    candidates: [],
    candidate_db: partialCandidates.map((item) => item.db_reference),
    reason: partialCandidates.length ? "partial_source_year_coverage" : "no_exact_configuration_evidence",
    source_row_numbers: uniqueNumbers(configRows.map((row) => row.sourceRowId)),
    missing_years: missingYears,
    analysis: { platform_bridge: platformBridge, body_rule: "ignored_within_exact_chassis", application_body: appBody,
      platform_rows: platformRows.length, body_rows: bodyRows.length,
      drive_rows: driveRows.length, config_rows: configRows.length, partial_candidates: partialCandidates },
  };
  return { candidates, reason: candidates.length > 1 ? "evidence_backed_multiple_brake_configurations" : "deterministic_unique",
    source_row_numbers: uniqueNumbers(candidates.flatMap((row) => row.source_row_numbers)), missing_years: [],
    analysis: { platform_bridge: platformBridge, body_rule: "ignored_within_exact_chassis", application_body: appBody,
      platform_rows: platformRows.length, body_rows: bodyRows.length,
      drive_rows: driveRows.length, config_rows: configRows.length, partial_candidates: partialCandidates } };
}

function applicationEngineMatch(application, sourceRow) {
  // EV catalog rows often have a stable motor code but no displacement.  The
  // shared ICE matcher intentionally requires displacement, so accept an exact
  // normalized code overlap when either side is non-combustion/unspecified.
  const appCodes = new Set((application.engineCodes ?? []).map(compact).filter(Boolean));
  const sourceCodes = (sourceRow.engineCodes ?? []).map(compact).filter(Boolean);
  const codeMatch = sourceCodes.some((code) => appCodes.has(code));
  if (!codeMatch) return false;
  const appCc = Number(application.displacementCc) || 0;
  const sourceCc = Number(sourceRow.displacementCc) || 0;
  return !appCc || !sourceCc || configEngineMatch(application, sourceRow);
}

function diagnosticResult(reason, rows, years, analysis = {}) {
  return { candidates: [], reason, source_row_numbers: uniqueNumbers(rows.map((row) => row.sourceRowId)), missing_years: years,
    analysis: { ...analysis, source_candidates: unique(rows.map((row) => row.bendixReference)) } };
}
function emptyResult(reason) { return { candidates: [], reason, source_row_numbers: [], missing_years: [], analysis: {} }; }

async function applyPlan(preflight) {
  for (const row of preflight.safe) {
    const conditional = row.selection_mode === "conditional_one_of";
    const payload = {
      application_id: row.application_id,
      part_reference_id: row.part_reference_id,
      position: row.position,
      data_source_id: row.data_source_id,
      fitment_status: "published",
      confidence: conditional ? "high" : "exact",
      source_row_numbers: row.source_row_numbers,
      match_reasons: conditional
        ? ["authoritative_bendix_full_catalog", "evidence_backed_multiple_brake_configurations", "user_approved_multi_reference_mode"]
        : ["authoritative_bendix_full_catalog", "deterministic_unique_full_application_years"],
      metadata: {
        ...(row.previous_row?.metadata ?? {}),
        policy_version: POLICY,
        source_code: SOURCE_CODE,
        source_sha256: preflight.source_sha256,
        selection_mode: row.selection_mode,
        option_set: row.option_set,
        configuration_confirmation_required: conditional,
        discriminator_hint: conditional ? "Confirm PR code / caliper / disc size / OE brake package" : null,
        exact_knowledge_coverage: !conditional,
        conditional_search_coverage: conditional,
        platform_bridge: row.analysis?.platform_bridge ?? null,
        bridge_evidence_urls: bridgeEvidenceUrls(row.analysis?.platform_bridge),
        product_write: false,
      },
    };
    const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(payload, {
      onConflict: "application_id,part_reference_id,position,data_source_id",
    });
    if (error) throw error;
  }
}

function bridgeEvidenceUrls(platformBridge) {
  if (platformBridge === "golf_aj5_variant_to_golf_vi_generation") {
    return [
      "https://www.bremboparts.com/europe/en/catalogue/vw-golf-vi-variant-aj5-1-6/000032586-1",
      "https://www.bendix.com.au/news-events/september-2026-whats-new",
    ];
  }
  if (platformBridge === "golf_bc1_bc2_to_golf_vii_generation") {
    return [
      "https://www.texafrance.fr/wp-content/uploads/2025/02/Aggiornamento_CAR_2025_01_fr-FR.pdf",
      "https://www.bendix.com.au/catalogue/vw/golf/golf-vii-5g1-bq1-be1-be2/14-tsi",
    ];
  }
  return [];
}

async function verify(preflight) {
  const ids = unique(preflight.safe.map((row) => row.application_id));
  const [fitments, products] = await Promise.all([
    selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "*", "application_id", ids),
  ]);
  const failures = [];
  for (const expected of preflight.safe) {
    const actual = fitments.find((row) => row.application_id === expected.application_id
      && row.part_reference_id === expected.part_reference_id && row.position === expected.position
      && row.data_source_id === expected.data_source_id);
    if (!actual || actual.fitment_status !== "published" || actual.metadata?.policy_version !== POLICY
      || actual.metadata?.selection_mode !== expected.selection_mode) {
      failures.push({ application_id: expected.application_id, position: expected.position,
        db_reference: expected.db_reference, reason: "reference_fitment_readback_failed" });
    }
  }
  const duplicateKeys = duplicateKeysFor(fitments.filter((row) => row.fitment_status === "published"));
  if (duplicateKeys.length) failures.push({ reason: "duplicate_published_reference_keys", duplicateKeys });
  if (semanticHash(products) !== preflight.product_hash) failures.push({ reason: "protected_product_layer_changed" });
  assert(failures.length === 0, `Verification failures: ${JSON.stringify(failures)}`);
  return { ok: true, verified_at: new Date().toISOString(), applications: ids.length,
    relationships: preflight.safe.length, product_layer_unchanged: true, duplicate_published_reference_keys: 0 };
}

function createBackup(preflight) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `brake-priority-search-multi-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  writeJson(path.join(directory, "referenceFitments.json"), preflight.snapshot.referenceFitments);
  writeJson(path.join(directory, "productFitments.json"), preflight.snapshot.productFitments);
  writeJson(path.join(directory, "plan.json"), preflight.public_plan);
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/resolve-priority-brake-search-and-multi-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const allowed = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${allowed}${path.sep}`) && path.basename(directory).startsWith("brake-priority-search-multi-"),
    "Invalid rollback directory.");
  const before = readJson(path.join(directory, "referenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const plan = readJson(path.join(directory, "plan.json"));
  const ids = unique(plan.map((row) => row.application_id));
  let response = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids);
  if (response.error) throw response.error;
  if (before.length) {
    response = await db.from("vehicle_catalog_part_reference_fitments").insert(before);
    if (response.error) throw response.error;
  }
  const [after, productsAfter] = await Promise.all([
    selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", ids),
    selectIn("vehicle_catalog_product_fitments", "*", "application_id", ids),
  ]);
  const checks = { reference_fitments_restored: semanticHash(after) === semanticHash(before),
    product_layer_unchanged: semanticHash(productsAfter) === semanticHash(productsBefore) };
  assert(Object.values(checks).every(Boolean), `Rollback verification failed: ${JSON.stringify(checks)}`);
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), checks };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function summary(preflight, mode) {
  const safeIds = new Set(preflight.safe.map((row) => row.application_id));
  const safeApps = preflight.applications.filter((row) => safeIds.has(row.application_id));
  const conditionalIds = new Set(preflight.safe.filter((row) => row.selection_mode === "conditional_one_of").map((row) => row.application_id));
  return {
    generated_at: preflight.generated_at,
    mode,
    policy: POLICY,
    source_sha256: preflight.source_sha256,
    production_writes: mode === "apply",
    current_gap_applications: preflight.applications.length,
    current_gap_application_years_2000_2026: sum(preflight.applications.map((row) => row.scopeYears.length)),
    safe_applications: safeApps.length,
    safe_application_years_2000_2026: sum(safeApps.map((row) => row.scopeYears.length)),
    deterministic_applications: safeApps.filter((row) => !conditionalIds.has(row.application_id)).length,
    conditional_multi_applications: conditionalIds.size,
    reference_relationships: preflight.safe.length,
    unresolved_applications: preflight.applications.length - safeApps.length,
    blockers: preflight.blockers,
    by_group: preflight.by_group,
    plan_sha256: preflight.plan_hash,
    product_writes: 0,
  };
}

function writeOutputs(preflight, mode) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson(path.join(OUTPUT_DIR, "preflight-summary.json"), summary(preflight, mode));
  writeJsonl(path.join(OUTPUT_DIR, "safe-to-publish.jsonl"), preflight.public_plan);
  writeJsonl(path.join(OUTPUT_DIR, "unresolved.jsonl"), preflight.unresolved);
  fs.writeFileSync(path.join(OUTPUT_DIR, "coverage-by-group.csv"), toCsv(preflight.by_group));
  writeJson(path.join(OUTPUT_DIR, "blockers.json"), preflight.blockers);
}

async function loadProduction() {
  const [applications, years, makes, models, series, variants, powertrains, engineCodes, engineLinks,
    products, productVariants, productFitments, referenceFitments, references, dataSource] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "*"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,code,display_name"),
    fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type,display_name"),
    fetchAll("vehicle_catalog_powertrains", "powertrain_id,display_name,displacement_cc"),
    fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
    fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id,is_primary"),
    fetchAll("products", "id,category_slug"),
    fetchAll("product_variants", "id,product_id,sku"),
    fetchAll("vehicle_catalog_product_fitments", "*"),
    fetchAll("vehicle_catalog_part_reference_fitments", "*"),
    fetchAll("catalog_part_references", "*"),
    fetchSingle("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)),
  ]);
  return { applications, years, makes, models, series, variants, powertrains, engineCodes, engineLinks,
    products, productVariants, productFitments, referenceFitments, references, dataSource };
}

function productVariantTypeMap(products, variants) {
  const categoryByProduct = new Map(products.map((row) => [row.id, row.category_slug]));
  return new Map(variants.map((row) => [row.id, categoryByProduct.get(row.product_id) === "brake-pads" || /^NBP/i.test(row.sku)
    ? "brake_pad" : categoryByProduct.get(row.product_id)]));
}

function publicApplication(row) {
  return { group: row.group, application_id: row.application_id, make: row.make, model: row.model,
    series: row.series, body: row.body, drive: row.drive, engine: row.engine,
    engine_codes: row.engineCodes, displacement_cc: row.displacementCc,
    application_years: row.allYears, scope_years: row.scopeYears, mode: row.mode };
}

function duplicateKeysFor(rows) {
  const counts = new Map();
  for (const row of rows) {
    const key = [row.application_id, row.part_reference_id, row.position, row.data_source_id].join("|");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([key]) => key);
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}
async function fetchSingle(table, columns, build) {
  const { data, error } = await build(db.from(table).select(columns)).maybeSingle();
  if (error) throw error;
  return data;
}
async function selectIn(table, columns, column, values) {
  if (!values.length) return [];
  const rows = [];
  for (let index = 0; index < values.length; index += 200) {
    const { data, error } = await db.from(table).select(columns).in(column, values.slice(index, index + 200));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
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
function groupBy(values, keyFn) { const map = new Map(); for (const value of values) { const key = keyFn(value); const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); } return map; }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function uniqueNumbers(values) { return [...new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b); }
function sum(values) { return values.reduce((total, value) => total + Number(value || 0), 0); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortDeep(item)])); return value; }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(rows) {
  const normalized = rows.map((row) => {
    const { created_at, updated_at, ...rest } = row;
    return rest;
  }).map((row) => sortDeep(row));
  normalized.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return stableHash(normalized);
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, values) { fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function relative(file) { return path.relative(ROOT, file).replaceAll("\\", "/"); }
function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${headers.map(quote).join(",")}\n${rows.map((row) => headers.map((header) => quote(row[header])).join(",")).join("\n")}\n`;
}
