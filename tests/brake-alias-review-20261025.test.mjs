import test from 'node:test';
import assert from 'node:assert/strict';
import {assessReviewed,augmentSources,identityCorrection} from '../scripts/catalog/brake-alias-review-policy-20261025.mjs';
import {normalizeTopstar,topstarFitmentTokens} from '../scripts/catalog/brake-popular50-script-first-policy.mjs';
const app=(over={})=>({application_id:'ap_test',status:'active',make:'FORD',model:'FOCUS',series:'DA_',body:'Hatchback',drive:'FWD',variant:'Hatchback FWD',engine_codes:['ASDA'],displacement_cc:1388,years:[2004,2005],all_years:[2004,2005],existing:[],...over});
const prod=(db,pos='front')=>new Map([[`${db}|${pos}`,[{sku:'NBP1',id:'p1'}]]]);
const src=(over={})=>({source_id:'B:test',family:'FORD|FOCUS',tokens:['DA_'],series:'Focus II',position:'front',db:'DB1679',from:2004,to:2012,year_kind:'closed',body:'hatchback',drive:'fwd',engine_codes:[],displacement_cc:null,...over});
test('Focus II verified front restores known identity without exact per-engine donor',()=>assert.equal(assessReviewed(app(),'front',[],prod('DB1679')).status,'ready'));
test('first-generation engines in DA_ never gain synthetic Focus II front support',()=>assert.equal(assessReviewed(app({engine_codes:['FYDB'],all_years:[2004],years:[2004]}),'front',[],prod('DB1679')).status,'review_identity_risk'));
test('Focus rear disk/drum is not hidden by one saved DB',()=>assert.equal(assessReviewed(app(),'rear',[src({position:'rear',db:'DB1763'})],prod('DB1763','rear')).status,'review_brake_configuration'));
test('partial source years are never extended by a direct Focus rule',()=>assert.notEqual(assessReviewed(app({all_years:[2004,2013]}),'front',[],prod('DB1679')).status,'ready'));
test('live conflict prevents restoration',()=>assert.equal(assessReviewed(app({existing:[{position:'front',fitment_status:'published',db:'DB_OTHER',sku:'NBP2'}]}),'front',[],prod('DB1679')).status,'review_published_conflict'));
test('multiple source DBs survive a bridge and need disambiguation',()=>{
 const rows=[{sourceRowId:1,makeName:'VW',modelName:'GOLF',seriesName:'GOLF IV (1J1)',yearFrom:1997,yearTo:2005,bodyStyle:'hatchback',driveType:'fwd',engineCodes:[],position:'front',bendixReference:'DB1405'},{sourceRowId:2,makeName:'VW',modelName:'GOLF',seriesName:'GOLF IV (1J1)',yearFrom:1997,yearTo:2005,bodyStyle:'hatchback',driveType:'fwd',engineCodes:[],position:'front',bendixReference:'DB1492'}];
 const r=assessReviewed(app({make:'VOLKSWAGEN',model:'GOLF',series:'9B1',years:[2002],all_years:[2002]}),'front',augmentSources(rows,[]),prod('DB1492'));
 assert.equal(r.status,'review_multiple_db');assert.deepEqual(r.candidate_db,['DB1405','DB1492']);
});
test('CX-3 rear EPB transition remains review even with unique source',()=>assert.equal(assessReviewed(app({make:'MAZDA',model:'CX-3',series:'DK5AW',body:'SUV',drive:'AWD',years:[2015,2018],all_years:[2015,2018]}),'rear',[src({family:'MAZDA|CX3',tokens:['DK5AW'],position:'rear',db:'DB2227',body:'suv',drive:'awd',from:2015,to:2019})],prod('DB2227','rear')).status,'review_brake_configuration'));
test('MCV20 1996 edge is not silently re-published',()=>assert.equal(assessReviewed(app({make:'TOYOTA',model:'CAMRY',series:'MCV20',all_years:[1996,2000]}),'front',[],prod('DB1345')).status,'review_year_or_config'));
test('only clear wrong-model identities enter corrections',()=>{
 assert.equal(identityCorrection(app({make:'BMW',model:'3',series:'E83',body:'SUV'})).model,'X3');
 assert.equal(identityCorrection(app({make:'BMW',model:'3',series:'I01',body:'Hatchback'})).model,'i3');
 assert.equal(identityCorrection(app({make:'BMW',model:'3',series:'G45',body:'SUV'})).model,'X3');
 assert.equal(identityCorrection(app({make:'MAZDA',model:'5',series:'NB8C',body:'Convertible'})).model,'MX-5');
 assert.equal(identityCorrection(app({make:'MAZDA',model:'5',series:'KE2AW',body:'SUV'})).model,'CX-5');
 assert.equal(identityCorrection(app({make:'MAZDA',model:'2',series:'BJ5P',body:'Sedan'})).model,'323');
 assert.equal(identityCorrection(app({make:'VOLKSWAGEN',model:'GOLF',series:'1T3',body:'MPV'})).model,'TOURAN');
 assert.equal(identityCorrection(app({make:'TOYOTA',model:'YARIS',series:'MXPJ15',body:'SUV'})).model,'YARIS CROSS');
 assert.equal(identityCorrection(app({make:'TOYOTA',model:'HILUX',series:'TRN215W',body:'SUV'})).model,'HILUX SURF');
 assert.equal(identityCorrection(app({make:'FORD',model:'E',series:'',body:'Standard Cab Utility',engine_codes:['T30VVEX']})).model,'RANGER');
 assert.equal(identityCorrection(app({make:'HONDA',model:'Z',series:'GS4',body:'Hatchback',engine_codes:['L15Z']})).model,'JAZZ');
 assert.equal(identityCorrection(app({make:'HYUNDAI',model:'SANTA FE V',series:'MX5',body:'SUV'})).model,'SANTA FE');
 assert.equal(identityCorrection(app({make:'TOYOTA',model:'IST',series:'MCV21W',body:'Wagon'})).model,'CAMRY');
 assert.equal(identityCorrection(app({make:'MAZDA',model:'3',series:'DK5AW',body:'SUV'})).model,'CX-3');
 assert.equal(identityCorrection(app({series:'DM2',body:'MPV'})).model,'FOCUS C-MAX');
 assert.equal(identityCorrection(app({make:'MAZDA',model:'3',series:'BM5AS'})),null);
});
test('no blanket wagon/SUV or unrelated chassis normalization',()=>{
 const a=app({make:'SUBARU',model:'FORESTER',series:'SG5',body:'Wagon',drive:'AWD',displacement_cc:2000,all_years:[2005]});
 assert.notEqual(assessReviewed(a,'rear',[src({family:'SUBARU|FORESTER',tokens:['SG5'],body:'suv',drive:'awd',position:'rear',db:'DB1379',from:2002,to:2008})],prod('DB1379','rear')).status,'ready');
});
test('supplier chassis codes misplaced in engine field are recovered narrowly',()=>{
 const catalog=[{sku:'NBP1259',supplierRef:'DB2223',position:'Front',fitments:[
  {make:'BMW',model:'3 Series',chassis:'',engine:'F30 / F31 / F34'},
  {make:'BMW',model:'3 Series',chassis:'',engine:'2.0L'},
 ]}];
 const rows=normalizeTopstar(catalog);
 assert.deepEqual(rows[0].tokens,['F30','F31','F34']);
 assert.equal(rows[0].source_field,'engine_misfielded_chassis');
 assert.deepEqual(rows[1].tokens,[]);
 assert.deepEqual(topstarFitmentTokens({chassis:'8K2',engine:'2.0L'}),['8K2']);
});
test('verified Golf and CX-5 chassis bridges expose supplier candidates without relaxing global matching',()=>{
 const rows=[
  {sourceRowId:10,makeName:'VW',modelName:'GOLF',seriesName:'GOLF VII (5G1)',yearFrom:2012,yearTo:2020,bodyStyle:'hatchback',driveType:'fwd',engineCodes:['CZDA'],displacementCc:1395,position:'front',bendixReference:'DB2383'},
  {sourceRowId:11,makeName:'VW',modelName:'GOLF',seriesName:'GOLF VII Variant (BA5, BV5)',yearFrom:2013,yearTo:2020,bodyStyle:'wagon',driveType:'fwd',engineCodes:['CZDA'],displacementCc:1395,position:'front',bendixReference:'DB2383'},
  {sourceRowId:12,makeName:'MAZDA',modelName:'CX-5',seriesName:'CX-5 (KF)',yearFrom:2017,yearTo:2026,bodyStyle:'suv',driveType:'fwd',engineCodes:['PEVPS'],displacementCc:1998,position:'rear',bendixReference:'DB2414'},
 ];
 const sources=augmentSources(rows,[]);
 assert.equal(assessReviewed(app({make:'VOLKSWAGEN',model:'GOLF',series:'BC2',body:'Hatchback',drive:'FWD',engine_codes:['CZDA'],displacement_cc:1395,all_years:[2017],years:[2017]}),'front',sources,prod('DB2383')).status,'ready');
 assert.equal(assessReviewed(app({make:'VOLKSWAGEN',model:'GOLF',series:'BX5',body:'Wagon',drive:'FWD',engine_codes:['CZDA'],displacement_cc:1395,all_years:[2017],years:[2017]}),'front',sources,prod('DB2383')).status,'ready');
 assert.equal(assessReviewed(app({make:'MAZDA',model:'CX-5',series:'KF5P',body:'SUV',drive:'FWD',engine_codes:['PEVPS'],displacement_cc:1998,all_years:[2019],years:[2019]}),'rear',sources,prod('DB2414','rear')).status,'ready');
});
test('Audi B8 bridge retains both front DBs and only makes the rear deterministic',()=>{
 const catalog=[
  {sku:'NBP1249',supplierRef:'DB2184',position:'Front',fitments:[{make:'Audi',model:'A4 / A4 Allroad',chassis:'',engine:'B8'}]},
  {sku:'NBP1250',supplierRef:'DB2185',position:'Rear',fitments:[{make:'Audi',model:'A4 / A4 Allroad',chassis:'',engine:'B8'}]},
  {sku:'NBP1251',supplierRef:'DB2186',position:'Front',fitments:[{make:'Audi',model:'A4 / A4 Allroad',chassis:'',engine:'B8'}]},
 ];
 const sources=augmentSources([],catalog),a=app({make:'AUDI',model:'A4',series:'8K2',body:'Sedan',drive:'FWD',all_years:[2012],years:[2012]});
 const products=new Map([['DB2184|front',[{sku:'NBP1249',id:'p1'}]],['DB2186|front',[{sku:'NBP1251',id:'p2'}]],['DB2185|rear',[{sku:'NBP1250',id:'p3'}]]]);
 assert.equal(assessReviewed(a,'front',sources,products).status,'review_multiple_db');
 assert.equal(assessReviewed(a,'rear',sources,products).status,'ready');
});
