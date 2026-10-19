import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

loadEnvFile(path.join(process.cwd(), ".env.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase production credentials.");
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const applications = await selectAll(supabase.from("vehicle_fitment_applications").select("id,source_application_key").like("source_application_key", "NEXAUTO_V3:%"));
const applicationIds = new Set(applications.map((row) => row.id));
const sourceIdByApplication = new Map(applications.map((row) => [row.id, String(row.source_application_key).slice("NEXAUTO_V3:".length)]));
const variants = await selectAll(supabase.from("product_variants").select("id,sku,products!inner(category_slug,checkout_enabled,commerce_status,content_origin)").in("products.category_slug", ["battery", "filter"]));
const variantById = new Map(variants.map((row) => [row.id, row]));
const productRows = (await selectAll(supabase.from("vehicle_product_fitments").select("id,vehicle_application_id,product_variant_id,fitment_status,notes").eq("fitment_status", "published")))
  .filter((row) => applicationIds.has(row.vehicle_application_id) && variantById.has(row.product_variant_id));
const wiperRows = (await selectAll(supabase.from("vehicle_wiper_fitments").select("id,vehicle_application_id,wiper_configuration_id,fitment_status,notes").eq("fitment_status", "published")))
  .filter((row) => applicationIds.has(row.vehicle_application_id));

const counts = { battery: 0, filter: 0, wiper: wiperRows.length };
for (const row of productRows) counts[variantById.get(row.product_variant_id).products.category_slug] += 1;
const nkeApplication = applications.find((row) => sourceIdByApplication.get(row.id) === "670");
const nkeBatteries = productRows.filter((row) => row.vehicle_application_id === nkeApplication.id && variantById.get(row.product_variant_id).products.category_slug === "battery");
const nkeSkus = nkeBatteries.map((row) => variantById.get(row.product_variant_id).sku);
const nkeFilterSkus = productRows.filter((row) => row.vehicle_application_id === nkeApplication.id && variantById.get(row.product_variant_id).products.category_slug === "filter").map((row) => variantById.get(row.product_variant_id).sku).sort();
const zweApplication = applications.find((row) => sourceIdByApplication.get(row.id) === "672");
const zweBatterySkus = productRows.filter((row) => row.vehicle_application_id === zweApplication.id && variantById.get(row.product_variant_id).products.category_slug === "battery").map((row) => variantById.get(row.product_variant_id).sku).sort();
const zweFilterSkus = productRows.filter((row) => row.vehicle_application_id === zweApplication.id && variantById.get(row.product_variant_id).products.category_slug === "filter").map((row) => variantById.get(row.product_variant_id).sku).sort();
const generatedVariants = variants.filter((row) => row.products.content_origin === "generated");
const unsafeProducts = generatedVariants.filter((row) => row.products.checkout_enabled !== false || row.products.commerce_status !== "catalog_only");
const staleV3 = productRows.filter((row) => !String(row.notes).startsWith("NEXAUTO_PRODUCT_MAPPING_V4"));

const expected = { battery: 833, filter: 282, wiper: 382 };
if (JSON.stringify(counts) !== JSON.stringify(expected)) throw new Error(`Published count mismatch: ${JSON.stringify(counts)} expected ${JSON.stringify(expected)}`);
if (nkeSkus.length !== 1 || nkeSkus[0] !== "BAT-S34B20R") throw new Error(`NKE165 mismatch: ${nkeSkus.join(",") || "none"}`);
if (JSON.stringify(nkeFilterSkus) !== JSON.stringify(["TOPSTAR-J650B", "TOPSTAR-UJ1671B"])) throw new Error(`NKE165 filter mismatch: ${nkeFilterSkus.join(",") || "none"}`);
if (JSON.stringify(zweBatterySkus) !== JSON.stringify(["BAT-LN1MF"])) throw new Error(`ZWE211/ZWE219 battery mismatch: ${zweBatterySkus.join(",") || "none"}`);
if (JSON.stringify(zweFilterSkus) !== JSON.stringify(["TOPSTAR-J650B", "TOPSTAR-UJ1671B", "TOPSTAR-UJ2666L20"])) throw new Error(`ZWE211/ZWE219 filter mismatch: ${zweFilterSkus.join(",") || "none"}`);
if (unsafeProducts.length) throw new Error(`${unsafeProducts.length} generated products unexpectedly allow commerce: ${unsafeProducts.map((row) => row.sku).join(", ")}.`);
if (staleV3.length) throw new Error(`${staleV3.length} published V3 product mappings are not V4.`);

console.log(JSON.stringify({
  status: "ok",
  published_counts: counts,
  nke165_application_id: nkeApplication.id,
  nke165_battery_skus: nkeSkus,
  nke165_filter_skus: nkeFilterSkus,
  zwe211_219_battery_skus: zweBatterySkus,
  zwe211_219_filter_skus: zweFilterSkus,
  stale_published_v3_links: staleV3.length,
  purchasable_generated_products: unsafeProducts.length
}, null, 2));

async function selectAll(query, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(name in process.env)) process.env[name] = value;
  }
}
