import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const REPORT_ONLY = process.argv.includes("--report-only");
if (APPLY === REPORT_ONLY) throw new Error("Choose exactly one of --report-only or --apply.");

const ROOT = process.cwd();
const SOURCE_CODE = "POPULAR_WIPER_GAP_REVIEW_2026_10_24";
const OUTPUT_DIR = path.resolve(ROOT, "outputs", "wiper-gap-backfill-processing-20261024");

const DECISIONS = [
  {
    applicationId: "ap_dfb40e145bde1289ac2b",
    make: "MAZDA", model: "AXELA", series: "BYEFP", body: "sedan",
    configurationKey: "24/18/-",
    sourceUrl: "https://wsearch.piaa.co.jp/result/1059",
    rationale: "PIAA exact BYEFP Sedan/Hybrid listing; WSVS60A and WSVS45C map to 600 mm and 450 mm; no rear position."
  },
  ...[
    "ap_76195063928f458e1fb1",
    "ap_78d542fa62b8d45f97ce",
    "ap_245ed599db1a68a4b6e0",
    "ap_99cd8decfa6dd6a78530"
  ].map((applicationId) => ({
    applicationId,
    make: "MG", model: "ZS", series: "ZS32", body: "suv",
    configurationKey: "22/19/10",
    sourceUrl: "https://www.uniwiper.com.au/wiper-blade/mg/zs/2025-2027/",
    rationale: "Exact ZS32 source gives 550/475/250 mm. NexAuto application years remain authoritative after chassis and body verification."
  })),
  {
    applicationId: "ap_cc2ffd96d780da1d312b",
    make: "SUBARU", model: "FORESTER", series: "SLG", body: "suv",
    configurationKey: "26/16/14",
    sourceUrl: "https://wiper.jp/SUBARU/FORESTER.html",
    rationale: "Exact 5AA-SLG source gives 650/400/350 mm. NexAuto application years remain authoritative after chassis and body verification."
  },
  {
    applicationId: "ap_46be11cef952c9622cc2",
    make: "TOYOTA", model: "PRADO", series: "TRJ250", body: "suv",
    configurationKey: "22/20/10",
    sourceUrl: "https://www.glaco.jp/wiper/size/TOYOTA/6539/11501",
    rationale: "Exact TRJ250W Land Cruiser 250 fitment; PB-11/PB-9 are 550/500 mm and the rear is independently corroborated at 250 mm."
  },
  {
    applicationId: "ap_27e10762c2de14458ff2",
    make: "TOYOTA", model: "VITZ", series: "NCP151R", body: "hatchback",
    configurationKey: "-/-/12",
    allowReplacementOf: ["22/14/-"],
    sourceUrl: "https://www.autodoc.parts/car-parts/wiper-blades-10233/toyota/yaris/yaris-ncp15/132267-1-3-ncp151",
    rationale: "Exact NCP151 catalogue evidence supports the 300 mm rear position; front remains unknown because the source lists incompatible front systems.",
    identityCorrection: { targetModel: "YARIS" }
  },
  {
    applicationId: "ap_34c2b10a9d788ae30d3e",
    make: "TOYOTA", model: "WISH", series: "ZGE22W", body: "mpv",
    configurationKey: "26/14/12",
    sourceUrl: "https://wiper.jp/TOYOTA/WISH.html",
    rationale: "Exact ZGE22W listings repeatedly give 650/350/300 mm. NexAuto application years remain authoritative after chassis and body verification."
  },
  {
    applicationId: "ap_3f52681e7a38abe8b372",
    make: "TOYOTA", model: "WISH", series: "ZGE25", body: "mpv",
    configurationKey: "26/14/12",
    sourceUrl: "https://wiper.jp/TOYOTA/WISH.html",
    rationale: "Exact ZGE25G/ZGE25W listings repeatedly give 650/350/300 mm. NexAuto application years remain authoritative after chassis and body verification."
  }
];

