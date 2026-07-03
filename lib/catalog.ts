import type { ProductAttributes, ProductVariant, SelectedAttributes } from "./types";

export function getDefaultSelection(attributes: ProductAttributes): SelectedAttributes {
  return Object.fromEntries(Object.entries(attributes).map(([key, values]) => [key, values[0]]));
}

export function findMatchingVariant(variants: ProductVariant[], selected: SelectedAttributes) {
  return variants.find((variant) =>
    Object.entries(selected).every(([key, value]) => String(variant.attributes[key]) === String(value))
  );
}

export function formatAttributeName(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD"
  }).format(value);
}
