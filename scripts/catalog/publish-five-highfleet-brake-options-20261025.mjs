import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readBendixWorkbook } from "./import-bendix-full-reference-fitments-20261025.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "outputs", "brake-five-highfleet-publication-20261025");
const POLICY = "BRAKE_FIVE_HIGHFLEET_EVIDENCE_OPTIONS_V1_2026_10_25";
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const EXPECTED_SOURCE_SHA256 = "8612087defd75010203b3b3fa658e473390591a3b1a0339f288dce5e020a41c2";
const APPLY = process.argv.includes("--apply");
const ROLLBACK_ARG = process.argv.find((value) => value.startsWith("--rollback="));
const unknown = process.argv.slice(2).filter((value) => value !== "--apply" && !value.startsWith("--rollback="));
if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(", ")}`);
if (APPLY && ROLLBACK_ARG) throw new Error("Choose --apply or --rollback=<backup-directory>.");

const OPTION_SPECS = [
  spec("Nissan", "Navara", "ap_31e5bb383cc0df0df4eb", "D22", "Utility", "RWD", ["KA24DE"], range(1997, 2005),
    { front: { DB340: [1041], DB438: [1042] } }),
  spec("Nissan", "Navara", "ap_35a8abb52aa6bca75f49", "D22", "Cab Chassis", "RWD", ["TD27"], range(1997, 2001),
    { front: { DB340: [1056], DB438: [1057] } }),
  spec("Nissan", "Navara", "ap_7027634616c3d808895a", "D22", "Utility", "RWD", ["TD27"], range(1998, 2005),
    { front: { DB340: [1036], DB438: [1037] } }),
  spec("Nissan", "Navara", "ap_97f6002c4e478a8bc3ab", "D22", "Utility", "AWD", ["KA24DE"], range(1997, 2004),
    { front: { DB340: [1048], DB438: [1049] } }),
  spec("Nissan", "Navara", "ap_a51f7f6fe19bd74be4a8", "D22", "Cab Chassis", "RWD", ["KA24DE"], range(1999, 2005),
    { front: { DB340: [1062], DB438: [1063] } }),
  spec("Toyota", "Corolla", "ap_6177633150cae5801c94", "ZWE211", "Sedan", "FWD", ["2ZR-FXE"], range(2019, 2026), {
    front: { DB2159: [235], DB2544: [237, 243] }, rear: { DB1786: [234], DB2529: [236, 242] },
  }),
  spec("Toyota", "Corolla", "ap_21eafbd33b5bf56b7a7c", "ZWE219", "Sedan", "FWD", ["2ZR-FXE"], range(2022, 2026), {
    front: { DB2159: [235], DB2544: [237, 243] }, rear: { DB1786: [234], DB2529: [236, 242] },
  }),
  spec("Volkswagen", "Golf", "ap_09b764a10b9af230c6a5", "5K1", "Hatchback", "FWD", ["CFFB", "CJAA", "CBAB"], range(2008, 2013), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_2b066f68efcf28694376", "5K1", "Hatchback", "AWD", ["CDLC", "CRZA"], range(2009, 2013), {
    front: { DB1405: [8998], DB1849: [8999], DB2402: [9002] }, rear: { DB1865: [9000], DB2211: [9001] },
  }),
  spec("Volkswagen", "Golf", "ap_aca22a160df59eb27ef3", "5K1", "Hatchback", "FWD", ["CBBB", "CFGB"], range(2009, 2012), {
    front: { DB1405: [9096], DB1849: [9098], DB2210: [9100], DB2402: [9102] },
    rear: { DB1449: [9097], DB1865: [9099], DB2211: [9101] },
  }),
  spec("Volkswagen", "Golf", "ap_c87db180b09820cffbb8", "5K1", "Hatchback", "FWD", ["CAYC"], range(2009, 2012), {
    front: { DB1405: [9110], DB1849: [9112], DB2210: [9114], DB2402: [9116] },
    rear: { DB1449: [9111], DB1865: [9113], DB2211: [9115] },
  }),
  spec("Volkswagen", "Golf", "ap_2d1b0847409077560296", "5K1", "Hatchback", "FWD", ["CFFA", "CBAA"], range(2008, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_35b5f285058337feab81", "5K1", "Hatchback", "FWD", ["CGGA"], range(2008, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_35663a538dcf6b088ff0", "5K1", "Hatchback", "FWD", ["CLCA", "CBDC"], range(2008, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_fe2919e61023db0fdb50", "5K1", "Hatchback", "FWD", ["CMXA", "CCSA", "BSE", "BSF"], range(2008, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_8219511073e1042bea64", "5K1", "Hatchback", "FWD", ["CAYB"], range(2009, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_81c5c9fae4ba8282e912", "5K1", "Hatchback", "AWD", ["CFFB", "CBAB"], range(2009, 2012), {
    front: { DB1405: [8998], DB1849: [8999], DB2402: [9002] }, rear: { DB1865: [9000], DB2211: [9001] },
  }),
  spec("Volkswagen", "Golf", "ap_3c03abc0b1c6d18f0111", "5K1", "Hatchback", "AWD", ["CDLA"], range(2009, 2011), {
    front: { DB1405: [8998], DB1849: [8999], DB2402: [9002] }, rear: { DB1865: [9000], DB2211: [9001] },
  }),
  spec("Volkswagen", "Golf", "ap_35e74f5b4c1fed55ee2d", "5K1", "Hatchback", "AWD", ["CDLF"], range(2009, 2012), {
    front: { DB1405: [8998], DB1849: [8999], DB2402: [9002] }, rear: { DB1865: [9000], DB2211: [9001] },
  }),
  spec("Volkswagen", "Golf", "ap_922d62ce2a62f2736762", "5K1", "Hatchback", "FWD", ["CDAA"], range(2009, 2011), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_f09c4812ecdd40159558", "5K1", "Hatchback", "FWD", ["CBZA"], range(2010, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
  spec("Volkswagen", "Golf", "ap_b02110bdc716c8dbc2eb", "5K1", "Hatchback", "FWD", ["CDLG"], range(2011, 2012), {
    front: { DB1405: [9089], DB1849: [9091], DB2210: [9093], DB2402: [9095] },
    rear: { DB1449: [9090], DB1865: [9092], DB2211: [9094] },
  }),
];

const CORRECTION_SPECS = [
  correction("ap_2c66f94d555dbebd09ac", "D22", "Utility", "RWD", ["VG30E"], range(2000, 2004), range(2000, 2004),
    { front: { DB438: [1039] } }),
  correction("ap_7bbf3307bb9000c8b0ec", "D22", "Cab Chassis", "RWD", ["YD25DDTI", "YD25ETI"], range(2007, 2015), range(2007, 2015),
    { front: { DB1439: [1060], DB438: [1061] } }),
  correction("ap_7f9dc3571cf81d79c535", "D22", "Cab Chassis", "AWD", ["YD25DDTI"], range(2007, 2015), range(2007, 2015),
    { front: { DB1439: [1059] } }),
  correction("ap_9496c38d0bbe8970510a", "D22", "Utility", "AWD", ["VG33E"], range(2002, 2006), range(2002, 2006),
    { front: { DB1439: [1043] } }),
];

loadEnv(path.join(ROOT, ".env.local"));
assert(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } });

if (ROLLBACK_ARG) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, ROLLBACK_ARG.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const bendix = readBendixWorkbook();
assert(bendix.sha256 === EXPECTED_SOURCE_SHA256, `Bendix workbook changed: ${bendix.sha256}`);
const initial = await prepare();
writeOutputs(initial, "report-only");
console.log(JSON.stringify(summary(initial, "report-only"), null, 2));
if (!APPLY) process.exit(0);
assert(initial.blockers.length === 0, `Preflight blockers: ${JSON.stringify(initial.blockers)}`);
const fresh = await prepare();
assert(fresh.blockers.length === 0, `Fresh blockers: ${JSON.stringify(fresh.blockers)}`);
assert(initial.plan_hash === fresh.plan_hash, "Fresh plan changed after preflight; no writes issued.");
const backup = createBackup(fresh);
try {
  await applyPlan(fresh);
  const verification = await verify(fresh);
  const result = { ...summary(fresh, "apply"), backup_directory: relative(backup), verification };
  writeJson(path.join(OUT, "applied.json"), result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  writeJson(path.join(backup, "automatic-rollback-result.json"), restored);
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}

async function prepare() {
  const targets = [...OPTION_SPECS, ...CORRECTION_SPECS];
  const targetIds = targets.map((row) => row.application_id);
  const [applications, allApplications, years, seriesRows, variants, powertrains, engineLinks, engineCodes, referenceFitments,
    references, dataSource, productFitments, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", targetIds),
    fetchAll("vehicle_catalog_applications", "application_id,canonical_key,status"),
    selectIn("vehicle_catalog_application_years", "application_id", targetIds),
    fetchAll("vehicle_catalog_series", "series_id,code"),
    fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type"),
    fetchAll("vehicle_catalog_powertrains", "powertrain_id,display_name"),
    fetchAll("vehicle_catalog_powertrain_engine_codes", "powertrain_id,engine_code_id,is_primary"),
    fetchAll("vehicle_catalog_engine_codes", "engine_code_id,code"),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", targetIds),
    selectIn("catalog_part_references", "normalized_value", allDbValues(targets)),
    fetchSingle("catalog_data_sources", "*", (query) => query.eq("code", SOURCE_CODE)),
    selectIn("vehicle_catalog_product_fitments", "application_id", targetIds),
    selectIn("customer_vehicles", "vehicle_catalog_application_id", targetIds),
    selectIn("order_items", "vehicle_catalog_application_id", targetIds),
    selectIn("order_vehicle_snapshots", "vehicle_catalog_application_id", targetIds),
    selectIn("order_wiper_fulfillment", "vehicle_catalog_application_id", targetIds),
  ]);
  const blockers = [];
  if (applications.length !== targets.length) blockers.push({ reason: "missing_target_applications", expected: targets.length, actual: applications.length });
  if (!dataSource.active) blockers.push({ reason: "bendix_data_source_inactive" });
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const seriesById = new Map(seriesRows.map((row) => [row.series_id, row]));
  const variantById = new Map(variants.map((row) => [row.variant_id, row]));
  const engineCodeById = new Map(engineCodes.map((row) => [row.engine_code_id, compact(row.code)]));
  const engineLinksByPowertrain = groupBy(engineLinks, (row) => row.powertrain_id);
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const refByValue = new Map(references.map((row) => [row.normalized_value, row]));
  const refValueById = new Map(references.map((row) => [row.id, row.normalized_value]));
  const sourceByRow = new Map(bendix.uniqueRows.map((row) => [Number(row.sourceRowId), row]));
  const otherCanonicalKeys = new Set(allApplications.filter((row) => row.status === "active" && !targetIds.includes(row.application_id))
    .map((row) => row.canonical_key));
  const transactionIds = new Set([
    ...customerVehicles.map((row) => row.vehicle_catalog_application_id), ...orderItems.map((row) => row.vehicle_catalog_application_id),
    ...orderSnapshots.map((row) => row.vehicle_catalog_application_id), ...orderWipers.map((row) => row.vehicle_catalog_application_id),
  ]);
  const plan = [];
  for (const specRow of targets) {
    const application = appById.get(specRow.application_id);
    if (!application) continue;
    const series = seriesById.get(application.series_id)?.code ?? "";
    const variant = variantById.get(application.variant_id) ?? {};
    const appYears = (yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    const appEngineCodes = unique((engineLinksByPowertrain.get(application.powertrain_id) ?? [])
      .map((row) => engineCodeById.get(row.engine_code_id)).filter(Boolean));
    for (const [field, expected, actual] of [
      ["series", compact(specRow.series), compact(series)], ["body", compact(specRow.body), compact(variant.body_style)],
      ["drive", compact(specRow.drive), compact(variant.drive_type)],
    ]) if (expected !== actual) blockers.push({ application_id: specRow.application_id, reason: `${field}_changed`, expected, actual });
    if (!specRow.engine_codes.every((code) => appEngineCodes.includes(compact(code)))) blockers.push({ application_id: specRow.application_id,
      reason: "engine_codes_changed", expected: specRow.engine_codes, actual: appEngineCodes, display_name: powertrains.find((row) => row.powertrain_id === application.powertrain_id)?.display_name });
    if (!arrayEqual(appYears, specRow.current_years)) blockers.push({ application_id: specRow.application_id, reason: "application_years_changed",
      expected: specRow.current_years, actual: appYears });
    if (specRow.kind === "year_correction" && transactionIds.has(specRow.application_id)) blockers.push({ application_id: specRow.application_id,
      reason: "year_correction_has_transactional_reference" });
    const keptYears = specRow.keep_years;
    const removedYears = appYears.filter((year) => !keptYears.includes(year));
    const newCanonicalKey = [application.model_id, application.series_id, application.variant_id, application.powertrain_id,
      keptYears[0], keptYears.at(-1)].join("|");
    if (specRow.kind === "year_correction" && otherCanonicalKeys.has(newCanonicalKey)) blockers.push({ application_id: specRow.application_id,
      reason: "canonical_key_collision", new_canonical_key: newCanonicalKey });
    const allowedByPosition = {};
    for (const [position, dbMap] of Object.entries(specRow.positions)) {
      allowedByPosition[position] = [];
      for (const [dbValue, sourceRows] of Object.entries(dbMap)) {
        const reference = refByValue.get(dbValue);
        if (!reference || reference.product_type !== "brake_pad" || reference.reference_scheme !== "bendix_db") {
          blockers.push({ application_id: specRow.application_id, position, db_reference: dbValue, reason: "missing_or_invalid_part_reference" });
          continue;
        }
        if (!['active', 'to_be_discontinued'].includes(reference.lifecycle_status)) blockers.push({ application_id: specRow.application_id,
          position, db_reference: dbValue, reason: "inactive_part_reference", lifecycle_status: reference.lifecycle_status });
        const evidenceRows = sourceRows.map((rowId) => sourceByRow.get(rowId));
        if (evidenceRows.some((row) => !row || row.bendixReference !== dbValue || row.position !== position)) blockers.push({ application_id: specRow.application_id,
          position, db_reference: dbValue, source_rows: sourceRows, reason: "source_row_identity_changed" });
        const uncovered = keptYears.filter((year) => !evidenceRows.some((row) => row && year >= row.yearFrom && year <= row.yearTo));
        if (uncovered.length) blockers.push({ application_id: specRow.application_id, position, db_reference: dbValue,
          reason: "source_rows_do_not_cover_kept_years", uncovered_years: uncovered });
        const current = referenceFitments.find((row) => row.application_id === specRow.application_id && row.part_reference_id === reference.id
          && row.position === position && row.data_source_id === dataSource.id) ?? null;
        allowedByPosition[position].push({ db_reference: dbValue, part_reference_id: reference.id, data_source_id: dataSource.id,
          source_row_numbers: sourceRows, previous_row: current });
      }
      const allowedIds = new Set(allowedByPosition[position].map((row) => row.part_reference_id));
      const publishedOutside = referenceFitments.filter((row) => row.application_id === specRow.application_id && row.position === position
        && row.fitment_status === "published" && !allowedIds.has(row.part_reference_id));
      if (publishedOutside.length) blockers.push({ application_id: specRow.application_id, position, reason: "published_reference_outside_evidence_set",
        references: publishedOutside.map((row) => refValueById.get(row.part_reference_id) ?? row.part_reference_id) });
    }
    const rowsToReject = referenceFitments.filter((row) => row.application_id === specRow.application_id
      && Object.keys(allowedByPosition).includes(row.position)
      && !new Set(allowedByPosition[row.position].map((option) => option.part_reference_id)).has(row.part_reference_id)
      && row.fitment_status !== "rejected");
    plan.push({ ...specRow, application, current_years: appYears, kept_years: keptYears, removed_years: removedYears,
      current_canonical_key: application.canonical_key, new_canonical_key: newCanonicalKey, allowed_by_position: allowedByPosition,
      rows_to_reject: rowsToReject });
  }
  const targetIdSet = new Set(targetIds);
  const snapshot = {
    applications: applications.filter((row) => targetIdSet.has(row.application_id)), years,
    referenceFitments: referenceFitments.filter((row) => targetIdSet.has(row.application_id)), productFitments,
    customerVehicles, orderItems, orderSnapshots, orderWipers,
  };
  const productHash = semanticHash(productFitments);
  const publicPlan = plan.map(publicPlanRow);
  return { generated_at: new Date().toISOString(), blockers, plan, public_plan: publicPlan, snapshot, product_hash: productHash,
    source_sha256: bendix.sha256, plan_hash: stableHash(publicPlan) };
}

async function applyPlan(preflight) {
  for (const item of preflight.plan) {
    if (item.kind === "year_correction") {
      if (item.removed_years.length) {
        const { error } = await db.from("vehicle_catalog_application_years").delete().eq("application_id", item.application_id)
          .in("model_year", item.removed_years);
        if (error) throw error;
      }
      const { data, error } = await db.from("vehicle_catalog_applications").update({ year_from: item.kept_years[0], year_to: item.kept_years.at(-1),
        canonical_key: item.new_canonical_key, review_status: "approved" }).eq("application_id", item.application_id)
        .eq("canonical_key", item.current_canonical_key).select("application_id");
      if (error) throw error;
      assert((data ?? []).length === 1, `Concurrent application update: ${item.application_id}`);
    }
    for (const wrong of item.rows_to_reject) {
      const { error } = await db.from("vehicle_catalog_part_reference_fitments").update({ fitment_status: "rejected",
        match_reasons: unique([...(wrong.match_reasons ?? []), "superseded_by_exact_configuration_option_set"]),
        metadata: { ...(wrong.metadata ?? {}), rejected_by_policy: POLICY, rejected_at: new Date().toISOString() } })
        .eq("application_id", wrong.application_id).eq("part_reference_id", wrong.part_reference_id)
        .eq("position", wrong.position).eq("data_source_id", wrong.data_source_id);
      if (error) throw error;
    }
    for (const [position, options] of Object.entries(item.allowed_by_position)) {
      const optionValues = options.map((row) => row.db_reference).sort();
      const conditional = optionValues.length > 1;
      for (const option of options) {
        const payload = {
          application_id: item.application_id, part_reference_id: option.part_reference_id, position,
          data_source_id: option.data_source_id,
          fitment_status: "published", confidence: conditional ? "high" : "exact",
          source_row_numbers: option.source_row_numbers,
          match_reasons: conditional
            ? ["exact_platform_body_drive_engine_years", "authoritative_bendix_full_catalog", "evidence_backed_multiple_brake_configurations"]
            : ["exact_platform_body_drive_engine_years", "authoritative_bendix_full_catalog", "unique_reference_after_year_correction"],
          metadata: { policy_version: POLICY, source_code: SOURCE_CODE, source_sha256: preflight.source_sha256,
            selection_mode: conditional ? "conditional_one_of" : "deterministic", option_set: optionValues,
            configuration_confirmation_required: conditional, discriminator_hint: conditional ? "Confirm caliper / disc / PR or OEM configuration" : null,
            corrected_year_window: item.kind === "year_correction" ? [item.kept_years[0], item.kept_years.at(-1)] : null,
            product_write: false },
        };
        const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(payload,
          { onConflict: "application_id,part_reference_id,position,data_source_id" });
        if (error) throw error;
      }
    }
  }
}

async function verify(preflight) {
  const ids = preflight.plan.map((row) => row.application_id);
  const [applications, years, refs, products] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids),
  ]);
  const appById = new Map(applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupBy(years, (row) => row.application_id);
  const failures = [];
  for (const item of preflight.plan) {
    const actualYears = (yearsByApp.get(item.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    if (!arrayEqual(actualYears, item.kept_years)) failures.push({ application_id: item.application_id, reason: "year_readback_failed", actualYears });
    if (item.kind === "year_correction") {
      const app = appById.get(item.application_id);
      if (app?.year_from !== item.kept_years[0] || app?.year_to !== item.kept_years.at(-1) || app?.canonical_key !== item.new_canonical_key)
        failures.push({ application_id: item.application_id, reason: "application_bounds_readback_failed" });
    }
    for (const [position, options] of Object.entries(item.allowed_by_position)) {
      const expectedIds = options.map((row) => row.part_reference_id).sort();
      const published = refs.filter((row) => row.application_id === item.application_id && row.position === position && row.fitment_status === "published");
      const actualIds = published.map((row) => row.part_reference_id).sort();
      if (!arrayEqual(actualIds, expectedIds)) failures.push({ application_id: item.application_id, position,
        reason: "published_option_set_readback_failed", expectedIds, actualIds });
      const expectedMode = options.length > 1 ? "conditional_one_of" : "deterministic";
      if (published.some((row) => row.metadata?.policy_version !== POLICY || row.metadata?.selection_mode !== expectedMode))
        failures.push({ application_id: item.application_id, position, reason: "metadata_readback_failed" });
    }
  }
  const currentProductHash = semanticHash(products);
  if (currentProductHash !== preflight.product_hash) failures.push({ reason: "protected_product_layer_changed" });
  assert(failures.length === 0, `Verification failures: ${JSON.stringify(failures)}`);
  return { ok: true, verified_at: new Date().toISOString(), applications_verified: ids.length,
    conditional_applications: preflight.plan.filter((row) => Object.values(row.allowed_by_position).some((options) => options.length > 1)).length,
    deterministic_applications: preflight.plan.filter((row) => Object.values(row.allowed_by_position).every((options) => options.length === 1)).length,
    retained_application_years_2000_2026: sum(preflight.plan.map((row) => row.kept_years.filter(inScope).length)),
    removed_application_years_2000_2026: sum(preflight.plan.map((row) => row.removed_years.filter(inScope).length)),
    product_layer_unchanged: true, product_fitment_sha256: currentProductHash };
}

function createBackup(preflight) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(ROOT, "tmp", "production-backups", `brake-five-highfleet-options-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, value] of Object.entries(preflight.snapshot)) writeJson(path.join(directory, `${name}.json`), value);
  writeJson(path.join(directory, "plan.json"), preflight.public_plan);
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY,
    rollback_command: `node scripts/catalog/publish-five-highfleet-brake-options-20261025.mjs --rollback=${relative(directory)}` });
  return directory;
}

