import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBrakeFitment,platformCodeMatch,familyScopedDetailedChassisMatch} from '../scripts/catalog/brake-pad-strict-policy.mjs';
const app=(extra={})=>({status:'active',make:'TOYOTA',model:'RAV4',series:'ACA31',body:'SUV',drive:'AWD',engine:'2.4L Petrol — 2AZ-FE',displacementCc:2400,years:[2010,2011],...extra});
const src=(extra={})=>({makeName:'TOYOTA',modelName:'RAV4',seriesName:'RAV4 (ACA31)',position:'front',bodyStyle:'suv',driveType:'awd',engineCodes:['2AZFE'],displacementCc:2400,yearFrom:2005,yearTo:2012,bendixReference:'DB1802',sourceRowId:1,...extra});
const run=(a=app(),rows=[src()],db='DB1802')=>evaluateBrakeFitment(a,'front',db,rows);
test('unique candidate can publish with missing engine evidence or drive',()=>{
 assert.equal(run(app({engine:'',engineCodes:[],displacementCc:null})).keep,true);
 assert.equal(run(app({drive:'',variant:''})).keep,true);
});
test('unique platform candidate can extend source years provisionally',()=>{
 const r=run(app({years:[2004,2010,2015]}));assert.equal(r.keep,true);assert.equal(r.provisional,true);assert.deepEqual(r.missing_years,[2004,2015]);
});
test('known different drive/body can pass only when the whole platform position has the same current DB',()=>{
 assert.equal(run(app({drive:'FWD'})).keep,true);
 assert.equal(run(app({body:'Sedan'})).keep,true);
 assert.equal(run(app({drive:'FWD'}),[src(),src({sourceRowId:2,bendixReference:'DB1679'})]).keep,false);
 assert.equal(run(app({body:'Sedan'}),[src(),src({sourceRowId:2,bendixReference:'DB1679'})]).keep,false);
 assert.equal(run(app({series:'ACA21'})).keep,false);
});
test('multiple candidates may use populated body drive year engine and cc together',()=>{
 const r=run(app(),[src(),src({sourceRowId:2,bendixReference:'DB1679',engineCodes:['1AZFE'],displacementCc:2000})]);
 assert.equal(r.keep,true);assert.equal(r.rule,'unique_after_body_drive_year_engine_disambiguation');
});
test('missing drive is not a veto if full-year engine and displacement evidence leaves one candidate',()=>{
 assert.equal(run(app({drive:'',variant:''}),[src(),src({sourceRowId:2,bendixReference:'DB1679',engineCodes:['1AZFE'],displacementCc:2000})]).keep,true);
});
test('same configuration two DBs and unknown source engine remain review',()=>{
 assert.equal(run(app(),[src(),src({sourceRowId:2,bendixReference:'DB1679'})]).keep,false);
 assert.equal(run(app(),[src(),src({sourceRowId:2,bendixReference:'DB1679',engineCodes:[]})]).keep,false);
});
test('an engine-only selection cannot extrapolate a multiple-DB platform beyond source years',()=>{
 assert.equal(run(app({years:[2010,2020]}),[src(),src({sourceRowId:2,bendixReference:'DB1679',engineCodes:['1AZFE'],displacementCc:2000})]).keep,false);
});
test('missing chassis can use unique model year config, known contradictory chassis cannot',()=>{
 assert.equal(run(app({series:''})).keep,true);assert.equal(run(app({series:'ACA21'})).keep,false);
});
test('platform code conventions are make-family scoped, not substring rules',()=>{
 assert.equal(platformCodeMatch('MAZDA|3','BL10','BL'),true);
 assert.equal(platformCodeMatch('BMW|3','BL10','BL'),false);
 assert.equal(platformCodeMatch('NISSAN|XTRAIL','DNT31','T31'),true);
 assert.equal(platformCodeMatch('NISSAN|NV350CARAVAN','VWE25','E25'),true);
 assert.equal(platformCodeMatch('NISSAN|NV350CARAVAN','VWME25','E25'),true);
 assert.equal(platformCodeMatch('NISSAN|XTRAIL','VWE25','E25'),false);
 assert.equal(platformCodeMatch('TOYOTA|RAV4','ACA31R','ACA31'),true);
 assert.equal(platformCodeMatch('TOYOTA|RAV4','ACA310','ACA31'),false);
 assert.equal(platformCodeMatch('FORD|MONDEO','BAP','HA'),true);
 assert.equal(platformCodeMatch('FORD|MONDEO','BFP','HE'),true);
 assert.equal(platformCodeMatch('FORD|MONDEO','BNP','HD'),true);
 assert.equal(platformCodeMatch('FORD|MONDEO','CF','MD'),true);
 assert.equal(platformCodeMatch('FORD|MONDEO','B4Y','MA'),false);
 assert.equal(platformCodeMatch('MITSUBISHI|LANCER','CS_W','CS_A'),true);
 assert.equal(platformCodeMatch('MITSUBISHI|LANCER','CS2V','CS_A'),true);
 assert.equal(platformCodeMatch('MITSUBISHI|OUTLANDER','CS_W','CS_A'),false);
});
test('supplier platform roots may bridge to a detailed chassis only inside an already matched family',()=>{
 assert.equal(familyScopedDetailedChassisMatch('TFS77H','TFS'),true);
 assert.equal(familyScopedDetailedChassisMatch('FA3','FA'),true);
 assert.equal(familyScopedDetailedChassisMatch('LW5W','LW'),true);
 assert.equal(familyScopedDetailedChassisMatch('TAZR50','R50'),true);
 assert.equal(familyScopedDetailedChassisMatch('AE102','E1'),false);
 assert.equal(familyScopedDetailedChassisMatch('ABH3X','_H3_'),false);
 assert.equal(familyScopedDetailedChassisMatch('ABCDEF12','AB'),false);
});
test('family-scoped detailed chassis bridge still requires one compatible DB equal to the current product',()=>{
 const a=app({make:'ISUZU',model:'D-MAX',series:'TFS77H',body:'Pickup',drive:'AWD',years:[2010],engine:'3L Diesel — 4JJ1',displacementCc:3000});
 const s=src({makeName:'ISUZU',modelName:'D-MAX',seriesName:'D-MAX (TFS)',bodyStyle:'pickup',driveType:'awd',engineCodes:['4JJ1'],displacementCc:2999,yearFrom:2007,yearTo:2012,bendixReference:'DB1841'});
 const ok=run(a,[s],'DB1841');assert.equal(ok.keep,true);assert.equal(ok.rule,'family_scoped_detailed_chassis_unique');
 assert.equal(run(a,[s],'DB1802').rule,'published_db_mismatch');
 assert.equal(run(a,[s,{...s,sourceRowId:2,bendixReference:'DB1679'}],'DB1841').rule,'multiple_brake_configurations');
});
test('Caravan E25 source platform resolves the exact VWE25 configuration',()=>{
 const a=app({make:'NISSAN',model:'CARAVAN',series:'VWE25',body:'Van',drive:'RWD',
   engine:'3L Turbo Diesel — ZD30DDTI',engineCodes:['ZD30DDTI'],displacementCc:3000,years:[2009]});
 const s=src({makeName:'NISSAN',modelName:'CARAVAN',seriesName:'CARAVAN Van (E25)',position:'front',
   bodyStyle:'van',driveType:'rwd',engineCodes:['ZD30DDTI'],displacementCc:2953,
   yearFrom:2004,yearTo:2012,bendixReference:'DB1769'});
 const result=run(a,[s],'DB1769');
 assert.equal(result.keep,true);
 assert.equal(result.rule,'exact_platform_body_drive_engine_years');
});
test('verified Golf AU bridge does not match Golf VIII or ignore multiple brake configurations',()=>{
 const a=app({make:'VOLKSWAGEN',model:'GOLF',series:'AU1',body:'Hatchback',drive:'FWD',years:[2015],engine:'1.4L Petrol — CZDA',displacementCc:1400});
 const s=src({makeName:'VW',modelName:'GOLF',seriesName:'GOLF VII (5G1, BQ1)',bodyStyle:'hatchback',driveType:'fwd',engineCodes:['CZDA'],displacementCc:1395,yearFrom:2013,yearTo:2019});
 assert.equal(run(a,[s]).keep,true);
 assert.equal(run(a,[{...s,seriesName:'GOLF VIII (CD1)'}]).keep,false);
 assert.equal(run(a,[s,{...s,bendixReference:'DB1679',sourceRowId:2}]).keep,false);
});
