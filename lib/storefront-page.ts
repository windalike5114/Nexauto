import { catalogueCategories, categoryFacetDefinitions, readCategory, type CatalogueCategory, type CatalogueEntry } from './storefront-catalog';
import type { VehicleContext } from './vehicle-context';

export const cataloguePageSize = 24;
export type CatalogueRequest = {category:CatalogueCategory;query:string;sort:'featured'|'price-asc'|'price-desc'|'name-asc';fit:boolean;facets:Record<string,string>;page:number};
export type PublicCatalogueEntry = Pick<CatalogueEntry,'sku'|'name'|'category'|'price'|'image'|'href'|'purchasable'|'attributes'|'status'|'condition'> & {id:string};
export type CataloguePage = {
  items:PublicCatalogueEntry[];total:number;page:number;pageSize:24;
  counts:Partial<Record<CatalogueCategory,number>>;
  facets:Array<{key:string;label:string;values:string[]}>;
  selectionKey:string;filterKey:string;error:string;
};
export function catalogueVehicleKey(vehicle:VehicleContext|null){
  return vehicle?JSON.stringify([vehicle.makeId,vehicle.modelId,vehicle.year,vehicle.applicationId??'']):'';
}
export function catalogueFilterKey(request:Omit<CatalogueRequest,'page'>,vehicle:VehicleContext|null){
  return JSON.stringify([request.category,request.query,request.sort,request.fit,Object.entries(request.facets).sort(([a],[b])=>a.localeCompare(b)),catalogueVehicleKey(vehicle)]);
}
export function parseCatalogueRequest(value:unknown):CatalogueRequest {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid catalogue request.');
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>!['category','query','sort','fit','facets','page'].includes(key)))throw new Error('Unknown catalogue parameter.');
  const {category='all',query='',sort='featured',fit=false,facets={},page=1}=input;
  if(typeof category!=='string'||!catalogueCategories.some(([id])=>id===category)
    ||typeof query!=='string'||query.length>120||typeof sort!=='string'||!['featured','price-asc','price-desc','name-asc'].includes(sort)
    ||typeof fit!=='boolean'||!Number.isInteger(page)||Number(page)<1||Number(page)>10000
    ||!facets||typeof facets!=='object'||Array.isArray(facets))throw new Error('Invalid catalogue parameters.');
  const allowed=new Set((categoryFacetDefinitions[category as CatalogueCategory]??[]).map(([key])=>key));
  const entries=Object.entries(facets);
  if(entries.length>8||entries.some(([key,value])=>!allowed.has(key)||typeof value!=='string'||value.length>120))throw new Error('Invalid product filters.');
  return {category:category as CatalogueCategory,query:query.trim(),sort:sort as CatalogueRequest['sort'],fit,facets:Object.fromEntries(entries.filter(([,value])=>value)),page:Number(page)};
}
export function catalogueRequestFromLocation(params:Record<string,string|undefined>,page=1,hasVehicle=true):CatalogueRequest {
  const text=(key:string)=>typeof params[key]==='string'?params[key]:undefined;
  const category=readCategory(text('category')),allowed=new Set((categoryFacetDefinitions[category]??[]).map(([key])=>key));
  const sort=['featured','price-asc','price-desc','name-asc'].includes(text('sort')??'')?text('sort'):'featured';
  return parseCatalogueRequest({category,query:(text('q')??'').slice(0,120),sort,fit:hasVehicle&&text('fit')==='vehicle',
    facets:Object.fromEntries(Object.entries(params).filter(([key,value])=>key.startsWith('f.')&&allowed.has(key.slice(2))&&typeof value==='string').map(([key,value])=>[key.slice(2),value!.slice(0,120)])),page});
}
