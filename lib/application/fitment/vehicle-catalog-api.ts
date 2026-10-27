import { fitmentJson, guardFitmentApiRequest, hasOnlySearchParams, parseVehicleYear,type FitmentRequestGuard } from './public-api';
import { timeVehicleLookup } from './vehicle-lookup-timing';

type Option = {id:string;name:string};
type Model = Option & {aliases:string[];modelIds:string[]};
type Dependencies = {
  makes:()=>Promise<Option[]>;
  models:(makeId:string)=>Promise<Model[]>;
  years:(makeId:string,modelId:string)=>Promise<number[]>;
  guard?:FitmentRequestGuard;
};
const makePattern=/^mk_[0-9a-f]{20}$/;
const modelPattern=/^md_[0-9a-f]{20}$/;
const validVersion=(params:URLSearchParams)=>!params.has('catalog') || params.get('catalog')==='friendly-20261027';

export function createVehicleCatalogHandler(deps:Dependencies) {
  return async function GET(request:Request) {
    const guard=await (deps.guard??guardFitmentApiRequest)(request);
    if (guard.response) return guard.response;
    const params=new URL(request.url).searchParams;
    const makeId=params.get('makeId'), modelId=params.get('modelId');
    if (!hasOnlySearchParams(params,['makeId','modelId','catalog']) || !validVersion(params)
      || (makeId!==null&&!makePattern.test(makeId)) || (modelId!==null&&(!makeId||!modelPattern.test(modelId)))) {
      return fitmentJson({error:'Valid vehicle lookup parameters are required.'},guard,{status:400});
    }
    try {
      if (makeId && modelId) return fitmentJson({years:await timeVehicleLookup('request.years',()=>deps.years(makeId,modelId))},guard);
      if (makeId) return fitmentJson({models:(await timeVehicleLookup('request.models',()=>deps.models(makeId))).map(({id,name,aliases,modelIds})=>({id,name,aliases,modelIds}))},guard);
      return fitmentJson({makes:(await timeVehicleLookup('request.makes',()=>deps.makes())).map(({id,name})=>({id,name}))},guard);
    } catch {
      return fitmentJson({error:'Could not load vehicle catalogue.'},guard,{status:500});
    }
  };
}

export function createVehicleApplicationsHandler(lookup:(makeId:string,modelId:string,year:number)=>Promise<unknown[]>,requestGuard:FitmentRequestGuard=guardFitmentApiRequest) {
  return async function GET(request:Request) {
    const guard=await requestGuard(request);
    if (guard.response) return guard.response;
    const params=new URL(request.url).searchParams;
    const makeId=params.get('makeId'),modelId=params.get('modelId'),year=parseVehicleYear(params.get('year'));
    if (!hasOnlySearchParams(params,['makeId','modelId','year','catalog']) || !validVersion(params)
      || !makeId || !makePattern.test(makeId) || !modelId || !modelPattern.test(modelId) || !year) {
      return fitmentJson({error:'A valid makeId, modelId and year are required.'},guard,{status:400});
    }
    try {
      const applications=await timeVehicleLookup('request.applications',()=>lookup(makeId,modelId,year));
      if (applications.length>500) return fitmentJson({error:'Please refine this vehicle selection.'},guard,{status:422});
      return fitmentJson({applications},guard);
    } catch {
      return fitmentJson({error:'Could not load vehicle configurations.'},guard,{status:500});
    }
  };
}
