import assert from "node:assert/strict";
import test from "node:test";

import {
  assessWiperRows,
  expandCodeField,
  extractEngineCodes,
  matchBatteryRow,
  matchFilterRow
} from "../scripts/catalog/fitment-v4-matcher.mjs";

const nke165 = {
  source_vehicle_id: "670",
  make: "Toyota",
  model: "Corolla",
  chassis_raw: "NKE165",
  body_raw: "Sedan FWD",
  body_style: "sedan",
  engine_code: "1.5L 1NZ-FXE,1LM Petrol/Electric Hybrid FWD 54kW",
  year_start: 2013,
  year_end: 2023
};

test("expands grouped chassis and engine suffixes without fuzzy prefix matching", () => {
  assert.deepEqual(expandCodeField("AXAA54, AXAH52/54, MXGH10/12/15"), ["AXAA54", "AXAH52", "AXAH54", "MXGH10", "MXGH12", "MXGH15"]);
  assert.deepEqual(expandCodeField("A25A-FKS/FXS"), ["A25AFKS", "A25AFXS"]);
  assert.ok(extractEngineCodes("1.5L 1NZ-FXE,1LM Petrol/Electric Hybrid").includes("1NZFXE"));
});

test("battery matching uses exact chassis as its product fitment key", () => {
  const sedan = matchBatteryRow(nke165, {
    make: "Toyota", model: "Unrelated model label", chassis_code: "NKE165", body: "Wagon",
    fuel: "D", engine: "3.0", drivetrain: "AWD", year_start: 1990, year_end: 1991
  });
  assert.equal(sedan.status, "published");
  assert.equal(sedan.rule, "battery_exact_chassis");

  const wagon = matchBatteryRow(nke165, {
    make: "Toyota", model: "Corolla", chassis_code: "NKE165G", body: "Sedan",
    fuel: "H", engine: "1.5", drivetrain: "FWD", year_start: 2014, year_end: null
  });
  assert.equal(wagon.status, "none");
  assert.equal(wagon.reason, "chassis_mismatch");
});

test("filter matching uses exact engine as its product fitment key", () => {
  const matched = matchFilterRow(nke165, {
    make: "Toyota", model: "Aqua", chassis_codes: "NHP10", engine_code: "1NZ-FXE",
    engine_displacement: "1.5L", drivetrain: "FWD", year_start: 2011, year_end: 2012
  });
  assert.equal(matched.status, "published");
  assert.equal(matched.rule, "filter_exact_engine");

  const wrongEngine = matchFilterRow(nke165, {
    make: "Toyota", model: "Corolla", chassis_codes: "NKE165", engine_code: "2ZR-FE",
    engine_displacement: "1.8L", drivetrain: "FWD", year_start: 2013, year_end: 2023
  });
  assert.equal(wrongEngine.status, "none");
  assert.equal(wrongEngine.reason, "engine_mismatch");
});

test("ZWE211/ZWE219 maps battery by chassis and filter by engine", () => {
  const vehicle = {
    make: "Toyota",
    model: "Corolla",
    chassis_raw: "ZWE211,ZWE219",
    body_raw: "Hatchback FWD",
    engine_code: "1.8L 2ZR-FXE DOHC 16v Petrol/Electric Hybrid 4cyl",
    year_start: 2018,
    year_end: 2018
  };
  const battery = matchBatteryRow(vehicle, {
    make: "Toyota", model: "COROLLA", chassis_code: "ZWE211,ZRE211,MZEA12", body: "Sedan",
    fuel: "H", engine: "1.8", drivetrain: "FWD", year_start: 2020, year_end: null
  });
  assert.equal(battery.status, "published");
  assert.equal(battery.rule, "battery_exact_chassis");

  const filter = matchFilterRow(vehicle, {
    make: "Toyota", model: "Different Toyota", chassis_codes: "DIFFERENT", engine_code: "2ZR-FXE",
    engine_displacement: "1.8L", drivetrain: "AWD", year_start: 2000, year_end: 2001
  });
  assert.equal(filter.status, "published");
  assert.equal(filter.rule, "filter_exact_engine");
});

test("wiper is published only when all overlapping evidence resolves to one configuration", () => {
  const ambiguous = assessWiperRows(nke165, [
    { row_number: 1, make: "Toyota", model: "Corolla", year_start: 2012, year_end: 2018, driver_length_in: 26, passenger_length_in: 14, rear_length_in: null },
    { row_number: 2, make: "Toyota", model: "Corolla", year_start: 2018, year_end: 2023, driver_length_in: 28, passenger_length_in: 14, rear_length_in: null }
  ]);
  assert.equal(ambiguous.status, "review");

  const unique = assessWiperRows({ ...nke165, year_end: 2017 }, [
    { row_number: 1, make: "Toyota", model: "Corolla", year_start: 2012, year_end: 2018, driver_length_in: 26, passenger_length_in: 14, rear_length_in: null },
    { row_number: 2, make: "Toyota", model: "Corolla", year_start: 2012, year_end: 2018, driver_length_in: 26, passenger_length_in: 14, rear_length_in: null }
  ]);
  assert.equal(unique.status, "published");
  assert.equal(unique.configuration_key, "26/14/-");
});
