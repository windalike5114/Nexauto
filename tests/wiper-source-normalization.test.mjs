import assert from "node:assert/strict";
import test from "node:test";

import {
  expandCombinedModels,
  normalizeSourceWiperLength,
  parseSeparateYearFields,
  parseWiperObservation
} from "../scripts/fitment/wiper-source-normalization.mjs";

test("converts approved nominal millimetre sizes to integer inches", () => {
  assert.equal(normalizeSourceWiperLength("600", "front", "mm").value, 24);
  assert.equal(normalizeSourceWiperLength("355", "rear", "mm").value, 14);
  assert.equal(normalizeSourceWiperLength("305", "rear", "mm").value, 12);
  assert.equal(normalizeSourceWiperLength("575", "front", "mm").value, null);
});

test("treats dash markers as missing rather than invalid measurements", () => {
  assert.deepEqual(normalizeSourceWiperLength("—", "rear", "mm"), {
    value: null,
    raw: "—",
    issue: null
  });
});

test("parses CAT-style separate years and rejects malformed date serials", () => {
  const valid = parseSeparateYearFields("06/85", "01/92");
  assert.equal(valid.ok, true);
  assert.equal(valid.year_start, 1985);
  assert.equal(valid.month_start, 6);
  assert.equal(valid.year_end, 1992);
  assert.equal(valid.month_end, 1);
  assert.equal(parseSeparateYearFields("7/5/26", "09/09").ok, false);
});

test("expands comma-separated catalogue models", () => {
  assert.deepEqual(expandCombinedModels("75, 90"), ["75", "90"]);
});

test("quarantines a source row when an approved front size is unavailable", () => {
  const record = parseWiperObservation({
    source_code: "TEST",
    row_number: 1,
    make: "Ford",
    model: "Ranger",
    detail: "PY",
    year_range: "2022-2026",
    driver: "25",
    passenger: "18",
    rear: "",
    unit: "in"
  });
  assert.equal(record.parse_status, "review");
  assert.match(record.parse_notes.join(" "), /Unsupported front wiper length/);
});
