import assert from "node:assert/strict";
import test from "node:test";
import { priceAfter, makePlan } from "../scripts/catalog/update-prices-20261026.mjs";

test("brake prices round the original amount up before doubling", () => {
  assert.equal(priceAfter(43.48, "brake-pad"), 88);
  assert.equal(priceAfter(50, "brake-pad"), 100);
  assert.equal(priceAfter(60, "brake-pad"), 120);
  assert.equal(priceAfter(80, "brake-pad"), 160);
});
test("filters double exactly, retaining cents and leaving unpriced records at zero", () => {
  assert.equal(priceAfter(7, "filter"), 14);
  assert.equal(priceAfter(24.99, "filter"), 49.98);
  assert.equal(priceAfter(0, "filter"), 0);
});
test("bulb tier is chosen from original price, never the already doubled price", () => {
  assert.equal(priceAfter(40, "bulb"), 80);
  assert.equal(priceAfter(45, "bulb"), 90);
  assert.equal(priceAfter(80, "bulb"), 160);
  assert.equal(priceAfter(85, "bulb"), 110.5);
  assert.equal(priceAfter(105, "bulb"), 136.5);
  assert.equal(priceAfter(160, "bulb"), 208);
  assert.equal(priceAfter(3.5, "bulb"), 7);
});
test("product listing price aligns to real variant prices and the plan is GST inclusive", () => {
  const before = { products: [{ id: "a", slug: "legacy-bulb", category_slug: "bulb", price: 14.99 }],
    variants: [{ id: "b", product_id: "a", sku: "BULB-H7-12V", price: 16.99 }, { id: "c", product_id: "a", sku: "BULB-H11-12V", price: 16.99 }] };
  const plan = makePlan(before, { brakes: [], filters: [], bulbs: [] });
  assert.equal(plan.gst_included, true);
  assert.equal(plan.products[0].after, 33.98);
  assert.deepEqual(plan.variants.map((row) => row.after), [33.98, 33.98]);
  assert.equal(plan.variants[0].before, 16.99);
});
