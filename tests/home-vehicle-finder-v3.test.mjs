import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vehicleCatalog = readFileSync("lib/queries/vehicle-catalog.ts", "utf8");
const vehicleProductFitment = readFileSync("lib/queries/vehicle-product-fitment.ts", "utf8");
const finder = readFileSync("components/vehicle-parts-finder.tsx", "utf8");
const categoryPage = readFileSync("app/parts/[category]/page.tsx", "utf8");
const applicationRoute = readFileSync("app/api/vehicles/applications/route.ts", "utf8");
const vehicleContext = readFileSync("lib/vehicle-context.ts", "utf8");
const serverVehicleContext = readFileSync("lib/server/vehicle-context.ts", "utf8");
const vehicleContextSynchronizer = readFileSync("components/vehicle-context-synchronizer.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

test("home vehicle finder reads only the new NexAuto V3 vehicle backbone", () => {
  assert.match(vehicleCatalog, /NEXAUTO_V3:%/);
  assert.match(vehicleCatalog, /\.like\("source_application_key", VEHICLE_CATALOG_V3_SOURCE_PATTERN\)/);
  assert.match(finder, /vehicleCatalogApiVersion = "v3"/);
});

test("selected vehicles filter products through published canonical fitments", () => {
  assert.match(vehicleProductFitment, /listVehicleCatalogApplicationIds/);
  assert.match(vehicleProductFitment, /\.from\("vehicle_product_fitments"\)/);
  assert.match(vehicleProductFitment, /\.eq\("fitment_status", "published"\)/);
  assert.match(categoryPage, /listProductsForVehicle/);
});

test("finder follows the latest vehicle backbone fields through an exact application id", () => {
  assert.match(vehicleCatalog, /chassisCodes: string\[\]/);
  assert.match(vehicleCatalog, /bodyConfiguration: string/);
  assert.match(vehicleCatalog, /engine: string/);
  assert.match(applicationRoute, /listVehicleCatalogApplications/);
  assert.match(finder, /Chassis \/ code/);
  assert.match(finder, /Body \/ drivetrain/);
  assert.match(finder, /applicationId: selectedApplication\.id/);
});

test("selected vehicle persists across product categories until the customer changes it", () => {
  assert.match(vehicleContext, /Max-Age=31536000/);
  assert.match(vehicleContext, /SameSite=Lax/);
  assert.match(serverVehicleContext, /await cookies\(\)/);
  assert.match(categoryPage, /readStoredVehicleContext/);
  assert.match(categoryPage, /parseVehicleSelection\(queryVehicle\) \? queryVehicle : toCategorySearchParams\(storedVehicle\)/);
  assert.match(categoryPage, /VehicleContextSynchronizer/);
  assert.match(vehicleContextSynchronizer, /saveVehicleContext\(vehicle\)/);
  assert.match(layout, /<VehicleSelectionBar \/>/);
});
