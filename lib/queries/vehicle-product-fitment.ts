import { listProducts } from "@/lib/queries/catalog";
import { listVehicleCatalogApplicationIds } from "@/lib/queries/vehicle-catalog";
import { createSupabaseServerClient } from "@/lib/supabase";
import type { Product } from "@/lib/types";
import { coverageStatus } from '@/lib/vehicle-variants';
import { resolveVehicleSelection } from '@/lib/server/resolve-vehicle-selection';
import { matchesFitmentPosition } from '@/lib/storefront-catalog';
import brakeMetadata from '@/data/brake-pads/catalog.json';

type FitmentRow = { product_variant_id: string; application_id: string };
type VariantRow = { id: string; product_id: string };
export type ProductVehicleFitmentStatus = "fits" | "conditional" | "not-listed" | "unavailable";
type VehicleSelection = { makeId: string; modelId: string; year: number; applicationId?: string; applicationIds?: string[]; variantGroup?: string };

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
    .select("product_variant_id,application_id")
    .in("application_id", applicationIds)
    .eq("fitment_status", "published");
  if (fitmentError) throw fitmentError;

  const rows = (fitmentData ?? []) as FitmentRow[];
  const variantIds = [...new Set(rows.map(row => row.product_variant_id))].filter(id => coverageStatus(applicationIds, rows.filter(row => row.product_variant_id === id).map(row => row.application_id)) === 'fits');
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
    .select("application_id,position")
    .eq("product_variant_id", variantId)
    .in("application_id", applicationIds)
    .eq("fitment_status", "published");
  if (fitmentError) throw fitmentError;
  const position=brakeMetadata.find(row=>row.sku===sku)?.position;
  return coverageStatus(applicationIds, (fitmentData ?? []).filter(row=>matchesFitmentPosition(sku.startsWith('NBP')?'brakes':'all',position?[position]:undefined,row.position)).map(row => row.application_id));
}

async function resolveSelectedApplicationIds(selection: VehicleSelection) {
  if (selection.variantGroup) {
    const resolved = await resolveVehicleSelection({ ...selection, year: String(selection.year), make: '', model: '' });
    return resolved?.applications.map(app => app.id) ?? [];
  }
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
  return selectedIds.every(id => matchingIds.has(id)) ? [...new Set(selectedIds)] : [];
}
