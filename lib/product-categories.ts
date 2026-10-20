export const productCategoryDefinitions = [
  { key: "wipers", label: "Wiper Blades", shortLabel: "Wipers", databaseSlug: "wiper" },
  { key: "filters", label: "Oil Filters", shortLabel: "Filters", databaseSlug: "filter" },
  { key: "brakes", label: "Brake Pads", shortLabel: "Brake Pads", databaseSlug: "brake-pad" },
  { key: "bulbs", label: "Light Bulbs", shortLabel: "Bulbs", databaseSlug: "bulb" },
  { key: "batteries", label: "Batteries", shortLabel: "Batteries", databaseSlug: "battery" },
  { key: "suspension", label: "Control Arms", shortLabel: "Suspension", databaseSlug: "suspension" }
] as const;

export type ProductCategoryKey = (typeof productCategoryDefinitions)[number]["key"];

export function getProductCategoryDefinition(key: string) {
  return productCategoryDefinitions.find((category) => category.key === key);
}

export function getProductCategoryLabel(databaseSlug: string) {
  return productCategoryDefinitions.find((category) => category.databaseSlug === databaseSlug)?.label ?? "Auto Parts";
}

export function isProductCategoryKey(value: string | undefined): value is ProductCategoryKey {
  return productCategoryDefinitions.some((category) => category.key === value);
}
