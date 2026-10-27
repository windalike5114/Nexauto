import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalBrakePadName,
  normalizeAxlePosition,
  normalizeBendixReference,
  prepareBrakePadNormalization,
  topStarReferenceFromBendix
} from "../scripts/catalog/normalize-brake-pad-catalog.mjs";

test("maps every Bendix DB number to the TopStar CDB supplier SKU", () => {
  assert.equal(topStarReferenceFromBendix("DB1802"), "CDB1802");
  assert.equal(topStarReferenceFromBendix("db1849"), "CDB1849W");
  assert.equal(topStarReferenceFromBendix("db1405"), "CDB1405W");
  assert.equal(topStarReferenceFromBendix("db2193"), "CDB2193W");
  assert.equal(normalizeBendixReference(" DB300 "), "DB300");
});

test("keeps NexAuto SKU canonical and both external identifiers non-primary", () => {
  const variants = new Map([["NBP1200", { id: "variant-1", product_id: "product-1" }]]);
  const prepared = prepareBrakePadNormalization([sample()], variants, "source-1", {
    identifierBrand: true,
    identifierVerification: true
  });
  assert.deepEqual(prepared.productNames, [{
    product_id: "product-1",
    sku: "NBP1200",
    name: "NexAuto Front Brake Pad Set - NBP1200"
  }]);
  assert.deepEqual(prepared.identifiers.map((row) => [
    row.identifier_type,
    row.identifier_brand,
    row.identifier_value,
    row.is_primary
  ]), [
    ["supplier_sku", "TopStar", "CDB1802", false],
    ["cross_reference", "Bendix", "DB1802", false]
  ]);
  assert.equal(prepared.specifications[0].part_number, "NBP1200");
  assert.equal(prepared.specifications[0].axle_position, "front");
});

test("normalizes front and rear axle labels", () => {
  assert.equal(normalizeAxlePosition("Front (Axle Set - 4 Pads)"), "front");
  assert.equal(normalizeAxlePosition("Rear Axle"), "rear");
});

test("rejects identifiers outside the confirmed DB-to-CDB rule", () => {
  assert.throws(() => normalizeBendixReference("PN1524"), /Unsupported Bendix reference/);
});

test("prepares all 211 brake-pad variants without primary external identifiers", () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve("data/brake-pads/catalog.json"), "utf8"));
  const variants = new Map(catalog.map((row, index) => [row.sku, { id: `variant-${index}`, product_id: `product-${index}` }]));
  const prepared = prepareBrakePadNormalization(catalog, variants, "source-1", {
    identifierBrand: true,
    identifierVerification: true
  });
  assert.equal(prepared.productNames.length, 211);
  assert.equal(prepared.specifications.length, 211);
  assert.equal(prepared.identifiers.length, 422);
  assert.equal(prepared.identifiers.filter((row) => row.identifier_type === "supplier_sku").length, 211);
  assert.equal(prepared.identifiers.filter((row) => row.identifier_type === "cross_reference").length, 211);
  assert.equal(prepared.identifiers.filter((row) => row.is_primary).length, 0);
  assert.deepEqual(prepared.missingVariants, []);
  assert.deepEqual(prepared.invalidRows, []);
  assert.deepEqual(prepared.duplicateIdentifiers, []);
});

test("uses a canonical product name independent of DB and CDB numbers", () => {
  assert.equal(canonicalBrakePadName({ sku: "NBP1201", position: "rear" }), "NexAuto Rear Brake Pad Set - NBP1201");
});

function sample(overrides = {}) {
  return {
    sku: "NBP1200",
    supplierRef: "DB1802",
    position: "Front (Axle Set - 4 Pads)",
    lengthMm: 139.2,
    widthMm: 55.5,
    thicknessMm: 17.3,
    ...overrides
  };
}
