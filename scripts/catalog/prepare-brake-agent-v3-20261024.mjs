import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {resultSchema} from './brake-agent-result-schema-v2.mjs';

const ROOT=path.resolve('outputs/brake-agent-v3-minquery-20261024');
const PKG=path.join(ROOT,'NexAuto_Brake_Agent_V3');
const audit=JSON.parse(fs.readFileSync('outputs/brake-pad-unique-first-audit-20261024/audit.json','utf8'));
const prior=JSON.parse(fs.readFileSync('outputs/brake-pad-ai-batch-20261024/prepared.json','utf8'));
const v2=JSON.parse(fs.readFileSync('outputs/brake-agent-v2-20261024/prepared.json','utf8'));
const pending=audit.rows.filter(r=>!r.keep);
const priorTargets=new Map(prior.mapping.map(r=>[r.review_id,r]));
const priorTasks=new Map(prior.tasks.map(t=>[t.task_id,t]));
const digest=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
// Formatting-only normalization. No unverified aliases or chassis generations are merged.
const canonical=x=>String(x??'').normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
// These five name pairs were explicitly grouped by the user in the popular-model list.
// They share research ownership only. Original vehicle identifiers remain separate.
const researchPairs=[['MAZDA',['2','DEMIO']],['MAZDA',['3','AXELA']],['MAZDA',['5','PREMACY']],
 ['TOYOTA',['HIGHLANDER','KLUGER']],['TOYOTA',['VITZ','YARIS']]];
const researchFamily=(make,model)=>researchPairs.find(([m,names])=>m===canonical(make)&&names.includes(canonical(model)))?.[1].join(' / ')??canonical(model);
const distinct=a=>[...new Set(a)];
const years=rows=>distinct(rows.flatMap(r=>r.years)).sort((a,b)=>a-b);
const write=(rel,value)=>{const p=path.join(PKG,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof value==='string'?value:JSON.stringify(value));};
for(const p of ['models','reference','schema','tools','results','progress/locks','progress/checkpoints','expanded'])fs.mkdirSync(path.join(PKG,p),{recursive:true});