async function rollback(directory, automatic = false) {
  const allowed = path.join(ROOT, "tmp", "production-backups");
  assert(directory.startsWith(`${allowed}${path.sep}`) && path.basename(directory).startsWith("brake-five-highfleet-options-"), "Invalid rollback directory.");
  const applicationsBefore = readJson(path.join(directory, "applications.json"));
  const yearsBefore = readJson(path.join(directory, "years.json"));
  const refsBefore = readJson(path.join(directory, "referenceFitments.json"));
  const productsBefore = readJson(path.join(directory, "productFitments.json"));
  const ids = applicationsBefore.map((row) => row.application_id);
  for (const row of applicationsBefore) {
    const { error } = await db.from("vehicle_catalog_applications").update({ year_from: row.year_from, year_to: row.year_to,
      year_status: row.year_status, canonical_key: row.canonical_key, status: row.status, review_status: row.review_status })
      .eq("application_id", row.application_id);
    if (error) throw error;
  }
  let result = await db.from("vehicle_catalog_application_years").delete().in("application_id", ids); if (result.error) throw result.error;
  if (yearsBefore.length) { result = await db.from("vehicle_catalog_application_years").insert(yearsBefore); if (result.error) throw result.error; }
  result = await db.from("vehicle_catalog_part_reference_fitments").delete().in("application_id", ids); if (result.error) throw result.error;
  if (refsBefore.length) { result = await db.from("vehicle_catalog_part_reference_fitments").insert(refsBefore); if (result.error) throw result.error; }
  const [appsNow, yearsNow, refsNow, productsNow] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id", ids), selectIn("vehicle_catalog_application_years", "application_id", ids),
    selectIn("vehicle_catalog_part_reference_fitments", "application_id", ids), selectIn("vehicle_catalog_product_fitments", "application_id", ids),
  ]);
  const checks = { applications_restored: semanticHash(appsNow) === semanticHash(applicationsBefore),
    years_restored: semanticHash(yearsNow) === semanticHash(yearsBefore), refs_restored: semanticHash(refsNow) === semanticHash(refsBefore),
    product_layer_unchanged: semanticHash(productsNow) === semanticHash(productsBefore) };
  assert(Object.values(checks).every(Boolean), `Rollback verification failed: ${JSON.stringify(checks)}`);
  const output = { verified: true, automatic, rolled_back_at: new Date().toISOString(), checks };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), output);
  return output;
}