loadEnv(path.resolve(ROOT, ".env.local"));
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase service credentials.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const data = await loadData();
const prepared = await prepare(data);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const reportPath = path.join(OUTPUT_DIR, APPLY ? "apply-plan.json" : "report.json");
fs.writeFileSync(reportPath, JSON.stringify(prepared.report, null, 2));

let applied = null;
if (APPLY) {
  if (prepared.blockers.length) throw new Error(`Preflight has ${prepared.blockers.length} blocker(s).`);
  applied = await applyPrepared(data, prepared);
  fs.writeFileSync(path.join(OUTPUT_DIR, "applied.json"), JSON.stringify(applied, null, 2));
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "report",
  reportPath,
  candidates: prepared.candidates.length,
  applicationYears: prepared.report.applicationYears,
  blockers: prepared.blockers,
  identityCorrection: prepared.identityPlan,
  applied
}, null, 2));

async function prepare(data) {
  const applicationById = new Map(data.applications.map((row) => [row.application_id, row]));
  const modelById = new Map(data.models.map((row) => [row.model_id, row]));
  const makeById = new Map(data.makes.map((row) => [row.make_id, row]));
  const seriesById = new Map(data.series.map((row) => [row.series_id, row]));
  const variantById = new Map(data.variants.map((row) => [row.variant_id, row]));
  const yearsByApplication = groupBy(data.years, (row) => row.application_id);
  const publishedByApplication = groupBy(data.published, (row) => row.application_id);
  const configurationById = new Map(data.configurations.map((row) => [row.id, row]));
  const blockers = [];
  const candidates = [];

  for (const decision of DECISIONS) {
    const application = applicationById.get(decision.applicationId);
    if (!application) {
      blockers.push({ applicationId: decision.applicationId, reason: "missing_application" });
      continue;
    }
    const model = modelById.get(application.model_id);
    const make = makeById.get(model?.make_id);
    const series = seriesById.get(application.series_id);
    const variant = variantById.get(application.variant_id);
    const currentPublished = publishedByApplication.get(decision.applicationId) ?? [];
    const currentConfigurations = currentPublished
      .map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key)
      .filter(Boolean);
    const identity = {
      make: upper(make?.name),
      model: upper(model?.name),
      series: upper(series?.code),
      body: lower(variant?.body_style)
    };
    const expected = {
      make: decision.make,
      model: decision.model,
      series: decision.series,
      body: decision.body
    };
    // An identity-correction source may already have been retired by an earlier
    // successful run. Let the canonical-target plan below make reruns idempotent.
    if (application.status !== "active" && !decision.identityCorrection) blockers.push({ applicationId: decision.applicationId, reason: "inactive_application", status: application.status });
    for (const field of ["make", "model", "series", "body"]) {
      if (identity[field] !== expected[field]) blockers.push({ applicationId: decision.applicationId, reason: `identity_mismatch_${field}`, expected: expected[field], actual: identity[field] });
    }
    if (currentConfigurations.length > 1) blockers.push({ applicationId: decision.applicationId, reason: "duplicate_published_fitments", currentConfigurations });
    if (currentConfigurations.length === 1 && currentConfigurations[0] !== decision.configurationKey) {
      blockers.push({ applicationId: decision.applicationId, reason: "published_configuration_conflict", expected: decision.configurationKey, actual: currentConfigurations[0] });
    }
    candidates.push({
      ...decision,
      years: (yearsByApplication.get(decision.applicationId) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b),
      currentConfigurations,
      currentModelId: application.model_id,
      currentSeriesId: application.series_id,
      variantId: application.variant_id,
      powertrainId: application.powertrain_id,
      yearFrom: application.year_from,
      yearTo: application.year_to,
      identity
    });
  }

  const duplicateGlobal = [...publishedByApplication.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([applicationId, rows]) => ({ applicationId, count: rows.length }));
  if (duplicateGlobal.length) blockers.push({ reason: "global_duplicate_published_fitments", rows: duplicateGlobal });

  const identityPlan = buildIdentityPlan(data, candidates.find((row) => row.identityCorrection));
  if (identityPlan?.blocker) blockers.push(identityPlan.blocker);
  if (identityPlan?.action === "merge") {
    identityPlan.inspection = await inspectIdentityMerge(identityPlan);
    blockers.push(...identityPlan.inspection.blockers);
    const candidate = candidates.find((row) => row.applicationId === identityPlan.sourceApplicationId);
    const target = applicationById.get(identityPlan.targetApplicationId);
    const targetPublished = publishedByApplication.get(identityPlan.targetApplicationId) ?? [];
    const targetConfigurations = targetPublished
      .map((row) => configurationById.get(row.wiper_configuration_id)?.configuration_key)
      .filter(Boolean);
    if (target?.status !== "active") blockers.push({ applicationId: identityPlan.targetApplicationId, reason: "canonical_target_inactive", status: target?.status });
    if (targetConfigurations.length > 1) blockers.push({ applicationId: identityPlan.targetApplicationId, reason: "canonical_target_duplicate_published_fitments", targetConfigurations });
    if (targetConfigurations.length === 1 && targetConfigurations[0] !== candidate.configurationKey && !(candidate.allowReplacementOf ?? []).includes(targetConfigurations[0])) {
      blockers.push({ applicationId: identityPlan.targetApplicationId, reason: "canonical_target_published_configuration_conflict", expected: candidate.configurationKey, actual: targetConfigurations[0] });
    }
    if (targetConfigurations.length === 1 && (candidate.allowReplacementOf ?? []).includes(targetConfigurations[0])) {
      candidate.supersededConfiguration = targetConfigurations[0];
    }
    candidate.publicationApplicationId = identityPlan.targetApplicationId;
    candidate.currentConfigurations = targetConfigurations;
    candidate.years = (yearsByApplication.get(identityPlan.targetApplicationId) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "report",
    sourceCode: SOURCE_CODE,
    policy: "Exact chassis/body evidence; NexAuto years authoritative; partial configurations retained; no conflicting published fitment overwritten.",
    candidates: candidates.length,
    applicationYears: candidates.reduce((sum, row) => sum + row.years.length, 0),
    configurations: countBy(candidates, (row) => row.configurationKey),
    alreadyPublished: candidates.filter((row) => row.currentConfigurations.includes(row.configurationKey)).length,
    newCoverage: candidates.filter((row) => row.currentConfigurations.length === 0).length,
    blockers,
    identityPlan,
    rows: candidates
  };
  return { candidates, blockers, identityPlan, report };
}

