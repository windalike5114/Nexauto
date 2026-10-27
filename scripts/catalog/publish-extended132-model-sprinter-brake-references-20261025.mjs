import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const INPUT = path.resolve(ROOT, "outputs/extended132-model-sprinter-brake-20261025/ready-reference-fitments.jsonl");
const BASELINE = path.resolve(ROOT, "outputs/extended132-model-sprinter-brake-20261025/summary.json");
const OUTPUT_DIR = path.resolve(ROOT, "outputs/extended132-model-sprinter-brake-20261025/reference-publication");
const SOURCE_CODE = "BENDIX_NZ_FULL_FITMENT_V1";
const POLICY = "EXTENDED132_SPRINTER_STRICT_REFERENCE_PUBLICATION_V1_2026_10_25";
const EXPECTED = { groups: 41, relationships: 175, applications: 160, safeApplicationYears: 1020, scopeApplicationYears: 1218 };

const argv = process.argv.slice(2);
const unknown = argv.filter((arg) => arg !== "--apply" && !arg.startsWith("--rollback="));
if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
const apply = argv.includes("--apply");
const rollbackArg = argv.find((arg) => arg.startsWith("--rollback="));
if (apply && rollbackArg) throw new Error("Choose --apply or --rollback=<backup-directory>, not both.");

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase production credentials.");
}
if (!fs.existsSync(INPUT) || !fs.existsSync(BASELINE)) throw new Error("Missing Sprinter report inputs.");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

