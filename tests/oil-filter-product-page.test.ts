import assert from "node:assert/strict";
import test from "node:test";
import { buildOilFilterSpecifications } from "../lib/oil-filter";

test("cartridge filters render uploaded dimensions and seals", () => {
  const rows = buildOilFilterSpecifications({
    construction: "Cartridge",
    heightMm: 154,
    outsideDiameter: "46",
    insideDiameter: "21/21",
    sealRingSize: "Ф52×Ф3.5,Ф14×Ф3.5,Ф7.5×Ф3.5"
  });

  assert.deepEqual(rows, [
    { label: "Filter Type", value: "Cartridge" },
    { label: "Height", value: "154 mm" },
    { label: "Outside Diameter", value: "46 mm" },
    { label: "Inside Diameter", value: "21/21 mm" },
    { label: "Seal Ring Size", value: "Ф52×Ф3.5,Ф14×Ф3.5,Ф7.5×Ф3.5" }
  ]);
  assert.equal(rows.some((row) => row.label === "Thread Size"), false);
  assert.equal(rows.some((row) => row.label === "Brand"), false);
});

test("seal ring suppresses thread size when both values are passed defensively", () => {
  const rows = buildOilFilterSpecifications({
    construction: "Cartridge",
    heightMm: 80,
    outsideDiameter: "70",
    threadSize: "M20×1.5",
    sealRingSize: "Ф75×Ф3.5"
  });

  assert.equal(rows.some((row) => row.label === "Thread Size"), false);
  assert.deepEqual(rows.find((row) => row.label === "Seal Ring Size"), { label: "Seal Ring Size", value: "Ф75×Ф3.5" });
});

test("missing filter fields are omitted instead of rendered as N/A", () => {
  const rows = buildOilFilterSpecifications({ construction: "Cartridge" });

  assert.deepEqual(rows, [{ label: "Filter Type", value: "Cartridge" }]);
  assert.equal(rows.some((row) => row.value === "N/A"), false);
});