function summary(preflight, mode) {
  const relationships = sum(preflight.plan.flatMap((row) => Object.values(row.allowed_by_position)).map((rows) => rows.length));
  return { generated_at: preflight.generated_at, mode, policy: POLICY, source_sha256: preflight.source_sha256,
    production_writes: mode === "apply", applications: preflight.plan.length, reference_relationships: relationships,
    conditional_one_of_applications: preflight.plan.filter((row) => Object.values(row.allowed_by_position).some((rows) => rows.length > 1)).length,
    deterministic_applications: preflight.plan.filter((row) => Object.values(row.allowed_by_position).every((rows) => rows.length === 1)).length,
    restored_knowledge_application_years_2000_2026: sum(preflight.plan.map((row) => row.kept_years.filter(inScope).length)),
    corrected_applications: preflight.plan.filter((row) => row.kind === "year_correction").length,
    invalid_application_years_removed_2000_2026: sum(preflight.plan.map((row) => row.removed_years.filter(inScope).length)),
    rejected_stale_review_rows: sum(preflight.plan.map((row) => row.rows_to_reject.length)), product_writes: 0,
    blockers: preflight.blockers, plan_sha256: preflight.plan_hash };
}

function writeOutputs(preflight, mode) {
  fs.mkdirSync(OUT, { recursive: true });
  writeJson(path.join(OUT, "preflight-summary.json"), summary(preflight, mode));
  writeJsonl(path.join(OUT, "publication-plan.jsonl"), preflight.public_plan);
  writeJson(path.join(OUT, "blockers.json"), preflight.blockers);
}

