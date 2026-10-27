import fs from "node:fs";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: new URL("../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
} });
process.loadEnvFile(".env.local");
const { getBrakePadBySlugOrPartNumber } = await import("../../lib/queries/brake-pad-catalog.ts");
const { getOilFilterBySku } = await import("../../lib/queries/oil-filter-catalog.ts");
const { getBulbBySku } = await import("../../lib/queries/bulb-catalog.ts");
const { bulbCartItem } = await import("../../lib/bulbs.ts");
const { createSupabaseCheckoutProductRepository } = await import("../../lib/infrastructure/supabase/checkout-product.repository.ts");
const { calculateCartPricing, calculateOrderTotals } = await import("../../lib/pricing.ts");
const plan = JSON.parse(fs.readFileSync("outputs/price-update-20261026/plan.json", "utf8"));
const filterSku = plan.localChanges.filters[0].sku;
const brake = await getBrakePadBySlugOrPartNumber("NBP1201"), filter = await getOilFilterBySku(filterSku), bulb = await getBulbBySku("NBL5007");
assert.ok(brake && filter && bulb);
assert.equal(brake.variant.price, 88);
assert.equal(filter.variant.price, plan.localChanges.filters[0].after);
assert.equal(bulb.priceNzd, 80);
const items = [
  { productId: "brake_pad", variantId: brake.partNumber, sku: brake.partNumber, name: brake.title, category: "brake-pad", qty: 1, price: 0.01, attributes: {} },
  { productId: "oil_filter", variantId: filter.partNumber, sku: filter.partNumber, name: filter.title, category: "filter", qty: 1, price: 0.01, attributes: {} },
  { ...bulbCartItem(bulb, 1), price: 0.01 }
];
const trusted = await createSupabaseCheckoutProductRepository().loadTrustedCartItems(items);
assert.deepEqual(trusted.map((item) => item.price), [88, filter.variant.price, 80]);
const subtotal = trusted.reduce((sum, item) => sum + item.price, 0);
const totals = calculateOrderTotals(calculateCartPricing(trusted), 0);
assert.equal(totals.grandTotal, subtotal, "GST must not be added again");
assert.equal(totals.gstIncluded, Math.round(subtotal * 3 / 23 * 100) / 100);
const high = await getBulbBySku("NBL5017");
assert.ok(high);
for (const line of ["brakes", "filters", "bulbs"]) {
  const file = { brakes: "data/brake-pads/catalog.json", filters: "data/oil-filters/catalog.json", bulbs: "data/bulbs/catalog.json" }[line];
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const row of rows) assert.equal(row.priceNzd, plan.localChanges[line].find((change) => change.sku === row.sku).after, `Source ${row.sku}`);
}
const report = { verified: true, examples: trusted.map((item) => ({ sku: item.sku, price_incl_gst: item.price })), grand_total: totals.grandTotal, gst_already_included: totals.gstIncluded, extra_gst_added: 0, payment_submitted: false };
fs.writeFileSync("outputs/price-update-20261026/checkout-verification.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
