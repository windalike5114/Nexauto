import type { CartItem } from '@/lib/types';
import type { VehicleContext } from '@/lib/vehicle-context';
import { vehicleCartAttributes } from '@/lib/vehicle-cart';
import { ProductUnavailableError } from './checkout.errors';

type Validated = { vehicle: VehicleContext; entries: Array<{ sku: string; status?: string }> } | null;
/** Called only after SKU, ownership and prices have been replaced with trusted server values. */
export async function validateCatalogueSelections(items: CartItem[], resolve: (context: VehicleContext) => Promise<Validated>) {
  const result = new Map<number,CartItem['attributes']>(), checked = new Map<string,Promise<Validated>>();
  for (const [index,item] of items.entries()) {
    const raw=item.attributes.vehicle_selection;
    if(typeof raw!=='string')continue;
    if(raw.length>6000)throw new ProductUnavailableError('Please select the vehicle again.');
    let context:VehicleContext;
    try { context=JSON.parse(raw); } catch { throw new ProductUnavailableError('Please select the vehicle again.'); }
    if(!context||typeof context!=='object'||typeof context.makeId!=='string'||typeof context.modelId!=='string'||typeof context.year!=='string'||(context.applicationIds!==undefined&&!Array.isArray(context.applicationIds)))throw new ProductUnavailableError('Please select the vehicle again.');
    if(!checked.has(raw))checked.set(raw,resolve(context));
    const validated=await checked.get(raw)!;
    if(!validated)throw new ProductUnavailableError('Vehicle details have changed. Please select the vehicle again.');
    const match=validated.entries.find(entry=>entry.sku===item.sku);
    result.set(index,{...vehicleCartAttributes(validated.vehicle,match?.status??'not-listed'),vehicle_application_id:'',vehicle_fitment_application_id:item.category==='wiper'&&match?.status==='fits'?validated.vehicle.applicationId??'':''});
  }
  return result;
}
