import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFriendlyApplications, coverageStatus, selectionApplications, sharedVehicleDetails, type FriendlyApplication } from '../lib/vehicle-variants';
import { catalogueFacets, filterCatalogue, matchesFitmentPosition, sortCatalogue, type CatalogueEntry } from '../lib/storefront-catalog';
import { vehicleCartAttributes } from '../lib/vehicle-cart';
import { parseVehicleContext } from '../lib/vehicle-context';
import { validateCatalogueSelections } from '../lib/application/checkout/catalogue-selection';

const app = (id:string, overrides:Partial<FriendlyApplication>={}):FriendlyApplication => ({id,seriesId:id,seriesName:'NZE161',powertrainId:id,engine:'1.5L Petrol 4-cyl — 1NZ-FE',variantId:id,variantName:'Wagon FWD',bodyStyle:'Wagon',driveType:'FWD',vehicleClass:'Passenger',...overrides});
test('friendly grouping retains independent chassis and engine membership',()=>{
 const groups=groupFriendlyApplications([app('a'),app('b',{seriesName:'NZE161G',engine:'1.5L Petrol 4-cyl — OTHER'}),app('c',{bodyStyle:'Sedan'})]);
 assert.equal(groups.length,2);assert.equal(groups.find(group=>group.name.startsWith('Wagon'))!.applications.length,2);
 assert.ok(groups.every(group=>!group.name.includes('4-cyl')));
});
test('hybrid, turbo, body and drive differences are not collapsed',()=>{
 const apps=[app('a'),app('b',{engine:'1.5L Petrol/Electric 4-cyl — HYB'}),app('c',{engine:'1.5L Turbo Petrol 4-cyl — T'}),app('d',{driveType:'AWD'}),app('e',{bodyStyle:'Sedan'})];
 assert.equal(groupFriendlyApplications(apps).length,5);
});
test('missing identity fields never merge unrelated records',()=>assert.equal(groupFriendlyApplications([app('a',{bodyStyle:''}),app('b',{bodyStyle:''})]).length,2));
test('unknown engine placeholders never establish a shared configuration',()=>assert.equal(groupFriendlyApplications([app('a',{engine:'Unknown'}),app('b',{engine:'Unknown'})]).length,2));

test('quick selections expose agreed details without choosing an arbitrary application',()=>{
 const a=app('a',{seriesName:'FK2',variantName:'Hatchback'}), b=app('b',{seriesName:'FK1',variantName:'Hatchback'});
 assert.deepEqual(sharedVehicleDetails([a,b]),{chassis:undefined,engine:a.engine,variantName:'Hatchback'});
 assert.deepEqual(sharedVehicleDetails([a]),{chassis:'FK2',engine:a.engine,variantName:'Hatchback'});
 assert.equal(sharedVehicleDetails([a,app('c',{engine:'Unknown'})]).engine,undefined);
 assert.deepEqual(sharedVehicleDetails([]),{chassis:undefined,engine:undefined,variantName:undefined});
});

test('refinement stays within the saved version and never expands a stale selection',()=>{
 const apps=[app('a'),app('b',{seriesName:'OTHER'}),app('c',{bodyStyle:'Sedan'})];
 const group=groupFriendlyApplications(apps).find(group=>group.applications.some(app=>app.id==='a'))!;
 assert.deepEqual(selectionApplications(apps,{variantGroup:group.id}).map(app=>app.id),['a','b']);
 assert.deepEqual(selectionApplications(apps,{applicationId:'b'}).map(app=>app.id),['b']);
 assert.deepEqual(selectionApplications(apps,{variantGroup:'retired',applicationId:'c'}),[]);
});
test('any match is a candidate; full group coverage is required for a confirmation',()=>{
 assert.equal(coverageStatus(['a','b'],['a']),'conditional');assert.equal(coverageStatus(['a','b'],['a','b','b']),'fits');assert.equal(coverageStatus(['a','b'],['c']),'not-listed');assert.equal(coverageStatus([],[]),'not-listed');
});
test('front and rear evidence cannot be combined into a false position-specific confirmation',()=>{
 assert.equal(matchesFitmentPosition('brakes',['Front'],'rear'),false);
 assert.equal(matchesFitmentPosition('brakes',['Front'],'front'),true);
 assert.equal(matchesFitmentPosition('brakes',['Front'],'unknown'),false);
 assert.equal(matchesFitmentPosition('brakes',['Front'],'both'),true);
 assert.equal(matchesFitmentPosition('filters',undefined,'engine'),true);
});
const entry=(id:string, category:CatalogueEntry['category'], attributes:CatalogueEntry['attributes']):CatalogueEntry=>({id,sku:id,name:id,category,attributes,price:10,image:'',href:'',purchasable:true});
const entries=[entry('NBP1','brakes',{position:['Front']}),entry('NBP2','brakes',{position:['Rear']}),entry('NBL1','bulbs',{'Bulb model':['H16'],Voltage:['12V']}),entry('NBL2','bulbs',{'Bulb model':['H11'],Voltage:['12V']})];

