import assert from "node:assert/strict";
import test from "node:test";
import catalog from "../data/oil-filters/catalog.json";

test("uploaded oil-filter catalogue publishes all 125 unique SKUs with matched images", () => {
  assert.equal(catalog.length, 125);
  assert.equal(new Set(catalog.map((product) => product.sku)).size, 125);
  assert.equal(new Set(catalog.map((product) => product.imageUrl)).size, 125);
  assert.equal(catalog.filter((product) => product.category === "Cartridge").length, 84);
  assert.equal(catalog.filter((product) => product.category === "Spin-On").length, 41);
});

test("NOF1748 uses the requested SEO title, price, fitment summary and source-matched image", () => {
  const product = catalog.find((item) => item.sku === "NOF1748");
  assert.ok(product);
  assert.equal(product.supplierRef, "R2703P/R2681P");
  assert.equal(product.title, "R2703P/R2681P Oil Filter Cartridge Fits Mercedes Benz");
  assert.equal(product.priceNzd, 20);
  assert.equal(product.mostlyFor, "Mercedes-Benz C180-250, CLC, CLK, E200-E350, SLK200, SLK250");
  assert.equal(product.imageUrl, "/products/oil-filters/catalog/NOF1748.jpg");
  assert.equal(product.heightMm, 154);
  assert.equal(product.outerDiameter, "46");
  assert.equal(product.insideDiameter, "21/21");
  assert.equal(product.threadSize, "");
  assert.equal(product.sealRingSize, "Ф52×Ф3.5,Ф14×Ф3.5,Ф7.5×Ф3.5");
});

test("thread and seal-ring specifications are mutually exclusive across the catalogue", () => {
  for (const product of catalog) {
    assert.equal(Boolean(product.threadSize && product.sealRingSize), false, product.sku);
  }
});
