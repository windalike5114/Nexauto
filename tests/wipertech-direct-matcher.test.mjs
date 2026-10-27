import assert from "node:assert/strict";
import test from "node:test";
import { canonicalModelKey, resolveWiperTechApplication, resolveWiperTechPartialApplication } from "../scripts/catalog/wipertech-direct-matcher.mjs";

function source(overrides = {}) {
  return {
    vehicleId: "wt-1", make: "Toyota", model: "RAV4", series: "XA50", body: "SUV",
    yearStart: 2019, yearEnd: 2026,
    positions: { driver: { sizeInch: 26 }, passenger: { sizeInch: 16 }, rear: { sizeInch: 12 } },
    ...overrides
  };
}

const application = {
  applicationId: "ap-1", make: "Toyota", model: "RAV4", seriesCode: "XA50", bodyStyle: "SUV",
  years: [2020, 2021, 2022]
};

test("publishes a configuration only when every application year is covered without a chassis match", () => {
  const result = resolveWiperTechApplication(application, [source()]);
  assert.equal(result.status, "published");
  assert.equal(result.rule, "authoritative_series_all_catalog_years");
  assert.equal(result.configurationKey, "26/16/12");

  const incomplete = resolveWiperTechApplication({ ...application, seriesCode: "", years: [2018, 2019] }, [source()]);
  assert.equal(incomplete.status, "review");
  assert.equal(incomplete.reason, "incomplete_year_coverage");
  assert.deepEqual(incomplete.missingYears, [2018]);
});

test("uses NexAuto years after an authoritative chassis match", () => {
  const result = resolveWiperTechPartialApplication({ ...application, years: [2018, 2019, 2027] }, [source()]);
  assert.equal(result.status, "published");
  assert.equal(result.rule, "authoritative_series_all_catalog_years");
  assert.equal(result.configurationKey, "26/16/12");
});

test("matches a WiperTech platform code contained in a detailed NexAuto chassis code", () => {
  const result = resolveWiperTechPartialApplication({
    applicationId: "blade-zre152", make: "Toyota", model: "Blade", seriesCode: "ZRE152",
    bodyStyle: "Hatchback", years: [2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013]
  }, [source({
    make: "Toyota", model: "BLADE", series: "E15", yearStart: 2006, yearEnd: 2012,
    positions: { driver: { sizeInch: 26 }, passenger: { sizeInch: 16 }, rear: { sizeInch: 12 } }
  })]);
  assert.equal(result.status, "published");
  assert.equal(result.rule, "authoritative_series_all_catalog_years");
  assert.equal(result.configurationKey, "26/16/12");
});

test("does not use a two-character partial chassis match", () => {
  const result = resolveWiperTechPartialApplication({ ...application, seriesCode: "XA10", years: [2018] }, [
    source({ series: "A1", yearStart: 2019, yearEnd: 2026 })
  ]);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "incomplete_year_coverage");
});

test("uses exact series to resolve overlapping generation configurations", () => {
  const result = resolveWiperTechApplication(application, [
    source(),
    source({ vehicleId: "wt-2", series: "XA40", positions: { driver: { sizeInch: 24 }, passenger: { sizeInch: 16 }, rear: null } })
  ]);
  assert.equal(result.status, "published");
  assert.equal(result.rule, "authoritative_series_all_catalog_years");
  assert.equal(result.frontKey, "26/16");
});

test("publishes the only configuration that covers the application's complete year range", () => {
  const result = resolveWiperTechApplication(application, [
    source(),
    source({ vehicleId: "wt-boundary", yearStart: 2019, yearEnd: 2020, positions: { driver: { sizeInch: 24 }, passenger: { sizeInch: 16 }, rear: null } })
  ]);
  assert.equal(result.status, "published");
  assert.equal(result.rule, "single_configuration_covers_full_application_range");
  assert.equal(result.frontKey, "26/16");
});

