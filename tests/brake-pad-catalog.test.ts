import assert from "node:assert/strict";
import test from "node:test";
import catalog from "../data/brake-pads/catalog.json";

test("uploaded brake-pad catalogue is complete and keeps public output PN/year free", () => {
  assert.equal(catalog.length, 211);
  assert.equal(catalog.reduce((total, product) => total + product.fitments.length, 0), 794);

  const first = catalog.find((product) => product.sku === "NBP1200");
  assert.ok(first);
  assert.equal(first.supplierRef, "DB1802");
  // The October 26 price update doubled this original $50 catalogue price.
  assert.equal(first.priceNzd, 100);
  assert.equal(first.position, "Front (Axle Set - 4 Pads)");
  assert.deepEqual([first.lengthMm, first.widthMm, first.thicknessMm], [139.2, 55.5, 17.3]);
  assert.equal(first.imageUrl, "/products/brake-pads/catalog/NBP1200.jpg");
  assert.equal(first.imageIsPlaceholder, false);
  assert.deepEqual(Object.keys(first.fitments[0]).sort(), ["chassis", "engine", "make", "model"]);

  const publicJson = JSON.stringify(catalog);
  assert.equal(/"pn"\s*:|"year"\s*:/i.test(publicJson), false);
});

test("new SKUs use the default image and keep missing detailed fitment data empty", () => {
  const newProduct = catalog.find((product) => product.sku === "NBP1500");
  assert.ok(newProduct);
  assert.equal(newProduct.supplierRef, "DB1149");
  assert.equal(newProduct.imageUrl, "/products/brake-pads/ceramic-brake-pad-set.png");
  assert.equal(newProduct.imageIsPlaceholder, true);
  assert.deepEqual(newProduct.fitments, []);
});

test("the final uploaded SKU keeps its supplied position and dimensions", () => {
  const finalProduct = catalog.find((product) => product.sku === "NBP1300");
  assert.ok(finalProduct);
  assert.equal(finalProduct.position, "Rear Axle");
  assert.deepEqual([finalProduct.lengthMm, finalProduct.widthMm, finalProduct.thicknessMm], [107.6, 42.5, 14.9]);
});
