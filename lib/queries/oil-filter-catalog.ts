import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase";
import {
  buildOilFilterSpecifications,
  type OilFilterConstruction,
  type OilFilterDetail
} from "@/lib/oil-filter";
import { getProductBySlug, listProductVariants } from "@/lib/queries/catalog";
import type { Product } from "@/lib/types";

type FilterSpecRow = {
  supplier_brand: string | null;
  supplier_part_number: string;
  filter_type: string;
  verification_status: OilFilterDetail["verificationStatus"];
  construction_type?: string | null;
  height_mm?: string | number | null;
  outside_diameter_mm?: string | number | null;
  inside_diameter_top_mm?: string | number | null;
  inside_diameter_bottom_mm?: string | number | null;
  thread_size?: string | null;
  seal_ring_dimensions?: string[] | null;
  pack_quantity?: number | null;
  metadata: Record<string, unknown> | null;
};

const j415Specification = {
  construction: "Cartridge" as const,
  heightMm: 154,
  outsideDiameterMm: 46,
  insideDiameterTopMm: 21,
  insideDiameterBottomMm: 21,
  sealRingDimensions: ["52 × 3.5 mm", "14 × 3.5 mm", "7.5 × 3.5 mm"],
  dimensionImageUrl: "/products/oil-filters/j-415-dimensions.svg",
  packagingImageUrl: "/products/oil-filters/filter-packaging.svg"
};

export async function getOilFilterBySlugOrPartNumber(value: string) {
  const decoded = decodeURIComponent(value).trim();
  const direct = await getProductBySlug(decoded.toLowerCase());
  if (direct?.category === "filter") return getOilFilterDetail(direct);

  const partNumber = decoded.replace(/^topstar[-_\s]*/i, "");
  const generatedSlug = `topstar-oil-filter-${slugify(partNumber)}`;
  const product = await getProductBySlug(generatedSlug);
  if (!product || product.category !== "filter") return null;
  return getOilFilterDetail(product);
}

export async function getOilFilterDetail(product: Product): Promise<OilFilterDetail | null> {
  const variants = await listProductVariants(product.id);
  const variant = variants[0];
  if (!variant) return null;

  const supabase = createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured for oil-filter catalogue lookup.");

  const specResult = await selectFilterSpec(supabase, variant.id);

  if (specResult.error) throw specResult.error;

  const spec = specResult.data as FilterSpecRow | null;
  const metadata = spec?.metadata ?? {};
  const partNumber = spec?.supplier_part_number || readString(variant.attributes.supplier_part_number) || variant.sku.replace(/^TOPSTAR-/, "");
  const brand = spec?.supplier_brand || readString(variant.attributes.supplier_brand) || "TopStar";
  const isJ415 = compactPartNumber(partNumber) === "J415";
  const construction = isJ415 ? j415Specification.construction : readConstruction(spec?.construction_type ?? metadata.construction_type);
  const heightMm = isJ415 ? j415Specification.heightMm : readNumber(spec?.height_mm ?? metadata.height_mm);
  const outsideDiameterMm = isJ415 ? j415Specification.outsideDiameterMm : readNumber(spec?.outside_diameter_mm ?? metadata.outside_diameter_mm);
  const insideDiameterTopMm = isJ415 ? j415Specification.insideDiameterTopMm : readNumber(spec?.inside_diameter_top_mm ?? metadata.inside_diameter_top_mm);
  const insideDiameterBottomMm = isJ415 ? j415Specification.insideDiameterBottomMm : readNumber(spec?.inside_diameter_bottom_mm ?? metadata.inside_diameter_bottom_mm);
  const threadSize = readString(spec?.thread_size ?? metadata.thread_size);
  const sealRingDimensions = isJ415 ? j415Specification.sealRingDimensions : readStringArray(spec?.seal_ring_dimensions ?? metadata.seal_ring_dimensions);
  const packQuantity = readNumber(spec?.pack_quantity ?? metadata.pack_quantity) ?? 1;
  const verificationStatus = isJ415 ? "review" : spec?.verification_status ?? "generated";
  const specifications = buildOilFilterSpecifications({
    brand,
    partNumber,
    construction,
    verificationStatus,
    heightMm,
    outsideDiameterMm,
    insideDiameterTopMm,
    insideDiameterBottomMm,
    threadSize,
    sealRingDimensions,
    packQuantity
  });

  return {
    product,
    variant,
    brand,
    partNumber,
    title: `${brand} ${partNumber} ${construction === "Unknown" ? "" : `${construction} `}Oil Filter`.replace(/\s+/g, " ").trim(),
    construction,
    verificationStatus,
    heightMm,
    outsideDiameterMm,
    insideDiameterTopMm,
    insideDiameterBottomMm,
    threadSize,
    sealRingDimensions,
    packQuantity,
    specifications,
    imageUrl: isJ415 ? "/products/oil-filters/cartridge-filter-with-seals.png" : product.images[0] ?? "/products/vehicle-oil-filter.png",
    dimensionImageUrl: isJ415 ? j415Specification.dimensionImageUrl : undefined,
    packagingImageUrl: isJ415 ? j415Specification.packagingImageUrl : undefined,
    imageIsIllustrative: isJ415 || product.images.length === 0 || product.images[0] === "/products/vehicle-oil-filter.png"
  };
}

async function selectFilterSpec(supabase: NonNullable<ReturnType<typeof createSupabaseServerClient>>, variantId: string) {
  const structuredColumns = "supplier_brand,supplier_part_number,filter_type,verification_status,construction_type,height_mm,outside_diameter_mm,inside_diameter_top_mm,inside_diameter_bottom_mm,thread_size,seal_ring_dimensions,pack_quantity,metadata";
  const result = await supabase
    .from("filter_variant_specs")
    .select(structuredColumns)
    .eq("product_variant_id", variantId)
    .maybeSingle();

  if (result.error?.code !== "42703") return result;

  return supabase
    .from("filter_variant_specs")
    .select("supplier_brand,supplier_part_number,filter_type,verification_status,metadata")
    .eq("product_variant_id", variantId)
    .maybeSingle();
}

export async function hasPublishedOilFilterFitment(productVariantId: string, applicationId: string) {
  const supabase = createSupabaseServerClient();
  if (!supabase) return false;

  const { data, error } = await supabase
    .from("vehicle_product_fitments")
    .select("id")
    .eq("product_variant_id", productVariantId)
    .eq("vehicle_application_id", applicationId)
    .eq("fitment_status", "published")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

function readConstruction(value: unknown): OilFilterConstruction {
  const normalized = readString(value).toLowerCase();
  if (normalized === "cartridge") return "Cartridge";
  if (normalized === "spin-on" || normalized === "spin_on" || normalized === "spin on") return "Spin-On";
  return "Unknown";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function compactPartNumber(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
