import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import source from "../data/bulbs/catalog.json";
import { bulbCartItem, bulbProduct, mapBulbDetail, resolveTrustedBulbCartItem, type BulbProductRow } from "../lib/bulbs";
import { productHref, productImage } from "../lib/product-content";

function fixture(sku = "NBL5004"): BulbProductRow {
  const row = source.find((entry) => entry.sku === sku)!;
  return {
    id: "7451cac1-6c74-4c22-a5b6-16c688256012", slug: `bulb-${sku.toLowerCase()}`,
    name: row.title, description: row.subtitle, images: row.images,
    active: true, visibility_status: "public", content_status: "approved",
    commerce_status: "active", checkout_enabled: true,
    detail_sections: row.features.map((body, index) => ({ title: `Feature ${index + 1}`, body })),
    product_attributes: { attributes: Object.fromEntries(row.specifications.map((spec) => [spec.label, [spec.value]])) },
    product_variants: [{ id: "4d06484f-3806-40a6-9d05-d3289a0baf3c", product_id: "7451cac1-6c74-4c22-a5b6-16c688256012",
      sku, price: row.priceNzd, stock: 0, active: true,
      attributes: { inventory_mode: "untracked", supplier_ref: row.supplierRef, ...(row.packLabel ? { pack: row.packLabel } : {}) } }]
  };
}

test("database records preserve every supplied title, subtitle, feature and image", () => {
  let imageCount = 0;
  for (const sourceRow of source) {
    const row = fixture(sourceRow.sku), detail = mapBulbDetail(row)!;
    const product = bulbProduct(row, detail);
    assert.equal(productHref(product), `/bulbs/${detail.sku}`);
    assert.equal(productImage(product), detail.images[0]);
    assert.equal(detail.title, sourceRow.title);
    assert.equal(detail.subtitle, sourceRow.subtitle);
    assert.deepEqual(detail.features, sourceRow.features);
    assert.equal(detail.inventoryQuantity, null);
    for (const image of detail.images) assert.ok(fs.existsSync(`public${image}`), image);
    imageCount += detail.images.length;
  }
  assert.equal(source.length, 73);
  assert.equal(imageCount, 196);
});

test("display and cart use the current variant price rather than source-file pricing", () => {
  const row = fixture();
  row.product_variants[0].price = "23.75";
  const detail = mapBulbDetail(row)!;
  assert.equal(detail.priceNzd, 23.75);
  assert.equal(bulbProduct(row, detail).price, 23.75);
  assert.equal(bulbCartItem(detail, 1).price, 23.75);
});

test("H10 consistently retains the user-confirmed 42W rating", () => {
  const h10 = mapBulbDetail(fixture("NBL5003"))!;
  assert.equal(h10.specifications.find((spec) => spec.label === "Power")?.value, "42W");
  assert.equal(JSON.stringify(h10).includes("32W"), false);
});

test("database publishing and active SKU state control page ordering", () => {
  for (const changes of [{ active: false }, { visibility_status: "internal" }, { content_status: "review" }, { commerce_status: "unavailable" }, { checkout_enabled: false }]) {
    const row = { ...fixture(), ...changes } as BulbProductRow;
    assert.equal(mapBulbDetail(row)?.orderingEnabled, false);
  }
  const row = fixture(); row.product_variants[0].active = false;
  assert.equal(mapBulbDetail(row), null);
});

test("checkout replaces tampered prices and attributes with trusted database values", () => {
  const row = fixture(), item = bulbCartItem(mapBulbDetail(row)!, 2);
  const variant = { ...row.product_variants[0], product_name: row.name, category_slug: "bulb" };
  const trusted = resolveTrustedBulbCartItem({ ...item, price: 0.01, name: "fake", sku: "fake", category: "wiper", bundleEligible: true, attributes: { inventory_mode: "untracked", vehicle_fitment_application_id: "fabricated" } }, variant)!;
  assert.equal(trusted.price, variant.price);
  assert.equal(trusted.sku, variant.sku);
  assert.equal(trusted.category, "bulb");
  assert.equal(trusted.bundleEligible, false);
  assert.equal(trusted.attributes.vehicle_fitment_application_id, undefined);
  assert.equal(trusted.productId, row.id);
  assert.equal(trusted.variantId, variant.id);
});

test("checkout enforces tracked inventory, product ownership and quantity bounds", () => {
  const row = fixture(), item = bulbCartItem(mapBulbDetail(row)!, 1);
  const variant = { ...row.product_variants[0], product_name: row.name, category_slug: "bulb" };
  assert.ok(resolveTrustedBulbCartItem(item, variant)); // Explicitly untracked, no fabricated stock.
  const tracked = { ...variant, stock: 2, attributes: { ...variant.attributes, inventory_mode: "tracked" } };
  assert.equal(resolveTrustedBulbCartItem({ ...item, qty: 3, attributes: { inventory_mode: "untracked" } }, tracked), null);
  assert.ok(resolveTrustedBulbCartItem({ ...item, qty: 2 }, tracked));
  assert.equal(mapBulbDetail({ ...row, product_variants: [tracked] })?.inventoryQuantity, 2);
  assert.equal(resolveTrustedBulbCartItem({ ...item, productId: "wrong-product" }, variant), null);
  assert.equal(resolveTrustedBulbCartItem({ ...item, variantId: "wrong-variant" }, variant), null);
  assert.equal(resolveTrustedBulbCartItem(item, { ...variant, active: false }), null);
  for (const qty of [0, -1, 1.5, 100, NaN, Infinity]) assert.equal(resolveTrustedBulbCartItem({ ...item, qty }, variant), null);
});

test("legacy bulb carts resolve to real database UUIDs", () => {
  const row = fixture(), item = bulbCartItem(mapBulbDetail(row)!, 1);
  const variant = { ...row.product_variants[0], product_name: row.name, category_slug: "bulb" };
  const trusted = resolveTrustedBulbCartItem({ ...item, productId: "bulb", variantId: variant.sku }, variant)!;
  assert.equal(trusted.productId, row.id);
  assert.equal(trusted.variantId, variant.id);
  assert.equal(resolveTrustedBulbCartItem({ ...item, productId: "bulb", variantId: "NBL9999" }, variant), null);
});
