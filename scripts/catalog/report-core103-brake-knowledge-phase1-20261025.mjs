import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";
import { canonicalModelKey } from "./wipertech-direct-matcher.mjs";
import { DEFAULT_POPULAR_VEHICLE_GROUPS, POPULAR_EXTENDED_80_VEHICLE_GROUPS, buildPopularAliasIndex } from "./popular-vehicle-models.mjs";
import { compact, strictChassisMatch } from "./brake-pad-strict-policy.mjs";

const ROOT = process.cwd();
const OUTPUT_DIR = path.resolve(ROOT, process.env.BRAKE_PHASE_OUTPUT ?? "outputs/core103-brake-knowledge-phase1-20261025");
const BENDIX_WORKBOOK = "C:/Users/Sanli/Desktop/database/Bendix刹车片_全量车找件_V01.xlsx";
const FULL_REFERENCE_DIR = path.resolve(ROOT, "outputs", "bendix-full-reference-fitments-20261025");
const NORMALIZED_SOURCES = path.resolve(ROOT, "outputs", "brake-popular50-script-first-20261024", "sources.normalized.json");
const CORRECTIONS = path.resolve(ROOT, "outputs", "brake-popular50-delegation-20261024", "first-round", "normalized_model_correction_proposals.json");
const HISTORICAL_RESEARCH = path.resolve(ROOT, "outputs", "brake-popular50-delegation-20261024", "first-round", "clean-plan", "normalized-rule-plan.json");
const TARGET_LABELS = new Set([
  "BMW 3 Series", "Ford Mondeo", "Suzuki Vitara / Grand Vitara", "Mitsubishi Lancer",
  "Audi A4 / S4 Avant", "Suzuki Jimny", "MINI hatch family", "Volkswagen Golf"
]);
const TARGET_RANK_MIN = Number(process.env.BRAKE_TARGET_RANK_MIN || 0);
const TARGET_RANK_MAX = Number(process.env.BRAKE_TARGET_RANK_MAX || 0);
const TARGET_GROUPS = TARGET_RANK_MIN && TARGET_RANK_MAX
  ? POPULAR_EXTENDED_80_VEHICLE_GROUPS.filter((group) => group.rank >= TARGET_RANK_MIN && group.rank <= TARGET_RANK_MAX)
  : DEFAULT_POPULAR_VEHICLE_GROUPS.filter((group) => TARGET_LABELS.has(group.label));

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase read credentials.");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const production = await loadProduction();
const sourceAudit = loadSources();
const result = buildReport(production, sourceAudit);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
writeJson("summary.json", result.summary);
writeJsonl("ready-reference-fitments.jsonl", result.ready);
writeJsonl("conditional-reference-fitments.jsonl", result.conditional);
writeJsonl("multi-candidate-review.jsonl", result.multiCandidate);
writeJsonl("deferred.jsonl", result.deferred);
writeJsonl("rear-drum-not-applicable.jsonl", result.rearDrum);
writeJsonl("catalog-corrections.jsonl", result.catalogCorrections);
writeJson("source-audit.json", result.sourceAudit);
if (process.env.BRAKE_PHASE_RUNNER) fs.copyFileSync(path.resolve(ROOT, process.env.BRAKE_PHASE_RUNNER), path.join(OUTPUT_DIR, "rerun.mjs"));
console.log(JSON.stringify({ output_dir: OUTPUT_DIR, ...result.summary.counts, coverage: result.summary.coverage }, null, 2));

