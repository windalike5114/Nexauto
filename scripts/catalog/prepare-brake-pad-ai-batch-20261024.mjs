import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {brakeFamily,chassisTokens,compact,platformCodeMatch} from './brake-pad-strict-policy.mjs';

const ROOT=path.resolve('outputs/brake-pad-ai-batch-20261024');
const INPUT='outputs/brake-pad-unique-first-audit-20261024/audit.json';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const audit=read(INPUT),applied=read('outputs/brake-pad-unique-first-audit-20261024/applied.json');
const sourceMap=new Map(audit.sourceRows.map(r=>[r.sourceRowId,r]));
const catalog=read('data/brake-pads/catalog.json'),dbBySku=new Map(catalog.map(r=>[r.sku,r.supplierRef]));
const pending=audit.rows.filter(r=>!r.keep);
assert.equal(pending.length,applied.review_remaining);
const reasonLabels={no_exact_platform:'底盘或车型映射未证实',multiple_brake_configurations:'多个DB待区分制动配置',drive_mismatch:'驱动与源候选不符',body_mismatch:'车身与源候选不符',published_db_mismatch:'当前DB与唯一候选不同'};
const ask={no_exact_platform:'先核实目标车型与底盘身份、代际及市场别名；再查该底盘的前/后刹车片。发现车型库归属疑似错误时给出纠错建议，不改application ID。',multiple_brake_configurations:'查卡钳、制动盘直径、OEM/PR码、性能套件及年份变化。逐个说明候选DB适用条件，不能仅凭发动机码或多数网站投票选一个。',drive_mismatch:'核实目标驱动标注，并查询相同驱动版本的制动适配。区分车型库标注错误与源候选不适用。',body_mismatch:'核实目标车身、底盘归属及该车身是否共用制动系统。不能把同车型不同车身直接视为一致。',published_db_mismatch:'比较当前DB、唯一源候选的卡钳/OEM/尺寸及配置条件，确认应保留、替换还是拆分。'};
const outSchema={
  review_id:'原样复制，必填',application_id:'原样复制，必填',position:'front或rear，原样复制',current_sku:'原样复制',current_db:'原样复制',
  conclusion:'keep_current | replace_db | split_fitment | catalog_correction | not_applicable | unable_to_determine',
  confirmed_db:null,
  fitment_segments:[{years:[],body:null,drive:null,engine_codes:[],db:null,caliper:null,disc_diameter_mm:null,oem_numbers:[],pr_codes:[],conditions:null}],
  proposed_vehicle:{make:null,model:null,series:null,body:null,drive:null},
  confidence:'high | medium | low | unknown',
  rationale:null,
  evidence:[{url:null,publisher:null,title:null,source_type:'manufacturer | oem | retailer | other',locator:null,vehicle_scope:null,supports_claim:null,accessed_at:null}],
  unresolved_questions:[],reviewer_ai:null,reviewed_at:null,
};
export const PROMPT=`你负责核查新西兰/澳洲车型的刹车片适配。请实际联网查询本文件中的研究任务，对每个review_id分别返回一条结果。

任务边界：输入记录目前都处于待审核。当前DB、旧DB和原自动匹配备注只是待核实线索，不是正确答案。源表本身由用户指定为最高置信度，但它是Topstar供货子集，源行与目标application的对应关系仍需核实。研究分组只合并查询，不合并适配结论。

核查顺序：
1. 确认品牌、车型、底盘/代际、车身和市场身份。已知底盘与车型名矛盾时先查车型库是否归属错误，不能直接沿用车型名。提出更正字段，不删除或重建application ID。
2. 确认前/后位置，再查驱动、具体年份、卡钳/盘径、OEM/PR码或性能版本。发动机码和排量是辅助条件，不是全局主键。源DB后缀HD、4WD、GCT等不可直接当成车辆驱动条件。
3. 优先用Bendix、DBA、Terrain Tamer、RDA官方目录或OEM资料；经销商资料可辅助。搜索摘要、泛车型商品标题、AI推断或多个网站复制同一数据，不足以证明精确配置。不要编造URL、目录页、尺寸或已访问时间。
4. 不要求一条研究任务只有一个DB。同一底盘若存在多个制动配置，必须按年份/配置返回fitment_segments；无法区分时选择unable_to_determine，并写明还缺哪些信息。不得把一款车的所有发动机/车身默认套用同一答案。
5. 按每条目标记录的完整years数组逐年判断，不用year_from/year_to包络填平年份缺口。证据只支持部分年份时，列出支持范围与未解决范围，不默认为整条application已解决。
6. 输出DB标准图号（例如DB1681），不是NBP内部SKU或CDB供应商SKU。可返回不在当前上架清单的新DB，不要为了选现售产品强行匹配。无证据时confirmed_db填null，不把多个DB拼成一个唯一值。
7. 每条已解决结果必须有可访问证据URL、出版方、目录页/表行定位、适用配置、理由、置信度、审核AI及实际审核时间。证据未覆盖全部目标年份或有未解决条件时，不能标记整条keep_current或replace_db。
8. 输入中的identity_hints、related_source_rows及旧匹配备注均未经本次外部检索确认，只能作为检索线索，不能当作已确认车型纠错或适配结论。

结果格式：返回JSON对象 {"batch_id":"原批次ID","results":[逐条结果]}，字段遵循output_schema。每个review_id恰好一次；保留application_id、position、current_sku、current_db。不确定也必须返回，说明原因。不得修改原文件中的目标字段。结果不会直接写入生产，后续会校验ID、配置范围和证据后再处理。`;

