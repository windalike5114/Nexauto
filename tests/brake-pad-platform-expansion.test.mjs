import test from 'node:test';
import assert from 'node:assert/strict';
import { family,exactChassisMatch,sourceTokens,identityIssue,prepare } from '../scripts/catalog/expand-brake-pad-platforms-20261024.mjs';

test('market aliases are scoped to the vehicle make',()=>{
 assert.equal(family('MAZDA','Axela'),family('MAZDA','3'));
 assert.notEqual(family('BMW','3'),family('MAZDA','3'));
 assert.equal(family('FORD AUSTRALIA','Ranger'),family('FORD','Ranger'));
 assert.equal(family('NISSAN','Dualis'),family('NISSAN','Qashqai'));
 assert.equal(family('TOYOTA','Aqua'),family('TOYOTA','Prius C'));
 assert.notEqual(family('TOYOTA','Prius'),family('TOYOTA','Prius C'));
});

test('chassis patterns retain source underscores and do not match arbitrary substrings',()=>{
 assert.equal(exactChassisMatch('BM2FS','BM_'),true);
 assert.equal(exactChassisMatch('CU5W','CU_W'),true);
 assert.equal(exactChassisMatch('CW5W','CU_W'),false);
 assert.equal(exactChassisMatch('NZE121','_E12_'),true);
 assert.equal(exactChassisMatch('G20','G30'),false);
 assert.equal(exactChassisMatch('ANH20','H2'),false);
 assert.deepEqual(sourceTokens({seriesName:'OUTLANDER I Wagon (CU_W, ZE, ZF)'}),['CU_W','ZE','ZF']);
});

test('wrong-family chassis is routed to identity review rather than propagated',()=>{
 const row={make:'BMW',family:'BMW|3',series:'F97'};
 const source=[{family:'BMW|X3',tokens:['F97'],sourceRowId:1,seriesName:'X3 (F97)'}];
 assert.equal(identityIssue(row,source).suggested_family,'BMW|X3');
});

test('a unique same-chassis live donor alone is no longer publishable',()=>{
 const data=fixture();
 const plan=prepare(data,[],oldGap());
 const front=plan.publish.find(r=>r.application_id==='target'&&r.position==='front');
 assert.equal(front,undefined);
 assert.equal(plan.counts.new_coverage_applications,0);
 assert.ok(plan.review.some(r=>r.application_id==='target'&&r.reason.includes('单一供体')));
});

test('multiple source DBs block reuse even when live donor has only one published SKU',()=>{
 const sources=['DB1802','DB1679'].map((db,i)=>({family:'TOYOTA|RAV4',makeName:'TOYOTA',modelName:'RAV4',seriesName:'RAV4 (ACA31)',position:'front',bendixReference:db,sourceRowId:i+1,engineCodes:[]}));
 const plan=prepare(fixture(),sources,oldGap());
 assert.equal(plan.publish.some(r=>r.application_id==='target'&&r.position==='front'),false);
 assert.ok(plan.review.some(r=>r.application_id==='target'&&r.position==='front'&&r.candidate_db.length===2));
});

test('a unique highest-confidence source takes precedence over another published SKU',()=>{
 const data=fixture();
 data.fitments.push({application_id:'target',position:'front',product_variant_id:'v-other',fitment_status:'published',source:'legacy'});
 const source=[{makeName:'TOYOTA',modelName:'RAV4',seriesName:'RAV4 (ACA31)',position:'front',bendixReference:'DB1802',sourceRowId:1,engineCodes:['1AZFE'],displacementCc:2000,bodyStyle:'suv',driveType:'awd',yearFrom:2005,yearTo:2012}];
 const plan=prepare(data,source,oldGap());
 assert.equal(plan.replacements.length,1);
 assert.equal(plan.replacements[0].candidate.sku,'NBP1200');
 assert.equal(plan.counts.new_coverage_applications,0);
});

test('publication validates the full application range, not only popular reporting years',()=>{
 const data=fixture();data.years.push({application_id:'target',model_year:1999});
 const source=[
  {makeName:'TOYOTA',modelName:'RAV4',seriesName:'RAV4 (ACA31)',position:'front',bendixReference:'DB1802',sourceRowId:1,engineCodes:['1AZFE'],displacementCc:2000,bodyStyle:'suv',driveType:'awd',yearFrom:2010,yearTo:2012},
  {makeName:'TOYOTA',modelName:'RAV4',seriesName:'RAV4 (ACA31)',position:'front',bendixReference:'DB1679',sourceRowId:2,engineCodes:['2AZFE'],displacementCc:2400,bodyStyle:'suv',driveType:'awd',yearFrom:1997,yearTo:2000}
 ];
 const plan=prepare(data,source,oldGap());
 assert.equal(plan.publish.some(r=>r.application_id==='target'&&r.position==='front'),false);
 assert.equal(plan.baseline.application_years,3);
});

function oldGap(){return {expansions:[{application_id:'target',reason:'同底盘已有适配可评估复用'}]};}
function fixture(){return {
 makes:[{make_id:'mk',name:'TOYOTA'}],models:[{model_id:'md',make_id:'mk',name:'RAV4'}],
 series:[{series_id:'sr',code:'ACA31'}],variants:[{variant_id:'vr',display_name:'SUV AWD',body_style:'suv',drive_type:'awd'}],
 engines:[{powertrain_id:'eng1',display_name:'2L Petrol — 1AZ-FE',displacement_cc:2000},{powertrain_id:'eng2',display_name:'2.4L Petrol — 2AZ-FE',displacement_cc:2400}],
 applications:[{application_id:'target',model_id:'md',series_id:'sr',variant_id:'vr',powertrain_id:'eng1',status:'active'},{application_id:'donor',model_id:'md',series_id:'sr',variant_id:'vr',powertrain_id:'eng2',status:'active'}],
 years:[{application_id:'target',model_year:2010},{application_id:'target',model_year:2011},{application_id:'donor',model_year:2010}],
 products:[{id:'v-first',sku:'NBP1200'},{id:'v-other',sku:'NBP1550'}],
 fitments:[{application_id:'donor',position:'front',product_variant_id:'v-first',fitment_status:'published',source:'legacy'}]
};}
