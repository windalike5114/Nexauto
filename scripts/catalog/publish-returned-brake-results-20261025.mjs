import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {client,snapshot,all} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';
import {compact,bodyKey} from './brake-pad-strict-policy.mjs';

export const POLICY='BRAKE_RETURNED_AI_CONFIG_VERIFIED_20261025';
const OUT=path.resolve('outputs/brake-returned-results-import-20261025');
const INPUT=path.resolve('outputs/brake-returned-results-inspection-20261025/application-candidates.json');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const put=(name,value)=>fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const sortedHash=rr=>hash(rr.map(r=>JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]])))).sort());
const engine=(a,allowed)=>a.engine_codes.length>0&&a.engine_codes.every(c=>allowed.includes(compact(c)));
const inYears=(a,from,to)=>a.all_years.length>0&&a.all_years.every(y=>y>=from&&y<=to);
const text=s=>s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
function evidenceFile(name){const s=fs.readFileSync(path.join(OUT,'evidence',name),'utf8');return {text:text(s),rows:[...s.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)].map(m=>text(m[0]))};}

// Finite reviewed subgroups only. A production start/end month is retained in
// notes. A date-dependent change of DB, unknown PR/caliper or drum/disc branch
// is not approved by any rule below.
export function reviewedRule(a,r){
 const db=r.candidate_db?.length===1?r.candidate_db[0]:null;
 const b=bodyKey(a.body),s=compact(a.series),p=r.position;
 if(a.make==='TOYOTA'&&a.model==='COROLLA'&&p==='front'&&a.drive==='FWD'){
  if(db==='DB1422'&&s==='NZE120'&&b==='sedan'&&engine(a,['2NZFE'])&&inYears(a,2000,2008))return 'COROLLA_NZE120_2NZ_FRONT';
  if(db==='DB1422'&&s==='NZE121'&&['wagon','hatchback'].includes(b)&&engine(a,['1NZFE'])&&inYears(a,2000,2006))return 'COROLLA_NZE121_1NZ_FRONT';
  if(db==='DB1785'&&s==='ZRE162G'&&b==='wagon'&&engine(a,['2ZRFAE'])&&inYears(a,2012,2026))return 'FIELDER_ZRE162G_FRONT_LIVE_CATALOGUE';
  if(db==='DB1820'&&s==='NKE165G'&&b==='wagon'&&engine(a,['1NZFXE'])&&inYears(a,2014,2026))return 'FIELDER_NKE165G_FRONT_EXPLICIT_YEAR_ROWS';
 }
 if(a.make==='TOYOTA'&&a.model==='COROLLA'&&s==='ZWE211'&&b==='hatchback'&&a.drive==='FWD'&&engine(a,['2ZRFXE'])&&inYears(a,2018,2026)
   &&((p==='front'&&db==='DB2544')||(p==='rear'&&db==='DB2529')))return 'COROLLA_ZWE211_HATCH_EXPLICIT_YEAR_ROWS';
 if(a.make==='TOYOTA'&&a.model==='PRIUS'&&s==='NHW11'&&b==='sedan'&&a.drive==='FWD'&&engine(a,['1NZFXE'])&&p==='front'&&db==='DB1422'&&inYears(a,2000,2003))return 'PRIUS_NHW11_FRONT_DIRECT_CATALOGUE';
 if(a.make==='TOYOTA'&&a.model==='HILUX'&&p==='front'&&['pickup','cab_chassis'].includes(b)){
  if(db==='DB1149'&&a.drive==='AWD'&&((['LN167','LN172'].includes(s)&&engine(a,['5LE'])&&inYears(a,1998,2005))
    ||(['KZN165','KZN165R'].includes(s)&&engine(a,['1KZTE'])&&inYears(a,1999,2005))
    ||(s==='VZN167'&&engine(a,['5VZFE'])&&inYears(a,2002,2005))))return 'HILUX_VI_EXACT_CHASSIS_ENGINE_DB1149';
  if(db==='DB1482'&&['GUN135','GUN135R'].includes(s)&&a.drive==='RWD'&&engine(a,['2GDFTV'])&&inYears(a,2015,2026))return 'HILUX_GUN135_2GD_RWD_FRONT';
  if(db==='DB1482'&&s==='GUN126'&&a.drive==='AWD'&&engine(a,['1GDFTV'])&&inYears(a,2020,2026)){
   const hybrid=/electric|electro/i.test(a.engine);
   if(!hybrid)return 'HILUX_GUN126_NONHYBRID_FRONT';
   if(b==='cab_chassis'&&inYears(a,2024,2026))return 'HILUX_GUN126_48V_CABCHASSIS_FRONT';
  }
  if(db==='DB1482'&&s==='GGN125'&&a.drive==='AWD'&&engine(a,['1GRFE'])&&inYears(a,2015,2017))return 'HILUX_VIII_GGN125_FRONT_MANUFACTURER';
 }
 return null;
}

