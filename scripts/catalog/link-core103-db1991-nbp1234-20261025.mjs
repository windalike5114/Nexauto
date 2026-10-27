import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { DEFAULT_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";

const ROOT = process.cwd();
const INPUT_FILE = path.resolve(ROOT, "outputs/core103-brake-productization-20261025/ready-to-link.jsonl");
const OUTPUT_DIR = path.resolve(ROOT, "outputs/core103-brake-productization-20261025/production-link-db1991-nbp1234");
const SOURCE = "CORE103_BRAKE_DB1991_NBP1234_LINK_2026_10_25";
const POLICY = "CORE103_BRAKE_REFERENCE_TO_PRODUCT_V1_2026_10_25";
const EXPECTED = { db: "DB1991", sku: "NBP1234", position: "front", applications: 4, applicationYears: 20 };
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => arg !== "--apply")) throw new Error(`Unknown argument(s): ${[...args].join(", ")}`);
const apply = args.has("--apply");

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase production credentials.");
}
if (!fs.existsSync(INPUT_FILE)) throw new Error(`Missing candidate input: ${INPUT_FILE}`);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});
const candidateRows = readJsonl(INPUT_FILE);
const candidates = collapseAndValidateInput(candidateRows);
const applicationIds = candidates.map((row) => row.application_id);

const production = await loadProductionBaseline(db);
const target = await inspectTarget(db, production, candidates);
const validations = validateCandidates(target, candidates);
const safe = validations.every((row) => row.safe);
const planned = buildPlan(target, candidates, validations);
const baselineCoverage = coverageMetric(production, new Set());
const projectedCoverage = coverageMetric(production, new Set(planned.writes.map((row) => row.application_id)));
const newlyCoveredApplicationYears = projectedCoverage.application_years_covered - baselineCoverage.application_years_covered;

const generatedAt = new Date().toISOString();
const report = {
  generated_at: generatedAt,
  mode: apply ? "apply" : "report-only",
  source: SOURCE,
  policy: POLICY,
  product_line: "brake_pad",
  scope: { popular_groups: "DEFAULT_POPULAR_VEHICLE_GROUPS", years: [2000, 2026] },
  input: fileIdentity(INPUT_FILE),
  target: EXPECTED,
  production_identity: {
    part_reference_id: target.reference.id,
    product_variant_id: target.productVariant.id,
    product_id: target.product.id,
    identifier_id: target.identifier.id
  },
  validation: {
    safe,
    applications_requested: candidates.length,
    applications_safe: validations.filter((row) => row.safe).length,
    checks_per_application: validations[0]?.checks.length ?? 0
  },
  expected_write: {
    relationships: planned.writes.length,
    inserts: planned.writes.filter((row) => row.operation === "insert").length,
    updates: planned.writes.filter((row) => row.operation === "update").length,
    noops: planned.noops.length,
    newly_covered_application_years: newlyCoveredApplicationYears,
    candidate_application_years: candidates.reduce((sum, row) => sum + row.years.length, 0)
  },
  coverage: {
    denominator_policy: "Active Core 103 applications and attached model years 2000-2026; published fitment to an active NBP brake-pad product.",
    baseline: baselineCoverage,
    projected: projectedCoverage,
    projected_gain_percentage_points: Number((projectedCoverage.application_year_coverage_percent - baselineCoverage.application_year_coverage_percent).toFixed(2))
  },
  safeguards: [
    "Default mode is report-only; production writes require the explicit --apply flag.",
    "Every application is re-read from production and must be active with the expected years.",
    "DB1991 must be a published front brake-pad reference and uniquely cross-reference active NBP1234.",
    "A different published NBP on any target application blocks the batch.",
    "Apply writes only vehicle_catalog_product_fitments for the four allow-listed application IDs.",
    "Apply creates a preimage backup before idempotent upsert, then performs exact-key readback and coverage reconciliation."
  ]
};

