import test from "node:test";
import assert from "node:assert/strict";

import { canonicalMakeKey, matchWiperObservation, rangesOverlap } from "../scripts/fitment/vehicle-wiper-matcher.mjs";

function observation(overrides = {}) {
  return {
    parse_status: "accepted",
    normalized_values: {
      make_key: "toyota",
      model_key: "corolla",
      year_start: 2012,
      year_end: 2018,
      open_ended: false,
      body_styles: ["hatchback"],
      chassis_codes: ["E180"],
      ...overrides
    }
  };
}

function candidate(overrides = {}) {
  return {
    row_number: 10,
    source_make_id: "toyota",
    source_model_id: "corolla",
    source_variant_id: "e180-hatch",
    make: "Toyota",
    make_key: "toyota",
    model: "Corolla",
    model_key: "corolla",
    generation_name: "E180",
    year_start: 2012,
    year_end: 2018,
    open_ended: false,
    body_styles: ["hatchback"],
    chassis_codes: ["E180"],
    ...overrides
  };
}

test("matches an exact chassis/year/body signature", () => {
  const match = matchWiperObservation(observation(), [candidate()]);
  assert.equal(match.status, "matched");
  assert.equal(match.suggested_target.source_variant_id, "e180-hatch");
});

test("does not auto-merge sedan and hatchback on the same chassis", () => {
  const match = matchWiperObservation(observation(), [candidate({ body_styles: ["sedan"] })]);
  assert.equal(match.status, "review");
  assert.match(match.reasons[0], /body-style/i);
});

test("requires review when equally plausible candidates remain", () => {
  const rows = [
    candidate({ row_number: 10, chassis_codes: [], body_styles: [] }),
    candidate({ row_number: 11, source_variant_id: "e180-other", chassis_codes: [], body_styles: [] })
  ];
  const match = matchWiperObservation(observation({ chassis_codes: [], body_styles: [] }), rows);
  assert.equal(match.status, "review");
  assert.equal(match.candidate_count, 2);
});

test("finds inclusive production-year overlap", () => {
  assert.equal(rangesOverlap({ year_start: 2010, year_end: 2014 }, { year_start: 2014, year_end: 2018 }), true);
  assert.equal(rangesOverlap({ year_start: 2010, year_end: 2013 }, { year_start: 2014, year_end: 2018 }), false);
});

test("normalizes audited source make aliases", () => {
  assert.equal(canonicalMakeKey("Mercedes"), "mercedes benz");
  assert.equal(canonicalMakeKey("Range Rover"), "land rover");
  assert.equal(canonicalMakeKey("Mazda Eunos"), "eunos");
});