function buildIdentityPlan(data, candidate) {
  if (!candidate?.identityCorrection) return null;
  const targetModel = data.models.find((row) => upper(row.name) === candidate.identityCorrection.targetModel && row.make_id === data.models.find((item) => item.model_id === candidate.currentModelId)?.make_id);
  if (!targetModel) return { blocker: { applicationId: candidate.applicationId, reason: "target_model_missing", targetModel: candidate.identityCorrection.targetModel } };
  const currentSeries = data.series.find((row) => row.series_id === candidate.currentSeriesId);
  const targetSeries = data.series.find((row) => row.model_id === targetModel.model_id && upper(row.code) === upper(candidate.series));
  const seriesUsage = data.applications.filter((row) => row.series_id === candidate.currentSeriesId);
  const targetSeriesId = targetSeries?.series_id ?? candidate.currentSeriesId;
  const newCanonicalKey = [targetModel.model_id, targetSeriesId, candidate.variantId, candidate.powertrainId, candidate.yearFrom, candidate.yearTo].join("|");
  const canonicalPeer = data.applications.find((row) => row.application_id !== candidate.applicationId && row.canonical_key === newCanonicalKey);
  if (canonicalPeer) return {
    action: "merge",
    sourceApplicationId: candidate.applicationId,
    targetApplicationId: canonicalPeer.application_id,
    currentModelId: candidate.currentModelId,
    targetModelId: targetModel.model_id,
    currentSeriesId: candidate.currentSeriesId,
    targetSeriesId,
    newCanonicalKey,
    targetModelName: targetModel.name
  };
  if (!targetSeries && (seriesUsage.length !== 1 || seriesUsage[0].application_id !== candidate.applicationId)) {
    return { blocker: { applicationId: candidate.applicationId, reason: "source_series_is_shared", seriesId: candidate.currentSeriesId, usageCount: seriesUsage.length } };
  }
  return {
    action: "in_place",
    applicationId: candidate.applicationId,
    currentModelId: candidate.currentModelId,
    targetModelId: targetModel.model_id,
    currentSeriesId: candidate.currentSeriesId,
    targetSeriesId,
    moveSeriesInPlace: !targetSeries,
    currentSeriesModelId: currentSeries?.model_id,
    newCanonicalKey,
    targetModelName: targetModel.name
  };
}