function publicPlanRow(row) {
  return { kind: row.kind, make: row.make, model: row.model, application_id: row.application_id, series: row.series, body: row.body,
    drive: row.drive, engine_codes: row.engine_codes, current_years: row.current_years, kept_years: row.kept_years,
    removed_years: row.removed_years, positions: Object.fromEntries(Object.entries(row.allowed_by_position).map(([position, options]) => [position,
      options.map((option) => ({ db_reference: option.db_reference, source_row_numbers: option.source_row_numbers,
        previous_status: option.previous_row?.fitment_status ?? null }))])),
    selection_mode_by_position: Object.fromEntries(Object.entries(row.allowed_by_position).map(([position, options]) => [position,
      options.length > 1 ? "conditional_one_of" : "deterministic"])),
    current_canonical_key: row.current_canonical_key, new_canonical_key: row.new_canonical_key,
    stale_rows_to_reject: row.rows_to_reject.map((item) => ({ part_reference_id: item.part_reference_id, position: item.position,
      fitment_status: item.fitment_status })), product_write: false };
}

function spec(make, model, applicationId, series, body, drive, engineCodes, years, positions) {
  return { kind: "option_publication", make, model, application_id: applicationId, series, body, drive,
    engine_codes: engineCodes, current_years: years, keep_years: years, positions };
}
function correction(applicationId, series, body, drive, engineCodes, currentYears, keptYears, positions) {
  return { kind: "year_correction", make: "Nissan", model: "Navara", application_id: applicationId, series, body, drive,
    engine_codes: engineCodes, current_years: currentYears, keep_years: keptYears, positions };
}
function allDbValues(rows) { return unique(rows.flatMap((row) => Object.values(row.positions).flatMap((position) => Object.keys(position)))); }
function range(from, to) { return Array.from({ length: to - from + 1 }, (_, index) => from + index); }
function inScope(year) { return year >= 2000 && year <= 2026; }
function compact(value) { return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupBy(values, keyFn) { const map = new Map(); for (const value of values) { const key = keyFn(value); const rows = map.get(key) ?? []; rows.push(value); map.set(key, rows); } return map; }
function arrayEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sum(values) { return values.reduce((total, value) => total + Number(value || 0), 0); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function semanticHash(rows) { return stableHash(rows.map((row) => { const { created_at, updated_at, ...rest } = row; return rest; })); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function relative(value) { return path.relative(ROOT, value).replaceAll("\\", "/"); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, values) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, values.map(JSON.stringify).join("\n") + (values.length ? "\n" : "")); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) return output; } }
async function selectIn(table, field, values) { const output = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select("*").in(field, batch).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return output; }
async function fetchSingle(table, columns, filter) { const { data, error } = await filter(db.from(table).select(columns)).single(); if (error) throw error; return data; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
