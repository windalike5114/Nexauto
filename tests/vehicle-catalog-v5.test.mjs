import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261024_vehicle_catalog_v5.sql", import.meta.url), "utf8");
const importer = fs.readFileSync(new URL("../scripts/catalog/import-vehicle-library-v5.mjs", import.meta.url), "utf8");
const query = fs.readFileSync(new URL("../lib/queries/vehicle-catalog.ts", import.meta.url), "utf8");

test("V5 schema keeps normalized source identities instead of UUID projections", () => {
  for (const table of ["makes", "models", "series", "variants", "powertrains", "engine_codes", "applications", "application_years"]) {
    assert.match(migration, new RegExp(`vehicle_catalog_${table}`));
  }
  assert.match(migration, /application_id text primary key/);
  assert.match(migration, /series_id text references/);
  assert.match(migration, /primary key \(application_id, model_year\)/);
  assert.doesNotMatch(importer, /vehicle_fitment_applications|vehicle_generations/);
});

test("runtime catalogue query only reads the V5 schema", () => {
  assert.match(query, /vehicle_catalog_index/);
  assert.match(query, /vehicle_catalog_search/);
  assert.doesNotMatch(query, /NEXAUTO_V4|vehicle_fitment_applications|vehicle_generations/);
});

test("V5 importer validates references before destructive replacement", () => {
  assert.match(importer, /validatePackage\(data\)/);
  assert.match(importer, /assertSchemaReady\(db\)/);
  assert.ok(importer.indexOf("validatePackage(data)") < importer.indexOf("for (const table of DELETE_ORDER)"));
});
