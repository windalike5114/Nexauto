import assert from "node:assert/strict";
import test from "node:test";
import { buildWiperTechRecords, matchWiperTechRow, parseYearRange } from "../scripts/catalog/enrich-wipertech-fitments.mjs";

test("parses closed and open-ended year ranges", () => {
  assert.deepEqual(parseYearRange("2016-2019"), { yearStart: 2016, yearEnd: 2019 });
  assert.deepEqual(parseYearRange("2020-3000"), { yearStart: 2020, yearEnd: null });
});

test("extracts one WiperTech size per vehicle position", () => {
  const result = buildWiperTechRecords(
    [{ vehicle_id: "1", make: "Abarth", model: "124", series: "348", body: "", year_from: "2016", year_to: "2019" }],
    [{ product_id: "10", sku: "WUA-18", size_inch: "18", size_mm: "450", bayonet: "WUA" }, { product_id: "11", sku: "WUA-19", size_inch: "19", size_mm: "475", bayonet: "WUA" }],
    [{ vehicle_id: "1", product_id: "10", position: "driver" }, { vehicle_id: "1", product_id: "11", position: "passenger" }]
  );
  assert.equal(result.anomalies.length, 0);
  assert.equal(result.records[0].positions.driver.sizeInch, 18);
  assert.equal(result.records[0].positions.passenger.sizeMm, 475);
});

test("applies a unique contextual match and keeps ambiguous matches for review", () => {
  const base = { makeKey: "abarth", modelKey: "124", make: "Abarth", model: "124", body: "", yearStart: 2016, yearEnd: 2019 };
  const source = [
    { ...base, vehicleId: "1", series: "348", positions: { driver: { sizeInch: 18, sizeMm: 450, sku: "D18" }, passenger: { sizeInch: 19, sizeMm: 475, sku: "P19" }, rear: null } },
    { ...base, vehicleId: "2", series: "other", positions: { driver: { sizeInch: 24, sizeMm: 600, sku: "D24" }, passenger: { sizeInch: 16, sizeMm: 400, sku: "P16" }, rear: null } }
  ];
  const contextual = matchWiperTechRow({ make: "Abarth", model: "124", yearRange: "2015-2019", context: "2015-2019-abarth-124-348-wiper-blades", driverIn: 18, passengerIn: 19 }, source);
  assert.equal(contextual.action, "apply_all");
  assert.equal(contextual.configKey, "18/19/-");

  const ambiguous = matchWiperTechRow({ make: "Abarth", model: "124", yearRange: "2016-2019", context: "abarth-124-wiper-blades", driverIn: 18, passengerIn: 19 }, source);
  assert.equal(ambiguous.action, "review");
  assert.equal(ambiguous.status, "待审核-多个WiperTech尺寸");
});
