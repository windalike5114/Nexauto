import assert from "node:assert/strict";
import test from "node:test";
import { buildOilFilterSpecifications } from "../lib/oil-filter";

test("J-415 renders the supplied TopStar dimensions", () => {
  const rows = buildOilFilterSpecifications({
    brand: "TopStar",
    partNumber: "J-415",
    construction: "Cartridge",
    verificationStatus: "review",
    heightMm: 154,
    outsideDiameterMm: 46,
    insideDiameterTopMm: 21,
    insideDiameterBottomMm: 21,
    sealRingDimensions: ["52 × 3.5 mm", "14 × 3.5 mm", "7.5 × 3.5 mm"],
    packQuantity: 1
  });

  assert.deepEqual(rows.find((row) => row.label === "Height"), { label: "Height", value: "154 mm" });
  assert.deepEqual(rows.find((row) => row.label === "Outside Diameter"), { label: "Outside Diameter", value: "46 mm" });
  assert.deepEqual(rows.find((row) => row.label === "Inside Diameter"), { label: "Inside Diameter", value: "21 / 21 mm" });
  assert.match(rows.find((row) => row.label === "Seal Ring Dimensions")?.value ?? "", /52 × 3\.5 mm/);
  assert.equal(rows.some((row) => row.label === "Brand"), false);
});

test("missing filter fields are omitted instead of rendered as N/A", () => {
  const rows = buildOilFilterSpecifications({
    brand: "TopStar",
    partNumber: "J-999",
    construction: "Unknown",
    verificationStatus: "generated",
    packQuantity: 1
  });

  assert.equal(rows.some((row) => row.label === "Height"), false);
  assert.equal(rows.some((row) => row.label === "Thread"), false);
  assert.equal(rows.some((row) => row.value === "N/A"), false);
});
