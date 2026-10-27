import assert from "node:assert/strict";
import test from "node:test";
import { engineLabelWithCodes, groupCatalogModels, groupIdenticalOptions } from "../lib/vehicle-catalog-display";

test("market aliases preserve source model identities and all available years", () => {
  const rows = groupCatalogModels("TOYOTA", [
    { id: "yaris", name: "YARIS", years: [2017, 2021] },
    { id: "vitz", name: "VITZ", years: [2015, 2017] },
    { id: "cross", name: "YARIS CROSS", years: [2021] },
    { id: "verso", name: "YARIS VERSO", years: [2005] }
  ]);
  assert.equal(rows.length, 3);
  const family = rows.find((row) => row.id === "vitz")!;
  assert.equal(family.name, "Vitz / Yaris");
  assert.deepEqual(family.modelIds, ["vitz", "yaris"]);
  assert.deepEqual(family.years, [2021, 2017, 2015]);
});

test("formatting duplicates collapse without losing significant plus symbols", () => {
  const rows = groupCatalogModels("SUZUKI", [
    { id: "a", name: "WAGON R", years: [2015] },
    { id: "b", name: "WAGON-R", years: [2016] },
    { id: "c", name: "WAGON R+", years: [2015] }
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.id === "a")!.modelIds, ["a", "b"]);
  assert.deepEqual(rows.find((row) => row.id === "c")!.modelIds, ["c"]);
});

test("a shared series option retains every underlying series identifier", () => {
  const rows = groupIdenticalOptions([{ id: "one", name: "NZE161" }, { id: "two", name: "NZE 161" }, { id: "three", name: "NZE164" }]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((row) => row.id === "one")!.ids, ["one", "two"]);
});

test("hybrid engines with abbreviated identical labels retain distinct engine codes", () => {
  const display = "1.5L Petrol/Electric 4-cyl — LEB";
  const raw = ["1.5L LEB-H1,LEB DOHC 16v Petrol/Electric Hybrid Direct Inj. 4cyl", "1.5L LEB-H1 DOHC 16v Petrol/Electric Hybrid Direct Inj. 4cyl", "1.5L LEB DOHC 16v Petrol/Electric Hybrid Direct Inj. 4cyl"];
  const labels = raw.map((name) => engineLabelWithCodes(display, name));
  assert.equal(new Set(labels).size, 3);
  assert.ok(labels[0].endsWith("LEB-H1 / LEB"));
  assert.ok(labels[1].endsWith("LEB-H1"));
  assert.ok(labels[2].endsWith("LEB"));
  assert.equal(engineLabelWithCodes("Unknown", "Electric single motor"), "Electric single motor");
});
