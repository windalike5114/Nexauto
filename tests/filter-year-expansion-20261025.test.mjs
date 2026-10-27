import test from 'node:test';
import assert from 'node:assert/strict';
import {secondaryYearBounds,prepareSecondary,secondaryMatches,yearDecision} from '../scripts/catalog/expand-filter-model-years-20261025.mjs';
const a={make:'TOYOTA',model:'COROLLA',family:'requested-01',series:'ZZE123',body:'hatch',drive:'fwd',engine_codes:['2ZZ-GE'],displacement_cc:1800,years:[2001,2002,2003,2004,2005,2006,2007]};
const primary=[2003,2004,2005,2006].map(y=>({file:'ryco.xlsx',sheet:'data',row:y,year:String(y),from:y,to:y,family:a.family,type:'oil_filter',engineCode:'2ZZGE',displacement:1800,inferred:false,seriesTokens:['ZZE123R'],body:'hatch',drive:'fwd',engine:'2ZZ-GE',reference:'Z432',vehicle:'Hatch FWD'}));
const raw={supplier:'TEST',reference:'Z432',make:'TOYOTA',model:'COROLLA',series:'ZZE123',engine_codes:'2ZZ-GE',displacement:'1.8L',drive:'FWD',raw:'1.8L 2ZZ-GE Petrol Hatchback FWD (2001–2007)',cleaned_row:2,workbook_rows:[3]};
test('month-limited boundary years are excluded',()=>{
 const r=secondaryYearBounds('3.0L Diesel [11/06 - 11/11]');assert.equal(r.from,2007);assert.equal(r.to,2010);
 assert.equal(secondaryYearBounds('Petrol [01/01 - 12/07]').from,2001);assert.equal(secondaryYearBounds('Petrol [01/01 - 12/07]').to,2007);
});
test('explicit on-ranges are capped at the source assessment year',()=>{assert.equal(secondaryYearBounds('Petrol [05/12 ON]').to,2026);assert.equal(secondaryYearBounds('Petrol (2018–On)').from,2018);assert.equal(secondaryYearBounds('unknown'),null);});
test('two exact primary anchors and full secondary year range permit finite extension',()=>{
 const secondary=prepareSecondary({rows:[raw]});if(secondary[0].families[0]!==a.family)a.family=secondary[0].families[0];
 assert(secondaryMatches(a,secondary[0]));const r=yearDecision(a,'oil_filter',primary,secondary);assert.equal(r.safe.length,1);assert.deepEqual(r.safe[0].missing,[2001,2002,2007]);
});
test('no extension beyond a closed interval or across unmatched engine/body',()=>{
 const s=prepareSecondary({rows:[{...raw,raw:'1.8L 2ZZ-GE Petrol Hatchback FWD (2003–2006)'}]});assert.equal(yearDecision(a,'oil_filter',primary,s).safe.length,0);
 assert(!secondaryMatches({...a,engine_codes:['1ZZ-FE']},prepareSecondary({rows:[raw]})[0]));
 assert(!secondaryMatches({...a,body:'sedan'},prepareSecondary({rows:[raw]})[0]));
});
test('one primary year and a primary reference switch remain review',()=>{
 const s=prepareSecondary({rows:[raw]});assert.equal(yearDecision(a,'oil_filter',primary.slice(0,1),s).safe.length,0);
 assert.equal(yearDecision(a,'oil_filter',primary.map((r,i)=>i===2?{...r,reference:'Z999'}:r),s).safe.length,0);
});
test('oil-only secondary evidence cannot extend air filters',()=>{
 assert.equal(yearDecision(a,'air_filter',primary,prepareSecondary({rows:[raw]})).safe.length,0);
});
test('conditional raw rows and slash-only tokens never become safe evidence',()=>{
 const s=prepareSecondary({rows:[{...raw,series:' / ZZE123 / ',raw:raw.raw+' For some models use Z999'}]});assert(!secondaryMatches(a,s[0]));
});
