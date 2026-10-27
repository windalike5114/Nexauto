import {fitmentJson,guardFitmentApiRequest,hasOnlySearchParams,type FitmentRequestGuard} from './public-api';
type Option={id:string;name:string};
type Model=Option&{aliases:string[];modelIds:string[]};
type Dependencies={makes:()=>Promise<Option[]>;models:(makeId:string)=>Promise<Model[]>;years:(makeId:string,modelId:string)=>Promise<number[]>;guard?:FitmentRequestGuard};
export function createLegacyVehicleHandler(kind:'makes'|'models'|'years',deps:Dependencies){
  return async function GET(request:Request){
    const guard=await(deps.guard??guardFitmentApiRequest)(request);if(guard.response)return guard.response;
    const params=new URL(request.url).searchParams,make=params.get('makeId'),model=params.get('modelId');
    const allowed=kind==='makes'?[]:kind==='models'?['makeId']:['makeId','modelId'];
    if(!hasOnlySearchParams(params,allowed)||(kind!=='makes'&&(!make||!/^mk_[a-f0-9]{20}$/.test(make)))
      ||(kind==='years'&&(!model||!/^md_[a-f0-9]{20}$/.test(model))))return fitmentJson({error:'Valid vehicle lookup parameters are required.'},guard,{status:400});
    try{
      if(kind==='makes')return fitmentJson({makes:(await deps.makes()).map(({id,name})=>({id,name}))},guard);
      if(kind==='models')return fitmentJson({models:(await deps.models(make!)).map(({id,name,aliases,modelIds})=>({id,name,aliases,modelIds}))},guard);
      return fitmentJson({years:await deps.years(make!,model!)},guard);
    }catch{return fitmentJson({error:'Could not load vehicle catalogue.'},guard,{status:500});}
  };
}
