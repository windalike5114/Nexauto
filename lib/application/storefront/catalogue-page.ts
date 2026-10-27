import { catalogueCategories, catalogueFacets, filterCatalogue, sortCatalogue, type CatalogueEntry } from '../../storefront-catalog';
import { catalogueFilterKey, cataloguePageSize, catalogueVehicleKey, type CataloguePage, type CatalogueRequest, type PublicCatalogueEntry } from '../../storefront-page';
import type { VehicleContext } from '../../vehicle-context';
import {isStorefrontCategoryVisible} from '../../storefront-visibility';

function publicEntry(entry:CatalogueEntry):PublicCatalogueEntry {
  // Internal product/variant IDs and complete match membership stay on the server.
  return {id:entry.sku,sku:entry.sku,name:entry.name,category:entry.category,price:entry.price,image:entry.image,href:entry.href,
    purchasable:entry.purchasable,attributes:entry.attributes,...(entry.status?{status:entry.status}:{}),...(entry.condition?{condition:entry.condition}:{})};
}
export function buildCataloguePage(entries:CatalogueEntry[],request:CatalogueRequest,vehicle:VehicleContext|null,error=''):CataloguePage {
  const eligible=entries.filter(entry=>isStorefrontCategoryVisible(entry.category)&&(!request.fit||(entry.purchasable&&entry.status==='fits')));
  const filtered=filterCatalogue(eligible,request.category,request.query,request.facets);
  const sorted=sortCatalogue(filtered,request.sort,Boolean(vehicle));
  const page=Math.min(request.page,Math.max(1,Math.ceil(sorted.length/cataloguePageSize)));
  return {items:sorted.slice((page-1)*cataloguePageSize,page*cataloguePageSize).map(publicEntry),total:sorted.length,page,pageSize:24,
    counts:Object.fromEntries(catalogueCategories.map(([id])=>[id,eligible.filter(entry=>id==='all'||entry.category===id).length])),
    facets:catalogueFacets(filterCatalogue(eligible,request.category,request.query,{}),request.category,request.facets),
    selectionKey:catalogueVehicleKey(vehicle),filterKey:catalogueFilterKey(request,vehicle),error};
}
