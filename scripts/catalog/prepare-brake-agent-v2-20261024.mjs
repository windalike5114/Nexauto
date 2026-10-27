import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {resultSchema} from './brake-agent-result-schema-v2.mjs';

const ROOT=path.resolve('outputs/brake-agent-v2-20261024'),PKG=path.join(ROOT,'NexAuto_Brake_Agent_V2');
const old=JSON.parse(fs.readFileSync('outputs/brake-pad-ai-batch-20261024/prepared.json','utf8'));
const audit=JSON.parse(fs.readFileSync('outputs/brake-pad-unique-first-audit-20261024/audit.json','utf8'));
const pending=audit.rows.filter(r=>!r.keep),oldRows=new Map(old.mapping.map(r=>[r.review_id,r]));
const oldTasks=new Map(old.tasks.map(t=>[t.task_id,t]));
const sha=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
const queueDefs={
 identity:{folder:'01_identity',label:'车型身份及底盘映射',max_tasks:10,max_cases:40,max_bytes:80000,
  instruction:'先确认车型/底盘/代际/市场身份。身份不符时提出proposed_vehicle，保留application ID；身份查清后才能继续给刹车片结论。身份已确认但刹车片证据不足时分别记录identity_status与fitment_status，不把纠错当成适配已解决。'},
 caliper:{folder:'02_caliper',label:'多DB及制动配置消歧',max_tasks:5,max_cases:20,max_bytes:60000,
  instruction:'针对相同车型底盘的多个DB，查卡钳、制动盘直径、OEM/PR码、性能版本与年份变化。对精确配置分段，不按发动机码单独选一个。无法区分保留unresolved。'},
 config:{folder:'03_vehicle_config',label:'车身及驱动核实',max_tasks:5,max_cases:30,max_bytes:60000,
  instruction:'先核实目标车身/驱动标注，再核查相同配置的目录。区分车型库标注问题与候选不适用。车型库疑似错误时提出纠错，不凭车型名称泛化。'},
 db_conflict:{folder:'04_db_conflict',label:'当前DB与源候选冲突',max_tasks:5,max_cases:20,max_bytes:60000,
  instruction:'先不看历史发布结论，独立查询精确配置的DB、卡钳/OEM与年份范围；形成证据后再读取对照文件，决定保留、替换或分段。'},
};
const queueFor=r=>({no_exact_platform:'identity',multiple_brake_configurations:'caliper',drive_mismatch:'config',body_mismatch:'config',published_db_mismatch:'db_conflict'}[r.rule]);
const common=`仅执行离线文件中的联网研究与结果整理，不修改生产数据库、车型库、SKU或原输入文件。先读result.schema.json，并按它返回纯JSON。
每个review_id恰好返回一次；保留稳定ID。configs保存共用车辆配置，targets保存每条application的真实年份集合与前后位置。任务分组仅节约查询，不能整组套用。
先形成独立事实和证据，再读取comparison文件对照当前DB。历史发布备注已隔离至reference/provenance.jsonl，不把它当证据。
源表由用户指定为最高置信度，但只是Topstar供货子集；源行与目标application的对应仍待核实。source_links里的original仅为旧匹配线索。identity_hints也只是未证实检索线索。
优先厂家/OEM目录，Bendix、DBA、Terrain Tamer、RDA可作为检索起点。实际打开证据，给URL、出版方、目录页/行定位、适用范围与实际访问时间。搜索摘要、泛车型标题或同源转载不证明精确配置；不要编造来源。
NBP是内部SKU，DB是跨品牌图号，CDB是供应商SKU。只返回标准DB；产品HD/4WD/GCT后缀不是车辆驱动条件。新DB即使未上架也可提出。
按targets.years集合判断，不用最早到最晚年份填平缺口。covered_years表示证据支持该条结论的年份，unresolved_years是未解决范围，二者须不重叠且并集等于目标年份。部分支持用split_fitment；不得把部分年份标成整条keep_current/replace_db。
证据放evidence表一次，精确配置事实放findings表一次；每条results用finding_ids引用。finding.review_ids必须明确列出所支持的目标，不能用车型级通配。conditions为空不等于所有卡钳都适用。
identity和fitment分别记录状态。车型纠错不自动证明刹车片适配；not_applicable仅能用于有证据排除当前候选，不表示车辆没有刹车片。不能确定就unable_to_determine，confirmed_db为null。
查询出支持的DB后，读取本批comparison JSON：与current_db相同才用keep_current，不同用replace_db；多条件用split_fitment。若仍需车型纠错，优先catalog_correction并单独记录fitment状态。
输出schema_version、batch_id、batch_fingerprint原样复制；reviewer填写真实agent名称和带时区时间。结果保存results/<agent标签>/<batch_id>.json，不覆盖其他agent结果。JSON结构和范围通过校验也不等于证据真实或允许发布。`;
for(const p of ['batches','comparison','prompts','reference','results'])fs.mkdirSync(path.join(PKG,p),{recursive:true});
for(const [q,d] of Object.entries(queueDefs)){
 fs.mkdirSync(path.join(PKG,'batches',d.folder),{recursive:true});
 fs.writeFileSync(path.join(PKG,'prompts',`${q}.txt`),common+'\n\n本类重点：'+d.instruction+'\n');
}
fs.writeFileSync(path.join(PKG,'result.schema.json'),JSON.stringify(resultSchema,null,2));
const sourceMap=new Map(audit.sourceRows.map(s=>[s.sourceRowId,{source_row_id:s.sourceRowId,make:s.makeName,model:s.modelName,
 series:s.seriesName,year_from:s.yearFrom,year_to:s.yearTo,position:s.position,db:s.bendixReference,
 engine_codes:s.engineCodes,displacement_cc:s.displacementCc,body:s.bodyStyle,drive:s.driveType,dimensions_mm:s.dimensions}]));