if (rollbackArg) {
  const result = await rollbackFromBackup(path.resolve(ROOT, rollbackArg.slice("--rollback=".length)));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const inputGroups = validateInput(readJsonl(INPUT), JSON.parse(fs.readFileSync(BASELINE, "utf8")));
const initialSnapshot = await loadSnapshot(inputGroups);
const initial = prepare(inputGroups, initialSnapshot);
writeReport(initial, apply ? "apply-preflight" : "report-only");

if (initial.blockers.length) {
  throw new Error(`Fresh production preflight found ${initial.blockers.length} blocker(s); no writes issued.`);
}
if (!apply) {
  console.log(JSON.stringify(publicSummary(initial, "report-only"), null, 2));
  process.exit(0);
}

// Apply always re-reads production after the report was built. Any changed
// target, conflict, source identity, or plan key aborts before the first write.
const freshSnapshot = await loadSnapshot(inputGroups);
const fresh = prepare(inputGroups, freshSnapshot);
if (fresh.blockers.length) throw new Error(`Fresh apply recheck found ${fresh.blockers.length} blocker(s); no writes issued.`);
if (fresh.plan_hash !== initial.plan_hash) throw new Error("Fresh apply plan differs from report-only preflight; no writes issued.");

const backupDirectory = writeBackup(fresh);
let applied;
try {
  applied = await applyPlan(fresh, backupDirectory);
} catch (error) {
  const rollback = await rollbackFromBackup(backupDirectory, true).catch((rollbackError) => ({
    completed: false,
    error: rollbackError.message
  }));
  writeJson(path.join(backupDirectory, "automatic-rollback-result.json"), rollback);
  throw new Error(`Apply failed and was stopped: ${error.message}. Automatic rollback completed=${rollback.completed}. Backup=${path.relative(ROOT, backupDirectory)}`);
}
writeJson(path.join(OUTPUT_DIR, "applied.json"), applied);
console.log(JSON.stringify(applied, null, 2));

function validateInput(rows, baseline) {
  const errors = [];
  if (rows.length !== EXPECTED.groups) errors.push(`groups=${rows.length}, expected ${EXPECTED.groups}`);
  if (baseline?.coverage?.safe_new_application_years !== EXPECTED.safeApplicationYears) errors.push("baseline safe AY changed");
  if (baseline?.scope?.application_years !== EXPECTED.scopeApplicationYears) errors.push("baseline scope AY changed");
  const keys = new Set();
  let relationships = 0;
  for (const [index, row] of rows.entries()) {
    const candidate = row.candidate_db ?? [];
    if (row.decision !== "ready" || row.production_write !== false || row.proposed_nbp !== null) errors.push(`row ${index + 1} is not reference-only ready evidence`);
    if (!/^(front|rear)$/.test(row.position ?? "")) errors.push(`row ${index + 1} has invalid position`);
    if (candidate.length !== 1 || !/^DB\d+[A-Z]?$/.test(candidate[0])) errors.push(`row ${index + 1} must have exactly one DB reference`);
    if (!row.platform || !row.body || !row.drive || !(row.source_rows ?? []).length || !(row.source_year_ranges ?? []).length) errors.push(`row ${index + 1} lacks strict evidence fields`);
    for (const applicationId of row.application_ids ?? []) {
      const key = `${applicationId}|${row.position}`;
      if (keys.has(key)) errors.push(`duplicate application-position ${key}`);
      keys.add(key);
      relationships += 1;
    }
    if ((row.application_ids ?? []).length !== row.applications) errors.push(`row ${index + 1} application count mismatch`);
  }
  if (relationships !== EXPECTED.relationships) errors.push(`relationships=${relationships}, expected ${EXPECTED.relationships}`);
  if (errors.length) throw new Error(`Sprinter input validation failed: ${errors.join("; ")}`);
  return rows;
}

async function loadSnapshot(groups) {
  const applicationIds = unique(groups.flatMap((row) => row.application_ids));
  const [applications, years, dataSources, schemes, productLines] = await Promise.all([
    selectIn("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,powertrain_id,status", "application_id", applicationIds),
    selectIn("vehicle_catalog_application_years", "application_id,model_year", "application_id", applicationIds),
    selectAll(db.from("catalog_data_sources").select("id,code,name,active,metadata").eq("code", SOURCE_CODE)),
    selectAll(db.from("catalog_reference_schemes").select("product_type,code,active").eq("product_type", "brake_pad").eq("code", "bendix_db")),
    selectAll(db.from("catalog_product_lines").select("code,category_slug,reference_layer_enabled,active").eq("code", "brake_pad"))
  ]);
  const modelIds = unique(applications.map((row) => row.model_id));
  const seriesIds = unique(applications.map((row) => row.series_id));
  const variantIds = unique(applications.map((row) => row.variant_id));
  const [models, series, variants, referenceFitments, productFitments] = await Promise.all([
    selectIn("vehicle_catalog_models", "model_id,make_id,name,status", "model_id", modelIds),
    selectIn("vehicle_catalog_series", "series_id,code,display_name", "series_id", seriesIds),
    selectIn("vehicle_catalog_variants", "variant_id,body_style,drive_type,display_name", "variant_id", variantIds),
    selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", applicationIds),
    selectIn("vehicle_catalog_product_fitments", "*", "application_id", applicationIds)
  ]);
  const makeIds = unique(models.map((row) => row.make_id));
  const referenceIds = unique(referenceFitments.map((row) => row.part_reference_id));
  const fitmentVariantIds = unique(productFitments.map((row) => row.product_variant_id));
  const candidateDbs = unique(groups.flatMap((row) => row.candidate_db));
  const [makes, fitmentReferences, candidateReferences, productVariants, identifiers] = await Promise.all([
    selectIn("vehicle_catalog_makes", "make_id,name,status", "make_id", makeIds),
    selectIn("catalog_part_references", "*", "id", referenceIds),
    selectAll(db.from("catalog_part_references").select("*").eq("product_type", "brake_pad").eq("reference_scheme", "bendix_db").in("normalized_value", candidateDbs)),
    selectIn("product_variants", "id,product_id,sku,active,attributes", "id", fitmentVariantIds),
    selectIn("product_identifiers", "product_variant_id,identifier_type,normalized_value,verification_status", "product_variant_id", fitmentVariantIds)
  ]);
  const productIds = unique(productVariants.map((row) => row.product_id));
  const products = await selectIn("products", "id,category_slug,active", "id", productIds);
  return { fetched_at: new Date().toISOString(), applicationIds, applications, years, dataSources, schemes, productLines, models, series, variants,
    makes, referenceFitments, productFitments, fitmentReferences, candidateReferences, productVariants, identifiers, products };
}

function prepare(groups, snapshot) {
  const blockers = [];
  const appById = new Map(snapshot.applications.map((row) => [row.application_id, row]));
  const yearsByApp = groupArray(snapshot.years, (row) => row.application_id);
  const modelById = new Map(snapshot.models.map((row) => [row.model_id, row]));
  const makeById = new Map(snapshot.makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(snapshot.series.map((row) => [row.series_id, row]));
  const variantById = new Map(snapshot.variants.map((row) => [row.variant_id, row]));
  const refById = new Map([...snapshot.fitmentReferences, ...snapshot.candidateReferences].map((row) => [row.id, row]));
  const candidateRefByDb = new Map(snapshot.candidateReferences.map((row) => [row.normalized_value, row]));
  const productVariantById = new Map(snapshot.productVariants.map((row) => [row.id, row]));
  const productById = new Map(snapshot.products.map((row) => [row.id, row]));
  const dbsByVariant = groupSet(snapshot.identifiers.filter((row) => row.identifier_type === "cross_reference" && row.verification_status !== "rejected" && /^DB\d+[A-Z]?$/.test(row.normalized_value ?? "")), (row) => row.product_variant_id, (row) => row.normalized_value);

  if (snapshot.dataSources.length !== 1 || snapshot.dataSources[0].active !== true) blockers.push(blocker("bendix_data_source_missing_or_inactive", snapshot.dataSources));
  if (snapshot.schemes.length !== 1 || snapshot.schemes[0].active !== true) blockers.push(blocker("bendix_reference_scheme_missing_or_inactive", snapshot.schemes));
  if (snapshot.productLines.length !== 1 || snapshot.productLines[0].active !== true || snapshot.productLines[0].reference_layer_enabled !== true) blockers.push(blocker("brake_pad_reference_layer_inactive", snapshot.productLines));
  if (snapshot.applicationIds.length !== EXPECTED.applications) blockers.push(blocker("target_application_count_changed", snapshot.applicationIds.length));

  const validations = [];
  const relations = [];
  for (const [groupIndex, group] of groups.entries()) {
    const liveGroupYears = [];
    for (const applicationId of group.application_ids) {
      const application = appById.get(applicationId);
      const model = modelById.get(application?.model_id);
      const make = makeById.get(model?.make_id);
      const series = seriesById.get(application?.series_id);
      const variant = variantById.get(application?.variant_id);
      const appYears = (yearsByApp.get(applicationId) ?? []).map((row) => Number(row.model_year)).filter((year) => year >= 2000 && year <= 2026).sort((a, b) => a - b);
      liveGroupYears.push(...appYears);
      const expectedDb = group.candidate_db[0];
      const candidateReference = candidateRefByDb.get(expectedDb) ?? null;
      const publishedReferenceRows = snapshot.referenceFitments.filter((row) => row.application_id === applicationId && row.position === group.position && row.fitment_status === "published")
        .map((row) => ({ ...row, db: refById.get(row.part_reference_id)?.product_type === "brake_pad" ? refById.get(row.part_reference_id)?.normalized_value : null }))
        .filter((row) => row.db);
      const differentPublishedReferences = publishedReferenceRows.filter((row) => row.db !== expectedDb);
      const samePublishedReferences = publishedReferenceRows.filter((row) => row.db === expectedDb);
      const publishedBrakeProducts = snapshot.productFitments.filter((row) => {
        if (row.application_id !== applicationId || row.position !== group.position || row.fitment_status !== "published") return false;
        const product = productById.get(productVariantById.get(row.product_variant_id)?.product_id);
        return product?.category_slug === "brake-pad";
      });
      const productConflicts = publishedBrakeProducts.filter((row) => {
        const dbs = dbsByVariant.get(row.product_variant_id) ?? new Set();
        return !dbs.has(expectedDb);
      }).map((row) => ({ product_variant_id: row.product_variant_id, sku: productVariantById.get(row.product_variant_id)?.sku,
        dbs: [...(dbsByVariant.get(row.product_variant_id) ?? [])] }));
      const targetKeyRow = candidateReference && snapshot.referenceFitments.find((row) => row.application_id === applicationId
        && row.position === group.position && row.part_reference_id === candidateReference.id && row.data_source_id === snapshot.dataSources[0]?.id);
      const checks = [
        check("application_active", application?.status === "active", application?.status ?? "missing"),
        check("make_is_mercedes_benz", clean(make?.name) === "mercedes-benz", make?.name ?? "missing"),
        check("model_is_sprinter_3_5t", compact(model?.name) === "sprinter35t", model?.name ?? "missing"),
        check("series_unchanged", clean(series?.code ?? series?.display_name) === clean(group.platform), series ?? null),
        check("body_unchanged", clean(variant?.body_style) === clean(group.body), variant?.body_style ?? "missing"),
        check("drive_unchanged", clean(variant?.drive_type) === clean(group.drive), variant?.drive_type ?? "missing"),
        check("has_scoped_years", appYears.length > 0, appYears),
        check("candidate_reference_unique", !candidateReference || snapshot.candidateReferences.filter((row) => row.normalized_value === expectedDb).length === 1, candidateReference),
        check("candidate_reference_usable", !candidateReference || candidateReference.lifecycle_status !== "discontinued", candidateReference?.lifecycle_status ?? "will_insert_unknown"),
        check("no_different_published_reference", differentPublishedReferences.length === 0, differentPublishedReferences.map((row) => row.db)),
        check("no_unknown_or_different_published_product", productConflicts.length === 0, productConflicts)
      ];
      const safe = checks.every((row) => row.pass);
      if (!safe) blockers.push(blocker("application_position_preflight_failed", { application_id: applicationId, position: group.position, checks: checks.filter((row) => !row.pass) }));
      let operation = "insert";
      if (samePublishedReferences.length) operation = "noop";
      else if (targetKeyRow) operation = "update";
      validations.push({ application_id: applicationId, position: group.position, expected_db: expectedDb, years: appYears, operation, safe, checks });
      relations.push({ application_id: applicationId, position: group.position, normalized_value: expectedDb, years: appYears,
        operation, part_reference_id: candidateReference?.id ?? null, previous_row: targetKeyRow ?? null, group_index: groupIndex + 1,
        evidence: { platform: group.platform, body: group.body, drive: group.drive, source_rows: group.source_rows, source_year_ranges: group.source_year_ranges } });
    }
    const actualGroupYears = liveGroupYears.length;
    const actualYearUnion = unique(liveGroupYears).sort((a, b) => a - b);
    if (actualGroupYears !== group.application_years || !equalArrays(actualYearUnion, group.years)) {
      blockers.push(blocker("group_years_changed", { group_index: groupIndex + 1, expected_application_years: group.application_years,
        actual_application_years: actualGroupYears, expected_years: group.years, actual_years: actualYearUnion }));
    }
  }

  const uniqueApplicationYears = new Set(relations.flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  if (uniqueApplicationYears.size !== EXPECTED.safeApplicationYears) blockers.push(blocker("safe_application_years_changed", uniqueApplicationYears.size));
  const priorKnowledgeApplications = new Set(snapshot.referenceFitments.filter((row) => row.fitment_status === "published" && refById.get(row.part_reference_id)?.product_type === "brake_pad").map((row) => row.application_id));
  for (const row of snapshot.productFitments.filter((row) => row.fitment_status === "published")) {
    const product = productById.get(productVariantById.get(row.product_variant_id)?.product_id);
    if (product?.category_slug === "brake-pad" && (dbsByVariant.get(row.product_variant_id)?.size ?? 0) > 0) priorKnowledgeApplications.add(row.application_id);
  }
  const newKnowledgeApplicationYears = new Set(relations.filter((row) => !priorKnowledgeApplications.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const writes = relations.filter((row) => row.operation !== "noop");
  const noops = relations.filter((row) => row.operation === "noop");
  const missingReferences = unique(relations.filter((row) => !row.part_reference_id).map((row) => row.normalized_value));
  const productPreimageHash = stableHash(snapshot.productFitments);
  const planHash = stableHash({ source: SOURCE_CODE, policy: POLICY, writes: writes.map(publicRelation), noops: noops.map(publicRelation), missingReferences });
  return {
    generated_at: new Date().toISOString(), snapshot, validations, blockers, writes, noops, missing_references: missingReferences,
    unique_application_years: uniqueApplicationYears.size, safe_new_application_years: newKnowledgeApplicationYears.size,
    coverage_uplift_percentage_points: percent(newKnowledgeApplicationYears.size, EXPECTED.scopeApplicationYears),
    product_preimage_hash: productPreimageHash, plan_hash: planHash
  };
}

function writeReport(prepared, mode) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const summary = publicSummary(prepared, mode);
  writeJson(path.join(OUTPUT_DIR, "summary.json"), summary);
  writeJsonl(path.join(OUTPUT_DIR, "plan.jsonl"), [...prepared.writes, ...prepared.noops].map(publicRelation));
  writeJsonl(path.join(OUTPUT_DIR, "validation-results.jsonl"), prepared.validations);
  writeJsonl(path.join(OUTPUT_DIR, "blockers.jsonl"), prepared.blockers);
  writeJson(path.join(OUTPUT_DIR, "backup-rollback-plan.json"), {
    generated_at: prepared.generated_at,
    apply_requires_explicit_flag: true,
    backup_directory_template: "tmp/production-backups/extended132-sprinter-brake-reference-<UTC timestamp>",
    mutable_tables: ["catalog_part_references", "vehicle_catalog_part_reference_fitments"],
    protected_tables: ["vehicle_catalog_product_fitments", "products", "product_variants", "catalog_part_reference_products"],
    rollback_command_template: "node scripts/catalog/publish-extended132-model-sprinter-brake-references-20261025.mjs --rollback=tmp/production-backups/extended132-sprinter-brake-reference-<UTC timestamp>",
    rollback_rule: "Restore updated fitment preimages, delete only journaled inserted fitment keys, then delete only journaled reference rows that remain unlinked; verify every journaled key."
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, "README"), `Sprinter brake-pad reference publication\n\nDefault: report-only.\nApply (not run by this report): node scripts/catalog/publish-extended132-model-sprinter-brake-references-20261025.mjs --apply\nRollback: use the exact command recorded in an apply backup manifest.\n\nOnly catalog_part_references and vehicle_catalog_part_reference_fitments are mutable. No NBP/product row or reference-product link is created.\nFresh identity, year, reference and product conflicts are checked before any apply write.\n`);
}

function publicSummary(prepared, mode) {
  return {
    generated_at: prepared.generated_at,
    mode,
    production_writes_executed: mode === "report-only" ? 0 : null,
    source_code: SOURCE_CODE,
    policy: POLICY,
    input: fileIdentity(INPUT),
    scope: { model: "Mercedes-Benz Sprinter 3,5-t", years: [2000, 2026], applications: EXPECTED.applications,
      application_years: EXPECTED.scopeApplicationYears, ready_application_years: prepared.unique_application_years },
    plan: { groups: EXPECTED.groups, relationships: prepared.writes.length + prepared.noops.length, inserts: prepared.writes.filter((row) => row.operation === "insert").length,
      updates: prepared.writes.filter((row) => row.operation === "update").length, noops: prepared.noops.length,
      missing_reference_rows_to_insert: prepared.missing_references.length, candidate_dbs: unique([...prepared.writes, ...prepared.noops].map((row) => row.normalized_value)) },
    fresh_preflight: { safe: prepared.blockers.length === 0, blockers: prepared.blockers.length, fetched_at: prepared.snapshot.fetched_at,
      data_source_id: prepared.snapshot.dataSources[0]?.id ?? null },
    coverage: { safe_new_application_years: prepared.safe_new_application_years,
      estimated_uplift_percentage_points: prepared.coverage_uplift_percentage_points,
      ceiling_application_years: EXPECTED.safeApplicationYears, ceiling_percentage_points: percent(EXPECTED.safeApplicationYears, EXPECTED.scopeApplicationYears) },
    plan_sha256: prepared.plan_hash,
    safeguards: [
      "Default invocation is report-only; only explicit --apply can mutate production.",
      "Apply re-reads every target and aborts the entire batch before writing if the fresh plan differs or any conflict exists.",
      "Only brake-pad reference identities and reference fitments are writable; no NBP, product fitment, or reference-product link is created.",
      "Apply writes a preimage backup and durable journal; any failed write/readback triggers compensating rollback and stops.",
      "Apply verifies product-layer target rows are byte-stable under canonical hashing."
    ]
  };
}

function writeBackup(prepared) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp/production-backups", `extended132-sprinter-brake-reference-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const payloads = {
    "reference-fitments.preimage.json": prepared.snapshot.referenceFitments,
    "candidate-references.preimage.json": prepared.snapshot.candidateReferences,
    "product-fitments.protected-snapshot.json": prepared.snapshot.productFitments,
    "applications.preflight.json": prepared.snapshot.applications,
    "application-years.preflight.json": prepared.snapshot.years,
    "plan.json": { plan_hash: prepared.plan_hash, writes: prepared.writes.map(publicRelation), noops: prepared.noops.map(publicRelation) },
    "journal.json": { source_code: SOURCE_CODE, policy: POLICY, started_at: new Date().toISOString(), completed: false, operations: [] }
  };
  const files = [];
  for (const [name, value] of Object.entries(payloads)) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(path.join(directory, name), content);
    files.push({ name, bytes: Buffer.byteLength(content), sha256: sha256(content) });
  }
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), source_code: SOURCE_CODE, policy: POLICY,
    plan_hash: prepared.plan_hash, product_preimage_hash: prepared.product_preimage_hash, files,
    rollback_command: `node scripts/catalog/publish-extended132-model-sprinter-brake-references-20261025.mjs --rollback=${path.relative(ROOT, directory).replaceAll("\\", "/")}` });
  return directory;
}

