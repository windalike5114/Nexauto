import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { buildPopularAliasIndex, groupsForPopularScope, popularGroupMatchesApplication } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const OUT = path.resolve(ROOT, "outputs/brake-priority-unique-references-20261025");
const POLICY = "BRAKE_PRIORITY_UNIQUE_REFERENCE_V1_2026_10_25";
const PERIOD = { from: 2000, to: 2026 };
const TARGET_NAMES = new Set([
  "Suzuki Jimny",
  "Volkswagen Golf",
  "Suzuki Vitara / Grand Vitara",
  "Jeep Grand Cherokee",
  "Audi A4 / S4 Avant",
  "MINI hatch family",
  "Nissan Serena",
  "Nissan Caravan / NV350",
  "Suzuki Swift",
  "Holden Colorado",
  "Toyota Corolla",
  "Nissan Navara",
  "Toyota Hilux",
  "Toyota Camry",
  "MG ZS"
]);

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rollbackArg = args.find((arg) => arg.startsWith("--rollback="));
const unknown = args.filter((arg) => arg !== "--apply" && !arg.startsWith("--rollback="));
if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
if (apply && rollbackArg) throw new Error("Choose --apply or --rollback=<backup-directory>.");

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

if (rollbackArg) {
  console.log(JSON.stringify(await rollback(path.resolve(ROOT, rollbackArg.slice("--rollback=".length))), null, 2));
  process.exit(0);
}

const initialSnapshot = await snapshot();
const initialPlan = prepare(initialSnapshot);
writeOutputs(initialPlan, "report-only");
console.log(JSON.stringify(summary(initialPlan, "report-only"), null, 2));
if (!apply) process.exit(0);
if (initialPlan.blockers.length) throw new Error(`Preflight has ${initialPlan.blockers.length} blocker(s); no writes issued.`);

const freshSnapshot = await snapshot();
const freshPlan = prepare(freshSnapshot);
if (freshPlan.blockers.length) throw new Error(`Fresh preflight has ${freshPlan.blockers.length} blocker(s); no writes issued.`);
if (freshPlan.plan_hash !== initialPlan.plan_hash) throw new Error("Fresh plan changed after preflight; no writes issued.");
const backup = createBackup(freshPlan);
let result;
try {
  result = await applyPlan(freshPlan, backup);
} catch (error) {
  const restored = await rollback(backup, true).catch((rollbackError) => ({ verified: false, error: rollbackError.message }));
  writeJson(path.join(backup, "automatic-rollback-result.json"), restored);
  throw new Error(`Apply failed: ${error.message}; automatic rollback verified=${restored.verified}; backup=${backup}`);
}
writeJson(path.join(OUT, "applied.json"), result);
console.log(JSON.stringify(result, null, 2));

async function snapshot() {
  const [makes, models, series, variants, applications, years, products, productVariants, productFitments,
    references, referenceFitments, dataSources] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,code,display_name,status"),
    fetchAll("vehicle_catalog_variants", "variant_id,body_style,display_name"),
    fetchAll("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,status"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("products", "id,category_slug"),
    fetchAll("product_variants", "id,product_id,sku,active"),
    fetchAll("vehicle_catalog_product_fitments", "*"),
    fetchAll("catalog_part_references", "id,product_type,reference_scheme,normalized_value,lifecycle_status"),
    fetchAll("vehicle_catalog_part_reference_fitments", "*"),
    fetchAll("catalog_data_sources", "id,code,active")
  ]);
  return { fetched_at: new Date().toISOString(), makes, models, series, variants, applications, years, products,
    productVariants, productFitments, references, referenceFitments, dataSources };
}