function verifyEvidence(a,r,rule){
 const proofs=[];
 const record=(file,rows)=>{assert(rows.length,`Evidence rows missing ${rule} ${a.application_id}`);proofs.push({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT,'evidence',file))).digest('hex'),rows});};
 if(['COROLLA_NZE120_2NZ_FRONT','COROLLA_NZE121_1NZ_FRONT','PRIUS_NHW11_FRONT_DIRECT_CATALOGUE'].includes(rule)){
  const e=evidenceFile('nibk-pn1472.html');assert(/BENDIX\s+DB1422/.test(e.text));
  record('nibk-pn1472.html',e.rows.filter(t=>t.includes(a.series)&&a.engine_codes.some(c=>compact(t).includes(compact(c)))&&t.includes('PN1472')));
 }else if(rule==='FIELDER_ZRE162G_FRONT_LIVE_CATALOGUE'){
  const e=evidenceFile('nibk-pn1518.html');assert(/DB1785/.test(e.text));record('nibk-pn1518.html',e.rows.filter(t=>t.includes('ZRE162G')&&t.includes('2ZR-FAE')&&t.includes('PN1518')));
 }else if(rule==='FIELDER_NKE165G_FRONT_EXPLICIT_YEAR_ROWS'||rule==='COROLLA_ZWE211_HATCH_EXPLICIT_YEAR_ROWS'){
  const name={DB1820:'db1820-supplier.html',DB2544:'db2544-supplier.html',DB2529:'db2529-supplier.html'}[r.candidate_db[0]],e=evidenceFile(name);
  assert(e.text.includes(r.candidate_db[0]));
  const rows=e.rows.filter(t=>t.includes(a.series)&&t.includes(a.body==='Wagon'?'Wagon':'Hatchback')&&t.includes('Front-Wheel Drive')&&a.engine_codes.some(c=>compact(t).includes(compact(c))));
  for(const y of a.all_years)assert(rows.some(t=>new RegExp(`\\b${y}\\b`).test(t)),`Supplier year missing ${a.application_id}: ${y}`);
  record(name,rows);
 }else if(rule==='HILUX_VI_EXACT_CHASSIS_ENGINE_DB1149'){
  const e=evidenceFile('db1149-supplier.html');assert(e.text.includes('DB1149'));assert(e.text.includes(a.series)||e.text.includes(a.series+'R'));
  // Primary manufacturer profile/engine rows plus direct DB1149 application
  // from the returned manufacturer/distributor chain. The PN1219 cross-ref
  // alone is never treated as proof that DB1323 is an exclusive alternative.
  if(a.series!=='VZN167'){
   const n=evidenceFile('nibk-pn1219.html');assert(/DB1149/.test(n.text));
   record('nibk-pn1219.html',n.rows.filter(t=>t.includes(a.series.replace(/R$/,''))&&a.engine_codes.some(c=>compact(t).includes(compact(c)))&&t.includes('PN1219')));
  }
  record('db1149-supplier.html',[e.text.slice(Math.max(0,e.text.indexOf(a.series)-150),e.text.indexOf(a.series)+1100)]);
 }else if(rule==='HILUX_VIII_GGN125_FRONT_MANUFACTURER'){
  const file='bendix-hilux.pdf';assert(fs.statSync(path.join(OUT,'evidence',file)).size>1000000);
  record(file,['Visually verified page 12: 07/2015-on, GUN126/GGN125, 4.0 V6 4WD (GGN125), front BR2716 and DB1482; no alternate brake-pad note in this row.']);
 }else if(rule.startsWith('HILUX_GUN')){
  const e=evidenceFile('db1482-supplier.html');assert(e.text.includes('DB1482'));
  const hybrid=/electric|electro/i.test(a.engine),body=a.body==='Utility'?'Ute':'Platform/Chassis';
  const rows=e.rows.filter(t=>t.includes(a.series.replace(/R$/,''))&&t.includes(body)&&a.engine_codes.some(c=>compact(t).includes(compact(c)))
   &&(hybrid?t.includes('48V'):!t.includes('48V'))&&t.includes(a.drive==='AWD'?'All-wheel Drive':'Rear-Wheel Drive'));
  for(const y of a.all_years)assert(rows.some(t=>new RegExp(`\\b${y}\\b`).test(t)),`Supplier exact configuration/year missing ${a.application_id} ${y}`);
  record('db1482-supplier.html',rows);
  const n=evidenceFile('nibk-pn1482.html');assert(n.text.includes('DB1482'));
  if(!hybrid)record('nibk-pn1482.html',n.rows.filter(t=>t.includes(a.series.replace(/R$/,''))&&a.engine_codes.some(c=>compact(t).includes(compact(c)))&&t.includes('PN1482')));
 }
 assert(proofs.length,`No primary/supplied catalogue check ${rule}`);return proofs;
}