async function applyPrepared(data, prepared) {
  const backupDir = await writeBackup(prepared.report);
  if (prepared.identityPlan) await applyIdentityCorrection(prepared.identityPlan);

  for (const row of prepared.candidates.filter((item) => item.supersededConfiguration)) {
    const supersededId = data.configurations.find((item) => item.configuration_key === row.supersededConfiguration)?.id;
    if (!supersededId) throw new Error(`Missing superseded configuration ${row.supersededConfiguration}.`);
    const applicationId = row.publicationApplicationId ?? row.applicationId;
    const { data: existingRows, error: selectError } = await db.from("vehicle_catalog_wiper_fitments")
      .select("notes")
      .eq("application_id", applicationId)
      .eq("wiper_configuration_id", supersededId)
      .eq("fitment_status", "published");
    if (selectError) throw selectError;
    const notes = [
      existingRows?.[0]?.notes,
      `${SOURCE_CODE}; superseded because NCP151R is Yaris XP150, not the Vitz family used by the previous front-only propagation; front lengths remain unresolved`
    ].filter(Boolean).join("; ");
    const { error: updateError } = await db.from("vehicle_catalog_wiper_fitments")
      .update({ fitment_status: "rejected", notes, updated_at: new Date().toISOString() })
      .eq("application_id", applicationId)
      .eq("wiper_configuration_id", supersededId)
      .eq("fitment_status", "published");
    if (updateError) throw updateError;
  }

  const configurationByKey = new Map(data.configurations.map((row) => [row.configuration_key, row.id]));
  for (const key of new Set(prepared.candidates.map((row) => row.configurationKey))) {
    if (configurationByKey.has(key)) continue;
    const [driver, passenger, rear] = key.split("/").map((value) => value === "-" ? null : Number(value));
    const { data: configurationId, error } = await db.rpc("upsert_partial_wiper_configuration", {
      p_driver_length_in: driver,
      p_passenger_length_in: passenger,
      p_rear_length_in: rear
    });
    if (error) throw error;
    configurationByKey.set(key, configurationId);
  }

  const now = new Date().toISOString();
  const payload = prepared.candidates.map((row) => ({
    application_id: row.publicationApplicationId ?? row.applicationId,
    wiper_configuration_id: configurationByKey.get(row.configurationKey),
    fitment_status: "published",
    source: SOURCE_CODE,
    notes: [
      `configuration=${row.configurationKey}`,
      `series=${row.series}`,
      `body=${row.body}`,
      `source_url=${row.sourceUrl}`,
      `policy=verified chassis/body; NexAuto application years authoritative`,
      `rationale=${row.rationale}`
    ].join("; "),
    updated_at: now
  }));
  const { error: upsertError } = await db.from("vehicle_catalog_wiper_fitments").upsert(payload, { onConflict: "application_id,wiper_configuration_id" });
  if (upsertError) throw upsertError;

  const verified = await selectInChunks("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source", "application_id", payload.map((row) => row.application_id));
  const expectedByApplication = new Map(payload.map((row) => [row.application_id, row.wiper_configuration_id]));
  const publishedByApplication = groupBy(verified.filter((row) => row.fitment_status === "published"), (row) => row.application_id);
  const invalid = payload.filter((row) => {
    const published = publishedByApplication.get(row.application_id) ?? [];
    return published.length !== 1 || published[0].wiper_configuration_id !== expectedByApplication.get(row.application_id);
  });
  if (invalid.length) throw new Error(`Post-apply fitment verification failed for ${invalid.length} application(s).`);

  const identityVerification = prepared.identityPlan ? await verifyIdentity(prepared.identityPlan) : null;
  const allPublished = await fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status", (query) => query.eq("fitment_status", "published"));
  const duplicatePublished = [...groupBy(allPublished, (row) => row.application_id).entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([applicationId, rows]) => ({ applicationId, count: rows.length }));
  if (duplicatePublished.length) throw new Error(`Post-apply found ${duplicatePublished.length} duplicate published application(s).`);

  return {
    appliedAt: now,
    backupDir,
    sourceCode: SOURCE_CODE,
    publishedApplications: payload.length,
    publishedApplicationYears: prepared.report.applicationYears,
    identityCorrection: identityVerification,
    duplicatePublishedApplications: duplicatePublished,
    rows: prepared.candidates.map((row) => ({
      sourceApplicationId: row.applicationId,
      publishedApplicationId: row.publicationApplicationId ?? row.applicationId,
      configurationKey: row.configurationKey,
      years: row.years
    }))
  };
}

