import test from 'node:test';
import assert from 'node:assert/strict';
import { globalVehicleContext, isCompleteVehicleContext, parseVehicleContext, sameVehicleContext, saveVehicleContext, clearVehicleContext, vehicleContextStorageKey, withoutVehicleParams, type VehicleContext } from '../lib/vehicle-context';
import { contactMessageWithVehicle } from '../lib/contact-vehicle';

const civic:VehicleContext={makeId:'make',modelId:'civic',year:'2015',make:'HONDA',model:'CIVIC',applicationId:'civic-exact',applicationIds:['civic-exact'],chassis:'FK2',engine:'1.8L Petrol 4-cyl — R18Z4',variantName:'Hatchback FWD'};
const corolla:VehicleContext={...civic,modelId:'corolla',make:'TOYOTA',model:'COROLLA',year:'2017',applicationId:'corolla-exact',applicationIds:['corolla-exact'],chassis:'NZE161',engine:'1.5L Petrol 4-cyl — 1NZ-FE',variantName:'Wagon FWD'};

test('only a concrete configuration can become the global vehicle',()=>{
 assert.equal(isCompleteVehicleContext(civic),true);
 assert.equal(isCompleteVehicleContext({...civic,applicationId:undefined,applicationIds:undefined}),false);
 assert.equal(isCompleteVehicleContext({...civic,applicationIds:['a','b']}),false);
 assert.equal(isCompleteVehicleContext({...civic,year:'bad'}),false);
 assert.equal(globalVehicleContext({...civic,variantGroup:'old-group'})?.variantGroup,undefined);
 assert.deepEqual(globalVehicleContext({...civic,applicationIds:undefined})?.applicationIds,['civic-exact']);
});

test('replacement and clear use one slot; unfinished drafts never overwrite the active vehicle',()=>{
 const target=new EventTarget(), values=new Map<string,string>();
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
 const fakeWindow={localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)},dispatchEvent:(event:Event)=>target.dispatchEvent(event)};
 const fakeDocument={cookie:''};
 Object.defineProperty(globalThis,'window',{value:fakeWindow,configurable:true});Object.defineProperty(globalThis,'document',{value:fakeDocument,configurable:true});
 try{
  assert.equal(saveVehicleContext(civic),true);
  const cookie=fakeDocument.cookie;
  assert.equal(saveVehicleContext({...corolla,applicationId:undefined}),false);
  assert.equal(parseVehicleContext(values.get(vehicleContextStorageKey)!)?.model,'CIVIC');assert.equal(fakeDocument.cookie,cookie);
  assert.equal(saveVehicleContext(corolla),true);assert.equal(values.size,1);
  assert.equal(parseVehicleContext(values.get(vehicleContextStorageKey)!)?.applicationId,'corolla-exact');
  clearVehicleContext();assert.equal(values.size,0);assert.match(fakeDocument.cookie,/Max-Age=0/);
 }finally{
  if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');
  if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else Reflect.deleteProperty(globalThis,'document');
 }
});

test('old vehicle URLs can be removed without losing product filters or a product route',()=>{
 assert.equal(withoutVehicleParams('/shop?category=brakes&q=NBP&f.position=Front&makeId=old&applicationIds=old&year=2015&fit=vehicle&page=3#change-vehicle'),'/shop?category=brakes&q=NBP&f.position=Front&fit=vehicle');
 assert.equal(withoutVehicleParams('/wipers/WPFP1826?applicationId=old&make=OLD&year=2015&rearAddonId=rear',true),'/wipers/WPFP1826?rearAddonId=rear');
 assert.equal(withoutVehicleParams('/shop?fit=vehicle&category=bulbs',true),'/shop?category=bulbs');
 assert.equal(sameVehicleContext(civic,{...civic}),true);assert.equal(sameVehicleContext(civic,corolla),false);assert.equal(sameVehicleContext(civic,null),false);
});

test('enquiries use the current vehicle instead of a stale URL or client label',()=>{
 const message=contactMessageWithVehicle('Need front pads',corolla,'2015 Honda Civic');
 assert.match(message,/2017 TOYOTA COROLLA/);assert.match(message,/NZE161/);assert.match(message,/1NZ-FE/);assert.doesNotMatch(message,/CIVIC/);
 assert.equal(contactMessageWithVehicle('Help',null,'My manual vehicle'),'Vehicle: My manual vehicle\n\nHelp');
 assert.equal(contactMessageWithVehicle('Help',null),'Help');
});
