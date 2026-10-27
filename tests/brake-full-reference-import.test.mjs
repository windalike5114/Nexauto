import test from "node:test";
import assert from "node:assert/strict";
import { coverageBlock, normalizeSourceRow } from "../scripts/catalog/import-bendix-full-reference-fitments-20261025.mjs";
import { configEngineMatch } from "../scripts/catalog/brake-pad-strict-policy.mjs";
import fs from "node:fs";

test("Bendix source engine codes use the strict-policy array contract", () => {
  const source = normalizeSourceRow({
    "行ID": 1,
    "品牌(英文)": "TOYOTA",
    "车型": "RAV4",
    "车系": "ACA31",
    "年款起": 2005,
    "年款止": 2012,
    "车身": "SUV",
    "驱动": "AWD",
    "排量(cc)": 2400,
    "发动机码": "2AZ-FE / 2AZFE",
    "件号": "DB1802",
    "位置": "前",
    "状态": "Active"
  });

  assert.ok(Array.isArray(source.engineCodes));
  assert.deepEqual(source.engineCodes, ["2AZFE"]);
  assert.equal(configEngineMatch({ engineCodes: ["2AZFE"], displacementCc: 2400 }, source), true);
});

test("blank Bendix end year is normalized as an open-ended current fitment", () => {
  const source = normalizeSourceRow({
    "行ID": 2,
    "品牌(英文)": "SUZUKI",
    "车型": "JIMNY",
    "车系": "JIMNY Closed Off-Road Vehicle (A6G)",
    "年款起": 2018,
    "年款止": "",
    "发动机码": "K15B",
    "件号": "DB2606 4WD",
    "位置": "前",
    "状态": "Active"
  });

  assert.equal(source.yearFrom, 2018);
  assert.equal(source.yearTo, 9999);
});

test("coverage reports set unions instead of subtracting unrelated counts", () => {
  const result = coverageBlock(
    10,
    new Set(["a", "b", "c"]),
    new Set(["b", "c", "d"]),
    new Set(["d", "e"]),
    new Set(["e", "f"])
  );

  assert.equal(result.sellableCovered, 3);
  assert.equal(result.publishedReferenceCovered, 3);
  assert.equal(result.uniqueKnowledgeCovered, 4);
  assert.equal(result.uniqueReferenceKnowledgeGain, 1);
  assert.equal(result.conditionalKnowledgeCovered, 5);
  assert.equal(result.conditionalReferenceKnowledgeGain, 1);
  assert.equal(result.sourceRelevantCeilingCovered, 6);
});

test("reference import reconciles stale source rows and verifies its snapshot", () => {
  const importer = fs.readFileSync("scripts/catalog/import-bendix-full-reference-fitments-20261025.mjs", "utf8");
  assert.match(importer, /desiredProductLinkKeys/);
  assert.match(importer, /desiredFitmentKeys/);
  assert.match(importer, /application_id.*part_reference_id.*position.*data_source_id/s);
  assert.match(importer, /staleSourceFitments/);
  assert.match(importer, /Reference fitment readback mismatch/);
});
