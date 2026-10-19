import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(path.join(process.cwd(), ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase production credentials.");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const products = await selectAll(supabase.from("products").select("id,category_slug,checkout_enabled,content_status,commerce_status,visibility_status,content_metadata").in("category_slug", ["filter", "battery"]));
const v3Products = products.filter((row) => row.content_metadata?.parser_version === 3);
const productIds = v3Products.map((row) => row.id);
const variants = productIds.length ? await selectInChunks("product_variants", "id,product_id,sku,stock,price,active", "product_id", productIds) : [];
const eligible = variants.length ? await selectInChunks("checkout_eligible_product_variants", "id,product_id,sku", "product_id", productIds) : [];
const applications = await selectAll(supabase.from("vehicle_fitment_applications").select("id,fitment_status,source_application_key").like("source_application_key", "NEXAUTO_V3:%"));
const fitments = await selectAll(supabase.from("vehicle_product_fitments").select("id,fitment_status,notes").like("notes", "Imported from clean mapping row %"));
const identifiers = variants.length ? await selectInChunks("product_identifiers", "id,product_variant_id,identifier_type", "product_variant_id", variants.map((row) => row.id)) : [];
const wiperSets = await selectAll(supabase.from("wiper_sets").select("sku,driver_length_in,passenger_length_in,rear_length_in,checkout_enabled,content_status,commerce_status"));
const invalidPurchasableWipers = wiperSets.filter((row) => row.checkout_enabled && (!approvedFront(row.driver_length_in) || !approvedFront(row.passenger_length_in) || (row.rear_length_in !== null && !approvedRear(row.rear_length_in))));

const counts = {
  products_total: v3Products.length,
  filters: v3Products.filter((row) => row.category_slug === "filter").length,
  batteries: v3Products.filter((row) => row.category_slug === "battery").length,
  product_variants: variants.length,
  public_previews: v3Products.filter((row) => row.visibility_status === "public" && row.content_status === "generated" && row.commerce_status === "catalog_only" && row.checkout_enabled === false).length,
  checkout_eligible_variants: eligible.length,
  canonical_vehicle_applications: applications.length,
  published_vehicle_applications: applications.filter((row) => row.fitment_status === "published").length,
  review_vehicle_applications: applications.filter((row) => row.fitment_status === "review").length,
  vehicle_product_fitments: fitments.length,
  supplier_identifiers: identifiers.filter((row) => row.identifier_type === "supplier_sku").length,
  cross_reference_identifiers: identifiers.filter((row) => row.identifier_type === "cross_reference").length,
  invalid_purchasable_wiper_sets: invalidPurchasableWipers.length
};

const expected = { products_total: 225, filters: 123, batteries: 102, product_variants: 225, public_previews: 225, checkout_eligible_variants: 0, canonical_vehicle_applications: 773, published_vehicle_applications: 750, review_vehicle_applications: 23, vehicle_product_fitments: 4635, supplier_identifiers: 225, cross_reference_identifiers: 127, invalid_purchasable_wiper_sets: 0 };
const mismatches = Object.entries(expected).filter(([keyName, value]) => counts[keyName] !== value).map(([keyName, value]) => ({ key: keyName, expected: value, actual: counts[keyName] }));
console.log(JSON.stringify({ ok: mismatches.length === 0, counts, mismatches }, null, 2));
if (mismatches.length) process.exitCode = 1;

async function selectAll(query, pageSize = 1000) { const rows = []; for (let from = 0; ; from += pageSize) { const { data, error } = await query.range(from, from + pageSize - 1); if (error) throw error; rows.push(...data); if (data.length < pageSize) return rows; } }
async function selectInChunks(table, columns, column, values, chunkSize = 200) { const result = []; for (let index = 0; index < values.length; index += chunkSize) { const rows = await selectAll(supabase.from(table).select(columns).in(column, values.slice(index, index + chunkSize))); result.push(...rows); } return result; }
function approvedFront(value) { return [14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30].includes(Number(value)); }
function approvedRear(value) { return [8, 10, 11, 12, 13, 14, 15, 16].includes(Number(value)); }
function loadEnvFile(filePath) { if (!fs.existsSync(filePath)) return; for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith("#")) continue; const separator = trimmed.indexOf("="); if (separator <= 0) continue; const name = trimmed.slice(0, separator).trim(); let value = trimmed.slice(separator + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); if (!(name in process.env)) process.env[name] = value; } }
