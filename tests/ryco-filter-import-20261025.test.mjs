import test from 'node:test';
import assert from 'node:assert/strict';
import {normalize,classify,compatible,intersectEvidence} from '../scripts/catalog/import-ryco-filter-fitments-20261025.mjs';
const raw={make:'TOYOTA',model:'COROLLA',series:'ZRE182R',year:'2015',engine:'1.8L, PET 2ZRFE I4',vehicle:'5D Hatch, FWD',category:'Oil Filter',description:'Oil Filter',reference:'Z432',file:'source.xlsx',sheet:'data',row:2};
const app={make:'TOYOTA',series:'ZRE182',engine_codes:['2ZR-FE'],displacement_cc:1800,body:'hatch',drive:'fwd',years:[2015,2016]};
test('exact engine and year required; no cross-engine platform propagation',()=>{
 assert(compatible(app,normalize(raw)));
 assert(!compatible({...app,engine_codes:['1NZ-FE']},normalize(raw)));
 assert(!compatible(app,normalize({...raw,vehicle:'沿用 2006 年 同系列同发动机'})));
 assert(!compatible(app,normalize({...raw,vehicle:'Sedan, FWD'})));
});
test('each year must be supported',()=>assert.deepEqual(intersectEvidence(app,[normalize(raw)]).refs,[]));
test('all compatible source trim configurations must support reference',()=>{
 const rows=[raw,{...raw,year:'2016'}, {...raw,year:'2016',vehicle:'Other trim 5D Hatch, FWD',reference:'Z999'}].map(normalize);
 assert.deepEqual(intersectEvidence(app,rows).refs,[]);
});
test('co-listed SynTec alternatives remain separate valid references',()=>{
 const rows=[2015,2016].flatMap(y=>['Z432','Z432ST'].map(reference=>normalize({...raw,year:String(y),reference})));
 assert.deepEqual(intersectEvidence(app,rows).refs,['Z432','Z432ST']);
});
test('air filters require series and remain independent of oil',()=>{
 const air=normalize({...raw,category:'Air Filter',description:'Air Filter',reference:'A123'});
 assert.equal(air.type,'air_filter');assert(compatible(app,air));
 assert(!compatible(app,{...air,seriesTokens:[]}));
 assert.equal(classify({...raw,description:'Oil Filter Removal Tool'}),'accessory');
});
