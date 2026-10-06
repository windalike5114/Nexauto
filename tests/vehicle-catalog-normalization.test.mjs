import assert from "node:assert/strict";
import test from "node:test";

import {
  extractChassisCodes,
  inferBodyStyles,
  normalizeCatalogKey,
  parseCatalogDateRange,
  parseVehicleCatalogRow,
  parseVariantDescriptor
} from "../scripts/fitment/vehicle-catalog-normalization.mjs";

test("normalizes Unicode separators and preserves useful identifiers", () => {
  assert.equal(normalizeCatalogKey(" Mercedes-Benz  "), "mercedes benz");
  assert.equal(parseCatalogDateRange("ZE2/ZE3 2010%u20132014").year_end, 2014);
});

test("parses year and month ranges without inventing open-ended dates", () => {
  const closed = parseCatalogDateRange("04/1994-03/2001");
  assert.equal(closed.ok, true);
  assert.equal(closed.month_start, 4);
  assert.equal(closed.year_start, 1994);
  assert.equal(closed.month_end, 3);
  assert.equal(closed.year_end, 2001);
  assert.equal(closed.open_ended, false);

  const open = parseCatalogDateRange("GB 2019-ON");
  assert.equal(open.ok, true);
  assert.equal(open.year_start, 2019);
  assert.equal(open.year_end, null);
  assert.equal(open.open_ended, true);
});

test("splits combined body styles while retaining one generation identity", () => {
  const parsed = parseVariantDescriptor("MZEA12 Hatchback/Sedan 2018-ON", "Toyota Corolla");
  assert.equal(parsed.generation_name, "MZEA12");
  assert.deepEqual(parsed.body_styles, ["hatchback", "sedan"]);
  assert.deepEqual(parsed.variant_names, ["Hatchback", "Sedan"]);
  assert.deepEqual(parsed.chassis_codes, ["MZEA12"]);
});

test("extracts conservative chassis candidates and excludes marketing words", () => {
  assert.deepEqual(extractChassisCodes("B8 Series 1"), ["B8"]);
  assert.deepEqual(extractChassisCodes("Coupe & Convertible C207/A207"), ["C207", "A207"]);
  assert.deepEqual(extractChassisCodes("Next Gen"), []);
  assert.deepEqual(extractChassisCodes("F30/F31"), ["F30", "F31"]);
});

test("recognizes common body styles", () => {
  assert.deepEqual(inferBodyStyles("5-Door Hatchback/Sedan"), ["hatchback", "sedan"]);
  assert.deepEqual(inferBodyStyles("MPV Van"), ["minivan"]);
});

test("accepts complete backbone rows and quarantines incomplete variants", () => {
  const accepted = parseVehicleCatalogRow({
    make: "Audi",
    model: "A1",
    variant: "8X 2010-2017",
    source_make_id: "177503",
    source_model_id: "177548",
    source_variant_id: "183316"
  }, 2);
  assert.equal(accepted.parse_status, "accepted");
  assert.equal(accepted.normalized_values.generation_name, "8X");

  const review = parseVehicleCatalogRow({
    make: "Holden",
    model: "City",
    variant: "",
    source_make_id: "177509",
    source_model_id: "187394",
    source_variant_id: ""
  }, 325);
  assert.equal(review.parse_status, "review");
  assert.match(review.parse_notes.join(" "), /Missing source variant ID/);
});