async function applyIdentityCorrection(plan) {
  if (plan.action === "merge") {
    await applyIdentityMerge(plan);
    return;
  }
  if (plan.moveSeriesInPlace) {
    const { error } = await db.from("vehicle_catalog_series")
      .update({ model_id: plan.targetModelId })
      .eq("series_id", plan.currentSeriesId)
      .eq("model_id", plan.currentSeriesModelId);
    if (error) throw error;
  }
  const { error } = await db.from("vehicle_catalog_applications").update({
    model_id: plan.targetModelId,
    series_id: plan.targetSeriesId,
    canonical_key: plan.newCanonicalKey,
    review_status: "approved"
  }).eq("application_id", plan.applicationId).eq("status", "active");
  if (error) throw error;
}

async function verifyIdentity(plan) {
  if (plan.action === "merge") {
    const { data, error } = await db.from("vehicle_catalog_applications")
      .select("application_id,model_id,series_id,canonical_key,status,review_status")
      .in("application_id", [plan.sourceApplicationId, plan.targetApplicationId]);
    if (error) throw error;
    const source = data.find((row) => row.application_id === plan.sourceApplicationId);
    const target = data.find((row) => row.application_id === plan.targetApplicationId);
    const ok = source?.status === "inactive" && target?.status === "active" && target?.model_id === plan.targetModelId && target?.series_id === plan.targetSeriesId;
    if (!ok) throw new Error("Post-apply identity merge verification failed.");
    return { ok, action: "merge", sourceApplicationId: plan.sourceApplicationId, targetApplicationId: plan.targetApplicationId, targetModelName: plan.targetModelName };
  }
  const { data, error } = await db.from("vehicle_catalog_applications")
    .select("application_id,model_id,series_id,canonical_key,status,review_status")
    .eq("application_id", plan.applicationId)
    .single();
  if (error) throw error;
  const ok = data.status === "active" && data.model_id === plan.targetModelId && data.series_id === plan.targetSeriesId && data.canonical_key === plan.newCanonicalKey;
  if (!ok) throw new Error("Post-apply identity verification failed.");
  return { ok, ...data, targetModelName: plan.targetModelName };
}

