import { createSupabaseServerClient } from "@/lib/supabase";
import { bulbProduct, mapBulbDetail, type BulbProductRow } from "@/lib/bulbs";
import type { CheckoutVariantRow } from "@/lib/queries/catalog";

const columns = "id,slug,name,description,images,active,visibility_status,content_status,commerce_status,checkout_enabled,detail_sections,product_variants!inner(id,product_id,sku,price,stock,attributes,active),product_attributes(attributes)";

function client() {
  const db = createSupabaseServerClient();
  if (!db) throw new Error("Supabase is not configured for the bulb catalogue.");
  return db;
}

function visibleBulbs() {
  return client().from("products").select(columns)
    .eq("category_slug", "bulb").like("slug", "bulb-nbl%")
    .eq("active", true).eq("visibility_status", "public")
    .eq("product_variants.active", true);
}

export async function getBulbBySku(sku: string) {
  if (!/^NBL\d{4}$/.test(sku)) return null;
  const { data, error } = await visibleBulbs().eq("product_variants.sku", sku).maybeSingle();
  if (error) throw error;
  return data ? mapBulbDetail(data as unknown as BulbProductRow) : null;
}

export async function listBulbCatalogProducts() {
  const { data, error } = await visibleBulbs().order("slug");
  if (error) throw error;
  return (data as unknown as BulbProductRow[]).flatMap((row) => {
    const detail = mapBulbDetail(row);
    return detail ? [bulbProduct(row, detail)] : [];
  });
}

export async function listBulbCatalogSkus() {
  const { data, error } = await client().from("product_variants")
    .select("sku,products!inner(category_slug,active,visibility_status)")
    .like("sku", "NBL%").eq("active", true)
    .eq("products.category_slug", "bulb").eq("products.active", true)
    .eq("products.visibility_status", "public").order("sku");
  if (error) throw error;
  return (data ?? []).map((row) => row.sku).filter((sku) => /^NBL\d{4}$/.test(sku));
}

/** Compatibility for carts created before bulbs acquired database UUIDs. */
export async function getBulbCheckoutVariantsBySkus(skus: string[]): Promise<CheckoutVariantRow[]> {
  if (!skus.length) return [];
  const { data, error } = await client().from("checkout_eligible_product_variants")
    .select("id,product_id,sku,price,stock,attributes,active,product_name,category_slug")
    .eq("category_slug", "bulb").in("sku", skus);
  if (error) throw error;
  return (data ?? []) as CheckoutVariantRow[];
}
