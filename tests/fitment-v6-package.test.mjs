import assert from "node:assert/strict";
import test from "node:test";
import { prepareFitmentV6 } from "../scripts/catalog/deploy-fitment-v6.mjs";

test("fitment V6 package is internally consistent", () => {
  const prepared = prepareFitmentV6();
  assert.equal(prepared.report.source_links.brake_pad, 25_761);
  assert.equal(prepared.report.source_links.oil_filter, 20_036);
  assert.equal(prepared.report.source_links.wiper, 22_584);
  assert.deepEqual(prepared.report.product_fitment_status, { published: 33_135, review: 12_662 });
  assert.equal(prepared.report.wiper_configurations, 86);
  assert.equal(prepared.report.unsupported_wiper_links, 842);
  assert.equal(prepared.report.catalogue_products.brake_pad, 211);
  assert.equal(prepared.report.catalogue_products.oil_filter, 125);
});
