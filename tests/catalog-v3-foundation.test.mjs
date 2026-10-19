import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261021_catalog_v3_product_foundation.sql", "utf8");
const importer = readFileSync("scripts/catalog/prepare-clean-catalog-v3.mjs", "utf8");
const categoryPage = readFileSync("app/parts/[category]/page.tsx", "utf8");

test("catalog V3 stores supplier identifiers and cross references separately", () => {
  assert.match(migration, /create table if not exists public\.product_identifiers/);
  assert.match(migration, /'supplier_sku', 'cross_reference', 'oe', 'alternate'/);
  assert.match(importer, /identifier_type: "cross_reference"/);
});

test("filter and battery specifications extend the shared product model", () => {
  assert.match(migration, /create table if not exists public\.filter_variant_specs/);
  assert.match(migration, /create table if not exists public\.battery_variant_specs/);
  assert.match(migration, /product_variant_id uuid primary key references public\.product_variants/);
});

test("fitment provenance remains auditable", () => {
  assert.match(migration, /create table if not exists public\.vehicle_product_fitment_evidence/);
  assert.match(migration, /import_batch_id uuid not null references public\.catalog_import_batches/);
  assert.match(migration, /revoke all on public\.vehicle_product_fitment_evidence from anon, authenticated/);
});

test("new vehicle applications have a stable source identity", () => {
  assert.match(migration, /source_application_key text/);
  assert.match(migration, /vehicle_fitment_applications_source_key_uidx/);
  assert.match(importer, /source_application_key: `NEXAUTO_V3:\$\{row\.source_vehicle_id\}`/);
});

test("all generated filter and battery products are preview-only", () => {
  assert.match(importer, /visibility_status: "public"/);
  assert.match(importer, /content_status: "generated"/);
  assert.match(importer, /commerce_status: "catalog_only"/);
  assert.match(importer, /checkout_enabled: false/);
  assert.match(categoryPage, /product\.purchasable \? formatMoney\(product\.price\) : "Preview"/);
});
