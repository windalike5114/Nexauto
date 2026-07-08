import { createSupabaseServerClient } from "@/lib/supabase";
import type { Category, Product, ProductAttributes, ProductDetailSection, ProductVariant } from "@/lib/types";

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  price: string | number;
  description: string | null;
  detail_sections: unknown[] | null;
  video_url: string | null;
  images: string[] | null;
  active: boolean;
};

type CategoryRow = {
  slug: string;
  name: string;
  description: string | null;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  price: string | number;
  stock: number;
  attributes: Record<string, string | number>;
  active: boolean;
};

export type ProductRelation = { name: string; category_slug?: string } | Array<{ name: string; category_slug?: string }> | null;
export type AdminStockRow = VariantRow & { products: ProductRelation };
export type CheckoutVariantRow = VariantRow & { products: ProductRelation };

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return supabase;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    price: Number(row.price),
    description: row.description ?? "",
    detailSections: parseDetailSections(row.detail_sections),
    videoUrl: row.video_url,
    images: row.images ?? [],
    active: row.active
  };
}

function mapCategory(row: CategoryRow): Category {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description ?? ""
  };
}

function mapVariant(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    price: Number(row.price),
    stock: row.stock,
    attributes: row.attributes ?? {},
    active: row.active
  };
}

export async function listCategories() {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase.from("categories").select("slug,name,description").order("sort_order");

  if (error) throw error;
  return (data as CategoryRow[]).map(mapCategory);
}

export async function listProducts(categorySlug?: string) {
  const supabase = getSupabaseOrThrow();
  let query = supabase
    .from("products")
    .select("id,slug,name,category_slug,price,description,detail_sections,video_url,images,active")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (categorySlug) {
    query = query.eq("category_slug", categorySlug);
  }

  const { data, error } = await query;

  if (error) throw error;
  return (data as ProductRow[]).map(mapProduct);
}

export async function getProductBySlug(slug: string) {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("products")
    .select("id,slug,name,category_slug,price,description,detail_sections,video_url,images,active")
    .eq("slug", slug)
    .eq("active", true)
    .single();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  return mapProduct(data as ProductRow);
}

export async function getProductAttributes(productId: string) {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("product_attributes")
    .select("attributes")
    .eq("product_id", productId)
    .single();

  if (error) {
    if (error.code === "PGRST116") return {};
    throw error;
  }

  return (data.attributes ?? {}) as ProductAttributes;
}

export async function listProductVariants(productId: string) {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id,product_id,sku,price,stock,attributes,active")
    .eq("product_id", productId)
    .eq("active", true)
    .order("sku");

  if (error) throw error;
  return (data as VariantRow[]).map(mapVariant);
}

export async function listAdminStock() {
  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id,product_id,sku,price,stock,attributes,active,products(name)")
    .order("sku");

  if (error) throw error;
  return data as unknown as AdminStockRow[];
}

export async function getVariantsByIds(variantIds: string[]) {
  if (variantIds.length === 0) return [];

  const supabase = getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id,product_id,sku,price,stock,attributes,active,products(name,category_slug)")
    .in("id", variantIds)
    .eq("active", true);

  if (error) throw error;
  return data as unknown as CheckoutVariantRow[];
}

function parseDetailSections(value: unknown[] | null): ProductDetailSection[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const title = "title" in entry ? String((entry as { title: unknown }).title ?? "") : "";
      const body = "body" in entry ? String((entry as { body: unknown }).body ?? "") : "";
      if (!title.trim() || !body.trim()) return null;
      return { title, body };
    })
    .filter((entry): entry is ProductDetailSection => Boolean(entry));
}
