import type { CartItem, Product, ProductDetailSection } from "@/lib/types";

export type BulbDetail = {
  productId: string;
  variantId: string;
  sku: string;
  supplierRef: string;
  title: string;
  subtitle: string;
  priceNzd: number;
  features: string[];
  specifications: { label: string; value: string }[];
  images: string[];
  packLabel: string | null;
  orderingEnabled: boolean;
  inventoryQuantity: number | null;
};

export type BulbVariantRow = {
  id: string;
  product_id: string;
  sku: string;
  price: number | string;
  stock: number;
  active: boolean;
  attributes: Record<string, string | number>;
};

export type BulbProductRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  images: string[];
  active: boolean;
  visibility_status: Product["visibilityStatus"];
  content_status: Product["contentStatus"];
  commerce_status: Product["commerceStatus"];
  checkout_enabled: boolean;
  detail_sections: ProductDetailSection[];
  product_variants: BulbVariantRow[];
  product_attributes: { attributes: Record<string, string[]> } | null;
};

export function mapBulbDetail(row: BulbProductRow): BulbDetail | null {
  const variant = row.product_variants.find((entry) => entry.active && /^NBL\d{4}$/.test(entry.sku));
  if (!variant) return null;
  const orderingEnabled = row.active && row.visibility_status === "public"
    && row.content_status === "approved" && row.commerce_status === "active" && row.checkout_enabled;
  const fieldOrder = ["Bulb model", "Technology", "Voltage", "Power", "Colour temperature", "Emitted colour", "Luminous flux", "Socket / base", "Part references", "Cross references", "Application", "Glass finish", "Beam function", "Installation type", "Base pin configuration", "Bottom contact points", "Base contact type", "Dimensions", "Dual beam application"];
  const specifications = Object.entries(row.product_attributes?.attributes ?? {})
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([label, values]) => ({ label, value: values.join(" / ") }))
    .sort((a, b) => fieldOrder.indexOf(a.label) - fieldOrder.indexOf(b.label));
  return {
    productId: row.id, variantId: variant.id, sku: variant.sku,
    supplierRef: String(variant.attributes.supplier_ref ?? ""),
    title: row.name, subtitle: row.description, priceNzd: Number(variant.price),
    features: row.detail_sections.map((section) => section.body), specifications,
    images: row.images,
    packLabel: typeof variant.attributes.pack === "string" ? variant.attributes.pack : null,
    orderingEnabled,
    inventoryQuantity: variant.attributes.inventory_mode === "untracked" ? null : variant.stock
  };
}

export function bulbProduct(row: BulbProductRow, detail: BulbDetail): Product {
  return {
    id: row.id, slug: row.slug, name: detail.title, category: "bulb", price: detail.priceNzd,
    description: `${detail.subtitle} · ${detail.sku}`, detailSections: row.detail_sections,
    videoUrl: null, images: detail.images, active: row.active,
    visibilityStatus: row.visibility_status, contentStatus: row.content_status,
    commerceStatus: row.commerce_status, checkoutEnabled: row.checkout_enabled,
    purchasable: detail.orderingEnabled
  };
}

export function bulbCartItem(detail: BulbDetail, qty: number): CartItem {
  return {
    productId: detail.productId, variantId: detail.variantId, sku: detail.sku,
    name: detail.title, category: "bulb", qty, price: detail.priceNzd,
    imageUrl: detail.images[0], bundleEligible: false,
    attributes: { ...(detail.packLabel ? { pack: detail.packLabel } : {}) }
  };
}

/** Input must come from the checkout-eligible database view, never client attributes. */
export function resolveTrustedBulbCartItem(item: CartItem, variant: BulbVariantRow & { product_name: string; category_slug: string }): CartItem | null {
  if (variant.category_slug !== "bulb" || !/^NBL\d{4}$/.test(variant.sku) || !variant.active
    || !Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99
    || (variant.attributes.inventory_mode !== "untracked" && item.qty > variant.stock)) return null;
  const legacy = item.productId === "bulb" && item.variantId === variant.sku;
  if (!legacy && (item.productId !== variant.product_id || item.variantId !== variant.id)) return null;
  return {
    ...(item.lineId ? { lineId: item.lineId } : {}),
    productId: variant.product_id, variantId: variant.id, sku: variant.sku,
    name: variant.product_name, category: "bulb", qty: item.qty, price: Number(variant.price),
    bundleEligible: false, attributes: { ...variant.attributes }
  };
}
