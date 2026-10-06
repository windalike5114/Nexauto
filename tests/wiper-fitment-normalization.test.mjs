import assert from "node:assert/strict";
import test from "node:test";

import {
  FRONT_WIPER_LENGTHS_IN,
  REAR_WIPER_LENGTHS_IN,
  normalizeWiperLength
} from "../scripts/fitment/wiper-normalization.mjs";

test("front and rear size dictionaries match the approved product ranges", () => {
  assert.deepEqual(FRONT_WIPER_LENGTHS_IN, [14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30]);
  assert.deepEqual(REAR_WIPER_LENGTHS_IN, [8, 10, 11, 12, 13, 14, 15, 16]);
});

test("normalizes common inch notations and catalogue suffixes", () => {
  assert.equal(normalizeWiperLength('24"', "front").value, 24);
  assert.equal(normalizeWiperLength("24″", "front").value, 24);
  assert.equal(normalizeWiperLength("24TLP", "front").value, 24);
  assert.equal(normalizeWiperLength("12 inch", "rear").value, 12);
});

test("maps only explicit millimetre aliases to inches", () => {
  assert.equal(normalizeWiperLength("600mm", "front").value, 24);
  assert.equal(normalizeWiperLength("350 毫米", "rear").value, 14);
  assert.equal(normalizeWiperLength("575mm", "front").value, null);
  assert.match(normalizeWiperLength("575mm", "front").issue, /Unmapped/);
});

test("rejects sizes that are not valid for the requested position", () => {
  assert.equal(normalizeWiperLength("23", "front").value, null);
  assert.equal(normalizeWiperLength("18", "rear").value, null);
  assert.equal(normalizeWiperLength("12", "front").value, null);
  assert.match(normalizeWiperLength("18", "rear").issue, /Unsupported rear/);
});
