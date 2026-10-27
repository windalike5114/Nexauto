import {fitmentJson,guardFitmentApiRequest,hasOnlySearchParams,type FitmentRequestGuard} from '../fitment/public-api';
import {catalogueVehicleKey,parseCatalogueRequest,type CataloguePage,type CatalogueRequest} from '../../storefront-page';
import type {VehicleContext} from '../../vehicle-context';

async function boundedJson(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new Error('body');
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>4096){await reader.cancel();throw new Error('large');}chunks.push(chunk.value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function createCataloguePageHandler(deps:{read:(request:CatalogueRequest)=>Promise<CataloguePage>;vehicle:()=>Promise<VehicleContext|null>;guard?:FitmentRequestGuard}){
  return async function POST(request:Request){
    const guard=await(deps.guard??guardFitmentApiRequest)(request);if(guard.response)return guard.response;
    const params=new URL(request.url).searchParams;
    if(!hasOnlySearchParams(params,['makeId','modelId'])||request.method!=='POST')return fitmentJson({error:'Invalid catalogue request.'},guard,{status:400});
    if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return fitmentJson({error:'JSON is required.'},guard,{status:415});
    let input:CatalogueRequest;
    try{input=parseCatalogueRequest(await boundedJson(request));}catch(error){return fitmentJson({error:'Invalid catalogue parameters.'},guard,{status:error instanceof Error&&error.message==='large'?413:400});}
    try{
      const vehicle=await deps.vehicle();
      const make=params.get('makeId'),model=params.get('modelId');
      // URL identity is for shared quota accounting; the cookie-backed database
      // selection remains authoritative. Omitting it cannot evade vehicle quota.
      if(vehicle?make!==vehicle.makeId||model!==vehicle.modelId:Boolean(make||model))return fitmentJson({error:'Your selected vehicle has changed. Please try again.'},guard,{status:409});
      const page=await deps.read(input);
      if(page.selectionKey!==catalogueVehicleKey(vehicle))return fitmentJson({error:'Your selected vehicle has changed. Please try again.'},guard,{status:409});
      if(page.items.length>24)return fitmentJson({error:'Could not load products.'},guard,{status:500});
      return fitmentJson(page,guard);
    }catch{return fitmentJson({error:'Could not load products. Please try again.'},guard,{status:500});}
  };
}
