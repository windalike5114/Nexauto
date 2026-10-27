import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCataloguePage} from '../lib/application/storefront/catalogue-page';
import {parseCatalogueRequest} from '../lib/storefront-page';
import {createCataloguePageHandler} from '../lib/application/storefront/catalogue-api';
import {createLegacyVehicleHandler} from '../lib/application/fitment/legacy-vehicle-api';
import {fixtureGuard,allowedQuota} from './helpers/quota-fixture';
import type {CatalogueEntry} from '../lib/storefront-catalog';

const entries:CatalogueEntry[]=Array.from({length:73},(_,i)=>({id:'internal-'+i,productId:'private-product',variantId:'private-variant',matchedApplicationIds:['private-application'],
 sku:'SKU'+String(i).padStart(3,'0'),name:i===72?'Special H11':'Product '+i,category:i%2?'bulbs':'brakes',price:i+1,image:'/item.png',href:'/item/'+i,purchasable:true,
 status:i>=70?'fits':'not-listed',attributes:i%2?{'Bulb model':[i%4?'H11':'H4']}:{position:[i%4?'Rear':'Front']}}));
const request=(body:unknown,url='https://shop.test/api/catalogue/page')=>new Request(url,{method:'POST',headers:{'Content-Type':'application/json','sec-fetch-site':'same-origin'},body:JSON.stringify(body)});

test('server pagination limits every page to 24, covers the entire set without overlap and strips internal identities',()=>{
 const pages=[1,2,3,4].map(page=>buildCataloguePage(entries,parseCatalogueRequest({page}),null));
 assert.deepEqual(pages.map(page=>page.items.length),[24,24,24,1]);
 assert.equal(new Set(pages.flatMap(page=>page.items.map(item=>item.sku))).size,73);
 assert.equal(pages[0].total,73);assert.equal(pages[0].counts.all,73);
 assert.doesNotMatch(JSON.stringify(pages),/private-product|private-variant|private-application|matchedApplicationIds|productId|variantId/);
 assert.ok(pages.every(page=>page.items.every(item=>item.id===item.sku)));
});
test('search, sorting and fitment priority apply before slicing, rather than only within a page',()=>{
 const vehicle={makeId:'make',modelId:'model',year:'2015',make:'Honda',model:'Civic',applicationId:'application'};
 const sorted=buildCataloguePage(entries,parseCatalogueRequest({sort:'price-asc'}),vehicle);
 assert.deepEqual(sorted.items.slice(0,3).map(item=>item.sku),['SKU070','SKU071','SKU072']);
 const searched=buildCataloguePage(entries,parseCatalogueRequest({query:'Special H11',page:4}),null);
 assert.equal(searched.total,1);assert.equal(searched.page,1);assert.equal(searched.items[0].sku,'SKU072');
 const fitted=buildCataloguePage(entries,parseCatalogueRequest({fit:true}),vehicle);
 assert.equal(fitted.total,3);assert.equal(fitted.items.length,3);
});
test('facets and category counts are aggregates, with no extra recommendation products',()=>{
 const page=buildCataloguePage(entries,parseCatalogueRequest({category:'brakes',facets:{position:'Front'}}),null);
 assert.ok(page.items.every(item=>item.attributes.position?.includes('Front')));
 assert.deepEqual(page.facets.find(f=>f.key==='position')?.values,['Front','Rear']);
 assert.equal(page.counts.brakes,37);assert.equal(page.counts.bulbs,36);
 assert.equal('recommendations'in page,false);
});
test('page-size, export, arbitrary filters and hidden categories cannot widen a catalogue request',()=>{
 for(const input of [{pageSize:1000},{limit:1000},{all:true},{page:0},{page:1.5},{page:10001},{category:'batteries'},
  {query:'x'.repeat(121)},{category:'brakes',facets:{sku:'all'}},{facets:{position:'Front'}},{facets:[]}])assert.throws(()=>parseCatalogueRequest(input));
});
test('catalogue requests retain private headers, consume quota before cached data, and stop at denial',async()=>{
 let consume=0,reads=0;
 const guard=fixtureGuard({consume:async()=>({...allowedQuota,allowed:++consume<3,reason:consume<3?null:'request_rate',remaining:Math.max(0,2-consume)})});
 const page=buildCataloguePage(entries,parseCatalogueRequest({}),null);
 const handler=createCataloguePageHandler({guard,vehicle:async()=>null,read:async()=>{reads++;return page;}});
 for(let i=0;i<2;i++){
  const response=await handler(request({}));assert.equal(response.status,200);assert.equal((await response.json()).items.length,24);
  assert.match(response.headers.get('cache-control')??'',/private, no-store/);
 }
 assert.equal((await handler(request({}))).status,429);assert.equal(reads,2);assert.equal(consume,3);
});
test('catalogue validates body bounds and authoritative vehicle identity without returning stale fitment',async()=>{
 let reads=0;
 const vehicle={makeId:'mk_1234567890abcdef1234',modelId:'md_1234567890abcdef1234',year:'2015',make:'Honda',model:'Civic',applicationId:'ap_1234567890abcdef1234'};
 const handler=createCataloguePageHandler({guard:fixtureGuard(),vehicle:async()=>vehicle,read:async()=>{reads++;return buildCataloguePage(entries,parseCatalogueRequest({}),vehicle);}});
 assert.equal((await handler(request({pageSize:1000}))).status,400);
 assert.equal((await handler(request({query:'x'.repeat(5000)}))).status,413);
 assert.equal((await handler(request({}))).status,409);assert.equal(reads,0);
 const response=await handler(request({},`https://shop.test/api/catalogue/page?makeId=${vehicle.makeId}&modelId=${vehicle.modelId}`));
 assert.equal(response.status,200);assert.equal(reads,1);
 const cross=await handler(new Request('https://shop.test/api/catalogue/page',{method:'POST',headers:{'sec-fetch-site':'cross-site'},body:'{}'}));
 assert.equal(cross.status,403);
});
test('legacy vehicle endpoints reject old export paths, strip model years and use the same async guard',async()=>{
 let lookups=0,guards=0;
 const baseGuard=fixtureGuard();
 const deps={guard:async(request:Request)=>{guards++;return baseGuard(request);},makes:async()=>[{id:'make',name:'Toyota',models:['hidden']}],
 models:async()=>{lookups++;return [{id:'model',name:'Corolla',aliases:['Corolla'],modelIds:['model'],years:[2017],private:'hidden'}];},years:async()=>[2017]};
 const models=createLegacyVehicleHandler('models',deps),make='mk_1234567890abcdef1234';
 const response=await models(new Request('https://shop.test/api/vehicles/models?makeId='+make));
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{models:[{id:'model',name:'Corolla',aliases:['Corolla'],modelIds:['model']}]});
 assert.match(response.headers.get('cache-control')??'',/private, no-store/);
 for(const query of ['?all=true','?makeId='+make+'&makeId='+make,'?makeId='+make+'&catalog=full'])assert.equal((await models(new Request('https://shop.test/api/vehicles/models'+query))).status,400);
 assert.equal(lookups,1);assert.equal(guards,4);
 const broken=createLegacyVehicleHandler('years',{...deps,years:async()=>{throw new Error('SQL service_role secret');}});
 const error=await broken(new Request(`https://shop.test/api/vehicles/years?makeId=${make}&modelId=md_1234567890abcdef1234`));
 assert.equal(error.status,500);assert.doesNotMatch(await error.text(),/SQL|secret|service_role/);
});
