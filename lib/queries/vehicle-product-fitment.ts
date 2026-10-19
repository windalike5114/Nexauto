import { listProducts } from "@/lib/queries/catalog";
import { listVehicleCatalogApplicationIds } from "@/lib/queries/vehicle-catalog";
import { createSupabaseServerClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

type FitmentRow = { product_variant_id: string };
type VariantRow = { id: string; product_id: string };

export async function listProductsForVehicle(
  categorySlug: string,
  selection: { makeId: string; modelId: string; year: number; applicationId?: string }
): Promise<Product[]> {
  const matchingApplicationIds = await listVehicleCatalogApplicationIds(selection.makeId, selection.modelId, selection.year);
  const applicationIds = selection.applicationId
    ? matchingApplicationIds.filter((id) => id === selection.applicationId)
    : matchingApplicationIds;
  if (applicationIds.length === 0) return [];

  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for vehicle product lookup.");

  const { data: fitmentData, error: fitmentError } = await supabase
    .from("vehicle_product_fitments")
    .select("product_variant_id")
    .in("vehicle_application_id", applicationIds)
    .eq("fitment_status", "published");
  if (fitmentError) throw fitmentError;

  const variantIds = [...new Set(((fitmentData ?? []) as FitmentRow[]).map((row) => row.product_variant_id))];
  if (variantIds.length === 0) return [];

  const { data: variantData, error: variantError } = await supabase
    .from("product_variants")
    .select("id,product_id")
    .in("id", variantIds)
    .eq("active", true);
  if (variantError) throw variantError;

  const productIds = new Set(((variantData ?? []) as VariantRow[]).map((row) => row.product_id));
  const products = await listProducts(categorySlug);
  return products.filter((product) => productIds.has(product.id));
}