const groups=new Map();
for(const r of pending){const queue=queueFor(r);assert.ok(queue,`Unclassified ${r.rule}`);const k=JSON.stringify([queue,r.make,r.model,r.series]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
const tasks=[];
for(const [key,all] of groups){
 // Split very large platform groups so a single task cannot monopolize output.
 for(let start=0;start<all.length;start+=10){
  const rows=all.slice(start,start+10),r=rows[0],queue=queueFor(r),prior=rows.some(r=>r.history.length)?'P0':rows.some(r=>r.popular_rank)?'P1':'P2';
  const ot=oldTasks.get(oldRows.get(r.review_id).task_id);
  const hintIDs=ot.identity_hints.flatMap(h=>h.source_row_ids);
  const sourceIDs=[...new Set(rows.flatMap(r=>[...r.source_rows,...r.platform_source_rows,...r.original_source_rows]).concat(hintIDs))].filter(id=>sourceMap.has(id)).sort((a,b)=>a-b);
  tasks.push({task_id:'BR2-'+sha(key+'|'+rows.map(r=>r.review_id).sort().join('|')).slice(0,14),queue,priority:prior,
   make:r.make,model:r.model,series:r.series,review_ids:rows.map(r=>r.review_id),source_ids:sourceIDs,
   identity_hints:ot.identity_hints.map(h=>({family:h.suggested_family,source_ids:h.source_row_ids,status:'unverified_hint'})),
   search_queries:[`${r.make} ${r.model} ${r.series} brake pads OEM chassis generation`,`${r.make} ${r.model} ${r.series} ${[...new Set(rows.map(r=>r.drive))].join(' ')} front rear caliper rotor diameter`],
   question:queueDefs[queue].instruction,rows,rank:Math.min(...rows.map(r=>r.popular_rank??999))});
 }
}
tasks.sort((a,b)=>a.priority.localeCompare(b.priority)||Object.keys(queueDefs).indexOf(a.queue)-Object.keys(queueDefs).indexOf(b.queue)||a.rank-b.rank||a.make.localeCompare(b.make)||a.model.localeCompare(b.model)||a.series.localeCompare(b.series));

function payload(list,batch_id){
 const configs={},targets={},source_ids=new Set(list.flatMap(t=>t.source_ids));
 for(const t of list)for(const r of t.rows){
  const cfg={make:r.make,model:r.model,series:r.series,body:r.body||null,drive:r.drive||null,variant:r.variant||null,engine:r.engine||null,displacement_cc:r.displacement_cc??null};
  const config_id='VC-'+sha(cfg).slice(0,12);configs[config_id]=cfg;
  targets[r.review_id]={application_id:r.application_id,config_id,position:r.position,years:r.years,
   issue:r.rule,candidate_db:r.candidate_db??[],source_links:{selected:r.source_rows,original:r.original_source_rows,platform:r.platform_source_rows}};
 }
 const queue=list[0].queue;
 const core={schema_version:'nexauto-brake-agent-v2',dataset_sha256:old.input_sha256,batch_id,queue,priority:list[0].priority,
  prompt_file:`prompts/${queue}.txt`,result_schema_file:'result.schema.json',comparison_file:`comparison/${batch_id}.json`,
  instruction:'先读取prompt_file及result_schema_file。先形成独立查询事实，再读取comparison_file判断保留/替换。只保存研究结果，不修改数据库。',
  tasks:list.map(t=>({task_id:t.task_id,vehicle:{make:t.make,model:t.model,series:t.series},review_ids:t.review_ids,search_queries:t.search_queries,identity_hints:t.identity_hints,question:t.question})),
  configs,targets,source_rows:Object.fromEntries([...source_ids].map(id=>[String(id),sourceMap.get(id)]))};
 return {...core,batch_fingerprint:sha(core)};
}
const batches=[];let bucket=[];
function flush(){if(!bucket.length)return;const id='BR2-'+String(batches.length+1).padStart(4,'0'),p=payload(bucket,id),text=JSON.stringify(p),q=p.queue;
 const input_file=`batches/${queueDefs[q].folder}/${id}.input.json`;
 fs.writeFileSync(path.join(PKG,input_file),text);
 const comparisons=Object.fromEntries(bucket.flatMap(t=>t.rows).map(r=>[r.review_id,{current_sku:r.sku,current_db:r.db,
   historical_candidates:r.history.map(h=>({sku:h.sku,source:h.source})),warning:'comparison_only_not_evidence'}]));
 fs.writeFileSync(path.join(PKG,p.comparison_file),JSON.stringify({batch_id:id,batch_fingerprint:p.batch_fingerprint,comparisons}));
 const template={schema_version:p.schema_version,batch_id:id,batch_fingerprint:p.batch_fingerprint,reviewer:{agent:'',reviewed_at:''},evidence:[],findings:[],results:[]};
 fs.writeFileSync(path.join(PKG,'reference',`${id}.blank_result.json`),JSON.stringify(template));
 bucket.forEach(t=>t.batch_id=id);
 batches.push({batch_id:id,queue:q,queue_label:queueDefs[q].label,priority:p.priority,tasks:bucket.length,cases:Object.keys(p.targets).length,
  input_file,comparison_file:p.comparison_file,batch_fingerprint:p.batch_fingerprint,bytes:Buffer.byteLength(text),input_sha256:sha(text)});bucket=[];
}
for(const t of tasks){const d=queueDefs[t.queue];
 if(bucket.length){const count=bucket.reduce((n,t)=>n+t.rows.length,0)+t.rows.length;
  if(bucket[0].queue!==t.queue||bucket[0].priority!==t.priority||bucket.length>=d.max_tasks||count>d.max_cases||Buffer.byteLength(JSON.stringify(payload([...bucket,t],'BR2-9999')))>d.max_bytes)flush();}
 bucket.push(t);const single=payload(bucket,'BR2-9999');assert.ok(Buffer.byteLength(JSON.stringify(single))<=d.max_bytes,`Single task too large: ${t.task_id}`);
}flush();
const mapped=tasks.flatMap(t=>t.rows.map(r=>({batch_id:t.batch_id,task_id:t.task_id,queue:t.queue,priority:t.priority,review_id:r.review_id,application_id:r.application_id,position:r.position,
 make:r.make,model:r.model,series:r.series,years:r.years,body:r.body,drive:r.drive,engine:r.engine,current_sku:r.sku,current_db:r.db,reason:r.rule})));
assert.equal(mapped.length,5541);assert.equal(new Set(mapped.map(r=>r.review_id)).size,5541);
assert.ok(mapped.every(r=>oldRows.has(r.review_id)));
fs.writeFileSync(path.join(PKG,'reference','case_mapping.json'),JSON.stringify(Object.fromEntries(mapped.map(r=>[r.review_id,r]))));
fs.writeFileSync(path.join(PKG,'reference','provenance.jsonl'),pending.map(r=>JSON.stringify({review_id:r.review_id,source:r.source,original_notes:r.notes,history:r.history})).join('\n')+'\n');
fs.writeFileSync(path.join(PKG,'reference','source_catalog.json'),JSON.stringify({source_file:'Bendix_TopstarSupplied_Rows_2026-10-24.xlsx',sheet:'TOPSTAR有供货的Bendix行',sha256:'fc4c7151daa39b6731eb0937abc7dfc5e0978cab5cb0520a6f4a4a0f72180e71',source_confidence:'user_designated_highest',mapping_confidence:'unresolved',rows:Object.fromEntries(sourceMap)}));
const stats=Object.fromEntries(Object.keys(queueDefs).map(q=>[q,{label:queueDefs[q].label,cases:mapped.filter(r=>r.queue===q).length,tasks:tasks.filter(t=>t.queue===q).length,batches:batches.filter(b=>b.queue===q).length,...queueDefs[q]}]));
const before=fs.readdirSync('outputs/brake-pad-ai-batch-20261024/package/batches').filter(f=>f.endsWith('_input.json')).reduce((n,f)=>n+fs.statSync('outputs/brake-pad-ai-batch-20261024/package/batches/'+f).size,0);
const manifest={schema_version:'nexauto-brake-agent-v2',created_at:new Date().toISOString(),user_date:'2026-10-24',timezone:'Pacific/Auckland',
 scope:'此次两个自动导入/拓展批次的5541条待审适配；不包含已发布唯一候选和其他历史待审队列。',
 cases:mapped.length,applications:new Set(mapped.map(r=>r.application_id)).size,tasks:tasks.length,batch_count:batches.length,
 stats,old_active_input_bytes:before,new_active_input_bytes:batches.reduce((n,b)=>n+b.bytes,0),max_batch_bytes:Math.max(...batches.map(b=>b.bytes)),
 caveat:'批次增多是因缩小上下文；没有执行agent查询、AI审核或数据库变更。正式结果目录为空。',batches};
fs.writeFileSync(path.join(PKG,'manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(PKG,'START_AGENT.txt'),`NexAuto刹车片研究任务 V2\n\n本包包含${mapped.length}条待审适配、${tasks.length}个研究任务、${batches.length}个小批次。用户委托接收本包的agent执行查询，本包生成过程未运行任何研究或审核。\n\n1. 读取manifest.json，按P0、P1、P2领取批次。四类任务不混批；identity类先确认身份再做适配，确认不了就分别保留unresolved。\n2. 读取该类prompts/*.txt和result.schema.json，再读一个batches/**/*.input.json。一个批次最多5或10个研究任务，20、30或40条待审记录，并受UTF-8字节上限约束。字节数不是token数。\n3. 先查询事实，之后再读取input内comparison_file做当前DB对照。历史原匹配备注在reference/provenance.jsonl，仅必要时取对应review_id，不预先整份灌入上下文。\n4. evidence和findings去重，逐review_id返回精确结果。每个目标都要有结果，不确定也返回unable_to_determine；不要整组推断。\n5. 返回纯JSON，保存到results/<agent标签>/<batch_id>.json。参考reference/*.blank_result.json仅提供空壳，不是有效审核结果。不要把空壳当完成。\n6. 运行Python 3无第三方依赖校验：python validate_result.py --input <input文件> --result <结果文件>。它检查结构、ID、引用、年份和对照一致性，不访问网页，不验证证据真伪，不发布数据。\n7. 可由两个agent分别保存A/B结果；合并只比较同review_id及证据来源独立性，不按多数票定结论。不覆盖对方结果。\n8. 本包没有数据库凭据或发布脚本。不得修改生产/车型库/SKU。结果交回后再做证据核验及录入。\n\n范围：${manifest.scope}\n`);
fs.copyFileSync('scripts/catalog/validate-brake-agent-result-v2.py',path.join(PKG,'validate_result.py'));
fs.writeFileSync(path.join(ROOT,'prepared.json'),JSON.stringify({manifest,queueDefs,mapping:mapped,tasks:tasks.map(t=>({...t,rows:undefined}))}));
console.log(JSON.stringify({...manifest,batches:undefined},null,2));