const rollbackKeys = planned.writes.map((row) => ({
  table: "vehicle_catalog_product_fitments",
  key: {
    application_id: row.application_id,
    product_variant_id: target.productVariant.id,
    position: EXPECTED.position
  },
  rollback_action: row.previous_row ? "restore_preimage" : "delete_inserted_key",
  previous_row: row.previous_row
}));
const backupPlan = {
  generated_at: generatedAt,
  apply_required: true,
  backup_directory_template: "tmp/production-backups/core103-db1991-nbp1234-<UTC timestamp>",
  tables: ["vehicle_catalog_product_fitments"],
  target_application_ids: applicationIds,
  exact_preimage_rows: target.targetProductFitments,
  rollback_keys: rollbackKeys,
  post_write_checks: [
    "exactly one published NBP1234/front key per target application",
    "no different published NBP product on target applications",
    "all four target applications remain active with the same scoped years",
    "coverage denominator unchanged and newly covered application-years equal the report-only plan"
  ]
};

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJson(path.join(OUTPUT_DIR, "report.json"), report);
writeJsonl(path.join(OUTPUT_DIR, "validation-results.jsonl"), validations);
writeJson(path.join(OUTPUT_DIR, "apply-plan.json"), planned);
writeJson(path.join(OUTPUT_DIR, "backup-plan.json"), backupPlan);
writeJson(path.join(OUTPUT_DIR, "rollback-keys.json"), rollbackKeys);

if (!safe) {
  throw new Error(`Production validation blocked the batch; inspect ${path.relative(ROOT, OUTPUT_DIR)}/validation-results.jsonl`);
}
if (newlyCoveredApplicationYears !== planned.writes.reduce((sum, row) => sum + row.years.length, 0)) {
  throw new Error(`Coverage reconciliation mismatch: projected ${newlyCoveredApplicationYears}, planned ${planned.writes.reduce((sum, row) => sum + row.years.length, 0)}`);
}

if (!apply) {
  console.log(JSON.stringify({
    mode: report.mode,
    safe,
    expected_write: report.expected_write,
    coverage: report.coverage,
    output_dir: path.relative(ROOT, OUTPUT_DIR).replaceAll("\\", "/")
  }, null, 2));
  process.exit(0);
}

const backup = writeApplyBackup(target, backupPlan, report);
const writeRows = planned.writes.map((row) => ({
  application_id: row.application_id,
  product_variant_id: target.productVariant.id,
  position: EXPECTED.position,
  fitment_status: "published",
  source: SOURCE,
  notes: `db_reference=${EXPECTED.db}; part_reference_id=${target.reference.id}; identifier_id=${target.identifier.id}; policy=${POLICY}`
}));
if (writeRows.length) {
  const { error } = await db.from("vehicle_catalog_product_fitments").upsert(writeRows, {
    onConflict: "application_id,product_variant_id,position"
  });
  if (error) throw error;
}

const readback = await selectAll(db.from("vehicle_catalog_product_fitments")
  .select("*")
  .in("application_id", applicationIds)
  .eq("product_variant_id", target.productVariant.id)
  .eq("position", EXPECTED.position));
const readbackByApplication = new Map(readback.map((row) => [row.application_id, row]));
for (const candidate of candidates) {
  const row = readbackByApplication.get(candidate.application_id);
  if (!row || row.fitment_status !== "published") throw new Error(`Apply readback failed for ${candidate.application_id}`);
}
const afterFitments = await fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status");
const afterProduction = { ...production, productFitments: afterFitments };
const afterCoverage = coverageMetric(afterProduction, new Set());
if (afterCoverage.application_years_total !== baselineCoverage.application_years_total) throw new Error("Coverage denominator changed during apply.");
if (afterCoverage.application_years_covered - baselineCoverage.application_years_covered !== newlyCoveredApplicationYears) {
  throw new Error("After-apply coverage uplift differs from report-only plan.");
}

const applied = {
  applied_at: new Date().toISOString(),
  source: SOURCE,
  backup,
  relationships_written: writeRows.length,
  readback,
  coverage_before: baselineCoverage,
  coverage_after: afterCoverage,
  rollback_keys: rollbackKeys
};
writeJson(path.join(OUTPUT_DIR, "applied.json"), applied);
console.log(JSON.stringify(applied, null, 2));

