import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

export const SOURCE = "NEXAUTO_BULBS_USER_CATALOGUE_V4_20261026";
export const OUT = path.resolve("outputs/bulb-supabase-20261026");

export function databaseRows(row, productId, variantId) {
  assert.match(row.sku, /^NBL\d{4}$/);
  assert.ok(row.title && row.subtitle && row.features.length && row.images.length);
  assert.ok(Number.isFinite(row.priceNzd) && row.priceNzd > 0);
  assert.equal(row.inventoryQuantity, null, "Initial source does not provide inventory quantities");
  const attributes = Object.fromEntries(row.specifications.map((spec) => [spec.label, [spec.value]]));
  assert.equal(Object.keys(attributes).length, row.specifications.length, "Duplicate specification labels");
  return {
    product: {
      id: productId, slug: `bulb-${row.sku.toLowerCase()}`, name: row.title,
      category_slug: "bulb", price: row.priceNzd, description: row.subtitle,
      detail_sections: row.features.map((body, index) => ({ title: `Feature ${index + 1}`, body })),
      images: row.images, active: true, visibility_status: "public", content_status: "approved",
      commerce_status: "active", checkout_enabled: true, content_origin: "imported",
      content_metadata: { source: SOURCE, source_url: row.sourceUrl, source_image_url: row.sourceImageUrl,
        bulb_schema_version: 1, vehicle_fitment_status: "not_supplied" }
    },
    variant: {
      id: variantId, product_id: productId, sku: row.sku, price: row.priceNzd,
      stock: 0, active: true,
      attributes: { supplier_ref: row.supplierRef, inventory_mode: "untracked",
        ...(row.packLabel ? { pack: row.packLabel } : {}) }
    },
    specs: { product_id: productId, attributes }
  };
}

