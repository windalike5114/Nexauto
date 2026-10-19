import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261020_catalog_publication_safety.sql", "utf8");
const catalogQuery = readFileSync("lib/queries/catalog.ts", "utf8");
const checkoutRepository = readFileSync("lib/infrastructure/supabase/checkout-product.repository.ts", "utf8");
const productPage = readFileSync("app/products/[id]/page.tsx", "utf8");
const wiperPage = readFileSync("app/wipers/[sku]/page.tsx", "utf8");
const wiperQuery = readFileSync("lib/queries/wiper-commerce.ts", "utf8");

test("generated catalogue records default to non-purchasable lifecycle states", () => {
  assert.match(migration, /visibility_status text not null default 'internal'/);
  assert.match(migration, /content_status text not null default 'generated'/);
  assert.match(migration, /commerce_status text not null default 'catalog_only'/);
  assert.match(migration, /checkout_enabled boolean not null default false/);
});

test("database constraints prevent checkout before explicit approval", () => {
  assert.match(migration, /products_checkout_state_check/);
  assert.match(migration, /wiper_sets_checkout_state_check/);
  assert.match(migration, /content_status = 'approved'/);
  assert.match(migration, /commerce_status = 'active'/);
  assert.match(migration, /checkout_enabled = true/);
});

test("standard product checkout uses the fail-closed eligibility view", () => {
  assert.match(migration, /checkout_eligible_product_variants/);
  assert.match(catalogQuery, /\.from\("checkout_eligible_product_variants"\)/);
  assert.doesNotMatch(catalogQuery, /\.from\("product_variants"\)[\s\S]{0,180}products\(name,category_slug\)/);
});

test("catalog-only pages render a preview instead of purchase controls", () => {
  assert.match(productPage, /product\.purchasable && !needsContactSupport/);
  assert.match(productPage, /Catalogue preview — purchasing is disabled/);
  assert.match(wiperPage, /wiperSet\.purchasable/);
  assert.match(wiperPage, /This wiper set is being reviewed/);
});

test("wiper checkout requires approved active commerce state", () => {
  assert.match(wiperQuery, /\.eq\("content_status", "approved"\)/);
  assert.match(wiperQuery, /\.eq\("commerce_status", "active"\)/);
  assert.match(wiperQuery, /\.eq\("checkout_enabled", true\)/);
});

test("checkout accepts only canonical vehicle references", () => {
  assert.match(checkoutRepository, /Legacy vehicle fitment references are no longer accepted/);
  assert.doesNotMatch(checkoutRepository, /\.from\("vehicle_applications"\)/);
  assert.match(checkoutRepository, /\.from\("vehicle_fitment_applications"\)/);
});

test("production checkout cannot use the database-bypassing test product", () => {
  assert.match(checkoutRepository, /Checkout test products are disabled/);
  assert.match(checkoutRepository, /process\.env\.NODE_ENV !== "production"/);
  assert.match(checkoutRepository, /ENABLE_CHECKOUT_TEST_PRODUCT === "true"/);
});
