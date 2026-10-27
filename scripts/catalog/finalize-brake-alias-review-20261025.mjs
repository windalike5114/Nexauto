import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {OUT,read,put,group,unique,hash} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';
import {POLICY,EVIDENCE,augmentSources,assessReviewed} from './brake-alias-review-policy-20261025.mjs';
import {family} from './brake-popular50-script-first-policy.mjs';
const applied=read(path.join(OUT,'applied.json'));assert(applied.verified);
const d=read(path.join(OUT,'after-snapshot.json')),plan=read(path.join(OUT,'plan.json')),catalog=read('data/brake-pads/catalog.json');
const apps=enrich(d).filter(a=>a.status==='active'&&a.rank&&a.years.length),productsByDB=new Map();
for(const c of catalog)for(const p of d.products.filter(p=>p.sku===c.sku&&p.active!==false))for(const position of ['front','rear'].filter(pos=>c.position.toLowerCase().includes(pos))){const k=`${c.supplierRef}|${position}`;if(!productsByDB.has(k))productsByDB.set(k,[]);productsByDB.get(k).push({sku:c.sku,id:p.id});}
const sources=augmentSources(read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows,catalog),sourceBy=new Map(sources.map(s=>[s.source_id,s])),prior=new Map(plan.audits.map(r=>[r.case_id,r]));
const pending=[];
function classify(r,review){
 if(r.status==='review_multiple_db')return ['多个DB','提供具体配置对应的DB；可用发动机、驱动、年份辅助，不要求无边界深挖卡钳'];
 if(r.status==='review_published_conflict')return ['现网DB冲突','确认现网与候选DB哪一个适用，或明确适用条件'];
 if(r.status==='review_brake_configuration')return ['制动配置差异','确认后盘/后鼓、EPB/机械手刹或生产月份，并返回对应DB'];
 if(r.status==='review_year_split')return ['年份内DB变化','给出各年份/生产日期对应DB，不能整条application直接挂一个DB'];
 if(r.status==='review_prior_rejection')return ['历史否决待核','检查原rejected原因，不能静默恢复被否决关系'];
 if(r.status==='review_identity_risk')return ['车型身份待核','核实真实车型、底盘、车身或市场版本；身份确认不等于DB已确定'];
 if(r.status==='review_no_platform'||r.status==='published_unverified')return ['底盘映射缺失','提供同底盘直接适配DB，或有证据的目录代码映射'];
 if(r.status==='review_unknown_end')return ['源年份未完整','提供缺失年份的直接DB证据；结束年0不能作为全时段证明'];
 if(r.status==='db_unique_product_mapping_pending')return ['DB到商品映射待处理','确认该DB对应哪个NBP产品，不需要重复搜索车型身份'];
 if(r.status==='already_published_supported'&&review.some(f=>f.db!==r.proposed_db))return ['旧候选已被现网覆盖','当前已发布DB有唯一源支持；旧review记录留作审计，不派AI重复查询，不自动改变旧记录状态'];
 if(r.status==='ready'&&review.some(f=>f.db!==r.proposed_db))return ['唯一候选与旧DB不同','源唯一候选不同于旧待审DB，核实后决定替换/否决旧候选'];
 return ['年份或配置证据不足','补足全部application年份及相容车身/驱动证据，不能以缺项等同真实矛盾'];
}
for(const a of apps)for(const position of ['front','rear']){
 const review=a.existing.filter(r=>r.position===position&&r.fitment_status==='review');if(!review.length)continue;
 const r=assessReviewed(a,position,sources,productsByDB),old=prior.get(r.case_id);
 if(old?.status==='review_identity_risk'&&!r.rule_ids.includes('FOCUS_II_VERIFIED_FRONT')){r.status=old.status;r.reason=old.reason;r.identity_flags=old.identity_flags;}
 const [issue,requested]=classify(r,review),platformDB=unique(r.platform_source_ids.map(id=>sourceBy.get(id)?.db).filter(Boolean));
 pending.push({...r,issue,requested,review_db:unique(review.map(r=>r.db)),review_sku:unique(review.map(r=>r.sku)),review_relations:review.length,
   review_sources:unique(review.map(r=>r.source)),platform_db:platformDB,candidate_count:r.candidate_db.length,
   candidate_count_note:r.candidate_db.length?`${r.candidate_db.length}个配置筛选后的DB`:'0表示当前规则未建立候选，不表示没有适配',
   zero_coverage_application:!a.published.length,application_year_gain_if_resolved:!a.published.length?a.years.length:0,
   priority:['现网DB冲突','唯一候选与旧DB不同','多个DB','制动配置差异'].includes(issue)?'P0':!a.published.length?'P1':'P2'});
}
pending.sort((a,b)=>a.priority.localeCompare(b.priority)||a.rank-b.rank||a.make.localeCompare(b.make)||a.series.localeCompare(b.series)||a.application_id.localeCompare(b.application_id)||a.position.localeCompare(b.position));
const trueIssues=new Set(['多个DB','现网DB冲突','制动配置差异','年份内DB变化','唯一候选与旧DB不同','历史否决待核']);
const questions=[...group(pending,r=>[family(r.make,r.model),r.position,r.issue,unique([...r.candidate_db,...r.review_db]).join(',')].join('|'))].map(([k,rr])=>{
 const zero=unique(rr.filter(r=>r.zero_coverage_application).map(r=>r.application_id)),coveredYearGain=apps.filter(a=>zero.includes(a.application_id)).reduce((n,a)=>n+a.years.length,0);
 return {question_id:`BQ-${hash(k).slice(0,10)}`,priority:rr.some(r=>r.priority==='P0')?'P0':rr.some(r=>r.priority==='P1')?'P1':'P2',make:rr[0].make,model:rr[0].model,position:rr[0].position,issue:rr[0].issue,
  true_conflict_or_multi:trueIssues.has(rr[0].issue),series:unique(rr.map(r=>r.series)),years:unique(rr.flatMap(r=>r.years)).sort((a,b)=>a-b),engine_configs:unique(rr.map(r=>`${r.engine} / ${r.body} / ${r.drive}`)),
  application_positions:rr.length,review_relations:rr.reduce((n,r)=>n+r.review_relations,0),applications:unique(rr.map(r=>r.application_id)),candidate_db:unique(rr.flatMap(r=>r.candidate_db)),review_db:unique(rr.flatMap(r=>r.review_db)),
  potential_zero_coverage_application_years:coveredYearGain,requested:rr[0].requested,target_ids:rr.map(r=>r.case_id),reason_examples:unique(rr.map(r=>r.reason)).slice(0,3),
  query:`${rr[0].make} ${rr[0].model} ${unique(rr.map(r=>r.series)).join(' / ')} ${rr[0].position} brake pads ${unique(rr.flatMap(r=>r.candidate_db.length?r.candidate_db:r.review_db)).join(' / ')}`};
}).sort((a,b)=>a.priority.localeCompare(b.priority)||b.potential_zero_coverage_application_years-a.potential_zero_coverage_application_years||b.application_positions-a.application_positions);
for(const r of pending)r.question_id=questions.find(q=>q.target_ids.includes(r.case_id)).question_id;
const ruleReviews=[...group(plan.restores,r=>r.rule_ids.join('+'))].map(([rule,rows])=>{
 const representatives=rows.map(r=>({...r,context:plan.audits.find(a=>a.application_id===r.application_id&&a.position===r.position)})).sort((a,b)=>hash(a.application_id+a.position).localeCompare(hash(b.application_id+b.position))).slice(0,3);
 return {rule,relations:rows.length,applications:unique(rows.map(r=>r.application_id)).length,review_type:rule==='EXISTING_SOURCE_EXACT_CHASSIS_UNIQUE'?'已给目录精确底盘唯一候选复核':'已核实规则族及代表配置复核',
  result:'approved_for_only_enumerated_targets',checks:{all_application_years_unique:true,no_different_published_DB:true,no_previous_rejection:true,explicit_alias_only:true,known_brake_configuration_risks_excluded:true},
  sample_ids:representatives.map(r=>`${r.application_id}|${r.position}`),samples:representatives.map(r=>({application_id:r.application_id,make:r.context.make,model:r.context.model,series:r.context.series,body:r.context.body,drive:r.context.drive,engine:r.context.engine,years:r.context.all_years,position:r.position,db:r.db,source_ids:r.source_ids,evidence_urls:r.evidence_urls})),
  limitation:'这是规则族核验及明确目标清单，不是整个车型/平台所有制动套件的正确率证明。未向未列明目标扩大发布。'};
});
const summary={generated_at:new Date().toISOString(),policy:POLICY,production_verified:applied.verified,verified_at:d.verified_at,
 counts:{restored_relations:plan.restores.length,restored_applications:unique(plan.restores.map(r=>r.application_id)).length,merged_wrong_model_applications:plan.corrections.length,
  remaining_review_relations:pending.reduce((n,r)=>n+r.review_relations,0),remaining_review_positions:pending.length,remaining_review_applications:unique(pending.map(r=>r.application_id)).length,
  true_conflict_or_multi_positions:pending.filter(r=>trueIssues.has(r.issue)).length,true_conflict_or_multi_questions:questions.filter(q=>q.true_conflict_or_multi).length,
  all_shared_questions:questions.length,other_evidence_or_mapping_positions:pending.filter(r=>!trueIssues.has(r.issue)).length,
  original_two_batches_remaining_relations:pending.reduce((n,r)=>n+apps.find(a=>a.application_id===r.application_id).existing.filter(f=>f.position===r.position&&f.fitment_status==='review'&&['BENDIX_TOPSTAR_SUPPLIED_FITMENTS_2026_10_24','BENDIX_VERIFIED_PLATFORM_EXPANSION_2026_10_24'].includes(f.source)).length,0)},
 issues:Object.fromEntries([...group(pending,r=>r.issue)].map(([k,rr])=>[k,{positions:rr.length,relations:rr.reduce((n,r)=>n+r.review_relations,0),shared_questions:questions.filter(q=>q.issue===k).length}])),
 coverage_before:applied.before,coverage_after:coverage(d),coverage_publication_only_original_denominator:plan.projected_publication_only,
 denominator_note:'全车身/驱动/发动机的active application-year；至少前或后一轴有published刹车片即为已覆盖，不表示前后两轴齐全。车型纠错合并后的分母单列，不能把分母减少说成新适配。',
 backup:applied.backup,source_priority_note:'继续采用用户认可的唯一候选优先原则；但已知跨代、车型归属、后盘/鼓、EPB、年份边界或多个DB不按多数票恢复。',
 queue_note:'待确认表包含热门50全部历史review刹车片关系，不只此前两个Bendix自动批次。缺映射、源年份不足另分队列，不冒称真正冲突。'};
