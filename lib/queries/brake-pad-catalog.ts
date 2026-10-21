import "server-only";

import brakePadCatalogJson from "@/data/brake-pads/catalog.json";
import {
  buildBrakePadSpecifications,
  type BrakePadDetail,
  type BrakePadFitment,
  type BrakePadPosition
} from "@/lib/brake-pad";
import type { Product, ProductVariant } from "@/lib/types";

type BrakePadCatalogRow = {
  sku: string;
  supplierRef: string;
  title: string;
  priceNzd: number;
  position: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  imageUrl: string;
  imageIsPlaceholder: boolean;
  fitments: BrakePadFitment[];
};

const brakePadCatalog = brakePadCatalogJson as BrakePadCatalogRow[];
const catalogueBySku = new Map(brakePadCatalog.map((row) => [normalizeKey(row.sku), row]));
const catalogueBySupplierRef = new Map(brakePadCatalog.map((row) => [normalizeKey(row.supplierRef), row]));
const catalogueProducts = brakePadCatalog.map(createProduct);

export async function getBrakePadBySlugOrPartNumber(value: string): Promise<BrakePadDetail | null> {
  const decoded = decodeURIComponent(value).trim();
  const routeKey = normalizeKey(decoded.replace(/^brake-pad-/i, ""));
  const row = catalogueBySku.get(routeKey) ?? catalogueBySupplierRef.get(routeKey);
  return row ? createDetail(row) : null;
}

export async function getBrakePadDetail(product: Product): Promise<BrakePadDetail | null> {
  const skuFromSlug = product.slug.replace(/^brake-pad-/i, "");
  const row = catalogueBySku.get(normalizeKey(skuFromSlug));
  return row ? createDetail(row) : null;
}

export function listBrakePadCatalogProducts() {
  return catalogueProducts;
}

export function listBrakePadCatalogSkus() {
  return brakePadCatalog.map((row) => row.sku);
}

function createDetail(row: BrakePadCatalogRow): BrakePadDetail {
  const product = createProduct(row);
  const variant = createVariant(row, product.id);
  const position = readPosition(row.position);
  const specifications = buildBrakePadSpecifications({
    partNumber: row.sku,
    position,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    thicknessMm: row.thicknessMm,
    packDescription: row.position
  });

  return {
    product,
    variant,
    partNumber: row.sku,
    supplierRef: row.supplierRef,
    title: row.title,
    position,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    thicknessMm: row.thicknessMm,
    packDescription: row.position,
    verificationStatus: "review",
    fitments: row.fitments,
    specifications,
    imageUrl: row.imageUrl,
    imageIsIllustrative: row.imageIsPlaceholder
  };
}

function createProduct(row: BrakePadCatalogRow): Product {
  return {
    id: `brake-pad-${row.sku.toLowerCase()}`,
    slug: `brake-pad-${row.sku.toLowerCase()}`,
    name: row.title,
    category: "brake-pad",
    price: row.priceNzd,
    description: `${row.position}. Dimensions and vehicle applications are listed on the product page.`,
    detailSections: [],
    videoUrl: null,
    images: [row.imageUrl],
    active: true,
    visibilityStatus: "public",
    contentStatus: "review",
    commerceStatus: "active",
    checkoutEnabled: true,
    purchasable: true
  };
}

function createVariant(row: BrakePadCatalogRow, productId: string): ProductVariant {
  return {
    id: `brake-pad-variant-${row.sku.toLowerCase()}`,
    productId,
    sku: row.sku,
    price: row.priceNzd,
    stock: 999,
    attributes: {
      supplier_ref: row.supplierRef,
      position: row.position,
      length_mm: row.lengthMm,
      width_mm: row.widthMm,
      thickness_mm: row.thicknessMm
    },
    active: true
  };
}

function readPosition(value: string): BrakePadPosition {
  const normalized = value.toLowerCase();
  if (normalized.startsWith("front")) return "Front";
  if (normalized.startsWith("rear")) return "Rear";
  return "Unknown";
}

function normalizeKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
