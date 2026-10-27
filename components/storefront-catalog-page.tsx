import {StorefrontCatalogBrowser} from '@/components/storefront-catalog-browser';
import {readCataloguePage} from '@/lib/queries/storefront-page';
import {readStoredVehicleContext} from '@/lib/server/vehicle-context';
import {buildCataloguePage} from '@/lib/application/storefront/catalogue-page';
import {catalogueRequestFromLocation} from '@/lib/storefront-page';
import {isStorefrontCategoryVisible} from '@/lib/storefront-visibility';
import {notFound} from 'next/navigation';

export type StorefrontParams=Record<string,string|undefined>;
export async function StorefrontCatalogPage({params}:{params:StorefrontParams}){
  if((params.category!==undefined&&typeof params.category!=='string')||!isStorefrontCategoryVisible(params.category))notFound();
  const vehicle=await readStoredVehicleContext();
  const request=catalogueRequestFromLocation(params,1,Boolean(vehicle));
  let initialPage;
  try{initialPage=await readCataloguePage(request);}
  catch{initialPage=buildCataloguePage([],request,vehicle,'Some catalogue data could not be loaded. Please try again.');}
  return <StorefrontCatalogBrowser initialPage={initialPage}/>;
}
