import assert from "node:assert/strict";
import test from "node:test";
import { buildWiperFrontPairSku } from "../lib/queries/wiper-commerce";

test("front wiper pair SKU always puts the smaller size first", () => {
  assert.equal(buildWiperFrontPairSku(26, 18), "WPFP1826");
  assert.equal(buildWiperFrontPairSku(18, 26), "WPFP1826");
  assert.equal(buildWiperFrontPairSku(18, 18), "WPFP1818");
});