const groups=new Map();
for(const r of pending){const key=JSON.stringify([canonical(r.make),researchFamily(r.make,r.model)]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
const list=[...groups].map(([key,rows])=>({key,rows,priority:rows.some(r=>r.history.length)?'P0':rows.some(r=>r.popular_rank)?'P1':'P2',rank:Math.min(...rows.map(r=>r.popular_rank??999))}));
list.sort((a,b)=>a.priority.localeCompare(b.priority)||a.rank-b.rank||a.key.localeCompare(b.key));
const mapping=[],manifestGroups=[],allPlatforms=[];
for(const g of list){
 const rows=g.rows,first=rows[0],group_id='B3-'+digest(g.key).slice(0,12),base=`models/${group_id}`;
 const platformMap=new Map(),configs={},targets={};
 for(const r of rows){
  const pk=JSON.stringify([canonical(r.make),canonical(r.model),canonical(r.series)]);
  const platform_id='PL-'+digest(pk).slice(0,14);
  if(!platformMap.has(platform_id))platformMap.set(platform_id,{platform_id,make:r.make,model:r.model,series:r.series,rows:[]});
  platformMap.get(platform_id).rows.push(r);
  const cfg={make:r.make,model:r.model,series:r.series,body:r.body||null,drive:r.drive||null,variant:r.variant||null,engine:r.engine||null,displacement_cc:r.displacement_cc??null};
  const config_id='VC-'+digest(cfg).slice(0,12);configs[config_id]=cfg;
  targets[r.review_id]={application_id:r.application_id,platform_id,config_id,position:r.position,years:r.years,issue:r.rule,
   candidate_db:r.candidate_db??[],source_links:{selected:r.source_rows,platform:r.platform_source_rows,original:r.original_source_rows}};
  mapping.push({review_id:r.review_id,application_id:r.application_id,group_id,platform_id,config_id,position:r.position,years:r.years,model_file:`${base}/targets.json`});
 }
 const relevantTasks=distinct(rows.map(r=>priorTargets.get(r.review_id).task_id)).map(id=>priorTasks.get(id));
 const hints=[...new Map(relevantTasks.flatMap(t=>t.identity_hints).map(h=>[JSON.stringify(h),h])).values()];
 const sourceIDs=distinct(rows.flatMap(r=>[...r.source_rows,...r.platform_source_rows,...r.original_source_rows]).concat(hints.flatMap(h=>h.source_row_ids))).sort((a,b)=>a-b);
 const platforms=[...platformMap.values()].map(p=>({platform_id:p.platform_id,vehicle:{make:p.make,model:p.model,series:p.series},
  years:years(p.rows),positions:distinct(p.rows.map(r=>r.position)),bodies:distinct(p.rows.map(r=>r.body)),drives:distinct(p.rows.map(r=>r.drive)),
  engines:distinct(p.rows.map(r=>r.engine)),variants:distinct(p.rows.map(r=>r.variant)),issues:distinct(p.rows.map(r=>r.rule)),
  candidate_db:distinct(p.rows.flatMap(r=>r.candidate_db??[])),review_ids:p.rows.map(r=>r.review_id),config_ids:distinct(p.rows.map(r=>targets[r.review_id].config_id)),
  source_ids:distinct(p.rows.flatMap(r=>[...r.source_rows,...r.platform_source_rows,...r.original_source_rows])).sort((a,b)=>a-b),
  identity_status:'not_researched',fitment_status:'not_researched'}));
 platforms.sort((a,b)=>a.vehicle.series.localeCompare(b.vehicle.series));
 allPlatforms.push(...platforms.map(p=>({...p,group_id})));
 const core={schema_version:'nexauto-brake-agent-v3',group_id,vehicle:{make:first.make,model:researchFamily(first.make,first.model)},priority:g.priority,
  dataset_sha256:prior.input_sha256,configs,targets};
 const targetFile={...core,group_fingerprint:digest(core)};
 write(`${base}/targets.json`,targetFile);
 write(`${base}/platforms.json`,{group_id,group_fingerprint:targetFile.group_fingerprint,platforms});
 write(`${base}/comparison.json`,{group_id,group_fingerprint:targetFile.group_fingerprint,comparisons:Object.fromEntries(rows.map(r=>[r.review_id,{current_sku:r.sku,current_db:r.db,warning:'comparison_only_not_evidence'}]))});
 const brief={schema_version:core.schema_version,group_id,group_fingerprint:targetFile.group_fingerprint,vehicle:core.vehicle,priority:g.priority,
  cases:rows.length,applications:distinct(rows.map(r=>r.application_id)).length,platforms:platforms.length,years:years(rows),
  model_names:distinct(rows.map(r=>r.model)),alias_research_only:'别名组只共用研究owner；不证明不同名称、代际或年份的适配相同。',
  files:{platforms:`${base}/platforms.json`,targets:`${base}/targets.json`,comparison:`${base}/comparison.json`,source_catalog:'reference/source_catalog.json'},
  source_ids:sourceIDs,unverified_identity_hints:hints.map(h=>({family:h.suggested_family,source_ids:h.source_row_ids,status:'unverified_hint_not_alias_mapping'})),
  discovery_queries:[`${first.make} ${core.vehicle.model} chassis generations model codes official catalogue`,`${first.make} ${core.vehicle.model} brake pads application catalogue caliper OEM front rear`],
  workflow:['先查整车型的代际/底盘对照表，一次记录全部可证实对应，不逐发动机重复查身份。',
   '同一底盘的前后片在同一目录会话内查询并记录不同位置的规则。跨发动机复用事实，不自动复用适配。',
   '用已验证共享事实对照精确配置；只对年份边界、车身/驱动、卡钳、OEM/PR码等未解决差异补查。',
   '每组一个owner。同车型所有平台、问题类型和优先级记录均在本组，禁止按V2旧批次重新领取。'],
  compact_platform_index:platforms.map(p=>({platform_id:p.platform_id,series:p.vehicle.series,years:p.years,positions:p.positions,issues:p.issues,cases:p.review_ids.length}))};
 write(`${base}/brief.json`,brief);
 manifestGroups.push({group_id,priority:g.priority,make:first.make,model:core.vehicle.model,model_names:brief.model_names,cases:rows.length,applications:brief.applications,platforms:platforms.length,
  brief_file:`${base}/brief.json`,target_file:`${base}/targets.json`,group_fingerprint:targetFile.group_fingerprint,target_sha256:digest(JSON.stringify(targetFile))});
}
assert.equal(mapping.length,5541);assert.equal(new Set(mapping.map(r=>r.review_id)).size,5541);
assert.deepEqual(new Set(mapping.map(r=>r.review_id)),new Set(prior.mapping.map(r=>r.review_id)));
write('reference/case_mapping.json',Object.fromEntries(mapping.map(r=>[r.review_id,r])));
fs.copyFileSync('outputs/brake-agent-v2-20261024/NexAuto_Brake_Agent_V2/reference/source_catalog.json',path.join(PKG,'reference/source_catalog.json'));
fs.copyFileSync('outputs/brake-agent-v2-20261024/NexAuto_Brake_Agent_V2/reference/provenance.jsonl',path.join(PKG,'reference/provenance.jsonl'));
write('reference/related_model_sources.json',Object.fromEntries(audit.sourceRows.reduce((m,r)=>{const k=JSON.stringify([r.makeName,r.modelName]);if(!m.has(k))m.set(k,[]);m.get(k).push(r.sourceRowId);return m;},new Map())));
const clone=x=>JSON.parse(JSON.stringify(x)),str={type:'string',minLength:1},strings={type:'array',items:str,uniqueItems:true};
const closed=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const suppliedEvidence=closed({evidence_id:str,source_type:{const:'supplied_catalog'},source_catalog_ref:{const:'reference/source_catalog.json'},
 source_row_ids:{type:'array',items:{type:'integer',minimum:1},minItems:1,uniqueItems:true},source_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},
 publisher:str,title:str,locator:str,accessed_at:{type:'string',format:'date-time'},supports_claim:str});
const evidenceSchema={anyOf:[clone(resultSchema.$defs.evidence),suppliedEvidence]};
const expandedSchema=clone(resultSchema);
expandedSchema.title='NexAuto V3 expanded per-application research result';
expandedSchema.properties.schema_version={const:'nexauto-brake-agent-v3-expanded'};
expandedSchema.$defs.evidence=evidenceSchema;
write('schema/expanded-result.schema.json',expandedSchema);
const factProps=clone(resultSchema.$defs.finding.properties);
delete factProps.finding_id;delete factProps.review_ids;
factProps.fact_id=str;factProps.platform_id=str;factProps.config_ids={...strings,minItems:1};
const assignmentProps=clone(resultSchema.$defs.result.properties);
delete assignmentProps.review_id;delete assignmentProps.finding_ids;
assignmentProps.covered_years={anyOf:[assignmentProps.covered_years,{const:'$TARGET_YEARS'}]};
assignmentProps.unresolved_years={anyOf:[assignmentProps.unresolved_years,{const:'$TARGET_YEARS'}]};
assignmentProps.fact_ids=strings;
const sharedSchema={$schema:'https://json-schema.org/draft/2020-12/schema',title:'NexAuto model-shared research v3',
 ...closed({schema_version:{const:'nexauto-brake-agent-v3'},group_id:str,group_fingerprint:{type:'string',pattern:'^[a-f0-9]{64}$'},
 reviewer:clone(resultSchema.properties.reviewer),evidence:clone(resultSchema.properties.evidence),facts:{type:'array',items:{$ref:'#/$defs/fact'}},
 assignments:{type:'array',minItems:1,items:{$ref:'#/$defs/assignment'}}}),
 $defs:{evidence:evidenceSchema,vehicle:clone(resultSchema.$defs.vehicle),fact:closed(factProps),
 assignment:closed({assignment_id:str,review_ids:{...strings,minItems:1},result:closed(assignmentProps)})}};
write('schema/shared-result.schema.json',sharedSchema);
fs.copyFileSync('scripts/catalog/validate-brake-agent-result-v2.py',path.join(PKG,'tools/validator_v2.py'));
fs.copyFileSync('scripts/catalog/brake-agent-v3-work.py',path.join(PKG,'tools/work.py'));
const stats={cases:mapping.length,applications:distinct(mapping.map(r=>r.application_id)).length,
 original_make_model_names:distinct(pending.map(r=>JSON.stringify([canonical(r.make),canonical(r.model)]))).length,
 user_listed_alias_pairs_grouped:researchPairs.length,
 model_shared_jobs:manifestGroups.length,platform_subitems:allPlatforms.length,previous_v2_research_tasks:v2.manifest.tasks,
 previous_v2_batches:v2.manifest.batch_count,job_group_reduction:1-manifestGroups.length/v2.manifest.tasks,
 query_count:'not_measured_no_research_executed',query_reduction:'not_measured_no_research_executed',
 source_rows:audit.sourceRows.length,groups_with_multiple_platforms:manifestGroups.filter(g=>g.platforms>1).length,
 pending_research:true,database_changed:false};
const manifest={schema_version:'nexauto-brake-agent-v3',created_at:new Date().toISOString(),user_date:'2026-10-24',
 scope:v2.manifest.scope,stats,policy:'以品牌+车型共享档案组织查询；底盘、位置、年份和精确配置只合并查询不自动合并适配。',
 schedule:'按groups顺序，P0优先。每个group只能有一个owner；先复用缓存，后对真正未解决差异补查。',
 groups:manifestGroups};
write('manifest.json',manifest);
write('START_AGENT.txt',`NexAuto 刹车片最少重复查询任务包 V3\n\n本包替代V2的349个独立批次，不要同时执行旧包。\n全部5541条待审适配仍保留。现在按品牌+车型建立${manifestGroups.length}份共享档案，内含${allPlatforms.length}个底盘子项；子项不是逐条重新搜索的任务。分组数量减少不等于真实搜索次数减少同一比例。没有执行任何联网研究或AI审核。\n\n执行顺序\n1. 读AGENT_PROMPT.txt、schema/shared-result.schema.json，再用 python tools/work.py status 查看待处理车型。\n2. 一个车型一个owner。领取：python tools/work.py claim --group <group_id> --owner <agent标签>。禁止另一agent重复领取整个车型；不自动抢过期锁。\n3. 先用view读取brief，建立整车型代际/底盘对照并记录证据。再读平台详情、局部配置和源行，逐底盘复用共享事实。不要一次装入全部车型文件。\n4. 先查事实后看comparison。同一DB的前后位置、车身/驱动、年份边界与卡钳区别不得泛化。未知别名/共享平台只有证实后才能复用。\n5. 查询前检查本车型checkpoint中的query_log和facts，搜索和失败结果都保存；相同问题/URL不因换批或换agent重复查询。查询日志参考reference/checkpoint.example.json。\n6. 输出以车型为单位，证据和facts各存一次；assignments把相同结论关联多个review_id。covered_years或unresolved_years可写字符串 $TARGET_YEARS，工具逐条展开原始年份集合。无需重复写5541条长理由。\n7. 运行 python tools/work.py check --group <group_id> --result results/<owner>/<group_id>.json 。默认要求本车型所有review_id恰好覆盖一次；未知也返回unable_to_determine。工具只校验，不联网、不验证证据真伪。\n8. 需要逐application交回时，运行 expand 命令并给 --output-dir expanded/<owner>/<group_id> 。此操作仅本地展开结果，保留稳定ID，不连接数据库。\n9. check成功后，保存查询日志，再用 finish --group <group_id> --owner <owner> --result <结果路径> 标记本车型处理完成。遇到证据不足明确交回，不能为了覆盖率猜测。\n\n完整命令帮助：python tools/work.py --help\n查看局部：python tools/work.py view --group <group_id> --section cases --platform <platform_id>\n查看源行：python tools/work.py view --group <group_id> --section sources --source-ids 15008,15011\n\n结果、进度和锁目录当前为空。包内无数据库凭据及发布脚本。接收agent只研究并整理结果，不改生产库、车型库或SKU。\n`);
write('AGENT_PROMPT.txt',`你处理的是NexAuto刹车片待审关系。目标是最少重复查证，不是最少证据，也不是把同底盘所有配置强制归为一个DB。\n\n共享研究原则\n- 一份品牌+车型档案覆盖所有相关底盘、前后位置、发动机和问题类型，只领取一次。先查整车型代际/底盘表和目录，再集中记录共享规则，最后核对例外。\n- 第一层：车型/代际身份事实。相同底盘不因发动机或前后位置重复查身份。疑似车型归属错误则提出纠错，原application_id不变。车型纠错和刹车片适配是两个结论。\n- 第二层：刹车片事实，位置是硬边界。同底盘的不同发动机可以共用已证明适用的事实；但卡钳、制动盘直径、OEM/PR码、性能配置、车身/驱动、市场和年份差异必须核实，不能仅凭底盘名相同套用。\n- 第三层：本地应用映射，用已证实的facts对照targets；只有未解决的差异再补充查询。读取更多记录或展开结果不属于新的联网任务。跨车型别名仅在证据确认后共用，reference/related_model_sources.json不是已确认别名表。\n- 多人处理要按整车型分工，不能让多个agent各查同车型的一半。checkpoint保存已读来源、支持范围、已试查询和无结果原因；恢复任务先读checkpoint，避免重复网站和失败搜索。研究本身可分段执行，但共享事实不按上下文片段重建。\n\n证据与数据\n用户指定源表最高置信度，但它只是Topstar供货子集；目录事实可信不代表源到目标的映射正确。已提供源行的DB及目录适用范围不必再逐行联网复查。用supplied_catalog证据引用本地source_row_ids和原文件SHA256，不能伪造HTTP链接。联网工作集中在身份映射、制动配置消歧和源范围以外的年份。仅本地源行不能证明未核实的别名映射或扩大年份。\nsource_links.original与identity_hints都是未核实线索。现网DB在comparison单独保存，先形成事实再读，不能作为答案证据。\nNBP是内部唯一SKU，DB是跨品牌图号，CDB是供应商SKU。HD/4WD/GCT产品后缀不是车辆驱动证据。可提出未上架DB。\n补查优先实际打开厂家/OEM目录，返回URL、出版方、标题、页/行定位、真实访问时间和精确支持的事实。搜索摘要、AI转述、泛车型标题和同源转载不能替代配置证据。不要按网站票数选DB，不编造证据。\n\n输出\n读schema/shared-result.schema.json。每个fact对应一个原始platform_id和明确config_ids，保留其年份、位置、发动机码和限制条件。多平台同一外部目录只打开一次，证据只记录一次，但每个平台的适用范围仍须分别声明。facts.vehicle用目标的原始标识；别名归一化结论写summary/conditions，疑似错车要proposed_vehicle而不是悄悄改目标。\nassignments明确列review_ids，引用fact_ids。只有结论、DB、条件、理由完全相同才合并。可用 $TARGET_YEARS 让工具展开每条原始年份集合。已支持和未解决年份须互斥且完整，不把范围中不存在的年份补进去。\n同一底盘不同body/drive要分facts，以符合逐配置验证。facts可覆盖多个同车身/驱动但不同发动机config_ids，前提是证据支持这些配置。不能将相同发动机当做强制共享卡钳的证据。\nkeep_current/replace_db要求车型身份confirmed_as_is、完整目标年份已支持、无未解问题；与comparison的当前DB相同才keep，不同才replace。部分配置或部分年份用split_fitment并明确条件，不确定年份保留。\ncatalog_correction要求correction_proposed、proposed_vehicle和identity事实；不自动认定雨刮/滤芯等其他产品适配改变。not_applicable只表示有证据排除候选，不表示该车无需刹车片。\n不能确定用unable_to_determine、confirmed_db=null、明确缺什么信息。未查也如实写未查原因，不能用空证据填高置信度结论。\n每个review_id必须恰好出现在一个assignment。最省写法是把不同年份但同结论的记录列在一个assignment，以 $TARGET_YEARS 表达全部原始年份。每条配置仍经过事实作用域校验。工具能批量展开，不需要agent重写相同理由。\n输出纯JSON，实际reviewer名称和带时区时间。结果保存results/<owner>/<group_id>.json；不要覆盖原输入或其他agent结果。JSON校验通过不等于证据真实性已验证，更不等于允许发布。禁止连接生产数据库。\n`);
write('reference/checkpoint.example.json',{template_only:true,group_id:'COPY_GROUP_ID',owner:'COPY_OWNER',
 query_log:[{query:'实际尝试的查询，不是预填答案',status:'planned_not_executed',urls_opened:[],coverage_platform_ids:[],remaining_questions:[]}],
 evidence:[],facts:[],identity_map:[],processed_platform_ids:[],remaining_platform_ids:[],
 cached_fact_ids:[],next_action:'先查看本车型brief，实际研究后更新；此模板不是研究结果'});
write('交给Agent的提示词.txt',`请处理这个NexAuto刹车片V3任务包。先读START_AGENT.txt和AGENT_PROMPT.txt，再从manifest按P0、P1、P2领取整车型研究档案。它替代V2任务包，不要同时重跑V2批次。\n\n先合并车型/代际/底盘身份查询，再引用已提供的最高置信度源表，最后只补查配置冲突和未解决年份。共享证据与事实要持久保存到checkpoint，恢复任务先检查查询缓存。不要针对同底盘的每个发动机或前后位置重复查车型身份。\n\n按schema输出车型共享facts和分组assignments，运行本地check并保留未解决问题，随后用expand展开逐application结果交回。完整保留5541条review_id，不猜测、不自行发布或改数据库。\n`);
write('命令示例.txt',`在解压后的NexAuto_Brake_Agent_V3目录运行Python 3。将GROUP_ID、PLATFORM_ID和OWNER替换为真实值。\n\n查看排队：python tools/work.py status\n领取整车型：python tools/work.py claim --group GROUP_ID --owner OWNER\n恢复先读缓存：python tools/work.py view --group GROUP_ID --section checkpoint\n查看简报：python tools/work.py view --group GROUP_ID --section brief\n分段查看底盘：python tools/work.py view --group GROUP_ID --section platforms --offset 0 --limit 30\n查看局部配置：python tools/work.py view --group GROUP_ID --section cases --platform PLATFORM_ID\n查询前查重：python tools/work.py query-check --group GROUP_ID --query "准备查询的完整关键词"\n实际查询后记录（该命令本身不搜索）：python tools/work.py log-query --group GROUP_ID --owner OWNER --query "实际查询词" --outcome no_result --platform-ids PLATFORM_ID --note "未解决的信息"\n找到来源则使用 --outcome found 并加 --urls "https://实际来源页面" 。避免把 planned 记成已查询。\n校验完整车型结果：python tools/work.py check --group GROUP_ID --result results/OWNER/GROUP_ID.json\n展开记录：python tools/work.py expand --group GROUP_ID --result results/OWNER/GROUP_ID.json --output-dir expanded/OWNER/GROUP_ID\n记录完成：python tools/work.py finish --group GROUP_ID --owner OWNER --result results/OWNER/GROUP_ID.json\n\ncheckpoint建议路径：progress/checkpoints/OWNER/GROUP_ID.json，保存实际证据、facts和待补查询。例子只给字段，不是审核结果。\n工具不执行联网查询，不核验证据真实性，不连接数据库。finish仅表示本车型研究已交回，不表示每条已解决。\n`);
write('任务清单.txt',`V3共享车型查询清单\n\n适配5541条，application ${stats.applications}个，共享车型档案${stats.model_shared_jobs}份，底盘子项${stats.platform_subitems}个。\n原V2的${stats.previous_v2_research_tasks}个分块任务现在集中为${stats.model_shared_jobs}个车型owner任务，组数减少${(stats.job_group_reduction*100).toFixed(1)}%。此为组织去重，不是已验证的搜索量或时间节省。\n\n${manifestGroups.map(g=>`${g.priority}  ${g.group_id}  ${g.make} ${g.model}  ${g.platforms}底盘 / ${g.cases}条适配`).join('\n')}\n`);
write('reference/research-alias-pairs.json',{basis:'用户此前给出的热门车型名称分组；仅组织查询，不作适配等价证明',pairs:researchPairs});
write('reference/input-provenance.json',{audit_file:'outputs/brake-pad-unique-first-audit-20261024/audit.json',audit_sha256:digest(fs.readFileSync('outputs/brake-pad-unique-first-audit-20261024/audit.json','utf8')),
 prior_v2_manifest_sha256:digest(JSON.stringify(v2.manifest)),source_file:'Bendix_TopstarSupplied_Rows_2026-10-24.xlsx',source_confidence:'user_designated_highest',target_mapping:'unresolved',normalization:'Platform IDs: Unicode NFKC, trim, whitespace collapse and case only. Five user-listed name pairs share research ownership only; no inferred fitment/generation merging.'});
fs.writeFileSync(path.join(ROOT,'prepared.json'),JSON.stringify({manifest,mapping}));
console.log(JSON.stringify(stats,null,2));