async function loadProductionBaseline(client) {
  const [makes, models, applications, years, products, productVariants, productFitments] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_applications", "application_id,model_id,status"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("products", "id,category_slug,active,commerce_status,checkout_enabled"),
    fetchAll("product_variants", "id,product_id,sku,attributes,active"),
    fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status")
  ]);
  return { makes, models, applications, years, products, productVariants, productFitments };

  async function fetchAll(table, columns) {
    const output = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client.from(table).select(columns).range(from, from + 999);
      if (error) throw error;
      output.push(...(data ?? []));
      if (!data || data.length < 1000) return output;
    }
  }
}

async function inspectTarget(client, baseline, candidateApplications) {
  const applicationIds = candidateApplications.map((row) => row.application_id);
  const applications = await selectAll(client.from("vehicle_catalog_applications")
    .select("application_id,model_id,series_id,variant_id,powertrain_id,status")
    .in("application_id", applicationIds));
  const years = await selectAll(client.from("vehicle_catalog_application_years")
    .select("application_id,model_year")
    .in("application_id", applicationIds));
  const references = await selectAll(client.from("catalog_part_references")
    .select("id,product_type,reference_scheme,reference_value,normalized_value,lifecycle_status")
    .eq("product_type", "brake_pad")
    .eq("reference_scheme", "bendix_db")
    .eq("normalized_value", EXPECTED.db));
  if (references.length !== 1) throw new Error(`Expected one production ${EXPECTED.db} reference, received ${references.length}`);
  const reference = references[0];

  const productVariants = await selectAll(client.from("product_variants")
    .select("id,product_id,sku,attributes,active")
    .eq("sku", EXPECTED.sku));
  if (productVariants.length !== 1) throw new Error(`Expected one production ${EXPECTED.sku} variant, received ${productVariants.length}`);
  const productVariant = productVariants[0];
  const products = await selectAll(client.from("products")
    .select("id,category_slug,active,commerce_status,checkout_enabled")
    .eq("id", productVariant.product_id));
  if (products.length !== 1) throw new Error(`Missing product row for ${EXPECTED.sku}`);
  const product = products[0];

  const identifiers = await selectAll(client.from("product_identifiers")
    .select("id,product_variant_id,identifier_type,identifier_brand,identifier_value,normalized_value,verification_status,is_primary")
    .eq("identifier_type", "cross_reference")
    .eq("normalized_value", EXPECTED.db));
  const identifier = identifiers.find((row) => row.product_variant_id === productVariant.id);
  if (!identifier) throw new Error(`${EXPECTED.sku} is missing production cross-reference ${EXPECTED.db}`);
  const referenceProductLinks = await selectAll(client.from("catalog_part_reference_products")
    .select("part_reference_id,product_variant_id,relation_type,verification_status,metadata")
    .eq("part_reference_id", reference.id));
  const referenceFitments = await selectAll(client.from("vehicle_catalog_part_reference_fitments")
    .select("application_id,part_reference_id,position,fitment_status,confidence,data_source_id,source_row_numbers,match_reasons")
    .in("application_id", applicationIds)
    .eq("fitment_status", "published"));
  const referenceIds = [...new Set(referenceFitments.map((row) => row.part_reference_id))];
  const allTargetReferences = referenceIds.length
    ? await selectAll(client.from("catalog_part_references")
      .select("id,product_type,reference_scheme,normalized_value")
      .in("id", referenceIds))
    : [];
  const targetProductFitments = await selectAll(client.from("vehicle_catalog_product_fitments")
    .select("*")
    .in("application_id", applicationIds));
  const fitmentVariantIds = [...new Set(targetProductFitments.map((row) => row.product_variant_id))];
  const targetFitmentVariants = fitmentVariantIds.length
    ? await selectAll(client.from("product_variants")
      .select("id,product_id,sku,attributes,active")
      .in("id", fitmentVariantIds))
    : [];
  const fitmentProductIds = [...new Set(targetFitmentVariants.map((row) => row.product_id))];
  const targetFitmentProducts = fitmentProductIds.length
    ? await selectAll(client.from("products")
      .select("id,category_slug,active")
      .in("id", fitmentProductIds))
    : [];
  return {
    baseline,
    applications,
    years,
    reference,
    productVariant,
    product,
    identifiers,
    identifier,
    referenceProductLinks,
    referenceFitments,
    allTargetReferences,
    targetProductFitments,
    targetFitmentVariants,
    targetFitmentProducts
  };
}

