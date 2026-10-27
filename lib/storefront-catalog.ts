import { isStorefrontCategoryVisible } from './storefront-visibility';

const allCatalogueCategories = [ ['all', 'All Products'], ['wipers', 'Wiper Blades'], ['filters', 'Oil Filters'], ['brakes', 'Brake Pads'], ['bulbs', 'Light Bulbs'], ['batteries', 'Batteries'], ['suspension', 'Control Arms'] ] as const;
export type CatalogueCategory = typeof allCatalogueCategories[number][0];
export const catalogueCategories = allCatalogueCategories.filter(([category]) => isStorefrontCategoryVisible(category));
export type CatalogueEntry = {
  id: string; productId?: string; variantId?: string; sku: string; name: string; category: CatalogueCategory;
  price: number; image: string; href: string; purchasable: boolean; attributes: Record<string, string[]>;
  matchedApplicationIds?: string[]; status?: 'fits' | 'conditional' | 'not-listed'; condition?: string;
};
export const categoryFacetDefinitions: Partial<Record<CatalogueCategory, Array<[string, string]>>> = {
  brakes: [['position', 'Installation position']],
  wipers: [['driver_length', 'Long blade'], ['passenger_length', 'Short blade']],
  filters: [['filter_type', 'Filter type'], ['height_mm', 'Height (mm)'], ['outside_diameter_mm', 'Outside diameter (mm)'], ['thread_size', 'Thread size']],
  bulbs: [['Bulb model', 'Bulb type'], ['Socket / base', 'Socket / base'], ['Technology', 'Technology'], ['Voltage', 'Voltage'], ['Power', 'Power']],
  batteries: [['technology', 'Technology'], ['voltage', 'Voltage'], ['code_format', 'Code format']]
};
export function categoryFromDatabase(category: string): CatalogueCategory {
  return ({ wiper: 'wipers', filter: 'filters', 'brake-pad': 'brakes', bulb: 'bulbs', battery: 'batteries', suspension: 'suspension' } as Record<string, CatalogueCategory>)[category] ?? 'all';
}
export function readCategory(value?: string): CatalogueCategory { return catalogueCategories.some(([id]) => id === value) ? value as CatalogueCategory : 'all'; }
export function matchesFitmentPosition(category: CatalogueCategory, positions: string[] | undefined, publishedPosition: string) {
  if(category!=='brakes')return true;
  const required:string[]=(positions??[]).join(' ').toLowerCase().match(/\b(front|rear)\b/g)??[];
  const actual:string[]=publishedPosition.toLowerCase().match(/\b(front|rear)\b/g)??[];
  return required.length>0&&(publishedPosition.toLowerCase()==='both'||required.some(position=>actual.includes(position)));
}
export function filterCatalogue(entries: CatalogueEntry[], category: CatalogueCategory, query: string, facets: Record<string, string>) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const allowed = new Set((categoryFacetDefinitions[category] ?? []).map(([key]) => key));
  return entries.filter(entry => isStorefrontCategoryVisible(entry.category) && (category === 'all' || entry.category === category)
    && terms.every(term => `${entry.sku} ${entry.name} ${Object.values(entry.attributes).flat().join(' ')}`.toLowerCase().includes(term))
    && Object.entries(facets).every(([key, value]) => !allowed.has(key) || !value || entry.attributes[key]?.includes(value)));
}
export function sortCatalogue(entries: CatalogueEntry[], sort: string, vehicleSelected: boolean) {
  const priority = { fits: 0, conditional: 1, 'not-listed': 2 };
  return [...entries].sort((a, b) => {
    const fitment = vehicleSelected ? (priority[a.status ?? 'not-listed'] - priority[b.status ?? 'not-listed']) : 0;
    if (fitment) return fitment;
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'name-asc') return a.name.localeCompare(b.name);
    return 0;
  });
}
export function catalogueFacets(entries: CatalogueEntry[], category: CatalogueCategory, selected: Record<string, string>) {
  return (categoryFacetDefinitions[category] ?? []).map(([key, label]) => ({ key, label,
    values: [...new Set(entries.filter(entry => entry.category === category).flatMap(entry => entry.attributes[key] ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  })).filter(facet => facet.values.length > 1 || selected[facet.key]);
}
