import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalOilFilterName,
  parseDimensionPair,
  prepareOilFilterNormalization,
  splitReferences,
  splitSealRings
} from "../scripts/catalog/normalize-oil-filter-catalog.mjs";

test("splits multiple Ryco references into distinct identifiers", () => {
  assert.deepEqual(splitReferences("R2606P/R2682P/R2675P"), ["R2606P", "R2682P", "R2675P"]);
});

test("allows a product with only a Ryco reference", () => {
  const catalog = [sample({ topstarRef: "", supplierRef: "Z89A" })];
  const prepared = prepareOilFilterNormalization(catalog, new Map([["NOF1", { id: "variant-1", product_id: "product-1" }]]), "source-1", {});
  assert.equal(prepared.identifiers.length, 1);
  assert.equal(prepared.identifiers[0].identifier_type, "cross_reference");
  assert.equal(prepared.identifiers[0].metadata.brand, "Ryco");
  assert.equal(prepared.identifiers[0].is_primary, false);
});

test("stores TopStar and Ryco as separate identifier rows", () => {
  const prepared = prepareOilFilterNormalization([sample()], new Map([["NOF1", { id: "variant-1", product_id: "product-1" }]]), "source-1", {
    identifierBrand: true,
    identifierVerification: true
  });
  assert.deepEqual(prepared.identifiers.map((row) => [row.identifier_type, row.identifier_brand, row.identifier_value]), [
    ["supplier_sku", "TopStar", "J-679"],
    ["cross_reference", "Ryco", "R2591P"]
  ]);
  assert.deepEqual(prepared.identifiers.map((row) => row.is_primary), [false, false]);
  assert.deepEqual(prepared.productNames, [{ product_id: "product-1", sku: "NOF1", name: "NexAuto Cartridge Oil Filter - NOF1" }]);
});

test("keeps the canonical product name independent of supplier and cross-reference numbers", () => {
  assert.equal(canonicalOilFilterName(sample()), "NexAuto Cartridge Oil Filter - NOF1");
  assert.equal(canonicalOilFilterName(sample({ category: "Spin-On", supplierRef: "Z9" })), "NexAuto Spin-On Oil Filter - NOF1");
});

test("keeps a shared cross-reference as a valid many-to-many mapping", () => {
  const catalog = [
    sample({ sku: "NOF1", supplierRef: "Z9" }),
    sample({ sku: "NOF2", topstarRef: "UJ-2", supplierRef: "Z9" })
  ];
  const variants = new Map([
    ["NOF1", { id: "variant-1", product_id: "product-1" }],
    ["NOF2", { id: "variant-2", product_id: "product-2" }]
  ]);
  const prepared = prepareOilFilterNormalization(catalog, variants, "source-1", {});
  const z9Rows = prepared.identifiers.filter((row) => row.identifier_value === "Z9");
  assert.equal(z9Rows.length, 2);
  assert.ok(z9Rows.every((row) => row.metadata.verification_status === "supplier_only"));
  assert.deepEqual(z9Rows.map((row) => row.metadata.shared_with_nexauto_skus), [["NOF2"], ["NOF1"]]);
});

test("preserves paired dimensions without inventing a single diameter", () => {
  assert.deepEqual(parseDimensionPair("88.5/82.5").values, [88.5, 82.5]);
  const prepared = prepareOilFilterNormalization([sample({ outerDiameter: "88.5/82.5" })], new Map([["NOF1", { id: "variant-1", product_id: "product-1" }]]), "source-1", {
    structuredSpecificationColumns: true,
    outsidePairColumns: true
  });
  const spec = prepared.specifications[0];
  assert.equal(spec.outside_diameter_mm, null);
  assert.equal(spec.outside_diameter_top_mm, 88.5);
  assert.equal(spec.outside_diameter_bottom_mm, 82.5);
});

test("splits seal rings into an array", () => {
  assert.deepEqual(splitSealRings("Ф90×Ф4.0,Ф16.8×Ф12.4×1.5"), ["Ф90×Ф4.0", "Ф16.8×Ф12.4×1.5"]);
});

function sample(overrides = {}) {
  return {
    sku: "NOF1",
    topstarRef: "J-679",
    supplierRef: "R2591P",
    category: "Cartridge",
    brands: "Holden",
    mostlyFor: "Holden Astra",
    heightMm: 79,
    outerDiameter: "62",
    insideDiameter: "27/24.5",
    threadSize: "",
    sealRingSize: "Ф71.5×Ф3.5",
    ...overrides
  };
}
