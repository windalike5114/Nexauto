import assert from "node:assert/strict";
import test from "node:test";
import { buildOilFilterReviewGroups, prepareFitmentV6 } from "../scripts/catalog/deploy-fitment-v6.mjs";
import { applyVehicleCatalogSafety } from "../scripts/catalog/vehicle-catalog-safety.mjs";

test("fitment V6 package is internally consistent", () => {
  const prepared = prepareFitmentV6();
  assert.equal(prepared.report.source_links.brake_pad, 25_761);
  assert.equal(prepared.report.source_links.oil_filter, 20_036);
  assert.equal(prepared.report.source_links.wiper, 22_584);
  assert.deepEqual(prepared.report.product_fitment_status, { published: 8_020, review: 37_777 });
  assert.equal(prepared.report.wiper_configurations, 86);
  assert.equal(prepared.report.unsupported_wiper_links, 842);
  assert.equal(prepared.report.catalogue_products.brake_pad, 211);
  assert.equal(prepared.report.catalogue_products.oil_filter, 125);
});

test("oil filters publish only a unique exact series-level candidate", () => {
  const prepared = prepareFitmentV6();
  const oilRows = prepared.productFitments.filter((row) => row.product_type === "oil_filter");
  const published = oilRows.filter((row) => row.fitment_status === "published");
  const publishedByApplication = new Map();

  assert.equal(published.length, 1_245);
  assert.equal(published.every((row) => ["exact", "cleaned_exact"].includes(row.match_method)), true);
  assert.equal(published.every((row) => Number(row.sku_candidates_for_application) === 1), true);
  assert.equal(published.every((row) => !row.series_name || row.matched_on.split("+").includes("series")), true);

  for (const row of published) {
    const skus = publishedByApplication.get(row.application_id) ?? new Set();
    skus.add(row.sku);
    publishedByApplication.set(row.application_id, skus);
  }
  assert.equal([...publishedByApplication.values()].every((skus) => skus.size === 1), true);

  const zwe214 = oilRows.filter((row) => row.application_id === "ap_5f1da75d56ed204caa46");
  assert.ok(zwe214.length > 1);
  assert.equal(zwe214.every((row) => row.fitment_status === "review"), true);
});

test("downgraded oil-filter links collapse into a manageable review queue", () => {
  const prepared = prepareFitmentV6();
  const reviews = buildOilFilterReviewGroups(prepared.productFitments, prepared.oilCatalog);
  const counts = Object.fromEntries(
    [...new Set(reviews.map((row) => row.issue_type))].map((issueType) => [issueType, reviews.filter((row) => row.issue_type === issueType).length])
  );

  assert.equal(reviews.length, 519);
  assert.deepEqual(counts, {
    fitment_v6_oil_candidate_conflict: 65,
    fitment_v6_oil_engine_only_cluster: 237,
    fitment_v6_oil_mixed_filter_type: 20,
    fitment_v6_oil_source_scope_review: 197
  });
  assert.equal(reviews.every((row) => row.payload.application_count === row.payload.applications.length), true);
});

test("verified DB2357 conflict is quarantined only for Nissan X-Trail", () => {
  const prepared = prepareFitmentV6();
  const xTrail = prepared.productFitments.filter((row) => row.product_type === "brake_pad" && row.sku === "NBP1279" && row.model_name === "X-TRAIL");
  const qashqai = prepared.productFitments.filter((row) => row.product_type === "brake_pad" && row.sku === "NBP1279" && row.model_name === "QASHQAI");

  assert.ok(xTrail.length > 0);
  assert.equal(xTrail.every((row) => row.fitment_status === "review"), true);
  assert.equal(qashqai.some((row) => row.fitment_status === "published"), true);
});

test("known vehicle year correction removes invalid years without deleting the application", () => {
  const data = {
    applications: [{ application_id: "ap_c7c7e5588c7ca43555c0", year_from: 2012, year_to: 2026, review_status: "unreviewed" }],
    applicationYears: [2018, 2019, 2020, 2026].map((model_year) => ({ application_id: "ap_c7c7e5588c7ca43555c0", model_year }))
  };
  const corrections = applyVehicleCatalogSafety(data);

  assert.equal(corrections.length, 1);
  assert.equal(data.applications[0].year_to, 2018);
  assert.equal(data.applications[0].review_status, "approved");
  assert.deepEqual(data.applicationYears.map((row) => row.model_year), [2018]);
});

test("ASV70R publishes only the uniquely confirmed current-generation brake pads", () => {
  const prepared = prepareFitmentV6();
  const rows = prepared.productFitments.filter((row) =>
    row.product_type === "brake_pad" && row.application_id === "ap_4d243f0c805b50a746a8"
  );
  const statusBySku = Object.fromEntries(rows.map((row) => [row.sku, row.fitment_status]));

  assert.deepEqual(statusBySku, {
    NBP1289: "published",
    NBP1290: "published",
    NBP1572: "review",
    NBP1205: "review",
    NBP1593: "review"
  });
});

test("published brake pads require a high-confidence series match and a unique best candidate", () => {
  const prepared = prepareFitmentV6();
  const publishedBrakePads = prepared.productFitments.filter((row) =>
    row.product_type === "brake_pad" && row.fitment_status === "published"
  );

  assert.ok(publishedBrakePads.length > 0);
  assert.equal(publishedBrakePads.every((row) => row.match_confidence === "high"), true);
  assert.equal(publishedBrakePads.every((row) => row.review_status === "auto_accepted"), true);
  assert.equal(publishedBrakePads.every((row) => !row.series_name || row.matched_on.split("+").includes("series")), true);
});
