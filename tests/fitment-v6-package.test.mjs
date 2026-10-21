import assert from "node:assert/strict";
import test from "node:test";
import { prepareFitmentV6 } from "../scripts/catalog/deploy-fitment-v6.mjs";

test("fitment V6 package is internally consistent", () => {
  const prepared = prepareFitmentV6();
  assert.equal(prepared.report.source_links.brake_pad, 25_761);
  assert.equal(prepared.report.source_links.oil_filter, 20_036);
  assert.equal(prepared.report.source_links.wiper, 22_584);
  assert.deepEqual(prepared.report.product_fitment_status, { published: 15_431, review: 30_366 });
  assert.equal(prepared.report.wiper_configurations, 86);
  assert.equal(prepared.report.unsupported_wiper_links, 842);
  assert.equal(prepared.report.catalogue_products.brake_pad, 211);
  assert.equal(prepared.report.catalogue_products.oil_filter, 125);
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
