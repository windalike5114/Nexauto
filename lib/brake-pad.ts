import type { Product, ProductVariant } from "@/lib/types";

export type BrakePadPosition = "Front" | "Rear" | "Unknown";

export type BrakePadSpecRow = {
  label: string;
  value: string;
};

export type BrakePadFitment = {
  make: string;
  model: string;
  chassis: string;
  engine: string;
};

export type BrakePadDetail = {
  product: Product;
  variant: ProductVariant;
  partNumber: string;
  supplierRef: string;
  title: string;
  position: BrakePadPosition;
  frictionMaterial?: string;
  lengthMm?: number;
  widthMm?: number;
  thicknessMm?: number;
  packDescription: string;
  drivingUse?: string;
  wearSensorIncluded?: boolean;
  shimsIncluded?: boolean;
  hardwareIncluded?: boolean;
  verificationStatus: "generated" | "review" | "verified" | "rejected";
  fitments: BrakePadFitment[];
  specifications: BrakePadSpecRow[];
  imageUrl: string;
  dimensionImageUrl?: string;
  constructionImageUrl?: string;
  imageIsIllustrative: boolean;
};

type BrakePadSpecInput = Pick<
  BrakePadDetail,
  | "partNumber"
  | "position"
  | "frictionMaterial"
  | "lengthMm"
  | "widthMm"
  | "thicknessMm"
  | "packDescription"
  | "drivingUse"
  | "wearSensorIncluded"
  | "shimsIncluded"
  | "hardwareIncluded"
>;

export function buildBrakePadSpecifications(input: BrakePadSpecInput): BrakePadSpecRow[] {
  return [
    { label: "SKU", value: input.partNumber },
    input.position !== "Unknown" ? { label: "Axle Position", value: input.position } : null,
    input.frictionMaterial ? { label: "Friction Material", value: input.frictionMaterial } : null,
    input.lengthMm ? { label: "Length", value: `${formatBrakePadDimension(input.lengthMm)} mm` } : null,
    input.widthMm ? { label: "Width", value: `${formatBrakePadDimension(input.widthMm)} mm` } : null,
    input.thicknessMm ? { label: "Thickness", value: `${formatBrakePadDimension(input.thicknessMm)} mm` } : null,
    { label: "Pack", value: input.packDescription },
    input.drivingUse ? { label: "Driving Use", value: input.drivingUse } : null,
    typeof input.wearSensorIncluded === "boolean"
      ? { label: "Wear Sensor Included", value: input.wearSensorIncluded ? "Yes" : "No" }
      : null,
    typeof input.shimsIncluded === "boolean"
      ? { label: "Shims Included", value: input.shimsIncluded ? "Yes" : "No" }
      : null,
    typeof input.hardwareIncluded === "boolean"
      ? { label: "Fitting Hardware Included", value: input.hardwareIncluded ? "Yes" : "No" }
      : null
  ].filter((row): row is BrakePadSpecRow => Boolean(row));
}

export function formatBrakePadDimension(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function splitBrakePadDisplayTitle(title: string) {
  const match = title.match(/^(.*?)\s*·\s*(Fits\s+.+)$/i);

  return match
    ? { title: match[1].trim(), fitmentSubtitle: match[2].trim() }
    : { title, fitmentSubtitle: "" };
}
