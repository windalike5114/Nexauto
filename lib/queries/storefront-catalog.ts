import 'server-only';
import { cache } from 'react';
import { createSupabaseServerClient } from '@/lib/supabase';
import { listWiperSets } from '@/lib/queries/wiper-commerce';
import { findCatalogWiperFitments } from '@/lib/queries/vehicle-catalog-wiper-fitment';
import { getWiperSetPreviewImage } from '@/lib/wiper-product-images';
import { categoryFromDatabase, matchesFitmentPosition, type CatalogueEntry } from '@/lib/storefront-catalog';
import { coverageStatus, type FriendlyApplication } from '@/lib/vehicle-variants';
import type { VehicleContext } from '@/lib/vehicle-context';
import { isStorefrontCategoryVisible } from '@/lib/storefront-visibility';
import brakeMetadata from '@/data/brake-pads/catalog.json';
import filterMetadata from '@/data/oil-filters/catalog.json';

export async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 1000) { const page = await build(from, from + 999); if (page.error) throw new Error(page.error.message); result.push(...(page.data ?? []) as T[]); if (!page.data || page.data.length < 1000) return result; }
}
type Variant = { id: string; sku: string; price: number | string; active: boolean; attributes: Record<string, unknown> };
type Row = { id: string; slug: string; name: string; category_slug: string; images: string[]; active: boolean; commerce_status: string; content_status: string; checkout_enabled: boolean; product_variants: Variant[]; product_attributes: { attributes: Record<string, unknown> } | Array<{ attributes: Record<string, unknown> }> | null };
const client = () => { const db = createSupabaseServerClient(); if (!db) throw new Error('Catalogue is temporarily unavailable.'); return db; };
function safeAttributes(value: Record<string, unknown> = {}) {
  const allowed = new Set(['position', 'filter_type', 'height_mm', 'outside_diameter_mm', 'thread_size', 'Bulb model', 'Socket / base', 'Technology', 'Voltage', 'Power', 'technology', 'voltage', 'code_format', 'battery_code', 'cross_references', 'Cross references', 'Part references']);
  return Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)).map(([key, values]) => [key, (Array.isArray(values) ? values : [values]).filter(v => typeof v === 'string' || typeof v === 'number').map(v => String(v).trim()).filter(Boolean)]));
}
export const loadStorefrontCatalogue = cache(async (): Promise<CatalogueEntry[]> => {
  const db = client();
  const [rows, sets] = await Promise.all([
    readAll<Row>((from, to) => db.from('products').select('id,slug,name,category_slug,images,active,commerce_status,content_status,checkout_enabled,product_variants(id,sku,price,active,attributes),product_attributes(attributes)').eq('active', true).eq('visibility_status', 'public').order('id').range(from, to)),
    listWiperSets()
  ]);
  const entries: CatalogueEntry[] = [];
  for (const row of rows) {
    if (!isStorefrontCategoryVisible(row.category_slug)) continue;
    if (['vehicle-fit-battery', 'vehicle-fit-oil-filter'].includes(row.slug) || row.category_slug === 'wiper') continue;
    const attributeRow = Array.isArray(row.product_attributes) ? row.product_attributes[0] : row.product_attributes;
    for (const variant of row.product_variants.filter(variant => variant.active)) {
      const attributes = { ...safeAttributes(attributeRow?.attributes), ...safeAttributes(variant.attributes) };
      const brake = brakeMetadata.find(p => p.sku === variant.sku), filter = filterMetadata.find(p => p.sku === variant.sku);
      // Retired supplier-reference filter records are knowledge, not extra storefront products.
      if (row.category_slug === 'filter' && (!/^NOF\d+$/.test(variant.sku) || !filter)) continue;
      if (row.category_slug === 'brake-pad' && (!/^NBP\d+$/.test(variant.sku) || !brake)) continue;
      if (brake) attributes.position = [brake.position.toLowerCase().startsWith('front') ? 'Front' : brake.position.toLowerCase().startsWith('rear') ? 'Rear' : brake.position];
      if (filter) Object.assign(attributes, { filter_type: [filter.category], height_mm: [String(filter.heightMm)], outside_diameter_mm: [String(filter.outerDiameter)], ...(filter.threadSize ? { thread_size: [filter.threadSize] } : {}) });
      const category = categoryFromDatabase(row.category_slug);
      const href = category === 'brakes' ? `/brake-pads/${variant.sku}` : category === 'filters' ? `/oil-filters/${variant.sku}` : category === 'bulbs' ? `/bulbs/${variant.sku}` : `/products/${row.slug}`;
      entries.push({ id: variant.id, productId: row.id, variantId: variant.id, sku: variant.sku, name: brake?.title ?? filter?.title ?? row.name, category, price: Number(variant.price), image: brake?.imageUrl ?? filter?.imageUrl ?? row.images?.[0] ?? '/products/wiper-blade.png', href,
        purchasable: row.content_status === 'approved' && row.commerce_status === 'active' && row.checkout_enabled, attributes });
    }
  }
  // Preserve the canonical complete-pair SKU and database commerce gate; no arbitrary slicing.
  for (const set of sets) entries.push({ id: set.id, sku: set.sku, name: `Front Wiper Pair ${set.driverLengthIn}″ + ${set.passengerLengthIn}″`, category: 'wipers', price: set.price, image: getWiperSetPreviewImage(set), href: `/wipers/${set.sku}`, purchasable: set.purchasable, attributes: { driver_length: [`${set.driverLengthIn}″`], passenger_length: [`${set.passengerLengthIn}″`] } });
  return [...new Map(entries.map(entry => [entry.sku, entry])).values()].sort((a,b)=>Number(b.purchasable)-Number(a.purchasable)||a.sku.localeCompare(b.sku,undefined,{numeric:true}));
});
type Fit = { application_id: string; product_variant_id: string; position: string };
export async function matchStorefrontCatalogue(entries: CatalogueEntry[], vehicle: VehicleContext, applications: FriendlyApplication[]) {
  const db = client(), ids = applications.map(app => app.id);
  const [fits, wipers] = await Promise.all([
    readAll<Fit>((from, to) => db.from('vehicle_catalog_product_fitments').select('application_id,product_variant_id,position').in('application_id', ids).eq('fitment_status', 'published').order('application_id').order('product_variant_id').range(from, to)),
    findCatalogWiperFitments(ids)
  ]);
  return entries.map(entry => {
    let matched = entry.category === 'wipers' ? wipers.filter(fit => {
      const pair = [fit.driverLengthIn, fit.passengerLengthIn].filter((v): v is number => v !== null).sort((a, b) => b - a);
      return pair.length === 2 && entry.attributes.driver_length?.includes(`${pair[0]}″`) && entry.attributes.passenger_length?.includes(`${pair[1]}″`);
    }).map(fit => fit.applicationId) : fits.filter(fit => fit.product_variant_id === entry.variantId && matchesFitmentPosition(entry.category,entry.attributes.position,fit.position)).map(fit => fit.application_id);
    if (entry.category === 'wipers') {
      // Conflicting published front configurations cannot be silently represented by the first row.
      matched = matched.filter(id => new Set(wipers.filter(fit => fit.applicationId === id && fit.driverLengthIn && fit.passengerLengthIn).map(fit => [fit.driverLengthIn, fit.passengerLengthIn].sort((a, b) => Number(b) - Number(a)).join('/'))).size === 1);
    }
    const matchedApplicationIds = [...new Set(matched)], status = coverageStatus(ids, matchedApplicationIds);
    const members = applications.filter(app => matchedApplicationIds.includes(app.id));
    const condition = status === 'conditional' ? [...new Set(members.map(app => [app.seriesName, app.engine, app.variantName].filter(Boolean).join(' · ')))].join(' / ') : undefined;
    // Only an actually exact selection can be attached to a wiper purchase link.
    const href = entry.category === 'wipers' && status === 'fits' && ids.length === 1 ? `${entry.href}?${new URLSearchParams({ applicationId: ids[0], applicationKind: 'canonical', make: vehicle.make, model: vehicle.model, year: vehicle.year })}` : entry.href;
    return { ...entry, status, condition, matchedApplicationIds, href };
  });
}
