import fs from 'node:fs';
import path from 'node:path';
import {OUT,prepareSource} from './expand-ryco-filter-knowledge-20261025.mjs';
import {enrich} from './import-ryco-filter-fitments-20261025.mjs';
const d=JSON.parse(fs.readFileSync(path.join(OUT,'before-snapshot.json'),'utf8'));
const source=JSON.parse(fs.readFileSync('outputs/ryco-filter-import-20261025/source.json','utf8'));
// Use the exact resolved source rows and family aliases captured in the plan.
// Original file/sheet/row remains the evidence address for every observation.
const apps=enrich(d),rows=prepareSource(source,apps).filter(r=>!r.inferred&&r.engineCode);
const group=(rr,f)=>{const m=new Map();for(const r of rr){const k=f(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const uniq=rr=>[...new Set(rr)];
const signature=rr=>uniq(rr.map(r=>r.reference)).sort().join('/');
const expanded=rows.flatMap(r=>Array.from({length:r.to-r.from+1},(_,i)=>({...r,yearNumber:r.from+i}))).filter(r=>r.yearNumber<=2026);
const result={generated_at:new Date().toISOString(),evidence:'User-supplied Ryco workbook rows; observed consistency is evidence for finite propagation rules, not universal interchangeability',lines:{}};
for(const type of ['oil_filter','air_filter']){
 const rr=expanded.filter(r=>r.type===type);
 const configs=[...group(rr,r=>[r.family,r.yearNumber,r.series,r.engine,r.vehicle,r.file].join('|'))].map(([key,rows])=>({key,...rows[0],signature:signature(rows),refs:uniq(rows.map(r=>r.reference)),proof:rows.map(r=>({file:r.file,row:r.row,sheet:r.sheet}))}));
 const engineYears=[...group(configs,r=>[r.family,r.engineCode,r.yearNumber].join('|'))].map(([key,cc])=>{let intersection=new Set(cc[0].refs);for(const c of cc.slice(1))intersection=new Set([...intersection].filter(v=>c.refs.includes(v)));return {key,configs:cc.length,series:uniq(cc.map(r=>r.series)),bodies:uniq(cc.map(r=>r.body)),drives:uniq(cc.map(r=>r.drive)),signatures:uniq(cc.map(r=>r.signature)),common_references:[...intersection]};});
 const multi=engineYears.filter(g=>g.configs>1);
 const engineTimeline=[...group(configs,r=>[r.family,r.engineCode].join('|'))].map(([key,cc])=>({key,signatures:uniq(cc.map(r=>r.signature)),years:[...group(cc,r=>r.yearNumber)].map(([year,yr])=>({year,references:signature(yr.flatMap(r=>r.refs.map(reference=>({reference}))))}))}));
 const seriesEngine=[...group(configs,r=>[r.family,r.series,r.body,r.yearNumber].join('|'))].filter(([,cc])=>uniq(cc.map(r=>r.engineCode)).length>1).map(([key,cc])=>({key,engine_codes:uniq(cc.map(r=>r.engineCode)),signatures:uniq(cc.map(r=>r.signature))}));
 const driveGroups=[...group(configs,r=>[r.family,r.series,r.body,r.engineCode,r.yearNumber].join('|'))].filter(([,cc])=>uniq(cc.map(r=>r.drive)).filter(Boolean).length>1).map(([key,cc])=>({key,drives:uniq(cc.map(r=>r.drive)),signatures:uniq(cc.map(r=>r.signature))}));
 result.lines[type]={source_rows:rows.filter(r=>r.type===type).length,configuration_years:configs.length,engine_model_year_groups:engineYears.length,multiple_configuration_engine_year_groups:multi.length,groups_with_common_reference_across_configs:multi.filter(g=>g.common_references.length).length,groups_without_common_reference:multi.filter(g=>!g.common_references.length).length,same_engine_different_reference_signatures:engineTimeline.filter(g=>g.signatures.length>1).length,multi_engine_series_body_year_groups:seriesEngine.length,multi_engine_groups_differing_references:seriesEngine.filter(g=>g.signatures.length>1).length,multi_drive_series_body_engine_year_groups:driveGroups.length,multi_drive_groups_differing_references:driveGroups.filter(g=>g.signatures.length>1).length,year_change_examples:engineTimeline.filter(g=>g.signatures.length>1).slice(0,5),engine_difference_examples:seriesEngine.filter(g=>g.signatures.length>1).slice(0,5),conflict_examples:multi.filter(g=>!g.common_references.length).slice(0,5)};
}
fs.writeFileSync(path.join(OUT,'field-dependency-analysis.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