export function buildPlan(d){
 const input=read(INPUT),apps=new Map(enrich(d).map(a=>[a.application_id,a])),products=new Map(d.products.map(p=>[p.id,p]));
 const approved=[],remaining=[],already=[];
 for(const r of input){
  const a=apps.get(r.application_id),current=a?.published.filter(f=>f.position===r.position)??[];
  if(r.candidate_db.length===1&&current.some(f=>f.db===r.candidate_db[0])&&!current.some(f=>f.db!==r.candidate_db[0])){already.push({...r,latest_disposition:'already_published_same_db'});continue;}
  const rule=a?reviewedRule(a,r):null;
  let reason=!a||a.status!=='active'?'车型记录已变化或失效':current.length?'现网已有不同DB，保留待确认':r.stage!=='full_year_unique_db_await_condition_and_evidence_check'?'原复核范围未满足全年唯一且商品可对应':!rule?'附带月份/市场/卡钳/PR/OE条件或其他尚未核实限制':null;
  if(reason){remaining.push({...r,latest_disposition:reason});continue;}
  assert.equal(a.make,r.make);assert.equal(a.model,r.model);assert.equal(a.series,r.series);assert.equal(a.body,r.body);assert.equal(a.drive,r.drive);assert.equal(a.engine,r.engine);assert.deepEqual(a.all_years,r.all_years);
  const p=r.product_candidates;assert.equal(p.length,1);assert.equal(products.get(p[0].product_variant_id)?.sku,p[0].sku);assert(products.get(p[0].product_variant_id)?.active!==false);
  assert(r.findings.every(f=>!f.validation_errors.length));assert(!r.prior_identity_flags.length);assert(!r.unresolved_overlap_years.length);
  const same=d.fitments.filter(f=>f.application_id===a.application_id&&f.position===r.position&&f.product_variant_id===p[0].product_variant_id);
  assert(same.length<=1);assert(!same.length||same[0].fitment_status==='review',`Do not restore rejected relationship ${a.application_id}`);
  const proofs=verifyEvidence(a,r,rule);
  approved.push({...r,safe_to_import:true,rule_id:rule,proofs,sku:p[0].sku,product_variant_id:p[0].product_variant_id,db:r.candidate_db[0],before:same[0]??null,operation:same.length?'restore_review':'insert_published'});
 }
 const afterProjection={...d,fitments:d.fitments.map(f=>approved.some(r=>r.operation==='restore_review'&&key(r)===key(f))?{...f,fitment_status:'published'}:f).concat(approved.filter(r=>r.operation==='insert_published').map(r=>({application_id:r.application_id,product_variant_id:r.product_variant_id,position:r.position,fitment_status:'published'})))};
 const result={policy:POLICY,created_at:new Date().toISOString(),source_hash:hash(input),snapshot_hash:hash(d),snapshot_at:d.completed_at,approved,already,remaining,before:coverage(d),projected:coverage(afterProjection),counts:{approved:approved.length,restore:approved.filter(r=>r.operation==='restore_review').length,insert:approved.filter(r=>r.operation==='insert_published').length,already:already.length,remaining:remaining.length}};
 assert.equal(approved.length+already.length+remaining.length,input.length);assert.equal(new Set(approved.map(key)).size,approved.length);return result;
}

