import test from 'node:test';
import assert from 'node:assert/strict';
import {createVehicleCatalogHandler as catalogFactory,createVehicleApplicationsHandler as applicationsFactory} from '../lib/application/fitment/vehicle-catalog-api';
import {fixtureGuard,allowedQuota} from './helpers/quota-fixture';
const createVehicleCatalogHandler=(deps:Parameters<typeof catalogFactory>[0])=>catalogFactory({...deps,guard:fixtureGuard()});
const createVehicleApplicationsHandler=(lookup:Parameters<typeof applicationsFactory>[0])=>applicationsFactory(lookup,fixtureGuard());

const makeId='mk_1234567890abcdef1234',modelId='md_1234567890abcdef1234';
let requestNumber=0;
const request=(query='')=>new Request(`https://shop.test/api/vehicles/catalog${query}`,{headers:{'x-forwarded-for':`198.51.100.${++requestNumber}`,'sec-fetch-site':'same-origin'}});

test('navigation exposes only makes, then models for one make, then years for one model',async()=>{
  const calls:string[]=[];
  const handler=createVehicleCatalogHandler({
    makes:async()=>{calls.push('makes');return [{id:makeId,name:'Toyota',models:[{secret:'hidden'}]}];},
    models:async(id)=>{assert.equal(id,makeId);calls.push('models');return [{id:modelId,name:'Corolla',aliases:['Corolla'],modelIds:[modelId],years:[2017]}];},
    years:async(make,model)=>{assert.equal(make,makeId);assert.equal(model,modelId);calls.push('years');return [2017];}
  });
  const makes=await handler(request());
  assert.deepEqual(await makes.json(),{makes:[{id:makeId,name:'Toyota'}]});
  assert.match(makes.headers.get('cache-control')??'',/private, no-store/);
  assert.deepEqual(await (await handler(request(`?makeId=${makeId}`))).json(),{models:[{id:modelId,name:'Corolla',aliases:['Corolla'],modelIds:[modelId]}]});
  assert.deepEqual(await (await handler(request(`?makeId=${makeId}&modelId=${modelId}`))).json(),{years:[2017]});
  assert.deepEqual(calls,['makes','models','years']);
});

test('unknown, repeated, invalid, full-export and incomplete navigation parameters never query data',async()=>{
  let calls=0;
  const handler=createVehicleCatalogHandler({makes:async()=>{calls++;return [];},models:async()=>{calls++;return [];},years:async()=>{calls++;return [];}});
  for(const query of ['?all=true','?catalog=all','?catalog=full','?limit=100000',`?makeId=${makeId}&makeId=${makeId}`,`?modelId=${modelId}`,'?makeId=invalid',`?makeId=${makeId}&modelId=invalid`]) {
    assert.equal((await handler(request(query))).status,400,query);
  }
  assert.equal(calls,0);
});

test('a database exception never leaks credentials, SQL or schema details',async()=>{
  const handler=createVehicleCatalogHandler({makes:async()=>{throw new Error('service_role secret SQL internal_table');},models:async()=>[],years:async()=>[]});
  const response=await handler(request());
  assert.equal(response.status,500);
  assert.deepEqual(await response.json(),{error:'Could not load vehicle catalogue.'});
});

test('applications reject noncanonical and duplicate years before lookup and cap configuration responses',async()=>{
  let calls=0;
  const handler=createVehicleApplicationsHandler(async(make,model,year)=>{calls++;assert.equal(make,makeId);assert.equal(model,modelId);assert.equal(year,2017);return [{id:'app'}];});
  const prefix=`?makeId=${makeId}&modelId=${modelId}`;
  for(const year of ['1900.0','2e3','0','2200','2017&year=2017']) assert.equal((await handler(request(`${prefix}&year=${year}`))).status,400);
  assert.equal(calls,0);
  assert.deepEqual(await (await handler(request(`${prefix}&year=2017`))).json(),{applications:[{id:'app'}]});
  assert.equal(calls,1);
  const tooMany=createVehicleApplicationsHandler(async()=>Array.from({length:501},()=>({id:'app'})));
  assert.equal((await tooMany(request(`${prefix}&year=2017`))).status,422);
});

test('applications use safe errors and the same cross-site guard',async()=>{
  const handler=createVehicleApplicationsHandler(async()=>{throw new Error('password=secret');});
  const query=`?makeId=${makeId}&modelId=${modelId}&year=2017`;
  const result=await handler(request(query));
  assert.equal(result.status,500);
  assert.doesNotMatch(await result.text(),/password|secret/);
  const blocked=await handler(new Request(`https://shop.test/api/vehicles/applications${query}`,{headers:{'sec-fetch-site':'cross-site'}}));
  assert.equal(blocked.status,403);
});

test('reusing a cached lookup result still consumes every request and blocks before another lookup',async()=>{
  const cached=Promise.resolve([{id:'application'}]); let calls=0;
  let consumed=0;
  const handler=applicationsFactory(()=>{calls++;return cached;},fixtureGuard({consume:async()=>({...allowedQuota,allowed:++consumed<=90,remaining:Math.max(0,90-consumed),reason:consumed>90?'request_rate':null})}));
  const path=`https://shop.test/api/vehicles/applications?makeId=${makeId}&modelId=${modelId}&year=2017`;
  const send=()=>handler(new Request(path,{headers:{'x-forwarded-for':'198.51.100.240','sec-fetch-site':'same-origin'}}));
  for(let i=0;i<90;i++){
    const response=await send(); assert.equal(response.status,200);
    assert.match(response.headers.get('cache-control')??'',/private, no-store/);
    assert.match(response.headers.get('ratelimit')??'',new RegExp(`remaining=${89-i},`));
  }
  const limited=await send();
  assert.equal(limited.status,429); assert.equal(calls,90);
  assert.ok(Number(limited.headers.get('retry-after'))>=1);
});