function validateCandidates(target, candidates) {
  const applicationById = new Map(target.applications.map((row) => [row.application_id, row]));
  const yearsByApplication = groupBy(target.years, (row) => row.application_id);
  const referenceById = new Map(target.allTargetReferences.map((row) => [row.id, row]));
  const variantById = new Map(target.targetFitmentVariants.map((row) => [row.id, row]));
  const productById = new Map(target.targetFitmentProducts.map((row) => [row.id, row]));
  const productLinks = target.referenceProductLinks.filter((row) =>
    row.relation_type === "exact_cross_reference" && row.verification_status === "verified");
  const identifierTargets = target.identifiers.filter((row) => row.product_variant_id === target.productVariant.id);
  const otherIdentifierTargets = target.identifiers.filter((row) => row.product_variant_id !== target.productVariant.id);

  return candidates.map((candidate) => {
    const application = applicationById.get(candidate.application_id);
    const productionYears = (yearsByApplication.get(candidate.application_id) ?? [])
      .map((row) => Number(row.model_year)).filter((year) => year >= 2000 && year <= 2026).sort((a, b) => a - b);
    const publishedReferences = target.referenceFitments.filter((row) => row.application_id === candidate.application_id);
    const publishedBrakeReferences = publishedReferences.filter((row) => referenceById.get(row.part_reference_id)?.product_type === "brake_pad");
    const expectedReferenceRows = publishedBrakeReferences.filter((row) =>
      row.part_reference_id === target.reference.id && row.position === EXPECTED.position);
    const differentPublishedFrontReferences = publishedBrakeReferences.filter((row) =>
      row.position === EXPECTED.position && row.part_reference_id !== target.reference.id);
    const fitments = target.targetProductFitments.filter((row) => row.application_id === candidate.application_id);
    const publishedBrakeProducts = fitments.filter((row) => {
      const variant = variantById.get(row.product_variant_id);
      const product = productById.get(variant?.product_id);
      return row.fitment_status === "published" && product?.category_slug === "brake-pad" && /^NBP\d+$/.test(String(variant?.sku));
    });
    const existingTarget = fitments.find((row) =>
      row.product_variant_id === target.productVariant.id && row.position === EXPECTED.position);
    const differentPublishedNbp = publishedBrakeProducts.filter((row) =>
      row.product_variant_id !== target.productVariant.id || row.position !== EXPECTED.position);

    const checks = [
      check("application_active", application?.status === "active", application?.status ?? "missing"),
      check("production_years_match_input", equalArrays(productionYears, candidate.years), { expected: candidate.years, actual: productionYears }),
      check("db_reference_is_brake_pad", target.reference.product_type === "brake_pad", target.reference.product_type),
      check("db_reference_scheme_bendix_db", target.reference.reference_scheme === "bendix_db", target.reference.reference_scheme),
      check("db_reference_lifecycle_usable", ["active", "to_be_discontinued"].includes(target.reference.lifecycle_status), target.reference.lifecycle_status),
      check("published_db1991_front_exists", expectedReferenceRows.length >= 1, expectedReferenceRows.length),
      check("no_different_published_front_db", differentPublishedFrontReferences.length === 0, differentPublishedFrontReferences.map((row) => referenceById.get(row.part_reference_id)?.normalized_value)),
      check("nbp1234_variant_active", target.productVariant.active === true, target.productVariant.active),
      check("nbp1234_product_active", target.product.active === true && target.product.commerce_status === "active" && target.product.checkout_enabled === true, target.product),
      check("nbp1234_product_line_brake_pad", target.product.category_slug === "brake-pad", target.product.category_slug),
      check("nbp1234_position_front", normalizePosition(target.productVariant.attributes?.position) === EXPECTED.position, target.productVariant.attributes?.position),
      check("unique_db1991_identifier_target", identifierTargets.length === 1 && otherIdentifierTargets.length === 0, { target: identifierTargets, others: otherIdentifierTargets }),
      check("db1991_identifier_is_bendix_and_usable", String(target.identifier.identifier_brand).toLowerCase() === "bendix" && target.identifier.verification_status !== "rejected", target.identifier),
      check("verified_exact_reference_product_link", productLinks.length === 1 && productLinks[0].product_variant_id === target.productVariant.id, productLinks),
      check("no_different_published_nbp", differentPublishedNbp.length === 0, differentPublishedNbp.map((row) => ({ ...row, sku: variantById.get(row.product_variant_id)?.sku }))),
      check("no_duplicate_target_key", fitments.filter((row) => row.product_variant_id === target.productVariant.id && row.position === EXPECTED.position).length <= 1, existingTarget ?? null)
    ];
    return {
      application_id: candidate.application_id,
      years: candidate.years,
      db: EXPECTED.db,
      sku: EXPECTED.sku,
      position: EXPECTED.position,
      current_target_row: existingTarget ?? null,
      operation: existingTarget?.fitment_status === "published" ? "noop" : existingTarget ? "update" : "insert",
      safe: checks.every((row) => row.pass),
      checks
    };
  });
}

