// Offline intake only. Never imports production, matching, or network code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='outputs/brake-popular50-delegation-20261024';
const read=f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const jsonl=f=>fs.readFileSync(path.join(root,f),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const groups=read('scope/groups.json').filter(g=>/^(Toyota|Lexus|Suzuki|Subaru) /.test(g.group));
const gaps=jsonl('scope/gap-applications.jsonl'),all=jsonl('scope/all-applications.jsonl');
const sources=read('scope/source-reuse-index.json'),rules=read('first-round/rules.classified.json');
const boundary=read('scope/source-year-boundary-audit.json');
const compact=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const uniq=a=>[...new Set(a)],sum=(a,k)=>a.reduce((n,r)=>n+r[k],0);
const configurations={
  1:{blocker:'identity',question:'用一份厂家/OEM车型代码表核实MXGA10、MXGH10、MXGH12、ZSG10、ZVG10、ZNR11R的真实车型/车身及起止年月，确认是否仍属于正式Corolla组；只核身份，不推断刹车通用。'},
  3:{blocker:'identity',question:'用一份Toyota厂家/OEM车型代码表核实GRN215、KDN185、KDN215、KZN185、RZN185W、TRN215W各自车型/车身及生产年月，确认当前Hilux归属；保留原application与底盘码。'},
  4:{blocker:'source_missing',question:'取得Toyota Aqua MXPK10/MXPK11按前后轴位、车身/发动机及生产日期列出的制动目录行；现有NHP10 Prius C提示不可跨代使用。'},
  5:{blocker:'identity',question:'用一份厂家/OEM代码表核实RG413的2000–2003年与ZC71S的2008–2010年市场/代际/车身身份；复用已给RS415/ZC21S和ZA32S/ZC32S身份线索，不重复查同题或据此推断DB。'},
  6:{blocker:'source_missing',question:'取得AXAP62、AXAP64、AXAP64R的RAV4厂家/OEM身份及生产日期记录，并据此定位对应代际制动目录；AXAL54/AXAP54提示不能直接跨代。'},
  10:{blocker:'identity',question:'用一份Toyota厂家/OEM车型表核实Prius名下NHP10、ZVW40W、ZVW41W、MXWH61各自正式市场车型/车身及生产日期；仅做归属判断，保留application ID。'},
  12:{blocker:'caliper_configuration',question:'针对Outback BR9/BRD现有候选，取得按前后轴位、卡钳/OEM或盘径和生产日期区分的目录行；保持所有车身与发动机目标，不凭BR前缀或既有published供体确认适用。'},
  15:{blocker:'identity',question:'用一份Toyota厂家/OEM车型代码表核实MXPB10、MXPJ10、MXPJ15、NCP20R、NCP21、NCP22R各自车型/车身和生产年月，确认Vitz/Yaris归属，不能按代码相近视为别名。'},
  20:{blocker:'caliper_configuration',question:'取得Forester SF9、SG5、SJ5、SJD、SJG按前后轴位、制动盘/卡钳与生产日期划分的目录行；源年款止0先按未知结束处理，不丢弃其可能DB。'},
  23:{blocker:'caliper_configuration',question:'取得Camry ACV30/ACV31/ACV35/ACV36按轴位、制动盘/卡钳及生产日期划分的同代目录行，识别多个候选DB的必要条件；不先按发动机唯一性推广整应用。'},
  26:{blocker:'source_missing',question:'取得Alphard/Vellfire 40代AAHH40、AAHH45、AGH40W、AGH45W、TAHA40、TAHA45W的厂家/OEM制动目录，保留生产日期、轴位和版本条件；H1/H2/H3源不支持跨代。'},
  27:{blocker:'identity',question:'用一份Toyota厂家/OEM车型代码表核实KCH10、KCH16、KCH40W、KCH46、LXH22、RCH41的真实车型/车身及生产年月，确认Hiace组归属；源HIACE单一名称不能代替身份核验。'},
  33:{blocker:'source_missing',question:'取得Highlander/Kluger AASH15L按轴位、发动机及生产日期列出的制动目录行；既有_U7_检索提示及未知结束年不能直接推广到该应用。'},
  38:{blocker:'source_missing',question:'取得Prado GDJ251/TRJ250的厂家/OEM按前后轴位、版本及生产日期列出的制动目录行；J9/J12/J15源提示不能跨至J250。'},
  39:{blocker:'source_missing',question:'取得Jimny JB74W/JC74W的厂家/OEM按前后轴位、车身/发动机和生产日期列出的制动目录，并明确后轮盘刹或鼓刹；当前本批索引没有该车型源。'},
  44:{blocker:'identity',question:'用一份Toyota厂家/OEM车型表核实Wish名下ZRE22R/ZRE22W的真实市场车型、车身及生产年月；当前无Wish源，不能凭Wish名称或已发布同码供体推断适配。'},
  49:{blocker:'caliper_configuration',question:'取得Lexus RX MCU10R、MCU38、MCU38R、MHU38R按轴位、盘径/卡钳、生产日期列出的目录行；目录_U3_等通配检索提示不能单独确认具体车型制动配置。'}
};
const priorities=[27,1,3];
const resultGroups=groups.map(g=>{
  const gg=gaps.filter(r=>r.rank===g.rank),ga=all.filter(r=>r.rank===g.rank),s=sources.find(r=>r.rank===g.rank);
  const sr=s?.source_rows??[],conf=configurations[g.rank],zero=boundary.per_popular_group.find(r=>r.rank===g.rank);
  const relevantRules=rules.filter(r=>(r.original_targets??[]).some(t=>t.make==='SUZUKI')&&g.rank===5);
  const reuse=relevantRules.map(r=>({question_id:r.question_id,rule_id:r.rule_id,category:r.category,
    identity_claim:r.original_rule.claim,source_option:r.source_option_as_unverified_hint,
    application_ids:r.influence.application_ids,evidence_as_reported:r.evidence_as_reported,
    evidence_truth_verified:false,fitment_inference_allowed:false,scope_years:r.original_rule.years}));
  const chassis=uniq(gg.map(r=>r.series)).map(series=>({series,applications:gg.filter(r=>r.series===series).length,
    literal_token_mentioned_in_source_index:!!series&&sr.some(s=>(s.series_tokens??[]).some(t=>compact(t)===compact(series))),
    token_match_is_identity_proof:false}));
  const secondary=uniq([...(zero?['year_boundary_unknown']:[]),...(gg.some(r=>r.published_donor_hints.length)?['published_donor_not_evidence']:[]),
    ...(gg.some(r=>r.review_candidates.length)?['existing_review_candidates_need_configuration_check']:[])]);
  return {rank:g.rank,group:g.group,intake_status:'initial_triage_complete_research_not_started',
    research_queue_status:priorities.includes(g.rank)?'priority_shared_question_proposed':'queued',
    gap_applications:gg.length,gap_application_years:sum(gg,'application_years'),
    gap_applications_outside_old_v4:gg.filter(r=>!r.v4_review_ids.length).length,
    gap_applications_in_old_v4:gg.filter(r=>r.v4_review_ids.length).length,
    all_scope_applications:ga.length,all_scope_application_years:sum(ga,'application_years'),
    partial_position_applications_separate_from_gap:ga.filter(r=>r.coverage==='one_position_published').length,
    full_scope_policy:'2000–2026, all body/engine variants; full scope remains assigned. Intake counts gaps only; partial-position and covered applications are not marked audited. Missing rear may be drum brakes.',
    source_exists_in_supplied_index:!!sr.length,source_model_rows:sr.length,source_file_as_reported:s?.source_file,
    source_distinct_series:uniq(sr.map(r=>r.series)),source_year_to_zero_unknown_rows:zero?.zero_end_rows??0,
    source_status_caveat:'Model/alias retrieval hints only. No source row has been matched to a gap by this intake; yearTo=0 means unknown end, not proved open-ended.',
    known_identity_facts_reusable:!!reuse.length,existing_identity_reuse:reuse,
    existing_model_correction_proposal_application_ids:[],
    main_blocker:conf.blocker,main_blocker_certainty:'offline_scope_indicator_not_completed_diagnosis',secondary_blockers:secondary,
    existing_facts_reusable:{local_source_ids:sr.map(r=>r.source_row_id),
      sku_reference_lookup:'scope/all-applications.jsonl published/review/donor reference_lookup; SKU→DB only, no fitment inference',
      gaps_with_published_donor_hints:gg.filter(r=>r.published_donor_hints.length).length,
      historical_reasons:uniq(gg.map(r=>r.historical_source_clue?.reason).filter(Boolean)),
      historical_reasons_status:'stale_clues_not_current_diagnosis',shared_year_boundary_report:'scope/source-year-boundary-audit.json'},
    next_minimum_shared_question:conf.question,next_action_mode:'future_shared_query_proposed_not_executed',
    gap_chassis_summary:chassis,gap_application_refs:gg.map(r=>({application_id:r.application_id,series:r.series,series_id:r.series_id,
      model:r.model,body:r.body,drive:r.drive,engine:r.engine,years:r.years,v4_review_ids:r.v4_review_ids})),
    research_complete:false,fitment_proposals_created:0,database_action:'none'};
});
if(groups.length!==17||resultGroups.some(r=>!configurations[r.rank]))throw Error('W1 group mismatch');
const inputs=['scope/groups.json','scope/all-applications.jsonl','scope/gap-applications.jsonl','scope/source-reuse-index.json',
 'scope/source-year-boundary-audit.json','first-round/rules.classified.json'];
const summary={formal_groups:resultGroups.length,all_scope_applications:sum(resultGroups,'all_scope_applications'),
 all_scope_application_years:sum(resultGroups,'all_scope_application_years'),gap_applications:sum(resultGroups,'gap_applications'),
 gap_application_years:sum(resultGroups,'gap_application_years'),outside_old_v4_gap_applications:sum(resultGroups,'gap_applications_outside_old_v4'),
 in_old_v4_gap_applications:sum(resultGroups,'gap_applications_in_old_v4'),
 groups_with_model_source_rows:resultGroups.filter(g=>g.source_model_rows).length,groups_without_model_source_rows:resultGroups.filter(g=>!g.source_model_rows).length,
 priority_shared_questions:priorities.length,queued_groups:resultGroups.length-priorities.length};
const output={schema_version:1,agent_group:'W1',mode:'pure_offline_initial_intake',generated_at:new Date().toISOString(),
 scope_years:[2000,2026],scope_body_engine:'all',assignment_file_status:fs.existsSync(path.join(root,'assignments/W1.json'))?'exists_not_required_for_formal_group_selection':'awaiting_assignments/W1.json_at_intake',
 summary,priority_shared_questions:priorities.map((rank,i)=>{const r=resultGroups.find(g=>g.rank===rank);return{priority:i+1,group:r.group,question:r.next_minimum_shared_question,status:'proposed_not_queried'};}),
 shared_technical_blocker:{kind:'source_year_boundary_unknown',report:'scope/source-year-boundary-audit.json',
 source_rows_all:406,source_rows_popular50:128,popular50_groups:23,
 policy:'Preserve unknown-end source as potential candidate and preserve DB conflicts. It cannot independently prove complete year support or applicability through 2026. Do not recompute source boundaries in this intake.'},
 groups:resultGroups,input_sha256:Object.fromEntries(inputs.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),
 reconciliation:{groups_17:groups.length===17,application_totals:summary.all_scope_applications===sum(groups,'applications'),
 application_year_totals:summary.all_scope_application_years===sum(groups,'application_years'),gap_totals:summary.gap_applications===sum(groups,'gap_applications'),
 gap_year_totals:summary.gap_application_years===sum(groups,'gap_application_years'),v4_partition:summary.gap_applications===summary.in_old_v4_gap_applications+summary.outside_old_v4_gap_applications},
 limits:['No network, SQL, original XLSX, real matching or publication. Stable scope inputs untouched.',
 'Source tokens, historical reasons, published donors and SKU crossrefs are leads, not fitment evidence.',
 'First-round Swift identity claims are reused as reported; source truth was not reverified.',
 'Only three future shared questions prioritized; other fourteen groups queued. Entire assigned body/engine scope remains in force.'],
 application_ids_preserved:true,original_chassis_preserved:true,evidence_truth_verified:false,database_changed:false,research_complete:false};
if(Object.values(output.reconciliation).some(v=>!v))throw Error('W1 reconciliation failed');
fs.mkdirSync(path.join(root,'agents'),{recursive:true});
const out=path.join(root,'agents/W1_initial_triage.json');
fs.writeFileSync(out,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({out,summary,reconciliation:output.reconciliation}));