async function inspectIdentityMerge(plan) {
  const [years, productFitments, wiperFitments, provenance, customerVehicles, orderItems, orderSnapshots, orderWipers] = await Promise.all([
    selectInChunks("vehicle_catalog_application_years", "application_id,model_year", "application_id", [plan.sourceApplicationId, plan.targetApplicationId]),
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", [plan.sourceApplicationId, plan.targetApplicationId]),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", [plan.sourceApplicationId, plan.targetApplicationId]),
    selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", [plan.sourceApplicationId, plan.targetApplicationId]),
    selectInChunks("customer_vehicles", "id,vehicle_catalog_application_id", "vehicle_catalog_application_id", [plan.sourceApplicationId]),
    selectInChunks("order_items", "id,vehicle_catalog_application_id", "vehicle_catalog_application_id", [plan.sourceApplicationId]),
    selectInChunks("order_vehicle_snapshots", "id,vehicle_catalog_application_id", "vehicle_catalog_application_id", [plan.sourceApplicationId]),
    selectInChunks("order_wiper_fulfillment", "id,vehicle_catalog_application_id", "vehicle_catalog_application_id", [plan.sourceApplicationId])
  ]);
  const byApplication = groupBy(years, (row) => row.application_id);
  const sourceYears = (byApplication.get(plan.sourceApplicationId) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  const targetYears = (byApplication.get(plan.targetApplicationId) ?? []).map((row) => Number(row.model_year)).sort((a, b) => a - b);
  const blockers = [];
  if (sourceYears.join(",") !== targetYears.join(",")) blockers.push({ applicationId: plan.sourceApplicationId, reason: "canonical_peer_years_differ", sourceYears, targetYears });
  const commerceReferences = customerVehicles.length + orderItems.length + orderSnapshots.length + orderWipers.length;
  if (commerceReferences) blockers.push({ applicationId: plan.sourceApplicationId, reason: "commerce_rows_reference_source_application", commerceReferences });
  return {
    sourceYears,
    targetYears,
    sourceProductFitments: productFitments.filter((row) => row.application_id === plan.sourceApplicationId).length,
    targetProductFitments: productFitments.filter((row) => row.application_id === plan.targetApplicationId).length,
    sourceWiperFitments: wiperFitments.filter((row) => row.application_id === plan.sourceApplicationId).length,
    targetWiperFitments: wiperFitments.filter((row) => row.application_id === plan.targetApplicationId).length,
    sourceProvenance: provenance.filter((row) => row.application_id === plan.sourceApplicationId).length,
    targetProvenance: provenance.filter((row) => row.application_id === plan.targetApplicationId).length,
    commerceReferences,
    blockers
  };
}

