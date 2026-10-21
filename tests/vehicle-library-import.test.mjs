import assert from "node:assert/strict";
import test from "node:test";

import { prepareVehicleLibrary } from "../scripts/catalog/replace-vehicle-library.mjs";

const headers = ["source_vehicle_id", "品牌", "车型", "底盘代号", "车款变体", "发动机", "起始年份", "结束年份"];

test("prepares the latest vehicle library and deduplicates identical selector configurations", () => {
  const prepared = prepareVehicleLibrary([
    headers,
    ["source-1", "AUDI", "A6", "4B2|4B4", "Sedan FWD", "1.8L AWT", "1997", "2005"],
    ["source-2", "AUDI", "A6", "4B2|4B4", "Sedan FWD", "1.8L AWT", "1997", "2005"]
  ]);

  assert.equal(prepared.rows.length, 2);
  assert.equal(prepared.applications.length, 1);
  assert.equal(prepared.report.duplicate_configuration_rows, 1);
  assert.deepEqual(prepared.chassisCodes.map((row) => row.code), ["4B2", "4B4"]);
  assert.deepEqual(prepared.applications[0].source_vehicle_ids, ["source-1", "source-2"]);
});

test("rejects a vehicle library with duplicate source ids", () => {
  assert.throws(() => prepareVehicleLibrary([
    headers,
    ["source-1", "AUDI", "A3", "8L1", "Hatchback FWD", "1.9L ASV", "1997", "2001"],
    ["source-1", "AUDI", "A6", "4B2", "Sedan FWD", "1.8L AWT", "1997", "2005"]
  ]), /Duplicate source_vehicle_id/);
});

test("rejects an unexpected source schema", () => {
  assert.throws(() => prepareVehicleLibrary([["make", "model"], ["Audi", "A3"]]), /Unexpected vehicle library headers/);
});
