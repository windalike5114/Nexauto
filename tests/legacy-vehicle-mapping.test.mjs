import assert from "node:assert/strict";
import test from "node:test";

import { isSafeVersionSuffix, resolveCanonicalModelName } from "../scripts/fitment/legacy-vehicle-mapping.mjs";

const canonicalRows = [
  { make_key: "ford", model_key: "falcon", model: "Falcon" },
  { make_key: "toyota", model_key: "corolla", model: "Corolla" },
  { make_key: "toyota", model_key: "yaris", model: "Yaris" },
  { make_key: "toyota", model_key: "yaris verso", model: "Yaris Verso" }
];

test("legacy model names resolve to the clean canonical model", () => {
  assert.equal(resolveCanonicalModelName("Ford", "Falcon - BA - BF", canonicalRows), "Falcon");
  assert.equal(resolveCanonicalModelName("Ford", "Falcon AU Sedan", canonicalRows), "Falcon");
  assert.equal(resolveCanonicalModelName("Toyota", "Corolla E100 Hatch", canonicalRows), "Corolla");
});

test("exact canonical models win over shorter prefix models", () => {
  assert.equal(resolveCanonicalModelName("Toyota", "Yaris Verso", canonicalRows), "Yaris Verso");
  assert.equal(resolveCanonicalModelName("Toyota", "Yaris Verso P2", canonicalRows), "Yaris Verso");
});

test("short version codes map to the master model while distinct named models remain separate", () => {
  assert.equal(isSafeVersionSuffix("Verso P2"), false);
  assert.equal(isSafeVersionSuffix("GR"), true);
  assert.equal(resolveCanonicalModelName("Toyota", "Yaris Cross", canonicalRows), null);
  assert.equal(resolveCanonicalModelName("Toyota", "Yaris GR", canonicalRows), "Yaris");
});