function prepare(data) {
  const groups = groupsForPopularScope("extended80");
  const groupIndex = buildPopularAliasIndex(groups);
  const makeById = new Map(data.makes.filter((row) => row.status === "active").map((row) => [row.make_id, row]));
  const modelById = new Map(data.models.filter((row) => row.status === "active").map((row) => [row.model_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApp = groupBy(data.years.filter((row) => inPeriod(row.model_year)), (row) => row.application_id);
  const targetApps = [];
  for (const application of data.applications.filter((row) => row.status === "active")) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const group = make && model ? groupIndex.get(canonicalModelKey(make.name, model.name)) : null;
    const vehicleVariant = variantById.get(application.variant_id);
    const appYears = (yearsByApp.get(application.application_id) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
    if (!group || !TARGET_NAMES.has(group.label) || !appYears.length) continue;
    if (!popularGroupMatchesApplication(group, { bodyStyle: vehicleVariant?.body_style, variantName: vehicleVariant?.display_name })) continue;
    const vehicleSeries = seriesById.get(application.series_id);
    targetApps.push({
      application_id: application.application_id,
      group: group.label,
      rank: group.rank,
      make: make.name,
      model: model.name,
      series: vehicleSeries?.code ?? vehicleSeries?.display_name ?? "",
      body: vehicleVariant?.body_style ?? vehicleVariant?.display_name ?? "",
      years: appYears
    });
  }
  const targetIds = new Set(targetApps.map((row) => row.application_id));
  const refById = new Map(data.references.map((row) => [row.id, row]));
  const brakeRefs = data.referenceFitments.filter((row) => targetIds.has(row.application_id)
    && refById.get(row.part_reference_id)?.product_type === "brake_pad");
  const productById = new Map(data.products.map((row) => [row.id, row]));
  const brakeVariantIds = new Set(data.productVariants.filter((row) => {
    const category = productById.get(row.product_id)?.category_slug;
    return row.active !== false && (category === "brake-pad" || /^NBP\d+$/i.test(String(row.sku ?? "")));
  }).map((row) => row.id));
  const publishedProductAppIds = new Set(data.productFitments.filter((row) => targetIds.has(row.application_id)
    && row.fitment_status === "published" && brakeVariantIds.has(row.product_variant_id)).map((row) => row.application_id));
  const publishedReferenceAppIds = new Set(brakeRefs.filter((row) => row.fitment_status === "published").map((row) => row.application_id));
  const knowledgeAppIds = new Set([...publishedProductAppIds, ...publishedReferenceAppIds]);
  const missingApps = targetApps.filter((row) => !knowledgeAppIds.has(row.application_id));
  const missingIds = new Set(missingApps.map((row) => row.application_id));
  const reviewByAppPosition = groupBy(brakeRefs.filter((row) => missingIds.has(row.application_id) && row.fitment_status === "review"),
    (row) => `${row.application_id}|${row.position}`);
  const publishedByAppPosition = groupBy(brakeRefs.filter((row) => row.fitment_status === "published"),
    (row) => `${row.application_id}|${row.position}`);
  const safe = [];
  const unresolved = [];
  const blockers = [];
  for (const app of missingApps) {
    let hasCandidate = false;
    for (const position of ["front", "rear"]) {
      const key = `${app.application_id}|${position}`;
      const reviewRows = reviewByAppPosition.get(key) ?? [];
      if (!reviewRows.length) continue;
      hasCandidate = true;
      const candidates = unique(reviewRows.map((row) => refById.get(row.part_reference_id)?.normalized_value).filter(Boolean));
      const existingPublished = unique((publishedByAppPosition.get(key) ?? []).map((row) => refById.get(row.part_reference_id)?.normalized_value).filter(Boolean));
      if (candidates.length !== 1 || existingPublished.some((value) => value !== candidates[0])) {
        unresolved.push({ ...app, position, candidates, existing_published: existingPublished,
          reason: candidates.length > 1 ? "multiple_db_requires_discriminator" : "published_conflict" });
        continue;
      }
      const candidate = candidates[0];
      const chosenRows = reviewRows.filter((row) => refById.get(row.part_reference_id)?.normalized_value === candidate);
      const generationBoundaryRows = chosenRows.filter((row) => (row.match_reasons ?? []).includes("known_generation_boundary"));
      if (generationBoundaryRows.length) {
        unresolved.push({ ...app, position, candidates, existing_published: existingPublished,
          reason: "known_generation_boundary_requires_split",
          source_row_numbers: unique(generationBoundaryRows.flatMap((row) => row.source_row_numbers ?? [])),
          prior_match_reasons: unique(generationBoundaryRows.flatMap((row) => row.match_reasons ?? [])) });
        continue;
      }
      for (const row of chosenRows) {
        const reference = refById.get(row.part_reference_id);
        if (!/^DB\d+[A-Z]?$/.test(candidate)) blockers.push({ reason: "invalid_db", application_id: app.application_id, position, candidate });
        if (!["active", "to_be_discontinued", "unknown"].includes(reference?.lifecycle_status)) {
          blockers.push({ reason: "inactive_reference", application_id: app.application_id, position, candidate, lifecycle_status: reference?.lifecycle_status });
        }
        safe.push({ ...app, position, db_reference: candidate, part_reference_id: row.part_reference_id, data_source_id: row.data_source_id,
          source_row_numbers: row.source_row_numbers ?? [], previous_row: row });
      }
    }
    if (!hasCandidate) unresolved.push({ ...app, position: null, candidates: [], existing_published: [], reason: "no_local_reference_candidate" });
  }
  const safeRelationKeys = safe.map(relationKey);
  const duplicates = duplicateValues(safeRelationKeys);
  if (duplicates.length) blockers.push({ reason: "duplicate_safe_relation_keys", keys: duplicates });
  const safeApps = new Set(safe.map((row) => row.application_id));
  const safeAy = missingApps.filter((row) => safeApps.has(row.application_id)).reduce((sum, row) => sum + row.years.length, 0);
  const missingAy = missingApps.reduce((sum, row) => sum + row.years.length, 0);
  const byGroup = [...groupBy(targetApps, (row) => row.group)].map(([group, apps]) => {
    const missing = apps.filter((row) => missingIds.has(row.application_id));
    const safeGroupIds = new Set(safe.filter((row) => row.group === group).map((row) => row.application_id));
    return { group, applications: apps.length, application_years: sumYears(apps), knowledge_gap_applications: missing.length,
      knowledge_gap_application_years: sumYears(missing), safe_applications: safeGroupIds.size,
      safe_application_years: sumYears(missing.filter((row) => safeGroupIds.has(row.application_id))),
      safe_relationships: safe.filter((row) => row.group === group).length };
  }).sort((a, b) => b.safe_application_years - a.safe_application_years || b.knowledge_gap_application_years - a.knowledge_gap_application_years || a.group.localeCompare(b.group));
  const productHash = stableHash(data.productFitments.filter((row) => targetIds.has(row.application_id)));
  const planRows = safe.map((row) => ({ application_id: row.application_id, position: row.position, db_reference: row.db_reference,
    part_reference_id: row.part_reference_id, data_source_id: row.data_source_id, source_row_numbers: row.source_row_numbers }));
  return { generated_at: new Date().toISOString(), snapshot: data, targetApps, missingApps, safe, unresolved, blockers, byGroup,
    counts: { target_groups: TARGET_NAMES.size, applications: targetApps.length, application_years: sumYears(targetApps),
      knowledge_gap_applications: missingApps.length, knowledge_gap_application_years: missingAy,
      safe_applications: safeApps.size, safe_application_years: safeAy, safe_relationships: safe.length,
      unresolved_rows: unresolved.length, blockers: blockers.length }, product_hash: productHash,
    plan_hash: stableHash(planRows) };
}

function writeOutputs(plan, mode) {
  fs.mkdirSync(OUT, { recursive: true });
  writeJson(path.join(OUT, "preflight-summary.json"), summary(plan, mode));
  writeJsonl(path.join(OUT, "safe-reference-fitments.jsonl"), plan.safe.map(publicSafe));
  writeJsonl(path.join(OUT, "unresolved.jsonl"), plan.unresolved);
}

function summary(plan, mode) {
  return { generated_at: plan.generated_at, mode, production_writes: mode === "report-only" ? 0 : null, policy: POLICY,
    scope: { years: PERIOD, targets: [...TARGET_NAMES], ...plan.counts }, by_group: plan.byGroup,
    projected_extended132_knowledge_uplift_pp: Number((100 * plan.counts.safe_application_years / 46082).toFixed(4)),
    integrity: { plan_sha256: plan.plan_hash, blockers: plan.blockers, safe_keys_unique: duplicateValues(plan.safe.map(relationKey)).length === 0 },
    rules: [
      "Only current knowledge-gap applications are considered.",
      "A position is safe only when all live review rows resolve to exactly one DB and no different published DB exists.",
      "No NBP/product/product-fitment/reference-product row is created or changed.",
      "Multi-DB and no-candidate applications remain unresolved."
    ] };
}

function createBackup(plan) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp/production-backups", `brake-priority-unique-reference-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const files = {
    "reference-fitments.preimage.json": plan.safe.map((row) => row.previous_row),
    "product-fitments.protected.json": plan.snapshot.productFitments.filter((row) => new Set(plan.targetApps.map((app) => app.application_id)).has(row.application_id)),
    "plan.json": { policy: POLICY, plan_hash: plan.plan_hash, safe: plan.safe.map(publicSafe) },
    "journal.json": { policy: POLICY, run_id: crypto.randomUUID(), completed: false, operations: [] }
  };
  for (const [name, value] of Object.entries(files)) writeJson(path.join(directory, name), value);
  writeJson(path.join(directory, "manifest.json"), { created_at: new Date().toISOString(), policy: POLICY, plan_hash: plan.plan_hash,
    rollback_command: `node scripts/catalog/publish-brake-priority-unique-references-20261025.mjs --rollback=${path.relative(ROOT, directory).replaceAll("\\", "/")}` });
  return directory;
}

async function applyPlan(plan, backup) {
  const journalFile = path.join(backup, "journal.json");
  const journal = readJson(journalFile);
  for (const row of plan.safe) {
    const payload = {
      fitment_status: "published",
      confidence: "provisional_unique",
      match_reasons: unique([...(row.previous_row.match_reasons ?? []), "unique_live_db_candidate", "user_authorized_unique_candidate_publication"]),
      metadata: { ...(row.previous_row.metadata ?? {}), policy: POLICY, apply_run_id: journal.run_id, promoted_from_review: true,
        publication_rule: "unique_candidate_no_published_conflict" }
    };
    const entry = { key: relationKey(row), previous_row: row.previous_row, state: "pending" };
    journal.operations.push(entry);
    writeJson(journalFile, journal);
    let query = db.from("vehicle_catalog_part_reference_fitments").update(payload)
      .eq("application_id", row.application_id).eq("part_reference_id", row.part_reference_id)
      .eq("position", row.position).eq("data_source_id", row.data_source_id).eq("fitment_status", "review");
    if (row.previous_row.updated_at) query = query.eq("updated_at", row.previous_row.updated_at);
    const { data, error } = await query.select("application_id");
    if (error) throw error;
    if ((data ?? []).length !== 1) throw new Error(`Concurrent or missing target ${relationKey(row)}`);
    entry.state = "applied";
    writeJson(journalFile, journal);
  }
  const verification = await verify(plan, journal.run_id);
  journal.completed = true;
  journal.completed_at = new Date().toISOString();
  journal.verification = verification;
  writeJson(journalFile, journal);
  return { applied_at: journal.completed_at, policy: POLICY, backup_directory: path.relative(ROOT, backup).replaceAll("\\", "/"),
    writes: plan.safe.length, applications: new Set(plan.safe.map((row) => row.application_id)).size,
    application_years: plan.counts.safe_application_years, by_group: plan.byGroup.filter((row) => row.safe_relationships), verification };
}

async function verify(plan, runId) {
  const applicationIds = unique(plan.safe.map((row) => row.application_id));
  const currentRefs = await fetchIn("vehicle_catalog_part_reference_fitments", "*", "application_id", applicationIds);
  const currentProducts = await fetchIn("vehicle_catalog_product_fitments", "*", "application_id", unique(plan.targetApps.map((row) => row.application_id)));
  const refs = await fetchIn("catalog_part_references", "id,product_type,normalized_value", "id", unique(currentRefs.map((row) => row.part_reference_id)));
  const refById = new Map(refs.map((row) => [row.id, row]));
  const failures = [];
  for (const row of plan.safe) {
    const match = currentRefs.find((item) => item.application_id === row.application_id && item.part_reference_id === row.part_reference_id
      && item.position === row.position && item.data_source_id === row.data_source_id);
    if (!match || match.fitment_status !== "published" || match.metadata?.apply_run_id !== runId) failures.push({ key: relationKey(row), reason: "missing_published_readback" });
    const conflicts = unique(currentRefs.filter((item) => item.application_id === row.application_id && item.position === row.position
      && item.fitment_status === "published" && refById.get(item.part_reference_id)?.product_type === "brake_pad")
      .map((item) => refById.get(item.part_reference_id)?.normalized_value).filter((value) => value && value !== row.db_reference));
    if (conflicts.length) failures.push({ key: relationKey(row), reason: "published_db_conflict", conflicts });
  }
  const productHash = stableHash(currentProducts);
  if (productHash !== plan.product_hash) failures.push({ reason: "protected_product_layer_changed" });
  if (failures.length) throw new Error(`Readback failed for ${failures.length} check(s).`);
  return { ok: true, verified_at: new Date().toISOString(), published_relationships: plan.safe.length,
    applications_verified: applicationIds.length, product_layer_unchanged: true, product_layer_sha256: productHash };
}

async function rollback(directory, automatic = false) {
  const allowed = path.resolve(ROOT, "tmp/production-backups");
  if (!directory.startsWith(`${allowed}${path.sep}`) || !path.basename(directory).startsWith("brake-priority-unique-reference-")) throw new Error("Invalid rollback directory.");
  const journal = readJson(path.join(directory, "journal.json"));
  if (journal.policy !== POLICY) throw new Error("Rollback policy mismatch.");
  for (const entry of [...journal.operations].reverse()) {
    if (entry.state !== "applied") continue;
    const { error } = await db.from("vehicle_catalog_part_reference_fitments").upsert(entry.previous_row,
      { onConflict: "application_id,part_reference_id,position,data_source_id" });
    if (error) throw error;
  }
  const preimage = readJson(path.join(directory, "reference-fitments.preimage.json"));
  const ids = unique(preimage.map((row) => row.application_id));
  const current = await fetchIn("vehicle_catalog_part_reference_fitments", "*", "application_id", ids);
  const failures = preimage.filter((row) => {
    const match = current.find((item) => relationKey(item) === relationKey(row));
    return !match || semanticHash(match) !== semanticHash(row);
  });
  if (failures.length) throw new Error(`Rollback verification failed for ${failures.length} row(s).`);
  const result = { verified: true, automatic, rolled_back_at: new Date().toISOString(), restored_rows: preimage.length,
    backup_directory: path.relative(ROOT, directory).replaceAll("\\", "/") };
  writeJson(path.join(directory, automatic ? "automatic-rollback.json" : "manual-rollback.json"), result);
  return result;
}

function publicSafe(row) { return { group: row.group, rank: row.rank, make: row.make, model: row.model, series: row.series, body: row.body,
  application_id: row.application_id, years: row.years, position: row.position, db_reference: row.db_reference,
  part_reference_id: row.part_reference_id, data_source_id: row.data_source_id, source_row_numbers: row.source_row_numbers,
  prior_match_reasons: row.previous_row.match_reasons ?? [], prior_confidence: row.previous_row.confidence,
  prior_metadata: row.previous_row.metadata ?? {},
  action: "promote_existing_review_reference_to_published", product_write: false, proposed_nbp: null }; }
function relationKey(row) { return `${row.application_id}|${row.part_reference_id}|${row.position}|${row.data_source_id}`; }
function semanticHash(row) { const { created_at, updated_at, ...value } = row; return stableHash(value); }
function inPeriod(value) { const year = Number(value); return year >= PERIOD.from && year <= PERIOD.to; }
function sumYears(rows) { return rows.reduce((sum, row) => sum + row.years.length, 0); }
function unique(values) { return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))].sort(); }
function duplicateValues(values) { const seen = new Set(); const duplicate = new Set(); for (const value of values) { if (seen.has(value)) duplicate.add(value); seen.add(value); } return [...duplicate]; }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const rows = output.get(key) ?? []; rows.push(value); output.set(key, rows); } return output; }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(sortDeep(value))).digest("hex"); }
function sortDeep(value) { if (Array.isArray(value)) return value.map(sortDeep).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])])); return value; }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, values) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
async function fetchAll(table, columns) { const output = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } return output; }
async function fetchIn(table, columns, field, values) { const output = []; for (let index = 0; index < values.length; index += 50) { const batch = values.slice(index, index + 50); if (!batch.length) continue; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).in(field, batch).range(from, from + 999); if (error) throw error; output.push(...(data ?? [])); if (!data || data.length < 1000) break; } } return output; }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
