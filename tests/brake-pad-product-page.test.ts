import assert from "node:assert/strict";
import test from "node:test";
import { buildBrakePadSpecifications, splitBrakePadDisplayTitle } from "../lib/brake-pad";

test("buildBrakePadSpecifications renders supplier-listed CDB1422 dimensions", () => {
  const specifications = buildBrakePadSpecifications({
    partNumber: "CDB1422",
    position: "Front",
    frictionMaterial: "Organic Ceramic",
    lengthMm: 116.5,
    widthMm: 51.3,
    thicknessMm: 16.5,
    packDescription: "1 Set"
  });

  assert.deepEqual(specifications, [
    { label: "SKU", value: "CDB1422" },
    { label: "Axle Position", value: "Front" },
    { label: "Friction Material", value: "Organic Ceramic" },
    { label: "Length", value: "116.5 mm" },
    { label: "Width", value: "51.3 mm" },
    { label: "Thickness", value: "16.5 mm" },
    { label: "Pack", value: "1 Set" }
  ]);
});

test("buildBrakePadSpecifications omits unknown values instead of rendering N/A", () => {
  const specifications = buildBrakePadSpecifications({
    partNumber: "BP-TEST",
    position: "Unknown",
    packDescription: "1 Set"
  });

  assert.deepEqual(specifications, [
    { label: "SKU", value: "BP-TEST" },
    { label: "Pack", value: "1 Set" }
  ]);
  assert.equal(JSON.stringify(specifications).includes("N/A"), false);
});

test("splitBrakePadDisplayTitle moves the Fits summary into a subtitle", () => {
  assert.deepEqual(
    splitBrakePadDisplayTitle("DB1149 Front Brake Pad Set · 119.2 × 74 × 15 mm · Fits Toyota Hilux, Land Cruiser"),
    {
      title: "DB1149 Front Brake Pad Set · 119.2 × 74 × 15 mm",
      fitmentSubtitle: "Fits Toyota Hilux, Land Cruiser"
    }
  );
});

test("splitBrakePadDisplayTitle leaves titles without a Fits summary unchanged", () => {
  assert.deepEqual(splitBrakePadDisplayTitle("Front Brake Pad Set"), {
    title: "Front Brake Pad Set",
    fitmentSubtitle: ""
  });
});
