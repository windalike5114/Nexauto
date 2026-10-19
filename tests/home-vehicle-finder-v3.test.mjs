import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vehicleCatalog = readFileSync("lib/queries/vehicle-catalog.ts", "utf8");
const vehicleProductFitment = readFileSync("lib/queries/vehicle-product-fitment.ts", "utf8");
const finder = readFileSync("components/vehicle-parts-finder.tsx", "utf8");
const partsPage = readFileSync("app/parts/page.tsx", "utf8");
const partsBrowser = readFileSync("components/compatible-parts-browser.tsx", "utf8");
const applicationRoute = readFileSync("app/api/vehicles/applications/route.ts", "utf8");
const vehicleContext = readFileSync("lib/vehicle-context.ts", "utf8");
const serverVehicleContext = readFileSync("lib/server/vehicle-context.ts", "utf8");
const vehicleContextSynchronizer = readFileSync("components/vehicle-context-synchronizer.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");
const siteHeader = readFileSync("components/site-header.tsx", "utf8");

test("home vehicle finder reads only the new NexAuto V3 vehicle backbone", () => {
  assert.match(vehicleCatalog, /NEXAUTO_V3:%/);
  assert.match(vehicleCatalog, /\.like\("source_application_key", VEHICLE_CATALOG_V3_SOURCE_PATTERN\)/);
  assert.match(finder, /vehicleCatalogApiVersion = "v3"/);
});

test("selected vehicles filter products through published canonical fitments", () => {
  assert.match(vehicleProductFitment, /listVehicleCatalogApplicationIds/);
  assert.match(vehicleProductFitment, /\.from\("vehicle_product_fitments"\)/);
  assert.match(vehicleProductFitment, /\.eq\("fitment_status", "published"\)/);
  assert.match(partsPage, /listAllProductsForVehicle/);
});

test("finder follows the latest vehicle backbone fields through an exact application id", () => {
  assert.match(vehicleCatalog, /chassisCodes: string\[\]/);
  assert.match(vehicleCatalog, /bodyConfiguration: string/);
  assert.match(vehicleCatalog, /engine: string/);
  assert.match(applicationRoute, /listVehicleCatalogApplications/);
  assert.match(finder, /Chassis \/ code/);
  assert.match(finder, /Body \/ drivetrain/);
  assert.match(finder, /applicationId: selectedApplication\.id/);
  assert.match(finder, /router\.push\(partsHref/);
});

test("selected vehicle persists across product categories until the customer changes it", () => {
  assert.match(vehicleContext, /Max-Age=31536000/);
  assert.match(vehicleContext, /SameSite=Lax/);
  assert.match(serverVehicleContext, /await cookies\(\)/);
  assert.match(partsPage, /readStoredVehicleContext/);
  assert.match(partsPage, /parseVehicleSelection\(queryVehicle\) \? queryVehicle : toPartsSearchParams\(storedVehicle\)/);
  assert.match(partsPage, /VehicleContextSynchronizer/);
  assert.match(partsBrowser, /All Parts/);
  assert.match(partsBrowser, /Wipers/);
  assert.match(partsBrowser, /Batteries/);
  assert.match(partsBrowser, /Filters/);
  assert.match(partsBrowser, /window\.history\.pushState/);
  assert.match(partsBrowser, /partsTabRequestedEvent/);
  assert.match(siteHeader, /handleCategoryNavigation/);
  assert.match(siteHeader, /new CustomEvent\(partsTabRequestedEvent/);
  assert.match(vehicleContextSynchronizer, /saveVehicleContext\(vehicle\)/);
  assert.match(layout, /<VehicleSelectionBar \/>/);
});

test("vehicle catalogue endpoints filter in the database and reuse catalogue reads", () => {
  assert.match(vehicleCatalog, /unstable_cache/);
  assert.match(vehicleCatalog, /vehicle_generations\.vehicle_models\.make_id/);
  assert.match(vehicleCatalog, /vehicle_generations\.vehicle_models\.id/);
  assert.match(vehicleCatalog, /year_end\.is\.null,year_end\.gte/);
  assert.match(finder, /vehicleRequestCache/);
  assert.match(finder, /router\.prefetch/);
});

test("high-confidence wiper recommendations remain a non-purchasable review demo", () => {
  const demoRows = JSON.parse(readFileSync("data/wiper-high-confidence-demo.json", "utf8"));
  const zwe = demoRows.find((row) => row.chassisCodes.includes("ZWE211") && row.chassisCodes.includes("ZWE219"));
  const demoCard = readFileSync("components/compatible-part-card.tsx", "utf8");
  assert.equal(demoRows.length, 80);
  assert.equal(zwe.confidence, 0.8);
  assert.deepEqual(zwe.suggestedConfiguration, { driverLengthIn: 28, passengerLengthIn: 14, rearLengthIn: null });
  assert.match(demoCard, /Ordering disabled/);
  assert.match(demoCard, /not confirmed/);
  assert.doesNotMatch(demoCard, /WiperReviewDemoCard[\s\S]*addToCart/i);
});
