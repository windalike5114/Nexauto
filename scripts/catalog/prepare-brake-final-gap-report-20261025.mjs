import fs from 'node:fs';
import path from 'node:path';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';

const input=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11)
  ??'outputs/brake-unique-review-candidates-round2-20261025/before-snapshot.json';
const output=process.argv.find(a=>a.startsWith('--out='))?.slice(6)
  ??'outputs/brake-final-structural-repair-20261025/report-data.json';
const d=JSON.parse(fs.readFileSync(input,'utf8')),apps=enrich(d).filter(a=>a.status==='active'&&a.rank&&a.years.length);
const unique=rows=>[...new Set(rows.filter(Boolean))].sort();
const fmt=rows=>unique(rows.map(r=>`${r.sku}${r.db?` (${r.db})`:''}`)).join(', ');
const classify=(a,position)=>{
  const review=a.existing.filter(r=>r.position===position&&r.fitment_status==='review');
  const rejected=a.existing.filter(r=>r.position===position&&r.fitment_status==='rejected');
  const candidates=unique(review.map(r=>r.product_variant_id));
  if(candidates.length>=2)return {reason:'多个候选DB',action:'按卡钳、制动盘直径、OEM号或生产日期区分',review,rejected};
  if(candidates.length===1)return {reason:'单一候选未发布',action:'检查产品active状态、SKU目录映射或历史限制',review,rejected};
  if(rejected.length)return {reason:'只有历史已拒绝候选',action:'复核历史拒绝原因后决定是否恢复',review,rejected};
  return {reason:'无现有候选',action:'补充DB来源；没有NexAuto SKU时先建产品',review,rejected};
};
const positionGaps=[];
for(const a of apps)for(const position of ['front','rear'])if(!a.published.some(r=>r.position===position)){
  const c=classify(a,position);positionGaps.push({application_id:a.application_id,rank:a.rank,group:a.group,make:a.make,model:a.model,series:a.series,
    year_from:Math.min(...a.years),year_to:Math.max(...a.years),year_count:a.years.length,body:a.body,drive:a.drive,engine:a.engine,
    engine_codes:a.engine_codes.join(', '),position,reason:c.reason,review_candidate_count:unique(c.review.map(r=>r.product_variant_id)).length,
    review_candidates:fmt(c.review),rejected_candidates:fmt(c.rejected),action:c.action});
}
positionGaps.sort((a,b)=>a.rank-b.rank||b.year_count-a.year_count||a.series.localeCompare(b.series)||a.position.localeCompare(b.position));
const uncovered=[];
for(const a of apps.filter(a=>!a.published.length)){
  const f=classify(a,'front'),r=classify(a,'rear'),reasons=unique([f.reason,r.reason]);
  uncovered.push({application_id:a.application_id,rank:a.rank,group:a.group,make:a.make,model:a.model,series:a.series,
    year_from:Math.min(...a.years),year_to:Math.max(...a.years),year_count:a.years.length,body:a.body,drive:a.drive,engine:a.engine,
    engine_codes:a.engine_codes.join(', '),front_candidates:fmt(f.review),rear_candidates:fmt(r.review),reason:reasons.join(' / '),
    action:reasons.includes('多个候选DB')?'先处理多候选位置；无候选位置另补来源':reasons.every(x=>x==='无现有候选')?'补充DB来源；没有NexAuto SKU时先建产品':'按各位置原因处理'});
}
uncovered.sort((a,b)=>a.rank-b.rank||b.year_count-a.year_count||a.series.localeCompare(b.series));
const cv=coverage(d),groupCoverage=cv.per_group.map(g=>({...g,missing_application_years:g.application_years-g.covered_application_years}));
const reasonSummary=[...Map.groupBy(positionGaps,r=>`${r.position}|${r.reason}`)].map(([key,rows])=>({position:rows[0].position,reason:rows[0].reason,
  applications:rows.length,application_years:rows.reduce((n,r)=>n+r.year_count,0)})).sort((a,b)=>b.application_years-a.application_years||a.position.localeCompare(b.position));
const result={created_at:new Date().toISOString(),snapshot_at:d.completed_at,scope:'热门50车型，2000–2026，active applications',coverage:cv,
  group_coverage:groupCoverage,uncovered_applications:uncovered,position_gaps:positionGaps,reason_summary:reasonSummary,
  repair_summary:{identity_merges:26,identity_reassignments:3,config_year_peer_relations:189,config_year_peer_applications:154,
    note:'本轮车型归属修复共29条；底盘+车身/驱动+动力总成+逐年唯一DB复用189条。'}};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({coverage:cv.application_year_rate,total:cv.application_years,covered:cv.covered_application_years,
  uncovered_applications:uncovered.length,position_gaps:positionGaps.length,top_missing:groupCoverage.filter(r=>r.missing_application_years).sort((a,b)=>b.missing_application_years-a.missing_application_years).slice(0,15),reasonSummary},null,2));
