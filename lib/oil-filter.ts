import type { Product, ProductVariant } from "@/lib/types";

export type OilFilterConstruction = "Cartridge" | "Spin-On" | "Unknown";

export type OilFilterSpecRow = {
  label: string;
  value: string;
};

export type OilFilterDetail = {
  product: Product;
  variant: ProductVariant;
  brand: string;
  partNumber: string;
  title: string;
  construction: OilFilterConstruction;
  verificationStatus: "generated" | "review" | "verified" | "rejected";
  heightMm?: number;
  outsideDiameterMm?: number;
  insideDiameterTopMm?: number;
  insideDiameterBottomMm?: number;
  threadSize?: string;
  sealRingDimensions: string[];
  packQuantity: number;
  specifications: OilFilterSpecRow[];
  imageUrl: string;
  dimensionImageUrl?: string;
  packagingImageUrl?: string;
  imageIsIllustrative: boolean;
};

type FilterSpecInput = {
  brand: string;
  partNumber: string;
  construction: OilFilterConstruction;
  verificationStatus: OilFilterDetail["verificationStatus"];
  heightMm?: number;
  outsideDiameterMm?: number;
  insideDiameterTopMm?: number;
  insideDiameterBottomMm?: number;
  threadSize?: string;
  sealRingDimensions?: string[];
  packQuantity?: number;
};

export function buildOilFilterSpecifications(input: FilterSpecInput): OilFilterSpecRow[] {
  return [
    { label: "Part Number", value: input.partNumber },
    { label: "Filter Type", value: input.construction },
    input.heightMm ? { label: "Height", value: `${formatDimension(input.heightMm)} mm` } : null,
    input.outsideDiameterMm ? { label: "Outside Diameter", value: `${formatDimension(input.outsideDiameterMm)} mm` } : null,
    input.insideDiameterTopMm || input.insideDiameterBottomMm
      ? {
          label: "Inside Diameter",
          value: formatInsideDiameters(input.insideDiameterTopMm, input.insideDiameterBottomMm)
        }
      : null,
    input.threadSize ? { label: "Thread", value: input.threadSize } : null,
    input.sealRingDimensions?.length
      ? { label: "Seal Ring Dimensions", value: input.sealRingDimensions.join(", ") }
      : null,
    { label: "Pack Quantity", value: `${input.packQuantity ?? 1} filter` },
    { label: "Specification Status", value: titleCase(input.verificationStatus) }
  ].filter((row): row is OilFilterSpecRow => Boolean(row));
}

export function formatDimension(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatInsideDiameters(top?: number, bottom?: number) {
  if (top && bottom) return `${formatDimension(top)} / ${formatDimension(bottom)} mm`;
  return `${formatDimension(top ?? bottom ?? 0)} mm`;
}

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