test("keeps unresolved configurations in review", () => {
  const result = resolveWiperTechApplication({ ...application, seriesCode: "", seriesName: "", bodyStyle: "" }, [
    source(),
    source({ vehicleId: "wt-2", series: "XA40", positions: { driver: { sizeInch: 24 }, passenger: { sizeInch: 16 }, rear: null } })
  ]);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "multiple_front_configurations");
  assert.deepEqual(result.candidateFrontKeys, ["24/16", "26/16"]);
});

test("may corroborate an existing published front configuration without guessing", () => {
  const result = resolveWiperTechApplication({ ...application, seriesCode: "", seriesName: "", bodyStyle: "", currentFrontKey: "24/16" }, [
    source(),
    source({ vehicleId: "wt-2", positions: { driver: { sizeInch: 24 }, passenger: { sizeInch: 16 }, rear: null } })
  ]);
  assert.equal(result.status, "published");
  assert.equal(result.rule, "existing_published_configuration_corroborated");
  assert.equal(result.frontKey, "24/16");
});

test("normalizes the catalogue Sprinter model alias", () => {
  assert.equal(canonicalModelKey("Mercedes-Benz", "Sprinter 3,5-T"), canonicalModelKey("Mercedes-Benz", "Sprinter"));
});

test("normalizes model punctuation and spacing without crossing makes", () => {
  assert.equal(canonicalModelKey("Toyota", "Town Ace"), canonicalModelKey("Toyota", "Townace"));
  assert.equal(canonicalModelKey("Ford", "F-150"), canonicalModelKey("Ford", "F150"));
  assert.notEqual(canonicalModelKey("Ford", "F150"), canonicalModelKey("Toyota", "F150"));
});

test("normalizes make-specific Series and Class model suffixes", () => {
  assert.equal(canonicalModelKey("BMW", "3"), canonicalModelKey("BMW", "3 Series"));
  assert.equal(canonicalModelKey("Mercedes-Benz", "CLA"), canonicalModelKey("Mercedes Benz", "CLA Class"));
  assert.notEqual(canonicalModelKey("Toyota", "3"), canonicalModelKey("Toyota", "3 Series"));
});

test("publishes trusted partial and rear-only WiperTech configurations", () => {
  const singleFront = resolveWiperTechPartialApplication(application, [
    source({ positions: { driver: { sizeInch: 25 }, passenger: null, rear: { sizeInch: 7 } } })
  ]);
  assert.equal(singleFront.status, "published");
  assert.equal(singleFront.configurationKey, "25/-/7");
  assert.equal(singleFront.passengerLengthIn, null);

  const rearOnly = resolveWiperTechPartialApplication(application, [
    source({ positions: { driver: null, passenger: null, rear: { sizeInch: 12 } } })
  ]);
  assert.equal(rearOnly.status, "published");
  assert.equal(rearOnly.configurationKey, "-/-/12");
});

test("does not use the old published configuration to break a WiperTech ambiguity", () => {
  const result = resolveWiperTechPartialApplication({ ...application, currentFrontKey: "24/16" }, [
    source(),
    source({ vehicleId: "wt-2", positions: { driver: { sizeInch: 24 }, passenger: { sizeInch: 16 }, rear: null } })
  ]);
  assert.equal(result.status, "review");
  assert.equal(result.reason, "multiple_wipertech_configurations");
});

test("propagates a unique front size while omitting an ambiguous rear size", () => {
  const result = resolveWiperTechPartialApplication(application, [
    source({ vehicleId: "wt-hatch", body: "HATCH", positions: { driver: { sizeInch: 26 }, passenger: { sizeInch: 16 }, rear: { sizeInch: 12 } } }),
    source({ vehicleId: "wt-sedan", body: "SEDAN", positions: { driver: { sizeInch: 26 }, passenger: { sizeInch: 16 }, rear: null } }),
    source({ vehicleId: "wt-wagon", body: "WAGON", positions: { driver: { sizeInch: 26 }, passenger: { sizeInch: 16 }, rear: { sizeInch: 14 } } })
  ]);
  assert.equal(result.status, "published");
  assert.equal(result.frontKey, "26/16");
  assert.equal(result.rearLengthIn, null);
  assert.equal(result.rearResolution, "ambiguous_omitted");
});
