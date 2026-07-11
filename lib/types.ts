export type CategorySlug = string;

export type Product = {
  id: string;
  slug: string;
  name: string;
  category: CategorySlug;
  price: number;
  description: string;
  detailSections: ProductDetailSection[];
  videoUrl: string | null;
  images: string[];
  active: boolean;
};

export type ProductDetailSection = {
  title: string;
  body: string;
};

export type AttributeValue = string | number;
export type ProductAttributes = Record<string, AttributeValue[]>;
export type SelectedAttributes = Record<string, AttributeValue>;

export type ProductVariant = {
  id: string;
  productId: string;
  sku: string;
  price: number;
  stock: number;
  attributes: SelectedAttributes;
  active: boolean;
};

export type Category = {
  slug: CategorySlug;
  name: string;
  description: string;
};

export type CartItem = {
  lineId?: string;
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  category: CategorySlug;
  qty: number;
  price: number;
  imageUrl?: string;
  bundleEligible?: boolean;
  bundleCategory?: "front-wiper-pair" | string;
  attributes: SelectedAttributes;
};

export type WiperSet = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  setType: "front_pair" | "front_rear_set";
  driverLengthIn: number;
  passengerLengthIn: number;
  rearLengthIn: number | null;
  price: number;
  compareAtPrice: number | null;
  active: boolean;
};

export type WiperRearAddon = {
  id: string;
  slug: string;
  name: string;
  rearLengthIn: number;
  price: number;
  active: boolean;
};
