import { listProducts } from "@/lib/queries/catalog";
import { listVehicleCatalogApplicationIds } from "@/lib/queries/vehicle-catalog";
import { createSupabaseServerClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";

type FitmentRow = { product_variant_id: string };
type VariantRow = { id: string; product_id: string };
export type ProductVehicleFitmentStatus = "fits" | "not-listed" | "unavailable";
type VehicleSelection = { makeId: string; modelId: string; year: number; applicationId?: string; applicationIds?: string[] };

export async function listProductsForVehicle(
  categorySlug: string,
  selection: VehicleSelection
): Promise<Product[]> {
  const products = await listAllProductsForVehicle(selection);
  return products.filter((product) => product.category === categorySlug);
}

export async function listAllProductsForVehicle(
  selection: VehicleSelection
): Promise<Product[]> {
  const applicationIds = await resolveSelectedApplicationIds(selection);
  if (applicationIds.length === 0) return [];

  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for vehicle product lookup.");

  const { data: fitmentData, error: fitmentError } = await supabase
    .from("vehicle_catalog_product_fitments")
    .select("product_variant_id")
    .in("application_id", applicationIds)
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
  const products = await listProducts();
  return products.filter((product) => productIds.has(product.id));
}

export async function getProductFitmentStatusForVehicle(
  sku: string,
  selection: VehicleSelection
): Promise<ProductVehicleFitmentStatus> {
  const applicationIds = await resolveSelectedApplicationIds(selection);
  if (applicationIds.length === 0) return "not-listed";

  const supabase = createSupabaseServerClient();
  if (!supabase) return "unavailable";

  const { data: variantData, error: variantError } = await supabase
    .from("product_variants")
    .select("id")
    .eq("sku", sku)
    .eq("active", true)
    .limit(1);
  if (variantError) throw variantError;
  const variantId = (variantData?.[0] as { id: string } | undefined)?.id;
  if (!variantId) return "unavailable";

  const { data: fitmentData, error: fitmentError } = await supabase
    .from("vehicle_catalog_product_fitments")
    .select("application_id")
    .eq("product_variant_id", variantId)
    .in("application_id", applicationIds)
    .eq("fitment_status", "published")
    .limit(1);
  if (fitmentError) throw fitmentError;
  return fitmentData?.length ? "fits" : "not-listed";
}

async function resolveSelectedApplicationIds(selection: VehicleSelection) {
  const matchingApplicationIds = await listVehicleCatalogApplicationIds(selection.makeId, selection.modelId, selection.year);
  const selectedIds = selection.applicationIds?.length
    ? selection.applicationIds
    : selection.applicationId
      ? [selection.applicationId]
      : [];

  // A product may only be checked against the exact application(s) saved by
  // the vehicle selector. Never widen a detail/list decision to every vehicle
  // sharing only make, model and year.
  if (selectedIds.length === 0) return [];
  const matchingIds = new Set(matchingApplicationIds);
  return [...new Set(selectedIds)].filter((id) => matchingIds.has(id));
}
