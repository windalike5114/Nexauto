import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBrakeFitmentConservative as evaluateBrakeFitment,evaluateBrakeFitment as evaluateUnique,strictChassisMatch,bodyKey,driveKey,brakeFamily} from '../scripts/catalog/brake-pad-strict-policy.mjs';
const app=(extra={})=>({status:'active',make:'TOYOTA',model:'RAV4',series:'ACA31',body:'SUV',drive:'AWD',engine:'2.4L Petrol — 2AZ-FE',displacementCc:2400,years:[2010,2011],...extra});
const src=(extra={})=>({makeName:'TOYOTA',modelName:'RAV4',seriesName:'RAV4 (ACA31)',position:'front',bodyStyle:'suv',driveType:'awd',engineCodes:['2AZFE'],displacementCc:2400,yearFrom:2005,yearTo:2012,bendixReference:'DB1802',sourceRowId:1,...extra});
const evaluate=(a=app(),sources=[src()],db='DB1802')=>evaluateBrakeFitment(a,'front',db,sources);
test('all hard keys and full source years pass',()=>assert.equal(evaluate().keep,true));
test('year-only or substring chassis cannot pass',()=>{
 assert.equal(evaluate(app({series:'ACA310'})).keep,false);
 assert.equal(strictChassisMatch('ANH20','H2'),false);
 assert.equal(strictChassisMatch('NZE121','_E12_'),true);
});
test('catalogue underscore chassis wildcards work from either side',()=>{
 assert.equal(strictChassisMatch('ZN6C','ZN6_'),true);
 assert.equal(strictChassisMatch('ZN6_','ZN6C'),true);
 assert.equal(strictChassisMatch('ABH3X','_H3_'),true);
 assert.equal(strictChassisMatch('_H3_','ABH3X'),true);
 assert.equal(strictChassisMatch('ABC22','_C22'),true);
 assert.equal(strictChassisMatch('XZN6','ZN6_'),false);
 assert.equal(strictChassisMatch('ABH4X','_H3_'),false);
});
test('mismatched drive/body and unknown drive never pass',()=>{
 assert.equal(evaluate(app({drive:'FWD'})).rule,'drive_mismatch');
 assert.equal(evaluate(app({body:'Sedan'})).rule,'body_mismatch');
 assert.equal(evaluate(app({drive:'4x2'})).rule,'missing_vehicle_config');
});
test('source year boundary and uncovered gaps do not propagate',()=>{
 assert.equal(evaluate(app({years:[2004,2010]})).rule,'source_year_boundary');
 assert.equal(evaluate(app(),[src({yearTo:2010})]).keep,false);
});
test('unique old-platform DB does not cross a known successor generation',()=>{
 const old=src({makeName:'SUZUKI',modelName:'JIMNY',seriesName:'JIMNY Hardtop (SN, JB_)',yearFrom:2000,yearTo:2018,bendixReference:'DB403'});
 const successor=src({makeName:'SUZUKI',modelName:'JIMNY',seriesName:'JIMNY Closed Off-Road Vehicle (A6G)',yearFrom:2018,yearTo:9999,bendixReference:'DB2606',sourceRowId:2});
 const target=app({make:'SUZUKI',model:'JIMNY',series:'JB43',body:'SUV',drive:'AWD',engine:'1.3L Petrol — M13A',displacementCc:1328,engineCodes:['M13A'],years:[2017,2018,2019]});
 const result=evaluateUnique(target,'front','DB403',[old,successor]);
 assert.equal(result.keep,false);
 assert.equal(result.rule,'known_generation_boundary');
 assert.deepEqual(result.competing_generation_years,[2019]);
});
test('engine alone cannot resolve two same-configuration DBs',()=>{
 const result=evaluate(app(),[src(),src({bendixReference:'DB1679',engineCodes:['1AZFE'],displacementCc:2000,sourceRowId:2})]);
 assert.equal(result.keep,false);assert.equal(result.rule,'multiple_brake_configurations');
 assert.deepEqual(result.engine_candidate_db,['DB1802']);
});
test('drivetrain separates DBs only when remaining exact configuration has source engine evidence',()=>{
 assert.equal(evaluate(app(),[src(),src({bendixReference:'DB1679',driveType:'fwd'})]).keep,true);
 assert.equal(evaluate(app({engine:'2L Petrol — 1AZFE',displacementCc:2000})).rule,'unverified_engine_reuse');
});
test('published mismatch is review, never automatic correction',()=>assert.equal(evaluate(app(),[src()],'DB1679').rule,'published_db_mismatch'));
test('verified Ranger exception is limited to PJ 2.5 WLAT RWD and DB1366',()=>{
 const a=app({make:'FORD',model:'RANGER',series:'PJ',body:'Utility',drive:'RWD',engine:'2.5L Diesel — WLAT (16 V)',displacementCc:2500,years:[2006,2007,2008,2009]});
 const rows=[src({makeName:'FORD AUSTRALIA',modelName:'RANGER',seriesName:'RANGER Ute (PJ)',bodyStyle:'pickup',driveType:'rwd',engineCodes:['WLAT16V'],displacementCc:2500,yearFrom:2006,yearTo:2009,bendixReference:'DB1366'}),src({makeName:'FORD AUSTRALIA',modelName:'RANGER',seriesName:'RANGER Ute (PJ)',bodyStyle:'pickup',driveType:'rwd',engineCodes:['WEAT'],displacementCc:3000,yearFrom:2006,yearTo:2009,bendixReference:'DB1681',sourceRowId:2})];
 assert.equal(evaluate(a,rows,'DB1366').keep,true);
 assert.equal(evaluate(a,rows,'DB1681').keep,false);
 assert.equal(evaluate({...a,engine:'3L Diesel — WEAT',displacementCc:3000},rows,'DB1681').keep,false);
});
test('make scoped aliases and body normalization do not collapse special variants',()=>{
 assert.equal(brakeFamily('MAZDA','Axela'),brakeFamily('MAZDA','3'));
 assert.equal(brakeFamily('MITSUBISHI','Montero'),brakeFamily('MITSUBISHI','Pajero'));
 assert.equal(brakeFamily('MITSUBISHI','L200'),brakeFamily('MITSUBISHI','Triton'));
 assert.equal(brakeFamily('HONDA','Fit'),brakeFamily('HONDA','Jazz'));
 assert.equal(brakeFamily('NISSAN','March'),brakeFamily('NISSAN','Micra'));
 assert.equal(brakeFamily('TOYOTA','Corolla Fielder'),brakeFamily('TOYOTA','Corolla'));
 assert.equal(brakeFamily('TOYOTA','Estima'),brakeFamily('TOYOTA','Tarago'));
 assert.equal(brakeFamily('TOYOTA','Hiace SBV'),brakeFamily('TOYOTA','Hiace'));
 assert.equal(brakeFamily('VOLKSWAGEN','Golf Plus'),brakeFamily('VOLKSWAGEN','Golf'));
 assert.notEqual(brakeFamily('AUDI','A4 Allroad'),brakeFamily('AUDI','A4'));
 assert.notEqual(brakeFamily('TOYOTA','Land Cruiser'),brakeFamily('TOYOTA','Land Cruiser Prado'));
 assert.notEqual(brakeFamily('SUBARU','Legacy'),brakeFamily('SUBARU','Outback'));
 assert.equal(bodyKey('掀背'),'hatchback');assert.equal(bodyKey('2dr Cab Chassis'),'cab_chassis');
 assert.equal(driveKey('4x2'),'');
});
