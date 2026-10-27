import 'server-only';
import { unstable_cache } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase';
import { groupCatalogModels } from '@/lib/vehicle-catalog-display';
import { timeVehicleLookup } from '@/lib/application/fitment/vehicle-lookup-timing';

function database() {
  const db = createSupabaseAdminClient();
  if (!db) throw new Error('Vehicle catalogue server access unavailable');
  return db;
}

export const listPublicVehicleMakes = unstable_cache(async () => timeVehicleLookup('catalog.makes.origin', async () => {
  const {data,error} = await database().from('vehicle_catalog_makes').select('make_id,name').order('name').limit(101);
  if (error || !data || data.length > 100) throw new Error('Vehicle make lookup unavailable');
  const priority=['TOYOTA','FORD','MAZDA','NISSAN','MITSUBISHI','HONDA','SUBARU','HYUNDAI','KIA','SUZUKI'];
  return data.map(row=>({id:String(row.make_id),name:String(row.name)})).sort((a,b)=>{
    const ai=priority.indexOf(a.name.toUpperCase()),bi=priority.indexOf(b.name.toUpperCase());
    return (ai<0?999:ai)-(bi<0?999:bi) || a.name.localeCompare(b.name);
  });
}), ['public-vehicle-makes-security-v1'], {revalidate:3600,tags:['vehicle-catalog-v5']});

export const listPublicVehicleModels = unstable_cache(async (makeId:string) => timeVehicleLookup('catalog.models.origin', async () => {
  // Preserve observed-year membership without aggregating every application year.
  // Both nested relations are capped existence checks, never a configuration export.
  const {data,error} = await database().from('vehicle_catalog_models')
    .select('model_id,name,make:vehicle_catalog_makes!inner(name,status),applications:vehicle_catalog_applications!inner(years:vehicle_catalog_application_years!inner(model_year))')
    .eq('make_id',makeId).eq('status','active').eq('make.status','active').eq('applications.status','active')
    .order('model_id').limit(501)
    .limit(1,{referencedTable:'applications'}).limit(1,{referencedTable:'applications.years'});
  if (error || !data || data.length > 500) throw new Error('Vehicle model lookup unavailable');
  const rows = data as unknown as Array<{model_id:string;name:string;make:{name:string}}>;
  return groupCatalogModels(rows[0]?.make.name ?? '', rows.map(row=>({id:row.model_id,name:row.name,years:[]})))
    .map(({id,name,aliases,modelIds})=>({id,name,aliases,modelIds}));
}), ['public-vehicle-models-security-v1'], {revalidate:3600,tags:['vehicle-catalog-v5']});

export const listPublicVehicleYears = unstable_cache(async (makeId:string,modelId:string) => timeVehicleLookup('catalog.years.origin', async () => {
  const model = (await listPublicVehicleModels(makeId)).find(row=>row.id===modelId || row.modelIds.includes(modelId));
  if (!model) return [];
  const {data,error} = await database().from('vehicle_catalog_model_years').select('model_year')
    .eq('make_id',makeId).in('model_id',model.modelIds).order('model_year',{ascending:false}).limit(501);
  if (error || !data || data.length > 500) throw new Error('Vehicle year lookup unavailable');
  const max = new Date().getFullYear()+2;
  return [...new Set(data.map(row=>Number(row.model_year)))]
    .filter(year=>Number.isInteger(year)&&year>=1886&&year<=max).sort((a,b)=>b-a);
}), ['public-vehicle-years-security-v1'], {revalidate:3600,tags:['vehicle-catalog-v5']});