const groups=new Map();
for(const r of pending){const gk=JSON.stringify([r.make,r.model,r.series]);if(!groups.has(gk))groups.set(gk,[]);groups.get(gk).push(r);}
const tasks=[...groups].map(([key,rows])=>{
  const sourceIDs=new Set(rows.flatMap(r=>[...r.original_source_rows,...r.platform_source_rows,...r.source_rows]));
  const first=rows[0],ownFamily=brakeFamily(first.make,first.model);
  const hints=[];
  if(rows.some(r=>r.rule==='no_exact_platform')&&compact(first.series)){
    const h=audit.sourceRows.filter(s=>brakeFamily(s.makeName,s.modelName).split('|')[0]===ownFamily.split('|')[0]&&brakeFamily(s.makeName,s.modelName)!==ownFamily
      &&chassisTokens(s).some(t=>platformCodeMatch(brakeFamily(s.makeName,s.modelName),first.series,t)
        ||ownFamily.startsWith('MERCEDESBENZ|')&&/^\d{3}$/.test(compact(first.series))&&new RegExp(`^[CWXV]${compact(first.series)}$`).test(compact(t))));
    const hg=new Map();for(const s of h){const k=brakeFamily(s.makeName,s.modelName);if(!hg.has(k))hg.set(k,[]);hg.get(k).push(s);}
    for(const [f,ss] of hg){const picked=ss.slice(0,4);hints.push({suggested_family:f,status:'unverified_search_hint_only',source_row_ids:picked.map(s=>s.sourceRowId),source_series:[...new Set(picked.map(s=>s.seriesName))]});picked.forEach(s=>sourceIDs.add(s.sourceRowId));}
  }
  const priority=rows.some(r=>r.history.length)?'P0':rows.some(r=>r.popular_rank)?'P1':'P2';
  return {task_id:`BPR-${crypto.createHash('sha256').update(key).digest('hex').slice(0,14)}`,priority,
    priority_reason:priority==='P0'?'此前自动覆盖仍待确认':priority==='P1'?'热门50车型待确认':'其他车型待确认',
    make:first.make,model:first.model,series:first.series,
    years:[...new Set(rows.flatMap(r=>r.years))].sort((a,b)=>a-b),bodies:[...new Set(rows.map(r=>r.body))],drives:[...new Set(rows.map(r=>r.drive))],
    engines:[...new Set(rows.map(r=>r.engine))],positions:[...new Set(rows.map(r=>r.position))],
    current_db:[...new Set(rows.map(r=>r.db))],candidate_db:[...new Set(rows.flatMap(r=>r.candidate_db??[]))],
    reasons:[...new Set(rows.map(r=>r.rule))],identity_hints:hints,source_row_ids:[...sourceIDs].filter(id=>sourceMap.has(id)).sort((a,b)=>a-b),
    review_count:rows.length,application_count:new Set(rows.map(r=>r.application_id)).size,
    popular_rank:Math.min(...rows.map(r=>r.popular_rank??999)),
    query_1:`${first.make} ${first.model} ${first.series} ${Math.min(...rows.flatMap(r=>r.years))}-${Math.max(...rows.flatMap(r=>r.years))} front rear brake pads Bendix DBA`,
    query_2:`${first.make} ${first.model} ${first.series} ${[...new Set(rows.map(r=>r.db))].join(' ')} caliper rotor diameter OEM`,
    questions:[...new Set(rows.map(r=>ask[r.rule]??'查询厂家目录与OEM配置，确认适用范围。'))],
    targets:rows.map(r=>({review_id:r.review_id,application_id:r.application_id,position:r.position,current_sku:r.sku,current_db:r.db,
      make:r.make,model:r.model,series:r.series,years:r.years,body:r.body,drive:r.drive,variant:r.variant,engine:r.engine,displacement_cc:r.displacement_cc,
      issue:r.rule,issue_label:reasonLabels[r.rule]??r.rule,reason:r.reasons,warnings:r.warnings,
      source_candidate_db:r.candidate_db??[],platform_db:r.platform_db,engine_candidate_db:r.engine_candidate_db??[],
      selected_source_row_ids:r.source_rows,original_unverified_source_row_ids:r.original_source_rows,platform_source_row_ids:r.platform_source_rows,
      historical_replacements:r.history.map(h=>({sku:h.sku,db:dbBySku.get(h.sku)??null,source:h.source,unverified_notes:h.notes})),
      original_matching_notes:r.notes,expected_status:'review',research_question:ask[r.rule]??'',popular_rank:r.popular_rank,
    }))};
}).sort((a,b)=>a.priority.localeCompare(b.priority)||a.popular_rank-b.popular_rank||a.make.localeCompare(b.make)||a.model.localeCompare(b.model)||a.series.localeCompare(b.series));