async function applyIdentityMerge(plan) {
  const inspection = await inspectIdentityMerge(plan);
  if (inspection.blockers.length) throw new Error(`Identity merge has ${inspection.blockers.length} blocker(s).`);
  const [sourceProducts, targetProducts, sourceWipers, targetWipers, sourceProvenance, targetProvenance] = await Promise.all([
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", [plan.sourceApplicationId]),
    selectInChunks("vehicle_catalog_product_fitments", "*", "application_id", [plan.targetApplicationId]),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", [plan.sourceApplicationId]),
    selectInChunks("vehicle_catalog_wiper_fitments", "*", "application_id", [plan.targetApplicationId]),
    selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", [plan.sourceApplicationId]),
    selectInChunks("vehicle_catalog_application_provenance", "*", "application_id", [plan.targetApplicationId])
  ]);
  const targetProductKeys = new Set(targetProducts.map((row) => `${row.product_variant_id}|${row.position}`));
  const productsToInsert = sourceProducts.filter((row) => !targetProductKeys.has(`${row.product_variant_id}|${row.position}`)).map((row) => ({ ...row, application_id: plan.targetApplicationId }));
  if (productsToInsert.length) {
    const { error } = await db.from("vehicle_catalog_product_fitments").upsert(productsToInsert, { onConflict: "application_id,product_variant_id,position" });
    if (error) throw error;
  }
  const targetWiperKeys = new Set(targetWipers.map((row) => row.wiper_configuration_id));
  const targetHasPublished = targetWipers.some((row) => row.fitment_status === "published");
  const wipersToInsert = sourceWipers.filter((row) => !targetWiperKeys.has(row.wiper_configuration_id)).map((row) => ({
    ...row,
    application_id: plan.targetApplicationId,
    fitment_status: targetHasPublished && row.fitment_status === "published" ? "rejected" : row.fitment_status,
    notes: [row.notes, `${SOURCE_CODE}; moved from ${plan.sourceApplicationId} during catalog identity merge`].filter(Boolean).join("; ")
  }));
  if (wipersToInsert.length) {
    const { error } = await db.from("vehicle_catalog_wiper_fitments").upsert(wipersToInsert, { onConflict: "application_id,wiper_configuration_id" });
    if (error) throw error;
  }
  const targetProvenanceKeys = new Set(targetProvenance.map((row) => `${row.source_group}|${row.source_url}`));
  const provenanceToInsert = sourceProvenance.filter((row) => !targetProvenanceKeys.has(`${row.source_group}|${row.source_url}`)).map((row) => ({ ...row, application_id: plan.targetApplicationId }));
  if (provenanceToInsert.length) {
    const { error } = await db.from("vehicle_catalog_application_provenance").upsert(provenanceToInsert, { onConflict: "application_id,source_group,source_url" });
    if (error) throw error;
  }
  const { error } = await db.from("vehicle_catalog_applications").update({ status: "inactive", review_status: "approved" }).eq("application_id", plan.sourceApplicationId).eq("status", "active");
  if (error) throw error;
}

async function writeBackup(report) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.resolve(ROOT, "tmp", "production-backups", `popular-wiper-backfill-${stamp}`);
  fs.mkdirSync(directory, { recursive: true });
  const tables = [
    "vehicle_catalog_applications",
    "vehicle_catalog_series",
    "vehicle_catalog_wiper_fitments",
    "wiper_configurations",
    "wiper_configuration_blades",
    "wiper_sizes"
  ];
  const manifest = { createdAt: new Date().toISOString(), sourceCode: SOURCE_CODE, report, tables: {} };
  for (const table of tables) {
    const rows = await fetchAll(table, "*");
    const content = JSON.stringify(rows, null, 2);
    const filename = `${table}.json`;
    fs.writeFileSync(path.join(directory, filename), content);
    manifest.tables[table] = { rows: rows.length, file: filename, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  }
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

async function loadData() {
  const [applications, years, variants, series, models, makes, published, configurations] = await Promise.all([
    fetchAll("vehicle_catalog_applications", "*"),
    fetchAll("vehicle_catalog_application_years", "application_id,model_year"),
    fetchAll("vehicle_catalog_variants", "variant_id,body_style,display_name"),
    fetchAll("vehicle_catalog_series", "series_id,model_id,code,normalized_code,display_name,status"),
    fetchAll("vehicle_catalog_models", "model_id,make_id,name,normalized_name,status"),
    fetchAll("vehicle_catalog_makes", "make_id,name,normalized_name,status"),
    fetchAll("vehicle_catalog_wiper_fitments", "application_id,wiper_configuration_id,fitment_status,source,notes", (query) => query.eq("fitment_status", "published")),
    fetchAll("wiper_configurations", "id,configuration_key,configuration_status")
  ]);
  return { applications, years, variants, series, models, makes, published, configurations };
}

async function fetchAll(table, columns, filter = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

async function selectInChunks(table, columns, field, values) {
  const output = [];
  const unique = [...new Set(values)];
  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await db.from(table).select(columns).in(field, unique.slice(index, index + 100));
    if (error) throw error;
    output.push(...(data ?? []));
  }
  return output;
}

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

function countBy(values, keyFn) {
  const output = {};
  for (const value of values) {
    const key = keyFn(value);
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}

function upper(value) { return String(value ?? "").trim().toUpperCase(); }
function lower(value) { return String(value ?? "").trim().toLowerCase(); }

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