function buildPlan(target, candidates, validations) {
  const validationById = new Map(validations.map((row) => [row.application_id, row]));
  const rows = candidates.map((candidate) => {
    const validation = validationById.get(candidate.application_id);
    return {
      application_id: candidate.application_id,
      years: candidate.years,
      operation: validation.operation,
      product_variant_id: target.productVariant.id,
      sku: EXPECTED.sku,
      position: EXPECTED.position,
      db_reference: EXPECTED.db,
      part_reference_id: target.reference.id,
      identifier_id: target.identifier.id,
      previous_row: validation.current_target_row
    };
  });
  return {
    generated_at: new Date().toISOString(),
    source: SOURCE,
    policy: POLICY,
    writes: rows.filter((row) => row.operation !== "noop"),
    noops: rows.filter((row) => row.operation === "noop")
  };
}

function coverageMetric(production, projectedApplicationIds) {
  const makeById = new Map(production.makes.filter(active).map((row) => [row.make_id, row]));
  const modelById = new Map(production.models.filter(active).map((row) => [row.model_id, row]));
  const popularIndex = buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS);
  const applicationById = new Map(production.applications.map((row) => [row.application_id, row]));
  const scopedApplicationIds = new Set();
  for (const application of production.applications.filter(active)) {
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    if (make && model && popularIndex.has(canonicalModelKey(make.name, model.name))) scopedApplicationIds.add(application.application_id);
  }
  const scopedYears = production.years.filter((row) => {
    const year = Number(row.model_year);
    return scopedApplicationIds.has(row.application_id) && year >= 2000 && year <= 2026;
  });
  const scopedIdsWithYears = new Set(scopedYears.map((row) => row.application_id));
  const activeProductIds = new Set(production.products
    .filter((row) => row.category_slug === "brake-pad" && row.active === true && row.commerce_status === "active")
    .map((row) => row.id));
  const activeVariantIds = new Set(production.productVariants
    .filter((row) => row.active === true && activeProductIds.has(row.product_id) && /^NBP\d+$/.test(String(row.sku)))
    .map((row) => row.id));
  const covered = new Set(production.productFitments
    .filter((row) => row.fitment_status === "published" && activeVariantIds.has(row.product_variant_id))
    .map((row) => row.application_id));
  for (const applicationId of projectedApplicationIds) covered.add(applicationId);

  const modelYears = new Map();
  for (const row of scopedYears) {
    const application = applicationById.get(row.application_id);
    const model = modelById.get(application?.model_id);
    const make = makeById.get(model?.make_id);
    const group = make && model ? popularIndex.get(canonicalModelKey(make.name, model.name)) : null;
    const key = `${group?.id ?? "unknown"}|${row.model_year}`;
    const ids = modelYears.get(key) ?? new Set();
    ids.add(row.application_id);
    modelYears.set(key, ids);
  }
  const applicationsCovered = [...scopedIdsWithYears].filter((id) => covered.has(id)).length;
  const applicationYearsCovered = scopedYears.filter((row) => covered.has(row.application_id)).length;
  const anyCovered = [...modelYears.values()].filter((ids) => [...ids].some((id) => covered.has(id))).length;
  const fullyCovered = [...modelYears.values()].filter((ids) => [...ids].every((id) => covered.has(id))).length;
  return {
    applications_total: scopedIdsWithYears.size,
    applications_covered: applicationsCovered,
    application_coverage_percent: percent(applicationsCovered, scopedIdsWithYears.size),
    application_years_total: scopedYears.length,
    application_years_covered: applicationYearsCovered,
    application_year_coverage_percent: percent(applicationYearsCovered, scopedYears.length),
    model_years_total: modelYears.size,
    model_years_any_covered: anyCovered,
    model_year_any_coverage_percent: percent(anyCovered, modelYears.size),
    model_years_fully_covered: fullyCovered,
    model_year_full_coverage_percent: percent(fullyCovered, modelYears.size)
  };
}