async function apply(){
 assert(!fs.existsSync(path.join(OUT,'applied.json'))&&!fs.existsSync(path.join(OUT,'apply-progress.json')),'This import has already started; verify instead of repeating');
 const plan=read(path.join(OUT,'plan.json')),before=read(path.join(OUT,'before-snapshot.json'));assert.equal(plan.snapshot_hash,hash(before));assert.equal(plan.source_hash,hash(read(INPUT)));
 const db=client(),live=await snapshot(db);
 // Abort before writing if any application/catalog/fitment inputs changed.
 for(const k of Object.keys(before).filter(k=>Array.isArray(before[k])))assert.equal(sortedHash(live[k]),sortedHash(before[k]),`Production changed (${k}); re-plan`);
 const checked=buildPlan(live);assert.deepEqual(checked.approved.map(r=>[key(r),r.rule_id]),plan.approved.map(r=>[key(r),r.rule_id]));
 const now=new Date().toISOString(),backup=path.resolve('tmp/production-backups',`brake-returned-ai-${now.replace(/[:.]/g,'-')}`);fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'core-snapshot.json'),JSON.stringify(live));fs.copyFileSync(path.join(OUT,'plan.json'),path.join(backup,'plan.json'));
 const journal={policy:POLICY,started_at:now,backup,updates:[],inserts:[]};put('apply-progress.json',journal);
 for(const r of plan.approved){
  const note=`${POLICY}; rule=${r.rule_id}; db=${r.db}; returned_evidence=${r.findings.map(f=>`${f.question_id}/${f.config_ids.join(',')}/${f.finding_id}`).join('|')}; application_years=${r.all_years.join(',')}; production_boundaries_and_conditions=${r.findings.flatMap(f=>f.conditions).join(' | ')}; evidence=${[...new Set(r.findings.flatMap(f=>f.evidence.map(e=>e.url)))].join(',')}; checked_proofs=${r.proofs.map(p=>p.sha256).join(',')}`;
  if(r.operation==='restore_review'){
   const payload={fitment_status:'published',notes:[r.before.notes,note].filter(Boolean).join('; '),updated_at:now};
   let q=db.from('vehicle_catalog_product_fitments').update(payload).eq('application_id',r.application_id).eq('product_variant_id',r.product_variant_id).eq('position',r.position).eq('fitment_status','review');
   q=r.before.updated_at?q.eq('updated_at',r.before.updated_at):q.is('updated_at',null);
   const res=await q.select('*');if(res.error)throw res.error;assert.equal(res.data.length,1,`Optimistic update failed ${key(r)}`);journal.updates.push(res.data[0]);
  }else{
   const payload={application_id:r.application_id,product_variant_id:r.product_variant_id,position:r.position,fitment_status:'published',source:POLICY,notes:note,updated_at:now};
   const res=await db.from('vehicle_catalog_product_fitments').insert(payload).select('*');if(res.error)throw res.error;assert.equal(res.data.length,1);journal.inserts.push(res.data[0]);
  }
  put('apply-progress.json',journal);
 }
 const afterFits=await all(db,'vehicle_catalog_product_fitments','application_id'),keys=new Set(plan.approved.map(key)),byKey=new Map(afterFits.map(f=>[key(f),f]));
 assert.equal(sortedHash(afterFits.filter(f=>!keys.has(key(f)))),sortedHash(live.fitments.filter(f=>!keys.has(key(f)))),'Unexpected non-target relationship changes');
 for(const r of [...journal.updates,...journal.inserts])assert.equal(sortedHash([byKey.get(key(r))]),sortedHash([r]),`Readback mismatch ${key(r)}`);
 const after={...live,fitments:afterFits,verified_at:new Date().toISOString()},aa=new Map(enrich(after).map(a=>[a.application_id,a]));
 for(const r of plan.approved){const published=aa.get(r.application_id).published.filter(f=>f.position===r.position);assert(published.every(f=>f.db===r.db),`Post-import conflict ${r.application_id}`);}
 const verification={...journal,completed_at:after.verified_at,verified:true,counts:plan.counts,before:coverage(live),after:coverage(after),by_rule:Object.fromEntries([...Map.groupBy(plan.approved,r=>r.rule_id)].map(([k,rr])=>[k,rr.length]))};
 put('after-snapshot.json',after);put('applied.json',verification);
 const gain=verification.after.covered_application_years-verification.before.covered_application_years;
 fs.writeFileSync(path.join(OUT,'录入说明.txt'),`刹车片AI结果录入（2026-10-25）\n\n已验证录入${plan.approved.length}条关系：恢复发布${journal.updates.length}条，新增关系${journal.inserts.length}条。\n涉及${new Set(plan.approved.map(r=>r.application_id)).size}个application。\n本批结果已有相同DB发布${plan.already.length}个位置，不重复录入。\n剩余${plan.remaining.length}个位置保留待确认，未自动覆盖不同DB或新增商品。\n热门50车型2000–2026年，至少一侧已发布的application-year覆盖率：${(verification.before.application_year_rate*100).toFixed(2)}% → ${(verification.after.application_year_rate*100).toFixed(2)}%。\n新增覆盖${gain}个application-year。统计不代表前后刹车片均完整。\n\n生产起止月份与原结论限制已保留在适配备注；无删除、无车型合并、无商品变更。\n写入前已备份，写入后逐条回读校验，并检查无关适配未变化。\n\n备份：${backup}\n`, 'utf8');
 console.log(JSON.stringify({verified:true,counts:plan.counts,applications:new Set(plan.approved.map(r=>r.application_id)).size,restored:journal.updates.length,inserted:journal.inserts.length,before:verification.before.application_year_rate,after:verification.after.application_year_rate,new_application_years:gain,backup},null,2));
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 if(process.argv.includes('--apply'))await apply();else{
  assert(!fs.existsSync(path.join(OUT,'applied.json'))&&!fs.existsSync(path.join(OUT,'apply-progress.json')),'Import already started');
  const p=buildPlan(read(path.join(OUT,'before-snapshot.json')));put('plan.json',p);put('remaining-confirmation.json',p.remaining);put('approved.json',p.approved);
  console.log(JSON.stringify({counts:p.counts,approved:p.approved.map(r=>({id:r.application_id,model:r.model,series:r.series,position:r.position,db:r.db,rule:r.rule_id})),before:p.before.application_year_rate,projected:p.projected.application_year_rate},null,2));
 }
}