test('confirmed fits lead the complete catalogue before pagination and secondary sorting',()=>{
 const products:CatalogueEntry[]=[{...entries[0],price:1,status:'not-listed'},{...entries[1],price:20,status:'conditional'},{...entries[2],price:80,status:'fits'},{...entries[3],price:40,status:'fits'}];
 assert.deepEqual(sortCatalogue(products,'featured',true).map(p=>p.sku),['NBL1','NBL2','NBP2','NBP1']);
 assert.deepEqual(sortCatalogue(products,'price-asc',true).map(p=>p.sku),['NBL2','NBL1','NBP2','NBP1']);
 assert.deepEqual(sortCatalogue(products,'price-asc',false).map(p=>p.price),[1,20,40,80]);
 assert.deepEqual(products.map(p=>p.price),[1,20,80,40]);
});
test('facets are category-specific and do not expose single-value or empty attributes',()=>{
 assert.deepEqual(catalogueFacets(entries,'all',{}),[]);
 assert.deepEqual(catalogueFacets(entries,'brakes',{}).map(f=>f.key),['position']);
 assert.deepEqual(catalogueFacets(entries,'bulbs',{}).map(f=>f.key),['Bulb model']);
});
test('specification and SKU search operate on the full catalogue rather than a page slice',()=>{
 assert.equal(filterCatalogue(entries,'bulbs','H11',{}).length,1);assert.equal(filterCatalogue(entries,'all','NBL1',{}).length,1);
 assert.equal(filterCatalogue(entries,'brakes','',{position:'Rear'}).length,1);
 assert.equal(filterCatalogue(entries,'bulbs','',{position:'Rear'}).length,2);
});
test('cart selection preserves a group without inventing an exact first application',()=>{
 const vehicle={makeId:'make',modelId:'model',make:'Toyota',model:'Corolla',year:'2017',variantGroup:'group',versionLabel:'Wagon · 1.5L Petrol · FWD',applicationIds:['a','b']};
 const attrs=vehicleCartAttributes(vehicle,'conditional'), selection=JSON.parse(String(attrs.vehicle_selection));
 assert.equal(selection.variantGroup,'group');assert.equal(selection.applicationId,undefined);assert.equal(selection.applicationIds,undefined);assert.equal(attrs.vehicle_fitment_status,'conditional');
 assert.deepEqual(vehicleCartAttributes(null),{});assert.equal(parseVehicleContext(JSON.stringify(vehicle))?.variantGroup,'group');
});
test('checkout recomputes per-SKU status and ignores a client supplied fits claim',async()=>{
 const vehicle={makeId:'make',modelId:'model',year:'2017',make:'Toyota',model:'Corolla',variantGroup:'group'};
 const attrs=vehicleCartAttributes(vehicle,'fits');
 const item={productId:'p',variantId:'v',sku:'NBP1',name:'test',category:'brake-pad',qty:1,price:100,attributes:attrs};
 let reads=0;
 const resolved=await validateCatalogueSelections([item,{...item,sku:'NBP2'}],async()=>{reads++;return {vehicle,entries:[{sku:'NBP1',status:'conditional'},{sku:'NBP2',status:'fits'}]};});
 assert.equal(reads,1);assert.equal(resolved.get(0)?.vehicle_fitment_status,'conditional');assert.equal(resolved.get(1)?.vehicle_fitment_status,'fits');
});
test('checkout rejects stale and malformed selections but preserves manual-SKU purchasing',async()=>{
 const item={productId:'p',variantId:'v',sku:'SKU',name:'test',category:'filter',qty:1,price:10,attributes:{}};
 assert.equal((await validateCatalogueSelections([item],async()=>null)).size,0);
 await assert.rejects(validateCatalogueSelections([{...item,attributes:{vehicle_selection:'null'}}],async()=>null));
 await assert.rejects(validateCatalogueSelections([{...item,attributes:{vehicle_selection:JSON.stringify({makeId:'m',modelId:'d',year:'2017'})}}],async()=>null));
});
