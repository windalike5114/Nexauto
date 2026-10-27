import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20261029_catalog_part_reference_fitments.sql",
  "utf8"
);
const importer = fs.readFileSync(
  "scripts/catalog/import-bendix-full-reference-fitments-20261025.mjs",
  "utf8"
);

test("Bendix brake component references retain separate product-line identities", () => {
  assert.match(migration, /create table if not exists public\.catalog_product_lines/);
  assert.match(migration, /create table if not exists public\.catalog_reference_schemes/);
  assert.match(migration, /'brake_pad', 'Brake pad', 'brake-pad', 'brake_pad_variant_specs'/);
  assert.match(migration, /'brake_disc', 'Brake disc', 'brake-disc', 'brake_disc_variant_specs'/);
  assert.match(migration, /'brake_shoe', 'Brake shoe', 'brake-shoe', 'brake_shoe_variant_specs'/);
  assert.match(migration, /'brake_drum', 'Brake drum', 'brake-drum', 'brake_drum_variant_specs'/);
  assert.match(migration, /'parking_brake_shoe', 'Parking brake shoe', 'parking-brake-shoe', 'parking_brake_shoe_variant_specs'/);
  assert.match(migration, /foreign key \(product_type, reference_scheme\)[\s\S]*references public\.catalog_reference_schemes\(product_type, code\)/);
  assert.match(migration, /'brake_pad',[\s\S]*'bendix_db',[\s\S]*'Bendix DB brake pad reference'/);
  assert.match(migration, /join public\.catalog_product_lines product_lines/);
  assert.match(migration, /catalog_part_reference_products_validate_line/);
});

test("the current full-reference importer is brake-pad-only", () => {
  assert.match(importer, /const sheetName = "01刹车片"/);
  assert.match(importer, /product_type: "brake_pad"/);
  assert.match(importer, /const REFERENCE_SCHEME = "bendix_db"/);
  assert.doesNotMatch(importer, /const sheetName = "0[2345]/);
});