fs.mkdirSync(path.join(ROOT,'package','batches'),{recursive:true});
let batches=[],bucket=[];
const flush=()=>{if(!bucket.length)return;const n=batches.length+1,batch_id=`BRAKE-${String(n).padStart(3,'0')}`;batches.push({batch_id,priority:bucket[0].priority,tasks:bucket,review_count:bucket.reduce((n,t)=>n+t.review_count,0)});bucket=[];};
for(const t of tasks){if(bucket.length&&(bucket.length>=25||bucket.reduce((n,x)=>n+x.review_count,0)+t.review_count>100||bucket[0].priority!==t.priority))flush();bucket.push(t);}flush();
const mapping=[];
for(const b of batches){
  const src=[...new Set(b.tasks.flatMap(t=>t.source_row_ids))].map(id=>sourceMap.get(id));
  b.tasks.forEach(t=>t.batch_id=b.batch_id);
  const payload={batch_id:b.batch_id,priority:b.priority,instructions:PROMPT,output_schema:outSchema,
    source:{name:'Bendix_TopstarSupplied_Rows_2026-10-24.xlsx',sheet:'TOPSTAR有供货的Bendix行',source_confidence:'user_designated_highest',
      note:'供货子集；源记录与目标application的对应关系尚未确认。',workbook_sha256:'fc4c7151daa39b6731eb0937abc7dfc5e0978cab5cb0520a6f4a4a0f72180e71'},
    tasks:b.tasks,related_source_rows:src};
  fs.writeFileSync(path.join(ROOT,'package','batches',`${b.batch_id}_input.json`),JSON.stringify(payload,null,2));
  const csvRows=b.tasks.flatMap(t=>t.targets.map(r=>{const x={...r,task_id:t.task_id,batch_id:b.batch_id,priority:t.priority};mapping.push(x);return x;}));
  writeCSV(path.join(ROOT,'package','batches',`${b.batch_id}_return.csv`),csvRows.map(r=>({
    batch_id:r.batch_id,task_id:r.task_id,review_id:r.review_id,application_id:r.application_id,position:r.position,current_sku:r.current_sku,current_db:r.current_db,
    make:r.make,model:r.model,series:r.series,years:yearLabel(r.years),engine:r.engine,body:r.body,drive:r.drive,issue:r.issue_label,
    conclusion:'',confirmed_db:'',fitment_segments_json:'',proposed_vehicle_json:'',confidence:'',rationale:'',evidence_json:'',unresolved_questions_json:'',reviewer_ai:'',reviewed_at:''
  })));
}
assert.equal(mapping.length,pending.length);assert.equal(new Set(mapping.map(r=>r.review_id)).size,pending.length);
const expected=new Set(pending.map(r=>r.review_id));assert.ok(mapping.every(r=>expected.has(r.review_id)));
writeCSV(path.join(ROOT,'package','全部application对照.csv'),mapping.map(r=>({batch_id:r.batch_id,task_id:r.task_id,review_id:r.review_id,application_id:r.application_id,position:r.position,sku:r.current_sku,db:r.current_db,make:r.make,model:r.model,series:r.series,years:yearLabel(r.years),engine:r.engine,body:r.body,drive:r.drive,reason:r.issue_label})));
writeCSV(path.join(ROOT,'package','源表证据.csv'),audit.sourceRows.map(s=>({source_row_id:s.sourceRowId,make:s.makeName,model:s.modelName,series:s.seriesName,year_from:s.yearFrom,year_to:s.yearTo,position:s.position,db:s.bendixReference,engine_codes:s.engineCodes.join(' / '),body:s.bodyStyle,drive:s.driveType,displacement_cc:s.displacementCc,width_mm:s.dimensions[0],height_mm:s.dimensions[1],thickness_mm:s.dimensions[2]})));
fs.writeFileSync(path.join(ROOT,'package','AI统一任务说明.txt'),PROMPT);
fs.writeFileSync(path.join(ROOT,'package','output_schema.json'),JSON.stringify(outSchema,null,2));
fs.writeFileSync(path.join(ROOT,'package','使用方法.txt'),`本包仅包含此次两批自动导入/拓展后仍待确认的${pending.length}条适配，不包含已经发布的唯一候选，也不包含其他历史未发布队列。\r\n共${tasks.length}个研究任务、${batches.length}个批次。分组只合并查询，不把多个application合并成一个适配结论。\r\n每次把一个batches/*_input.json交给可联网AI；文件自带提示词、精确目标、相关源证据与返回格式。要求返回同批次JSON；也可填写对应*_return.csv的结论列。\r\n建议先P0，再P1，再P2。可以让两个AI独立处理同一个输入文件，分别保存不同结果，不覆盖原输入。\r\n必须逐review_id返回；不确定也返回unable_to_determine。不要直接把分组结论批量应用到全部发动机/年份。\r\n结果回传后再核对稳定ID、证据与适用范围，不直接导入生产。\r\n`);
const result={created_at:new Date().toISOString(),scope:audit.scope,input_sha256:crypto.createHash('sha256').update(fs.readFileSync(INPUT)).digest('hex'),policy:audit.policy,
  pending_rows:pending.length,applications:new Set(pending.map(r=>r.application_id)).size,research_tasks:tasks.length,batches:batches.length,
  priorities:Object.fromEntries(['P0','P1','P2'].map(p=>[p,{tasks:tasks.filter(t=>t.priority===p).length,rows:mapping.filter(r=>r.priority===p).length,batches:batches.filter(b=>b.priority===p).length}])),
  reasons:Object.fromEntries(Object.entries(audit.reasons).map(([k,v])=>[reasonLabels[k]??k,v])),
  tasks,batches:batches.map(b=>({batch_id:b.batch_id,priority:b.priority,tasks:b.tasks.length,rows:b.review_count,filename:`batches/${b.batch_id}_input.json`})),mapping};
fs.writeFileSync(path.join(ROOT,'prepared.json'),JSON.stringify(result));
console.log(JSON.stringify({...result,tasks:undefined,batches:result.batches.length,mapping:undefined},null,2));

function yearLabel(a){const ys=[...new Set(a)].sort((a,b)=>a-b),parts=[];for(let i=0;i<ys.length;){let j=i;while(j+1<ys.length&&ys[j+1]===ys[j]+1)j++;parts.push(i===j?String(ys[i]):`${ys[i]}–${ys[j]}`);i=j+1;}return parts.join(', ');}
function writeCSV(file,rows){const cols=Object.keys(rows[0]??{}),cell=v=>{const s=v==null?'':String(v);return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};fs.writeFileSync(file,'\uFEFF'+[cols,...rows.map(r=>cols.map(c=>r[c]))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n');}
