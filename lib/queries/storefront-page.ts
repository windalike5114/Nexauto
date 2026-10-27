import 'server-only';
import {unstable_cache} from 'next/cache';
import {loadStorefrontCatalogue,matchStorefrontCatalogue} from './storefront-catalog';
import {readStoredVehicleContext} from '@/lib/server/vehicle-context';
import {resolveVehicleSelection} from '@/lib/server/resolve-vehicle-selection';
import {buildCataloguePage} from '@/lib/application/storefront/catalogue-page';
import type {CatalogueRequest} from '@/lib/storefront-page';

// This short-lived snapshot is server-only. Checkout keeps its existing fresh
// database verification; neither RSC nor the page API receives this whole array.
const snapshot=unstable_cache(()=>loadStorefrontCatalogue(),['private-storefront-page-snapshot-v1'],{revalidate:30,tags:['storefront-catalogue']});
export async function readCataloguePage(request:CatalogueRequest){
  const vehicle=await readStoredVehicleContext();
  let entries=await snapshot(),error='';
  if(vehicle){
    try{
      const resolved=await resolveVehicleSelection(vehicle);
      if(resolved)entries=await matchStorefrontCatalogue(entries,resolved.vehicle,resolved.applications);
      else throw new Error('Vehicle selection unavailable');
    }catch{
      error='Vehicle fitment could not be checked. Please try again.';
      // Never turn an unverified selection into green fitment labels.
      entries=entries.map(entry=>({...entry,status:undefined,condition:undefined}));
    }
  }
  return buildCataloguePage(entries,{...request,fit:Boolean(request.fit&&vehicle)},vehicle,error);
}
