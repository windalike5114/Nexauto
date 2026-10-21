import type { Product, ProductVariant } from "@/lib/types";

export type OilFilterConstruction = "Cartridge" | "Spin-On" | "Unknown";

export type OilFilterSpecRow = {
  label: string;
  value: string;
};

export type OilFilterDetail = {
  product: Product;
  variant: ProductVariant;
  partNumber: string;
  supplierRef: string;
  title: string;
  construction: OilFilterConstruction;
  brands: string;
  mostlyFor: string;
  heightMm?: number;
  outsideDiameter?: string;
  insideDiameter?: string;
  threadSize?: string;
  sealRingSize?: string;
  specifications: OilFilterSpecRow[];
  imageUrl: string;
  imageIsIllustrative: boolean;
};

type FilterSpecInput = {
  construction: OilFilterConstruction;
  heightMm?: number;
  outsideDiameter?: string;
  insideDiameter?: string;
  threadSize?: string;
  sealRingSize?: string;
};

export function buildOilFilterSpecifications(input: FilterSpecInput): OilFilterSpecRow[] {
  const threadSize = input.sealRingSize ? undefined : input.threadSize;
  return [
    { label: "Filter Type", value: input.construction },
    input.heightMm ? { label: "Height", value: `${formatDimension(input.heightMm)} mm` } : null,
    input.outsideDiameter ? { label: "Outside Diameter", value: `${input.outsideDiameter} mm` } : null,
    input.insideDiameter ? { label: "Inside Diameter", value: `${input.insideDiameter} mm` } : null,
    threadSize ? { label: "Thread Size", value: threadSize } : null,
    input.sealRingSize ? { label: "Seal Ring Size", value: input.sealRingSize } : null
  ].filter((row): row is OilFilterSpecRow => Boolean(row));
}

export function formatDimension(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