function client() {
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase configuration");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const put = (name, data) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2)); };
async function query(request, label) {
  const result = await request;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

async function snapshot(db, slugs, skus) {
  const products = await query(db.from("products").select("*").in("slug", slugs), "products");
  const variants = await query(db.from("product_variants").select("*").in("sku", skus), "variants");
  const specs = products.length ? await query(db.from("product_attributes").select("*").in("product_id", products.map((row) => row.id)), "specifications") : [];
  const fitments = variants.length ? await query(db.from("vehicle_catalog_product_fitments").select("*").in("product_variant_id", variants.map((row) => row.id)), "fitments") : [];
  const line = await query(db.from("catalog_product_lines").select("*").eq("category_slug", "bulb"), "product line");
  return { products, variants, specs, fitments, line };
}

function checkRows(actual, rows, label) {
  assert.equal(actual.length, rows.length, `${label} row count`);
  for (const row of rows) {
    const stored = actual.find((entry) => (entry.id ?? entry.product_id) === (row.id ?? row.product_id));
    assert.ok(stored, `${label} missing row`);
    for (const [key, value] of Object.entries(row)) {
      if (key === "price") assert.equal(Number(stored[key]), value, `${label}.${key}`);
      else assert.deepEqual(stored[key], value, `${label}.${key}`);
    }
  }
}

async function main() {
  const db = client();
  const catalog = JSON.parse(fs.readFileSync("data/bulbs/catalog.json", "utf8"));
  assert.equal(catalog.length, new Set(catalog.map((row) => row.sku)).size);
  const slugs = catalog.map((row) => `bulb-${row.sku.toLowerCase()}`), skus = catalog.map((row) => row.sku);
  const before = await snapshot(db, slugs, skus);
  for (const row of before.products) assert.equal(row.content_metadata?.source, SOURCE, `Product ownership conflict: ${row.slug}`);
  const rows = catalog.map((row) => {
    const product = before.products.find((entry) => entry.slug === `bulb-${row.sku.toLowerCase()}`);
    const variant = before.variants.find((entry) => entry.sku === row.sku);
    if (variant) assert.equal(variant.product_id, product?.id, `Variant ownership conflict: ${row.sku}`);
    return databaseRows(row, product?.id ?? crypto.randomUUID(), variant?.id ?? crypto.randomUUID());
  });
  const summary = { products: rows.length, variants: rows.length, parameter_sets: rows.length,
    images: catalog.reduce((total, row) => total + row.images.length, 0),
    new_products: rows.length - before.products.length, new_variants: rows.length - before.variants.length,
    existing_fitments: before.fitments.length, inventory_mode: "untracked",
    source_sha256: crypto.createHash("sha256").update(JSON.stringify(catalog)).digest("hex") };
  put("plan.json", { summary, rows });
  if (!process.argv.includes("--apply") && !process.argv.includes("--verify")) {
    console.log(JSON.stringify({ mode: "report", ...summary })); return;
  }
  // Refuse to overwrite catalogue changes made in the database after initial import.
  if (before.products.length === rows.length && before.variants.length === rows.length) {
    checkRows(before.products, rows.map((row) => row.product), "products");
    checkRows(before.variants, rows.map((row) => row.variant), "variants");
    checkRows(before.specs, rows.map((row) => row.specs), "specifications");
  } else {
    assert.ok(!process.argv.includes("--verify"), "Catalogue has not been imported completely");
    assert.equal(before.products.length, 0, "Partial import exists; inspect the saved backup before continuing");
    assert.equal(before.variants.length, 0);
    const backupFile = path.join(OUT, "before.json");
    assert.ok(!fs.existsSync(backupFile), "Prior import backup exists; do not overwrite it");
    put("before.json", before);
    try {
      if (!before.line.length) await query(db.from("catalog_product_lines").insert({
        code: "bulb", name: "Light bulbs", category_slug: "bulb", specification_table: "product_attributes",
        reference_layer_enabled: false, active: true,
        metadata: { schema_version: 1, source: SOURCE, canonical_sku: "product_variants.sku",
          content_table: "products", feature_field: "detail_sections", inventory_mode_field: "product_variants.attributes.inventory_mode",
          fitment_table: "vehicle_catalog_product_fitments", fitment_key: "product_variant_id",
          fitment_status: "reserved_no_data", fitment_positions: ["headlight_low", "headlight_high", "fog_front", "indicator_front", "indicator_rear", "brake", "tail", "reverse", "number_plate", "interior"] }
      }), "register bulb line");
      await query(db.from("products").insert(rows.map(({ product }) => ({ ...product, active: false, visibility_status: "internal", checkout_enabled: false }))), "stage products");
      put("progress.json", { stage: "products_staged", ids: rows.map((row) => row.product.id) });
      await query(db.from("product_variants").insert(rows.map((row) => row.variant)), "variants");
      await query(db.from("product_attributes").insert(rows.map((row) => row.specs)), "specifications");
      const staged = await snapshot(db, slugs, skus);
      checkRows(staged.products, rows.map(({ product }) => ({ ...product, active: false, visibility_status: "internal", checkout_enabled: false })), "staged products");
      checkRows(staged.variants, rows.map((row) => row.variant), "staged variants");
      checkRows(staged.specs, rows.map((row) => row.specs), "staged specifications");
      assert.equal(staged.fitments.length, 0);
      // Publication is a single database statement, after every child record is verified.
      await query(db.from("products").update({ active: true, visibility_status: "public", checkout_enabled: true }).in("id", rows.map((row) => row.product.id)), "publish products");
      put("progress.json", { stage: "published", ids: rows.map((row) => row.product.id) });
    } catch (error) {
      put("error.json", { message: error.message, recovery: "Keep staged records; inspect before.json and progress.json before retrying. No fitment records were written." });
      throw error;
    }
  }
  const after = await snapshot(db, slugs, skus);
  checkRows(after.products, rows.map((row) => row.product), "products");
  checkRows(after.variants, rows.map((row) => row.variant), "variants");
  checkRows(after.specs, rows.map((row) => row.specs), "specifications");
  assert.equal(after.fitments.length, 0, "No bulb fitment data is authorised");
  const eligible = await query(db.from("checkout_eligible_product_variants").select("id,sku,price,stock,attributes").in("sku", skus), "checkout eligibility");
  assert.equal(eligible.length, rows.length);
  for (const row of rows) assert.equal(Number(eligible.find((entry) => entry.sku === row.variant.sku)?.price), row.variant.price);
  put("verified.json", { ...summary, verified: true, checkout_eligible: eligible.length, vehicle_fitments: after.fitments.length, at: new Date().toISOString() });
  console.log(JSON.stringify({ mode: "verified", products: rows.length, checkout_eligible: eligible.length, vehicle_fitments: after.fitments.length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main();
