import { createSupabaseServerClient } from "@/lib/supabase";
import type { Category, Product, ProductAttributes, ProductDetailSection, ProductVariant } from "@/lib/types";
import { isStorefrontCategoryVisible } from '@/lib/storefront-visibility';

type ProductRow = {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  price: string | number;
  description: string | null;
  detail_sections?: unknown[] | null;
  video_url?: string | null;
  images: string[] | null;
  active: boolean;
  visibility_status: "internal" | "public" | "archived";
  content_status: "generated" | "review" | "approved" | "rejected";
  commerce_status: "catalog_only" | "enquiry" | "active" | "unavailable" | "discontinued";
  checkout_enabled: boolean;
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
export type CheckoutVariantRow = VariantRow & { product_name: string; category_slug: string };

function getSupabaseOrThrow() {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return supabase;
}

function mapProduct(row: ProductRow): Product {
  const purchasable = row.active
    && row.visibility_status === "public"
    && row.content_status === "approved"
    && row.commerce_status === "active"
    && row.checkout_enabled;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category_slug,
    price: Number(row.price),
    description: row.description ?? "",
    detailSections: parseDetailSections(row.detail_sections ?? null),
    videoUrl: row.video_url ?? null,
    images: row.images ?? [],
    active: row.active,
    visibilityStatus: row.visibility_status,
    contentStatus: row.content_status,
    commerceStatus: row.commerce_status,
    checkoutEnabled: row.checkout_enabled,
    purchasable
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
  return (data as CategoryRow[]).filter(row => isStorefrontCategoryVisible(row.slug)).map(mapCategory);
}

export async function listProducts(categorySlug?: string) {
  const supabase = getSupabaseOrThrow();
  const selectColumns = "id,slug,name,category_slug,price,description,detail_sections,video_url,images,active,visibility_status,content_status,commerce_status,checkout_enabled";
  const fallbackSelectColumns = "id,slug,name,category_slug,price,description,images,active,visibility_status,content_status,commerce_status,checkout_enabled";
  let query = buildProductsQuery(supabase, selectColumns, categorySlug);

  const result = await query;
  let data: unknown[] | null = result.data;
  let error = result.error;

  if (isMissingOptionalProductContentColumn(error)) {
    const fallback = await buildProductsQuery(supabase, fallbackSelectColumns, categorySlug);
    data = fallback.data;
    error = fallback.error;
  }

  if (error) throw error;
  return (data as ProductRow[]).filter(row => isStorefrontCategoryVisible(row.category_slug)).map(mapProduct);
}

export async function getProductBySlug(slug: string) {
  const supabase = getSupabaseOrThrow();
  const result = await supabase
    .from("products")
    .select("id,slug,name,category_slug,price,description,detail_sections,video_url,images,active,visibility_status,content_status,commerce_status,checkout_enabled")
    .eq("slug", slug)
    .eq("active", true)
    .eq("visibility_status", "public")
    .single();
  let data: unknown | null = result.data;
  let error = result.error;

  if (isMissingOptionalProductContentColumn(error)) {
    const fallback = await supabase
      .from("products")
      .select("id,slug,name,category_slug,price,description,images,active,visibility_status,content_status,commerce_status,checkout_enabled")
      .eq("slug", slug)
      .eq("active", true)
      .eq("visibility_status", "public")
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const product = mapProduct(data as ProductRow);
  return isStorefrontCategoryVisible(product.category) ? product : null;
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
    .from("checkout_eligible_product_variants")
    .select("id,product_id,sku,price,stock,attributes,active,product_name,category_slug")
    .in("id", variantIds);

  if (error) throw error;
  return data as unknown as CheckoutVariantRow[];
}

function buildProductsQuery(
  supabase: ReturnType<typeof getSupabaseOrThrow>,
  columns: string,
  categorySlug?: string
) {
  let query = supabase
    .from("products")
    .select(columns)
    .eq("active", true)
    .eq("visibility_status", "public")
    .order("created_at", { ascending: false });

  if (categorySlug) {
    query = query.eq("category_slug", categorySlug);
  }

  return query;
}

function isMissingOptionalProductContentColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42703" && (error.message?.includes("detail_sections") || error.message?.includes("video_url"));
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
