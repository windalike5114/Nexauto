import assert from "node:assert/strict";
import test from "node:test";

import {
  compactPartKey,
  inferBodyStyle,
  parseBatteryCode,
  parseFilterDetail,
  parseVehicleRow,
  splitBatteryRecommendations,
  validateWiperRow
} from "../scripts/catalog/catalog-v3-normalization.mjs";

test("creates an independent vehicle hierarchy record from the new backbone", () => {
  const row = parseVehicleRow(["1", "Toyota", "Corolla", "ZRE152", "Hatchback", "2ZR-FE", "2007", "2012"], 2);
  assert.equal(row.parse_status, "accepted");
  assert.equal(row.body_style, "hatchback");
  assert.equal(row.market, "NZ");
  assert.equal(row.steering_side, "RHD");
  assert.match(row.generation_key, /zre152/);
  assert.match(row.variant_key, /hatchback/);
});

test("keeps a vehicle with missing chassis for review instead of silently dropping it", () => {
  const row = parseVehicleRow(["2", "Toyota", "Corolla", "", "Sedan", "2ZR-FE", "2013", "2018"], 3);
  assert.equal(row.parse_status, "review");
  assert.ok(row.parse_notes.includes("missing_chassis_code"));
});

test("extracts supplier and cross-reference filter identifiers", () => {
  assert.deepEqual(parseFilterDetail("UJ-1700R (Z793)"), { supplierPartNumber: "UJ-1700R", crossReferences: ["Z793"] });
});

test("splits battery recommendation lists without splitting codes on ordinary spaces", () => {
  assert.deepEqual(splitBatteryRecommendations("75D23L MF / 55D23L MF / 50D20L MF"), ["75D23L MF", "55D23L MF", "50D20L MF"]);
  assert.equal(compactPartKey("DIN53LH AGM"), "DIN53LHAGM");
});

test("infers only battery technology that is encoded in the source code", () => {
  assert.equal(parseBatteryCode("DIN53LH AGM").technology, "AGM");
  assert.equal(parseBatteryCode("DIN53LH EFB").technology, "EFB");
  assert.equal(parseBatteryCode("75D23L MF").technology, "MF");
  assert.equal(parseBatteryCode("43").technology, "unknown");
});

test("normalizes common body styles", () => {
  assert.equal(inferBodyStyle("SUV AWD"), "suv");
  assert.equal(inferBodyStyle("Convertible"), "convertible");
  assert.equal(inferBodyStyle(""), "unknown");
});

test("enforces the approved front and rear wiper inch ranges", () => {
  const accepted = validateWiperRow(["Toyota", "Corolla", "2010-2012", "", "600", "24", "400", "16", "300", "12", "1"], 2);
  assert.equal(accepted.parse_status, "accepted");
  const review = validateWiperRow(["Toyota", "Corolla", "2010-2012", "", "575", "23", "400", "16", "", "", "1"], 3);
  assert.equal(review.parse_status, "review");
  assert.ok(review.parse_notes.includes("invalid_driver_length"));
  assert.ok(review.parse_notes.includes("rear_not_provided_unknown_not_no_rear"));
});