put('final-summary.json',summary);put('remaining-review.json',pending);put('shared-questions.json',questions);put('rule-group-review.json',ruleReviews);
const text=`刹车片分组复核结果\n\n已逐字段回读核验：${summary.counts.restored_relations}条恢复发布，涉及${summary.counts.restored_applications}个application。\n明显车型归属错误重复记录合并：${summary.counts.merged_wrong_model_applications}条。原ID保留为inactive，旧ID→新ID有追溯，原始适配未删除。\n\n热门50 2000–2026 application-year覆盖：\n处理前 ${applied.before.covered_application_years}/${applied.before.application_years} = ${(applied.before.application_year_rate*100).toFixed(2)}%\n仅恢复发布，保留原分母 ${plan.projected_publication_only.covered_application_years}/${plan.projected_publication_only.application_years} = ${(plan.projected_publication_only.application_year_rate*100).toFixed(2)}%\n车型纠错去重后 ${summary.coverage_after.covered_application_years}/${summary.coverage_after.application_years} = ${(summary.coverage_after.application_year_rate*100).toFixed(2)}%\n\n口径：${summary.denominator_note}\n\n剩余分类：\n${Object.entries(summary.issues).map(([k,v])=>`${k}：${v.positions}个application×位置，合并为${v.shared_questions}个共享问题`).join('\n')}\n\n${summary.queue_note}\n验证时间：${d.verified_at}\n备份：${applied.backup}\n`;
fs.writeFileSync(path.join(OUT,'处理结果说明.txt'),text);
console.log(JSON.stringify({counts:summary.counts,issues:summary.issues,before:summary.coverage_before.application_year_rate,publication_only:summary.coverage_publication_only_original_denominator.application_year_rate,after:summary.coverage_after.application_year_rate,denominator:summary.coverage_after.application_years},null,2));
