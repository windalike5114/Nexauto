import fs from "node:fs";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createClient } from "@supabase/supabase-js";

// This is a server-side Node verification process; Next normally supplies this marker alias.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: new URL("../../node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
process.loadEnvFile(".env.local");
const { getBulbBySku, listBulbCatalogProducts, listBulbCatalogSkus } = await import("../../lib/queries/bulb-catalog.ts");
const { bulbCartItem } = await import("../../lib/bulbs.ts");
const { createSupabaseCheckoutProductRepository } = await import("../../lib/infrastructure/supabase/checkout-product.repository.ts");
const source = JSON.parse(fs.readFileSync("data/bulbs/catalog.json", "utf8"));
const [products, skus] = await Promise.all([listBulbCatalogProducts(), listBulbCatalogSkus()]);
assert.equal(products.length, source.length);
assert.deepEqual([...skus].sort(), source.map((row) => row.sku).sort());
const detail = await getBulbBySku("NBL5004");
assert.ok(detail);
const item = bulbCartItem(detail, 2);
const repo = createSupabaseCheckoutProductRepository();
const [trusted] = await repo.loadTrustedCartItems([{ ...item, price: 0.01, name: "Tampered", category: "wiper", bundleEligible: true }]);
assert.equal(trusted.price, detail.priceNzd);
assert.equal(trusted.productId, detail.productId);
assert.equal(trusted.variantId, detail.variantId);
assert.equal(trusted.category, "bulb");
assert.equal(trusted.bundleEligible, false);
const [legacy] = await repo.loadTrustedCartItems([{ ...item, productId: "bulb", variantId: detail.sku, price: 0.01 }]);
assert.equal(legacy.variantId, detail.variantId);
assert.equal(legacy.price, detail.priceNzd);
await assert.rejects(repo.loadTrustedCartItems([{ ...item, productId: "bulb", variantId: "NBL9999" }]));
assert.equal(await getBulbBySku("NBL9999"), null);
const publicDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const publicRows = await publicDb.from("products").select("id,product_attributes(attributes),product_variants!inner(sku)")
  .like("slug", "bulb-nbl%").eq("visibility_status", "public");
assert.equal(publicRows.error, null);
assert.equal(publicRows.data.length, source.length);
assert.ok(publicRows.data.every((row) => row.product_attributes?.attributes && row.product_variants.length === 1));
const summary = { verified: true, database_products: products.length, public_readable: publicRows.data.length,
  actual_checkout_repository: "passed", legacy_cart: "passed", rejects_unknown_sku: true,
  price_source: "product_variants.price", payment_submitted: false };
fs.writeFileSync("outputs/bulb-supabase-20261026/runtime-verification.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