function collapseAndValidateInput(rows) {
  const filtered = rows.filter((row) => row.classification === "ready-to-link");
  const byApplication = groupBy(filtered, (row) => row.application_id);
  const candidates = [...byApplication.entries()].map(([applicationId, applicationRows]) => {
    const years = [...new Set(applicationRows.map((row) => Number(row.model_year)))].sort((a, b) => a - b);
    for (const row of applicationRows) {
      const refs = row.published_db_references ?? [];
      const products = row.candidate_nbp_products ?? [];
      if (refs.length !== 1 || refs[0].db !== EXPECTED.db || refs[0].position !== EXPECTED.position) {
        throw new Error(`Unexpected DB reference candidate for ${applicationId}`);
      }
      if (products.length !== 1 || products[0].sku !== EXPECTED.sku || products[0].reference_position !== EXPECTED.position) {
        throw new Error(`Unexpected NBP candidate for ${applicationId}`);
      }
    }
    return { application_id: applicationId, years };
  }).sort((left, right) => left.application_id.localeCompare(right.application_id));
  const applicationYears = candidates.reduce((sum, row) => sum + row.years.length, 0);
  if (candidates.length !== EXPECTED.applications || applicationYears !== EXPECTED.applicationYears) {
    throw new Error(`Candidate input changed: ${candidates.length} applications/${applicationYears} AY; expected ${EXPECTED.applications}/${EXPECTED.applicationYears}`);
  }
  return candidates;
}

function writeApplyBackup(target, backupPlan, report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp/production-backups", `core103-db1991-nbp1234-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const payloads = {
    "vehicle_catalog_product_fitments.preimage.json": target.targetProductFitments,
    "verification-snapshot.json": {
      applications: target.applications,
      years: target.years,
      reference: target.reference,
      reference_fitments: target.referenceFitments,
      product_variant: target.productVariant,
      product: target.product,
      identifiers: target.identifiers,
      reference_product_links: target.referenceProductLinks
    },
    "rollback-plan.json": backupPlan.rollback_keys,
    "report-only-plan.json": report
  };
  const files = [];
  for (const [name, value] of Object.entries(payloads)) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    fs.writeFileSync(path.join(directory, name), content);
    files.push({ name, bytes: Buffer.byteLength(content), sha256: sha256(content) });
  }
  const manifest = { created_at: new Date().toISOString(), source: SOURCE, files };
  writeJson(path.join(directory, "manifest.json"), manifest);
  return { directory: path.relative(ROOT, directory).replaceAll("\\", "/"), manifest };
}

async function fetchAll(table, columns) {
  const output = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    output.push(...(data ?? []));
    if (!data || data.length < 1000) return output;
  }
}
async function selectAll(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}
function check(name, pass, evidence) { return { name, pass: Boolean(pass), evidence }; }
function active(row) { return row.status === "active"; }
function normalizePosition(value) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("front")) return "front";
  if (text.includes("rear")) return "rear";
  return "unknown";
}
function groupBy(rows, keyFn) {
  const output = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const values = output.get(key) ?? [];
    values.push(row);
    output.set(key, values);
  }
  return output;
}
function equalArrays(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function percent(numerator, denominator) {
  return denominator ? Number((100 * numerator / denominator).toFixed(2)) : 0;
}
function readJsonl(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(file, rows) { fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "")); }
function fileIdentity(file) {
  const content = fs.readFileSync(file);
  return { path: path.relative(ROOT, file).replaceAll("\\", "/"), bytes: content.length, sha256: sha256(content) };
}
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
