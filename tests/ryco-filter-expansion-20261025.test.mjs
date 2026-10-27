import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize} from '../scripts/catalog/import-ryco-filter-fitments-20261025.mjs';
import {evaluate,selectZ9,prepareSource} from '../scripts/catalog/expand-ryco-filter-knowledge-20261025.mjs';
const raw={make:'TOYOTA',model:'COROLLA',series:'ZRE182R',year:'2015',engine:'1.8L, PET 2ZRFE I4',vehicle:'5D Hatch, FWD',category:'Oil Filter',description:'Oil Filter',reference:'Z432',file:'source.xlsx',sheet:'data',row:2};
const app={make:'TOYOTA',model:'COROLLA',series:'ZRE182',engine_codes:['2ZR-FE'],displacement_cc:1800,body:'hatch',drive:'fwd',years:[2015,2016]};
test('engine-first source fields never turn cylinder counts into capacity',()=>{
 const r=normalize({...raw,engine:'QR25DE I4 16v DOHC MPFI'});assert.equal(r.engineCode,'QR25DE');assert.equal(r.displacement,0);
 const n=normalize({...raw,engine:'4N15 I4 16v DOHC CRD'});assert.equal(n.engineCode,'4N15');assert.equal(n.displacement,0);
 assert.equal(normalize({...raw,engine:'4.0 I6 12v SOHC MPFI'}).displacement,4000);
});
test('oil may cross chassis only when exact engine-year references agree across source configurations',()=>{
 const rr=[2015,2016].flatMap(year=>['ZRE182R','ZRE183R'].map(series=>normalize({...raw,year:String(year),series})));
 assert.deepEqual(evaluate(app,'oil_filter',rr).refs,['Z432']);
 assert.deepEqual(evaluate({...app,engine_codes:['1NZ-FE']},'oil_filter',rr).refs,[]);
 assert.deepEqual(evaluate({...app,series:'ZRE999'},'oil_filter',[...rr,normalize({...raw,series:'ZRE184R',reference:'Z999'})]).refs,[]);
 assert.deepEqual(evaluate(app,'oil_filter',[...rr,normalize({...raw,series:'ZRE184R',reference:'Z999'})]).refs,['Z432']);
});
test('air retains series, body and engine hard keys',()=>{
 const rr=[2015,2016].map(year=>normalize({...raw,year:String(year),description:'Air Filter',reference:'A123'}));
 assert.deepEqual(evaluate(app,'air_filter',rr).refs,['A123']);
 assert.deepEqual(evaluate({...app,series:'ZRE999'},'air_filter',rr).refs,[]);
 assert.deepEqual(evaluate({...app,body:'sedan'},'air_filter',rr).refs,[]);
});
test('no extension beyond evidence years or from explicitly inferred rows',()=>{
 const rr=[2015,2016].map(year=>normalize({...raw,year:String(year)}));
 assert.deepEqual(evaluate({...app,years:[2014,2015,2016]},'oil_filter',rr).refs,[]);
 assert.deepEqual(evaluate(app,'oil_filter',rr.map(r=>({...r,inferred:true}))).refs,[]);
});
test('Z9 product positioning is constrained to the reviewed source configuration',()=>{
 const a={make:'FORD',model:'FALCON',series:'XH',body:'van',drive:'rwd',displacement_cc:4000,engine:'4L Petrol 6-cyl — ATG / H (MPFI)',years:[1996,1997,1998,1999]};
 assert.equal(selectZ9(a),'NOF1804');assert.equal(selectZ9({...a,body:'pickup'}),'NOF1804');
 assert.equal(selectZ9({...a,model:'EXPLORER',body:'suv'}),null);
 assert.equal(selectZ9({...a,displacement_cc:1600,body:'sedan'}),null);
});
test('code-free source needs one stored powertrain under exact discriminators',()=>{
 const r={...raw,make:'FORD',model:'FALCON',series:'XH',year:'1996-1999',engine:'4.0 I6 12v SOHC MPFI',vehicle:'Van - Panel, RWD'};
 const a={...app,make:'FORD',model:'FALCON',family:'requested-28',series:'XH',powertrain_id:'pt1',application_id:'a',body:'van',drive:'rwd',displacement_cc:4000,engine:'4L Petrol 6-cyl',engine_codes:['ATG','H (MPFI)'],years:[1996,1997,1998,1999]};
 // Family IDs are loaded from the maintained popular scope, not invented here.
 const first=prepareSource({rows:[r]},[a]);
 if(first[0].family!==a.family)a.family=first[0].family;
 assert.deepEqual(prepareSource({rows:[r]},[a])[0].resolvedCodes,['ATG','HMPFI']);
 assert.equal(prepareSource({rows:[r]},[a,{...a,powertrain_id:'pt2'}])[0].resolvedCodes,undefined);
});