async function applyPlan(prepared, backupDirectory) {
  const journalFile = path.join(backupDirectory, "journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  journal.run_id = journal.run_id ?? crypto.randomUUID();
  persistJournal(journalFile, journal);
  const sourceId = prepared.snapshot.dataSources[0].id;
  const referenceIdByDb = new Map(prepared.snapshot.candidateReferences.map((row) => [row.normalized_value, row.id]));
  for (const dbValue of prepared.missing_references) {
    const id = crypto.randomUUID();
    const payload = { id, product_type: "brake_pad", reference_scheme: "bendix_db", reference_value: dbValue, normalized_value: dbValue,
      lifecycle_status: "unknown", metadata: { source_code: SOURCE_CODE, policy: POLICY, apply_run_id: journal.run_id, reference_only: true, proposed_nbp: null } };
    const entry = { operation: "insert_reference", id, normalized_value: dbValue, state: "pending" };
    journal.operations.push(entry);
    persistJournal(journalFile, journal);
    const { error } = await db.from("catalog_part_references").insert(payload);
    if (error) throw error;
    entry.state = "applied";
    persistJournal(journalFile, journal);
    referenceIdByDb.set(dbValue, id);
  }
  for (const row of prepared.writes) {
    const partReferenceId = referenceIdByDb.get(row.normalized_value);
    if (!partReferenceId) throw new Error(`Missing reference id for ${row.normalized_value}`);
    const payload = { application_id: row.application_id, part_reference_id: partReferenceId, position: row.position, data_source_id: sourceId,
      import_batch_id: null, fitment_status: "published", confidence: "high", source_row_numbers: row.evidence.source_rows,
      match_reasons: ["strict_sprinter_generation", "exact_body", "exact_drive", "exact_position", "complete_source_year_coverage", "unique_db_no_live_conflict"],
      metadata: { source_code: SOURCE_CODE, policy: POLICY, apply_run_id: journal.run_id, reference_only: true, proposed_nbp: null, platform: row.evidence.platform,
        body: row.evidence.body, drive: row.evidence.drive, source_year_ranges: row.evidence.source_year_ranges } };
    if (row.operation === "update") {
      const entry = { operation: "update_fitment", key: fitmentKey(payload), previous_row: row.previous_row, state: "pending" };
      journal.operations.push(entry);
      persistJournal(journalFile, journal);
      const { data, error } = await db.from("vehicle_catalog_part_reference_fitments").update(payload)
        .eq("application_id", row.application_id).eq("part_reference_id", partReferenceId).eq("position", row.position).eq("data_source_id", sourceId)
        .eq("updated_at", row.previous_row.updated_at).select("application_id");
      if (error) throw error;
      if ((data ?? []).length !== 1) throw new Error(`Concurrent update blocked ${row.application_id}|${row.position}|${row.normalized_value}`);
      entry.state = "applied";
    } else {
      const entry = { operation: "insert_fitment", key: fitmentKey(payload), state: "pending" };
      journal.operations.push(entry);
      persistJournal(journalFile, journal);
      const { error } = await db.from("vehicle_catalog_part_reference_fitments").insert(payload);
      if (error) throw error;
      entry.state = "applied";
    }
    persistJournal(journalFile, journal);
  }
  const verification = await verifyApplied(prepared, referenceIdByDb);
  journal.completed = true;
  journal.completed_at = new Date().toISOString();
  journal.verification = verification;
  persistJournal(journalFile, journal);
  return { applied_at: journal.completed_at, source_code: SOURCE_CODE, policy: POLICY,
    backup_directory: path.relative(ROOT, backupDirectory).replaceAll("\\", "/"), writes: prepared.writes.length, noops: prepared.noops.length,
    references_inserted: prepared.missing_references.length, verification };
}

async function verifyApplied(prepared, referenceIdByDb) {
  const freshFitments = await selectIn("vehicle_catalog_part_reference_fitments", "*", "application_id", prepared.snapshot.applicationIds);
  const freshReferenceIds = unique(freshFitments.map((row) => row.part_reference_id));
  const freshReferences = await selectIn("catalog_part_references", "id,product_type,reference_scheme,normalized_value", "id", freshReferenceIds);
  const freshReferenceById = new Map(freshReferences.map((row) => [row.id, row]));
  for (const row of [...prepared.writes, ...prepared.noops]) {
    const id = referenceIdByDb.get(row.normalized_value) ?? row.part_reference_id;
    const matches = freshFitments.filter((item) => item.application_id === row.application_id && item.position === row.position
      && item.part_reference_id === id && item.fitment_status === "published");
    if (!matches.length) throw new Error(`Readback missing published ${row.application_id}|${row.position}|${row.normalized_value}`);
    const conflictingDbs = unique(freshFitments.filter((item) => item.application_id === row.application_id && item.position === row.position
      && item.fitment_status === "published" && freshReferenceById.get(item.part_reference_id)?.product_type === "brake_pad")
      .map((item) => freshReferenceById.get(item.part_reference_id)?.normalized_value).filter((value) => value !== row.normalized_value));
    if (conflictingDbs.length) throw new Error(`Readback found conflicting DB(s) for ${row.application_id}|${row.position}: ${conflictingDbs.join(",")}`);
  }
  const freshProducts = await selectIn("vehicle_catalog_product_fitments", "*", "application_id", prepared.snapshot.applicationIds);
  const productHash = stableHash(freshProducts);
  if (productHash !== prepared.product_preimage_hash) throw new Error("Protected product-fitment layer changed during apply.");
  return { verified_at: new Date().toISOString(), published_relationships: prepared.writes.length + prepared.noops.length,
    product_layer_unchanged: true, product_layer_sha256: productHash };
}

async function rollbackFromBackup(directory, automatic = false) {
  const allowedRoot = path.resolve(ROOT, "tmp/production-backups");
  if (!directory.startsWith(`${allowedRoot}${path.sep}`) || !path.basename(directory).startsWith("extended132-sprinter-brake-reference-")) {
    throw new Error("Rollback path is outside the Sprinter reference backup namespace.");
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
  const journalFile = path.join(directory, "journal.json");
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  if (manifest.source_code !== SOURCE_CODE || manifest.policy !== POLICY || journal.source_code !== SOURCE_CODE || journal.policy !== POLICY) {
    throw new Error("Rollback manifest identity mismatch.");
  }
  const actions = [];
  for (const entry of [...journal.operations].reverse()) {
    if (entry.operation === "insert_fitment") {
      const current = await exactFitment(entry.key);
      const owned = current.filter((row) => row.metadata?.apply_run_id === journal.run_id);
      if (owned.length) { const { error } = await deleteFitment(entry.key); if (error) throw error; }
      actions.push({ operation: "delete_inserted_fitment", key: entry.key, deleted: owned.length });
    } else if (entry.operation === "update_fitment") {
      const current = await exactFitment(entry.key);
      const owned = current.length === 1 && current[0].metadata?.apply_run_id === journal.run_id;
      if (entry.state === "applied" || owned) {
        const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(entry.previous_row,
          { onConflict: "application_id,part_reference_id,position,data_source_id" });
        if (error) throw error;
      }
      actions.push({ operation: "restore_fitment_preimage", key: entry.key, restored: entry.state === "applied" || owned });
    } else if (entry.operation === "insert_reference") {
      const [referenceRows, fitmentUse, productUse] = await Promise.all([
        selectAll(db.from("catalog_part_references").select("id,metadata").eq("id", entry.id)),
        selectAll(db.from("vehicle_catalog_part_reference_fitments").select("part_reference_id").eq("part_reference_id", entry.id)),
        selectAll(db.from("catalog_part_reference_products").select("part_reference_id").eq("part_reference_id", entry.id))
      ]);
      const owned = referenceRows.length === 1 && referenceRows[0].metadata?.apply_run_id === journal.run_id;
      if (owned && (fitmentUse.length || productUse.length)) throw new Error(`Cannot rollback inserted reference ${entry.id}; it is still linked.`);
      if (owned) { const { error } = await db.from("catalog_part_references").delete().eq("id", entry.id); if (error) throw error; }
      actions.push({ operation: "delete_inserted_reference", id: entry.id, deleted: owned });
    }
  }
  const verification = [];
  for (const entry of journal.operations) {
    if (entry.operation === "insert_fitment") {
      const rows = await exactFitment(entry.key);
      verification.push({ operation: entry.operation, key: entry.key, pass: rows.length === 0, actual_rows: rows.length });
    } else if (entry.operation === "update_fitment") {
      const rows = await exactFitment(entry.key);
      const pass = rows.length === 1 && semanticRowHash(rows[0]) === semanticRowHash(entry.previous_row);
      verification.push({ operation: entry.operation, key: entry.key, pass, actual_rows: rows.length });
    } else if (entry.operation === "insert_reference") {
      const rows = await selectAll(db.from("catalog_part_references").select("id").eq("id", entry.id));
      verification.push({ operation: entry.operation, id: entry.id, pass: rows.length === 0, actual_rows: rows.length });
    }
  }
  const protectedPreimage = JSON.parse(fs.readFileSync(path.join(directory, "product-fitments.protected-snapshot.json"), "utf8"));
  const protectedIds = unique(protectedPreimage.map((row) => row.application_id));
  const protectedCurrent = await selectIn("vehicle_catalog_product_fitments", "*", "application_id", protectedIds);
  verification.push({ operation: "protected_product_layer", pass: stableHash(protectedCurrent) === stableHash(protectedPreimage) });
  const failed = verification.filter((row) => !row.pass);
  if (failed.length) throw new Error(`Rollback readback failed for ${failed.length} check(s).`);
  const result = { completed: true, verified: true, automatic, rolled_back_at: new Date().toISOString(), backup_directory: path.relative(ROOT, directory).replaceAll("\\", "/"), actions, verification };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function deleteFitment(key) {
  return db.from("vehicle_catalog_part_reference_fitments").delete().eq("application_id", key.application_id)
    .eq("part_reference_id", key.part_reference_id).eq("position", key.position).eq("data_source_id", key.data_source_id);
}
function exactFitment(key) {
  return selectAll(db.from("vehicle_catalog_part_reference_fitments").select("*").eq("application_id", key.application_id)
    .eq("part_reference_id", key.part_reference_id).eq("position", key.position).eq("data_source_id", key.data_source_id));
}
function semanticRowHash(row) {
  if (!row) return null;
  const { created_at, updated_at, ...semantic } = row;
  return stableHash(semantic);
}
function persistJournal(file, journal) { writeJson(file, journal); }
function fitmentKey(row) { return { application_id: row.application_id, part_reference_id: row.part_reference_id, position: row.position, data_source_id: row.data_source_id }; }
function publicRelation(row) { return { application_id: row.application_id, position: row.position, db_reference: row.normalized_value, years: row.years,
  operation: row.operation, part_reference_id: row.part_reference_id, evidence: row.evidence, product_write: false, proposed_nbp: null }; }
function blocker(reason, evidence) { return { reason, evidence }; }
function check(name, pass, evidence) { return { name, pass: Boolean(pass), evidence }; }
function compact(value) { return clean(value).replace(/[^a-z0-9]/g, ""); }
function clean(value) { return String(value ?? "").trim().toLowerCase(); }
function equalArrays(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function groupArray(values, keyFn) { const out = new Map(); for (const value of values) { const key = keyFn(value); const rows = out.get(key) ?? []; rows.push(value); out.set(key, rows); } return out; }
function groupSet(values, keyFn, valueFn) { const out = new Map(); for (const value of values) { const key = keyFn(value); const set = out.get(key) ?? new Set(); set.add(valueFn(value)); out.set(key, set); } return out; }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(2)) : 0; }
function stableHash(value) { return sha256(JSON.stringify(sortDeep(value))); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function readJsonl(file) { return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, values) { fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
function fileIdentity(file) { const bytes = fs.readFileSync(file); return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: sha256(bytes) }; }
async function selectAll(query) { const { data, error } = await query; if (error) throw error; return data ?? []; }
async function selectIn(table, columns, field, values) { const out = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).in(field, batch).range(from, from + 999); if (error) throw error; out.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return out; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
