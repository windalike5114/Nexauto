import "server-only";

import oilFilterCatalogJson from "@/data/oil-filters/catalog.json";
import {
  buildOilFilterSpecifications,
  isCanonicalOilFilterSku,
  type OilFilterConstruction,
  type OilFilterDetail
} from "@/lib/oil-filter";
import type { Product, ProductVariant } from "@/lib/types";

type OilFilterCatalogRow = {
  sku: string;
  topstarRef: string;
  supplierRef: string;
  title: string;
  priceNzd: number;
  category: OilFilterConstruction;
  brands: string;
  mostlyFor: string;
  heightMm: number;
  outerDiameter: string;
  insideDiameter: string;
  threadSize: string;
  sealRingSize: string;
  imageUrl: string;
};

const oilFilterCatalog = oilFilterCatalogJson as OilFilterCatalogRow[];
const catalogueBySku = new Map(oilFilterCatalog.map((row) => [row.sku, row]));
const catalogueProducts = oilFilterCatalog.map(createProduct);

export async function getOilFilterBySku(value: string): Promise<OilFilterDetail | null> {
  const decoded = decodeURIComponent(value).trim();
  if (!isCanonicalOilFilterSku(decoded)) return null;
  const row = catalogueBySku.get(decoded);
  return row ? createDetail(row) : null;
}
export function listOilFilterCatalogProducts() {
  return catalogueProducts;
}

export function listOilFilterCatalogSkus() {
  return oilFilterCatalog.map((row) => row.sku);
}

function createDetail(row: OilFilterCatalogRow): OilFilterDetail {
  const product = createProduct(row);
  const variant = createVariant(row, product.id);
  const specifications = buildOilFilterSpecifications({
    construction: row.category,
    heightMm: row.heightMm,
    outsideDiameter: row.outerDiameter,
    insideDiameter: row.insideDiameter || undefined,
    threadSize: row.threadSize || undefined,
    sealRingSize: row.sealRingSize || undefined
  });

  return {
    product,
    variant,
    partNumber: row.sku,
    supplierRef: row.supplierRef,
    title: row.title,
    construction: row.category,
    brands: row.brands,
    mostlyFor: row.mostlyFor,
    heightMm: row.heightMm,
    outsideDiameter: row.outerDiameter,
    insideDiameter: row.insideDiameter || undefined,
    threadSize: row.sealRingSize ? undefined : row.threadSize || undefined,
    sealRingSize: row.sealRingSize || undefined,
    specifications,
    imageUrl: row.imageUrl,
    imageIsIllustrative: false
  };
}
function createProduct(row: OilFilterCatalogRow): Product {
  return {
    id: `oil-filter-${row.sku.toLowerCase()}`,
    slug: `oil-filter-${row.sku.toLowerCase()}`,
    name: row.title,
    category: "filter",
    price: row.priceNzd,
    description: `${row.supplierRef}. Mostly for ${row.mostlyFor}. Catalogue image reference ${row.topstarRef}.`,
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

function createVariant(row: OilFilterCatalogRow, productId: string): ProductVariant {
  return {
    id: `oil-filter-variant-${row.sku.toLowerCase()}`,
    productId,
    sku: row.sku,
    price: row.priceNzd,
    stock: 999,
    attributes: {
      supplier_ref: row.supplierRef,
      filter_type: row.category,
      height_mm: row.heightMm,
      outside_diameter_mm: row.outerDiameter,
      inside_diameter: row.insideDiameter,
      thread_size: row.threadSize,
      seal_ring_size: row.sealRingSize
    },
    active: true
  };
}