function buildReport(p, source) {
  const makeById = new Map(p.makes.map((row) => [row.make_id, row]));
  const modelById = new Map(p.models.map((row) => [row.model_id, row]));
  const seriesById = new Map(p.series.map((row) => [row.series_id, row]));
  const variantById = new Map(p.vehicleVariants.map((row) => [row.variant_id, row]));
  const powertrainById = new Map(p.powertrains.map((row) => [row.powertrain_id, row]));
  const yearsByApplication = groupBy(p.years, (row) => row.application_id);
  const targetIndex = buildPopularAliasIndex(TARGET_GROUPS);
  const applications = [];
  for (const row of p.applications) {
    if (row.status !== "active") continue;
    const model = modelById.get(row.model_id);
    const make = makeById.get(model?.make_id);
    const group = make && model ? targetIndex.get(canonicalModelKey(make.name, model.name)) : null;
    if (!group) continue;
    const years = (yearsByApplication.get(row.application_id) ?? []).map((item) => Number(item.model_year))
      .filter((year) => year >= 2000 && year <= 2026).sort((a, b) => a - b);
    if (!years.length) continue;
    const series = seriesById.get(row.series_id);
    const vehicleVariant = variantById.get(row.variant_id);
    const powertrain = powertrainById.get(row.powertrain_id);
    applications.push({
      application_id: row.application_id, group_id: group.id, group: group.label, rank: group.rank,
      make: make.name, model: model.name, platform: series?.code ?? series?.display_name ?? "",
      body: vehicleVariant?.body_style ?? "", drive: vehicleVariant?.drive_type ?? "",
      variant: vehicleVariant?.display_name ?? "", engine: powertrain?.display_name ?? "", years
    });
  }
  const targetIds = new Set(applications.map((row) => row.application_id));
  const appById = new Map(applications.map((row) => [row.application_id, row]));

  const refById = new Map(p.partReferences.map((row) => [row.id, row]));
  const productCategoryById = new Map(p.products.map((row) => [row.id, String(row.category_slug ?? "").toLowerCase()]));
  const brakeProductVariantIds = new Set(p.productVariants
    .filter((row) => productCategoryById.get(row.product_id) === "brake-pad" || /^NBP\d+$/i.test(String(row.sku ?? "")))
    .map((row) => row.id));
  const dbByVariant = groupBy(p.productIdentifiers.filter((row) => row.identifier_type === "cross_reference" && /^DB\d+[A-Z]?$/.test(row.normalized_value ?? "")), (row) => row.product_variant_id);
  const liveByCase = new Map();
  const productKnowledgeApps = new Set();
  for (const fitment of p.productFitments) {
    if (!targetIds.has(fitment.application_id) || fitment.fitment_status !== "published") continue;
    if (!brakeProductVariantIds.has(fitment.product_variant_id)) continue;
    productKnowledgeApps.add(fitment.application_id);
    const values = (dbByVariant.get(fitment.product_variant_id) ?? []).map((row) => row.normalized_value);
    addLive(liveByCase, fitment.application_id, fitment.position, values, "published_product");
  }
  const referenceKnowledgeApps = new Set();
  for (const fitment of p.referenceFitments) {
    if (!targetIds.has(fitment.application_id) || fitment.fitment_status !== "published") continue;
    const reference = refById.get(fitment.part_reference_id);
    if (reference?.product_type !== "brake_pad") continue;
    referenceKnowledgeApps.add(fitment.application_id);
    addLive(liveByCase, fitment.application_id, fitment.position, [reference.normalized_value], "published_reference");
  }
  const baselineKnowledgeApps = union(productKnowledgeApps, referenceKnowledgeApps);

  const evidenceByCase = new Map();
  for (const row of [...source.bendixPublished, ...source.bendixReview]) {
    if (!targetIds.has(row.application_id)) continue;
    const app = appById.get(row.application_id);
    const sourceRowNumbers = splitList(row.source_row_numbers);
    const sourceRows = sourceRowNumbers.map((id) => source.bendixPadById.get(String(id))).filter(Boolean);
    addEvidence(evidenceByCase, row.application_id, row.position, {
      db: row.bendix_reference, source_kind: "bendix_full", source_row_numbers: sourceRowNumbers,
      original_status: row.fitment_status, original_reason: row.match_reasons, confidence: row.confidence
      , exact_platform: Boolean(app?.platform && sourceRows.some((item) => item.tokens.some((token) => strictChassisMatch(app.platform, token))))
    });
  }
  for (const row of source.topstar) {
    const group = sourceTargetGroup(row);
    if (!group) continue;
    for (const app of applications.filter((item) => item.group === group && item.platform)) {
      if (!row.tokens?.some((token) => strictChassisMatch(app.platform, token))) continue;
      addEvidence(evidenceByCase, app.application_id, row.position, {
        db: row.db, source_kind: "topstar_chassis_catalog", source_ids: [row.source_id],
        source_sku: row.source_sku, platform_tokens: row.tokens, confidence: "exact_chassis_no_source_years"
      });
    }
  }

  const drumByCase = matchRearDrums(applications, source.rearShoes);
  const groups = groupEvidenceByPlatform(applications, evidenceByCase, liveByCase, drumByCase);
  const ready = [];
  const conditional = [];
  const multiCandidate = [];
  const deferred = [];
  for (const group of groups) {
    const candidateDbs = group.candidate_db;
    const conflict = group.live_published_db.length && (candidateDbs.some((dbRef) => !group.live_published_db.includes(dbRef))
      || group.live_published_db.some((dbRef) => !candidateDbs.includes(dbRef)));
    const sameLive = candidateDbs.length === 1 && group.live_published_db.includes(candidateDbs[0]);
    const topstarExact = group.sources.some((item) => item.source_kind === "topstar_chassis_catalog");
    const bendixPublished = group.sources.some((item) => item.source_kind === "bendix_full" && item.original_status === "published");
    const bendixExact = group.sources.some((item) => item.source_kind === "bendix_full" && item.exact_platform);
    const unsafeConfigReason = group.sources.some((item) => /body_mismatch|drive_mismatch|multiple_brake_configurations|known_generation_boundary/.test(item.original_reason ?? ""));
    const identityBlank = !group.platform;
    const base = { ...group, production_write: false, proposed_nbp: null };
    if (candidateDbs.length === 1 && !conflict && !identityBlank && !unsafeConfigReason && (topstarExact || bendixExact || bendixPublished)) {
      ready.push({ ...base, decision: "ready", decision_reason: sameLive
        ? "Unique DB confirms the same live published reference; safe but not incremental"
        : topstarExact ? "Topstar exact chassis has one DB and no published conflict"
        : bendixPublished ? "Bendix strict unique plan has one DB and no published conflict"
          : "Bendix exact platform has one DB and no published conflict; NexAuto application years retained" });
    } else {
      const reasons = [];
      if (candidateDbs.length > 1) reasons.push("multiple_db_requires_caliper_disc_or_production_split");
      if (conflict) reasons.push("published_online_db_conflict");
      if (sameLive) reasons.push("already_covered_by_same_published_db");
      if (identityBlank) reasons.push("missing_platform_identity");
      if (!topstarExact && !bendixExact && !bendixPublished) reasons.push("review_only_source_evidence");
      if (unsafeConfigReason) reasons.push("generation_body_drive_or_configuration_discriminator_required");
      const record = { ...base, decision: "conditional", decision_reasons: reasons };
      const deepSplit = candidateDbs.length > 1 || conflict || unsafeConfigReason;
      if (deepSplit) {
        const review = { ...record, decision: "review", requested_discriminator: "production date / engine / caliper / disc diameter / PR code as applicable" };
        multiCandidate.push(review);
        deferred.push({ ...review, deferred_reason: "Database cannot safely express or local evidence cannot resolve the configuration split." });
      } else conditional.push(record);
    }
  }
  const rearDrum = [...drumByCase.values()].filter((drum) => !evidenceByCase.has(drum.case_id)).map((drum) => ({
    ...drum, decision: "rear_drum_not_pad_gap", production_write: false, proposed_nbp: null,
    decision_reasons: ["Bendix rear brake-shoe evidence: do not count as a missing rear brake pad"]
  }));

  const newlyCoveredApps = new Set(ready.flatMap((row) => row.application_ids).filter((id) => !baselineKnowledgeApps.has(id)));
  const allYearKeys = new Set(applications.flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const baselineYearKeys = new Set(applications.filter((row) => baselineKnowledgeApps.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const readyYearKeys = new Set(applications.filter((row) => newlyCoveredApps.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const projectedYearKeys = union(baselineYearKeys, readyYearKeys);
  const catalogCorrections = source.corrections.filter((row) => {
    if (targetIds.has(row.application_id)) return true;
    const vehicle = row.original_vehicle ?? {};
    return !TARGET_RANK_MIN && String(vehicle.make).toUpperCase() === "BMW" && String(vehicle.model).toUpperCase() === "3";
  }).map((row) => ({ ...row, production_write: false, disposition: "catalog_correction_before_fitment" }));
  const drumApps = new Set([...drumByCase.values()].flatMap((row) => row.application_ids));
  const evidenceRows = [...ready, ...conditional, ...multiCandidate];
  const evidenceUpperApps = new Set(evidenceRows.flatMap((row) => row.application_ids ?? []).filter((id) => !baselineKnowledgeApps.has(id)));
  const evidenceUpperYearKeys = new Set(applications.filter((row) => evidenceUpperApps.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const baselineFullApps = new Set(applications.filter((row) => liveByCase.has(`${row.application_id}|front`)
    && (liveByCase.has(`${row.application_id}|rear`) || drumByCase.has(`${row.application_id}|rear`))).map((row) => row.application_id));
  const readyPositions = new Set(ready.flatMap((row) => row.application_ids.map((id) => `${id}|${row.position}`)));
  const projectedFullApps = new Set(applications.filter((row) => (liveByCase.has(`${row.application_id}|front`) || readyPositions.has(`${row.application_id}|front`))
    && (liveByCase.has(`${row.application_id}|rear`) || readyPositions.has(`${row.application_id}|rear`) || drumByCase.has(`${row.application_id}|rear`)))
    .map((row) => row.application_id));
  const baselineFullYearKeys = new Set(applications.filter((row) => baselineFullApps.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const projectedFullYearKeys = new Set(applications.filter((row) => projectedFullApps.has(row.application_id))
    .flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
  const byGroup = TARGET_GROUPS.map(({ label, rank }) => {
    const scoped = applications.filter((row) => row.group === label);
    const ids = new Set(scoped.map((row) => row.application_id));
    const yearKeys = new Set(scoped.flatMap((row) => row.years.map((year) => `${row.application_id}|${year}`)));
    const covered = new Set([...yearKeys].filter((key) => baselineYearKeys.has(key)));
    const gain = new Set([...yearKeys].filter((key) => readyYearKeys.has(key)));
    const upper = new Set([...yearKeys].filter((key) => evidenceUpperYearKeys.has(key)));
    return { rank, group: label, applications: ids.size, application_years: yearKeys.size,
      baseline_knowledge_application_years: covered.size,
      baseline_knowledge_percent: percent(covered.size, yearKeys.size),
      expected_new_application_years: gain.size,
      local_evidence_upper_bound_new_application_years: upper.size,
      projected_knowledge_application_years: covered.size + gain.size,
      projected_knowledge_percent: percent(covered.size + gain.size, yearKeys.size) };
  });
  const summary = {
    generated_at: new Date().toISOString(), mode: "report_only", production_writes: 0,
    scope: TARGET_RANK_MIN ? `Popular vehicle ranks ${TARGET_RANK_MIN}-${TARGET_RANK_MAX}, active NexAuto applications, model years 2000-2026 inclusive`
      : "Eight core-103 groups, active NexAuto applications, model years 2000-2026 inclusive",
    policy: {
      ready: "One DB at platform+position, exact Topstar chassis or Bendix strict-published evidence, and no different live published DB.",
      conditional: "A single unresolved DB with no deep configuration split stays conditional; it is excluded from safe uplift.",
      review_deferred: "Multiple DBs, a different live DB, or generation/body/drive/caliper/OE/PR discrimination stays review/deferred.",
      rear_drum: "Matched Bendix rear shoe evidence is an axle exemption and is not counted as missing rear pads or as pad knowledge.",
      sku: "Reference-only report: never invent an NBP SKU."
    },
    counts: { applications: applications.length, application_years: allYearKeys.size, platform_position_groups: groups.length,
      ready_groups: ready.length, conditional_groups: conditional.length, multi_candidate_groups: multiCandidate.length,
      deferred_groups: deferred.length, catalog_corrections: catalogCorrections.length,
      rear_drum_not_applicable_rows: rearDrum.length, rear_drum_exempt_applications: drumApps.size },
    coverage: { baseline_application_years: baselineYearKeys.size, baseline_percent: percent(baselineYearKeys.size, allYearKeys.size),
      baseline_any_knowledge_applications: baselineKnowledgeApps.size,
      baseline_any_knowledge_application_years: baselineYearKeys.size,
      baseline_full_axle_knowledge_applications: baselineFullApps.size,
      baseline_full_axle_knowledge_application_years: baselineFullYearKeys.size,
      expected_new_application_years: readyYearKeys.size, projected_application_years: projectedYearKeys.size,
      projected_any_knowledge_applications: union(baselineKnowledgeApps, newlyCoveredApps).size,
      projected_full_axle_knowledge_applications: projectedFullApps.size,
      projected_full_axle_knowledge_application_years: projectedFullYearKeys.size,
      projected_percent: percent(projectedYearKeys.size, allYearKeys.size),
      actual_safe_uplift_percentage_points: Number((percent(projectedYearKeys.size, allYearKeys.size) - percent(baselineYearKeys.size, allYearKeys.size)).toFixed(2)),
      conditional_not_counted_application_years: conditionalCeiling(conditional, baselineKnowledgeApps, appById),
      local_evidence_upper_bound_new_application_years: evidenceUpperYearKeys.size,
      local_evidence_upper_bound_percent: percent(baselineYearKeys.size + evidenceUpperYearKeys.size, allYearKeys.size) },
    groups: byGroup
  };
  return { ready, conditional, multiCandidate, deferred, rearDrum, catalogCorrections, summary,
    sourceAudit: { ...source.audit, live_snapshot: { fetched_at: p.fetchedAt, target_applications: applications.length,
      target_application_years: allYearKeys.size, published_product_knowledge_applications: productKnowledgeApps.size,
      published_reference_knowledge_applications: referenceKnowledgeApps.size },
      historical_research: { path: relative(HISTORICAL_RESEARCH), status_counts: source.historyStatus,
        usage: "Audit/correction context only; partial or unresolved identity conclusions were not upgraded to ready." },
      safeguards: ["No web browsing or AI search used.", "No production table mutation was issued.",
        "No NBP SKU was generated from a DB reference.", "Review and multi-candidate rows are excluded from projected knowledge coverage."] } };
}

function groupEvidenceByPlatform(applications, evidenceByCase, liveByCase, drumByCase) {
  const map = new Map();
  for (const app of applications) {
    for (const position of ["front", "rear"]) {
      const caseId = `${app.application_id}|${position}`;
      const evidence = evidenceByCase.get(caseId) ?? [];
      if (!evidence.length) continue;
      const key = `${app.group_id}|${compact(app.platform) || "NO_PLATFORM"}|${compact(app.body) || "NO_BODY"}|${compact(app.drive) || "NO_DRIVE"}|${position}`;
      const item = map.get(key) ?? { group_id: app.group_id, group: app.group, rank: app.rank, make: app.make,
        models: new Set(), platform: app.platform, body: app.body, drive: app.drive, position, application_ids: new Set(), application_years: new Set(),
        candidate_db: new Set(), live_published_db: new Set(), live_sources: new Set(), sources: [] };
      item.models.add(app.model); item.application_ids.add(app.application_id);
      app.years.forEach((year) => item.application_years.add(`${app.application_id}|${year}`));
      evidence.forEach((row) => { if (row.db) item.candidate_db.add(row.db); item.sources.push({ application_id: app.application_id, ...row }); });
      const live = liveByCase.get(caseId);
      live?.dbs.forEach((dbRef) => item.live_published_db.add(dbRef));
      live?.sources.forEach((kind) => item.live_sources.add(kind));
      map.set(key, item);
    }
  }
  return [...map.values()].map((row) => ({ ...row, models: [...row.models].sort(), application_ids: [...row.application_ids].sort(),
    application_years: row.application_years.size, candidate_db: [...row.candidate_db].sort(),
    live_published_db: [...row.live_published_db].sort(), live_sources: [...row.live_sources].sort(),
    sources: dedupeObjects(row.sources), rear_drum_evidence: [...row.application_ids].some((id) => drumByCase.has(`${id}|rear`)) }))
    .sort((a, b) => a.rank - b.rank || a.platform.localeCompare(b.platform) || a.position.localeCompare(b.position));
}

function matchRearDrums(applications, rows) {
  const output = new Map();
  for (const app of applications) {
    if (!app.platform) continue;
    const candidates = rows.filter((row) => row.position === "rear" && sourceTargetGroup(row) === app.group
      && row.tokens.some((token) => strictChassisMatch(app.platform, token))
      && app.years.some((year) => year >= row.from && year <= row.to));
    if (!candidates.length) continue;
    const caseId = `${app.application_id}|rear`;
    output.set(caseId, { case_id: caseId, group: app.group, rank: app.rank, make: app.make, models: [app.model],
      platform: app.platform, position: "rear", application_ids: [app.application_id], application_years: app.years.length,
      candidate_db: [], live_published_db: [], rear_brake_shoe_references: unique(candidates.map((row) => row.reference)),
      source_rows: unique(candidates.map((row) => row.row_id)), source_sheet: "03刹车蹄" });
  }
  return output;
}

function loadSources() {
  const publishedFile = path.join(FULL_REFERENCE_DIR, "published-reference-fitments.csv");
  const reviewFile = path.join(FULL_REFERENCE_DIR, "review-reference-fitments.csv");
  const normalized = JSON.parse(fs.readFileSync(NORMALIZED_SOURCES, "utf8"));
  const topstar = normalized.filter((row) => row.source_kind === "topstar_chassis_catalog");
  const corrections = JSON.parse(fs.readFileSync(CORRECTIONS, "utf8")).proposals ?? [];
  const history = JSON.parse(fs.readFileSync(HISTORICAL_RESEARCH, "utf8"));
  const workbook = XLSX.readFile(BENDIX_WORKBOOK, { cellDates: false });
  const padRows = XLSX.utils.sheet_to_json(workbook.Sheets["01刹车片"], { defval: "", raw: true }).map((row) => ({
    row_id: String(Number(row["行ID"])), tokens: extractParentheticalTokens(row["车系"]), series: row["车系"],
    make: row["品牌(英文)"], model: row["车型"], reference: String(row["件号"]).match(/DB\d+[A-Z]?/i)?.[0]?.toUpperCase() ?? ""
  }));
  const bendixPadById = new Map(padRows.map((row) => [row.row_id, row]));
  const shoeRows = XLSX.utils.sheet_to_json(workbook.Sheets["03刹车蹄"], { defval: "", raw: true }).map((row) => ({
    row_id: Number(row["行ID"]), make: row["品牌(英文)"], model: row["车型"], series: row["车系"],
    tokens: extractParentheticalTokens(row["车系"]), from: Number(row["年款起"] || 0), to: Number(row["年款止"] || 9999),
    position: String(row["位置"]).includes("后") ? "rear" : "", reference: String(row["件号"]).match(/BS\d+[A-Z]?/i)?.[0]?.toUpperCase() ?? "",
    status: row["状态"]
  })).filter((row) => row.reference && row.tokens.length);
  const bendixPublished = readCsv(publishedFile);
  const bendixReview = readCsv(reviewFile);
  return { bendixPublished, bendixReview, topstar, corrections, rearShoes: shoeRows, bendixPadById,
    historyStatus: countBy(history.answers ?? [], (row) => row.status ?? "unknown"),
    audit: { sources: [auditFile(BENDIX_WORKBOOK, { sheets: workbook.SheetNames, brake_pad_rows: workbook.Sheets["01刹车片"]?.["!ref"], rear_shoe_rows: shoeRows.length }),
      auditFile(publishedFile, { rows: bendixPublished.length, role: "strict unique reference plan" }),
      auditFile(reviewFile, { rows: bendixReview.length, role: "conditional/multi-candidate plan" }),
      auditFile(NORMALIZED_SOURCES, { rows: normalized.length, topstar_rows: topstar.length }),
      auditFile(CORRECTIONS, { proposals: corrections.length }), auditFile(HISTORICAL_RESEARCH, { answers: history.answers?.length ?? 0 })] } };
}

async function loadProduction() {
  const fetchedAt = new Date().toISOString();
  const [makes, models, series, vehicleVariants, powertrains, applications, years, products, productVariants, productFitments,
    referenceFitments, partReferences, productIdentifiers] = await Promise.all([
    fetchAll("vehicle_catalog_makes", "make_id,name,status"), fetchAll("vehicle_catalog_models", "model_id,make_id,name,status"),
    fetchAll("vehicle_catalog_series", "series_id,code,display_name"), fetchAll("vehicle_catalog_variants", "variant_id,body_style,drive_type,display_name"),
    fetchAll("vehicle_catalog_powertrains", "powertrain_id,display_name"), fetchAll("vehicle_catalog_applications", "application_id,model_id,series_id,variant_id,powertrain_id,status"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("products", "id,category_slug"), fetchAll("product_variants", "id,product_id,sku"),
    fetchAll("vehicle_catalog_product_fitments", "application_id,product_variant_id,position,fitment_status"),
    fetchAll("vehicle_catalog_part_reference_fitments", "application_id,part_reference_id,position,fitment_status"),
    fetchAll("catalog_part_references", "id,product_type,normalized_value"),
    fetchAll("product_identifiers", "product_variant_id,identifier_type,normalized_value")
  ]);
  return { fetchedAt, makes, models, series, vehicleVariants, powertrains, applications, years, products, productVariants, productFitments,
    referenceFitments, partReferences, productIdentifiers };
}

function sourceTargetGroup(row) {
  const exact = buildPopularAliasIndex(TARGET_GROUPS).get(canonicalModelKey(row.make, row.model));
  if (exact) return exact.label;
  const make = compact(row.make); const model = compact(row.model);
  if (make === "BMW" && /^3SERIES/.test(model)) return "BMW 3 Series";
  if (make === "FORD" && model.includes("MONDEO")) return "Ford Mondeo";
  if (make === "SUZUKI" && model.includes("JIMNY")) return "Suzuki Jimny";
  if (make === "SUZUKI" && model.includes("VITARA")) return "Suzuki Vitara / Grand Vitara";
  if (make === "MITSUBISHI" && model.includes("LANCER")) return "Mitsubishi Lancer";
  if (make === "AUDI" && (/^A4/.test(model) || /^S4/.test(model))) return "Audi A4 / S4 Avant";
  if ((make === "MINI" || make === "BMW") && (model.includes("MINI") || model.includes("COOPER") || model.includes("HATCH"))) return "MINI hatch family";
  if (make === "VOLKSWAGEN" && model.includes("GOLF")) return "Volkswagen Golf";
  for (const group of TARGET_GROUPS) {
    for (const [aliasMake, aliasModel] of group.aliases) {
      const am = compact(aliasMake); const av = compact(aliasModel);
      if (make !== am) continue;
      if (model === av || (av.length >= 5 && model.startsWith(av)) || (model.length >= 5 && av.startsWith(model))) return group.label;
    }
  }
  return null;
}
function extractParentheticalTokens(value) {
  return unique([...String(value ?? "").toUpperCase().matchAll(/\(([^)]+)\)/g)]
    .flatMap((match) => match[1].split(/[,;/|]+/)).map((token) => token.trim().replace(/[^A-Z0-9_]/g, "")).filter((token) => token.length >= 2));
}
function addEvidence(map, applicationId, position, evidence) {
  const key = `${applicationId}|${position}`; const values = map.get(key) ?? []; values.push(evidence); map.set(key, values);
}
function addLive(map, applicationId, position, dbs, source) {
  const key = `${applicationId}|${position}`; const item = map.get(key) ?? { dbs: new Set(), sources: new Set() };
  dbs.filter(Boolean).forEach((dbRef) => item.dbs.add(dbRef)); item.sources.add(source); map.set(key, item);
}
function conditionalCeiling(rows, baseline, appById) {
  const ids = new Set(rows.flatMap((row) => row.application_ids ?? []).filter((id) => !baseline.has(id)));
  return [...ids].reduce((sum, id) => sum + (appById.get(id)?.years.length ?? 0), 0);
}
function readCsv(file) { return XLSX.utils.sheet_to_json(XLSX.readFile(file, { raw: true }).Sheets.Sheet1, { defval: "", raw: false }); }
function splitList(value) { return String(value ?? "").split(/[|,]/).map((item) => item.trim()).filter(Boolean); }
function auditFile(file, extra = {}) { const bytes = fs.readFileSync(file); return { path: relative(file), bytes: bytes.length,
  sha256: crypto.createHash("sha256").update(bytes).digest("hex"), modified_at: fs.statSync(file).mtime.toISOString(), ...extra }; }
function relative(file) { return path.relative(ROOT, file).replace(/\\/g, "/"); }
function percent(a, b) { return b ? Number((100 * a / b).toFixed(2)) : 0; }
function union(...sets) { return new Set(sets.flatMap((set) => [...set])); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function groupBy(values, keyFn) { const output = new Map(); for (const value of values) { const key = keyFn(value); const list = output.get(key) ?? []; list.push(value); output.set(key, list); } return output; }
function countBy(values, keyFn) { const output = {}; for (const value of values) { const key = keyFn(value); output[key] = (output[key] ?? 0) + 1; } return output; }
function dedupeObjects(values) { const seen = new Set(); return values.filter((value) => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; }); }
function writeJson(name, value) { fs.writeFileSync(path.join(OUTPUT_DIR, name), `${JSON.stringify(value, null, 2)}\n`); }
function writeJsonl(name, values) { fs.writeFileSync(path.join(OUTPUT_DIR, name), values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "")); }
async function fetchAll(table, columns) { const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from(table).select(columns).range(from, from + 999); if (error) throw error; rows.push(...(data ?? [])); if (!data || data.length < 1000) return rows; } }
function loadEnv(file) { if (!fs.existsSync(file)) return; for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const match = line.match(/^([^#=]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); } }
