// Read-only with respect to source files/production; writes dated diagnostic artifacts only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT=path.resolve('outputs/brake-review-sample-audit-20261025');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const jl=p=>fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const group=(a,f)=>{const m=new Map();for(const r of a){const k=f(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const unique=a=>[...new Set(a)].sort();
const audit=read('outputs/brake-pad-unique-first-audit-20261024/audit.json');
const source=read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows;
const sourceBy=new Map(source.map(s=>[s.sourceRowId,s]));
const appRows=jl('outputs/brake-popular50-delegation-20261024/scope/all-applications.jsonl');
const appMap=new Map(appRows.map(a=>[a.application_id,a]));
const oldGaps=new Set(read('outputs/brake-pad-expansion-20261024/popular-gap-analysis.json').gaps.map(a=>a.application_id));
const dropped=new Set(appRows.filter(a=>!a.published.length&&!oldGaps.has(a.application_id)).map(a=>a.application_id));
const pending=audit.rows.filter(r=>!r.keep);
const pairStats=rows=>{
 const pairs=[...group(rows,r=>`${r.application_id}|${r.position}`).entries()].map(([key,rr])=>({
  key,application_id:rr[0].application_id,position:rr[0].position,rules:unique(rr.map(r=>r.rule)),
  assigned_db:unique(rr.map(r=>r.db)),platform_db:unique(rr.flatMap(r=>r.platform_db??[])),
  config_candidate_db:unique(rr.flatMap(r=>r.candidate_db??[])),rows:rr}));
 const histogram=(key)=>({zero:pairs.filter(r=>!r[key].length).length,one:pairs.filter(r=>r[key].length===1).length,
  multiple:pairs.filter(r=>r[key].length>1).length});
 const reasons=Object.fromEntries([...group(pairs,r=>r.rules.join(' + '))].map(([reason,p])=>[reason,{
  positions:p.length,assigned_db_one:p.filter(r=>r.assigned_db.length===1).length,
  platform_db_one:p.filter(r=>r.platform_db.length===1).length,platform_db_multiple:p.filter(r=>r.platform_db.length>1).length,
  config_candidate_one:p.filter(r=>r.config_candidate_db.length===1).length,
  config_candidate_multiple:p.filter(r=>r.config_candidate_db.length>1).length}]));
 return {pairs,summary:{relations:rows.length,applications:new Set(rows.map(r=>r.application_id)).size,application_positions:pairs.length,
  assigned_db_histogram:histogram('assigned_db'),platform_db_histogram:histogram('platform_db'),config_candidate_histogram:histogram('config_candidate_db'),reasons}};
};
const all=pairStats(pending),popular=pairStats(pending.filter(r=>appMap.has(r.application_id))),lost=pairStats(pending.filter(r=>dropped.has(r.application_id)));
const seed='20261025-brake-review-stratified-v1';
const hash=s=>crypto.createHash('sha256').update(seed+'|'+s).digest('hex');
const samples=[];
for(const reason of ['no_exact_platform','body_mismatch','drive_mismatch','multiple_brake_configurations']){
 const options=lost.pairs.filter(p=>p.rules.includes(reason)).sort((a,b)=>hash(a.key).localeCompare(hash(b.key)));
 const models=new Set();let selected=0;
 for(const p of options){
  const first=p.rows[0],model=`${first.make}|${first.model}`;
  if(models.has(model))continue;
  models.add(model);selected++;
  const sourceIds=unique(p.rows.flatMap(r=>[...(r.original_source_rows??[]),...(r.platform_source_rows??[]),...(r.source_rows??[])]));
  samples.push({sample_id:`S${String(samples.length+1).padStart(2,'0')}`,stratum:reason,
   application_id:first.application_id,position:first.position,make:first.make,model:first.model,series:first.series,
   body:first.body,drive:first.drive,engine:first.engine,displacement_cc:first.displacement_cc,years:appMap.get(first.application_id).years,
   all_application_years:first.years,
   old_assigned_db:p.assigned_db,platform_db:p.platform_db,config_candidate_db:p.config_candidate_db,
   original_match_notes:first.notes,source_rows:sourceIds.map(id=>sourceBy.get(id)).filter(Boolean).slice(0,10),
   source_rows_total:sourceIds.length,verdict:'not_researched'});
  if(selected>=3)break;
 }
}
const summary={snapshot_date:'2026-10-24',production_changed:false,current_live_checked:false,
 candidate_count_meaning:{assigned_db:'现有待审关系自身保存的DB，不等于源数据中唯一可装DB',platform_db:'同底盘同位置源DB，尚未消除车身/驱动/年份矛盾',
 config_candidate_db:'旧审核器实际走到配置候选分支时给出的DB；0可能只是提前因底盘/车身/驱动退出，不代表车辆无刹车片'},
 all_pending:all.summary,popular50_2000_2026_pending:popular.summary,
 formerly_covered_now_uncovered:{applications:dropped.size,application_years:appRows.filter(a=>dropped.has(a.application_id)).reduce((n,a)=>n+a.years.length,0),...lost.summary},
 sample_design:{seed,strata:4,per_stratum:3,size:samples.length,method:'按稳定哈希排序，每层尽量不同车型；这是原因分层诊断样本，不是用于全库正确率置信区间的简单随机样本。'}};
fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'candidate-counts.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(OUT,'samples.json'),JSON.stringify(samples,null,2));
console.log(JSON.stringify({summary,samples:samples.map(({source_rows,original_match_notes,...s})=>s)},null,2));
