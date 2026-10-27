import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {brakeFamily,evaluateBrakeFitment,evaluateBrakeFitmentConservative,engineKeys,compact,POLICY_VERSION,UNIQUE_FIRST_POLICY_VERSION} from './brake-pad-strict-policy.mjs';
import {REQUESTED_POPULAR_VEHICLE_GROUPS,buildPopularAliasIndex} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
import {POLICY as VERIFIED_ALIAS_POLICY,augmentSources,assessReviewed} from './brake-alias-review-policy-20261025.mjs';

const conservative=process.argv.includes('--conservative');
const promoteReviewOnly=process.argv.includes('--promote-review-only');
const allBrakeReview=process.argv.includes('--all-brake-review');
const familyRootBridge=process.argv.includes('--family-root-bridge');
const modelAliases=process.argv.includes('--model-aliases');
const popular50Round2=process.argv.includes('--popular50-round2');
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice('--out='.length);
const ACTIVE_POLICY=conservative?POLICY_VERSION:UNIQUE_FIRST_POLICY_VERSION;
export const OUT = path.resolve(outArg|| (popular50Round2
  ? 'outputs/brake-pad-popular50-round2-20261025'
  : modelAliases
  ? 'outputs/brake-pad-review-promotion-model-aliases-20261025'
  : familyRootBridge
  ? 'outputs/brake-pad-review-promotion-family-root-20261025'
  : allBrakeReview
  ? 'outputs/brake-pad-review-promotion-all-wildcards-20261025'
  : promoteReviewOnly
  ? 'outputs/brake-pad-review-promotion-wildcard-20261025'
  : conservative
    ? 'outputs/brake-pad-strict-audit-wildcard-20261025'
    : 'outputs/brake-pad-unique-first-audit-wildcard-20261025'));
export const SOURCES = allBrakeReview
  ? ['NEXAUTO_FITMENT_V6_2026_10_22','BENDIX_TOPSTAR_SUPPLIED_FITMENTS_2026_10_24','BENDIX_VERIFIED_PLATFORM_EXPANSION_2026_10_24']
  : ['BENDIX_TOPSTAR_SUPPLIED_FITMENTS_2026_10_24','BENDIX_VERIFIED_PLATFORM_EXPANSION_2026_10_24'];
const read = p => JSON.parse(fs.readFileSync(p,'utf8'));
const key = r => `${r.application_id}|${r.product_variant_id}|${r.position}`;
const group = (rows,fn) => {const m=new Map();for(const r of rows){const k=fn(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const count = (rows,fn) => {const o={};for(const r of rows){const k=fn(r);o[k]=(o[k]??0)+1;}return o;};

export function prepareAudit(data,sourceRows) {
  const maps = Object.fromEntries([['makes','make_id'],['models','model_id'],['series','series_id'],['variants','variant_id'],['engines','powertrain_id'],['products','id']].map(([name,id])=>[name,new Map(data[name].map(r=>[r[id],r]))]));
  const yrs=group(data.years,r=>r.application_id),byFamily=group(sourceRows,r=>brakeFamily(r.makeName,r.modelName));
  const catalog=read('data/brake-pads/catalog.json'),cat=new Map(catalog.map(r=>[r.sku,r]));
  const popularIndex=buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
  const codeMap=new Map((data.engineCodes??[]).map(r=>[r.engine_code_id,compact(r.code)]));
  const codesByPowertrain=group(data.powertrainEngineCodes??[],r=>r.powertrain_id);
  const applications=data.applications.map(r=>{
    const m=maps.models.get(r.model_id),mk=maps.makes.get(m?.make_id),v=maps.variants.get(r.variant_id),s=maps.series.get(r.series_id),e=maps.engines.get(r.powertrain_id);
    return {...r,make:mk?.name??'',model:m?.name??'',series:s?.code??'',body:v?.body_style??'',drive:v?.drive_type??'',variant:v?.display_name??'',
      engine:e?.display_name??'',engineCodes:[...new Set([...engineKeys(e?.display_name),...(codesByPowertrain.get(r.powertrain_id)??[]).map(r=>codeMap.get(r.engine_code_id)).filter(Boolean)])],displacementCc:e?.displacement_cc??null,
      years:(yrs.get(r.application_id)??[]).map(y=>+y.model_year).sort((a,b)=>a-b),popular:popularIndex.get(canonicalModelKey(mk?.name??'',m?.name??''))};
  });
  const appMap=new Map(applications.map(a=>[a.application_id,a]));
  const targets=data.fitments.filter(r=>SOURCES.includes(r.source)
    &&(promoteReviewOnly?r.fitment_status==='review':['published','review'].includes(r.fitment_status))
    &&cat.has(maps.products.get(r.product_variant_id)?.sku));
  const original=read('outputs/bendix-topstar-fitments-20261024/confirmation-data.json').replacements;
  const expansion=read('outputs/brake-pad-expansion-20261024/plan.json').replacements;
  const histories=new Map();
  const addHistory=(id,pos,value)=>{const k=`${id}|${pos}`;if(!histories.has(k))histories.set(k,[]);histories.get(k).push(value);};
  for(const r of original)addHistory(r.application_id,r.position,{sku:r.old_sku,source:r.old_source,notes:r.old_notes,kind:'首轮覆盖'});
  for(const r of expansion)addHistory(r.existing.application_id,r.existing.position,{sku:r.existing.sku,source:r.existing.source,notes:r.existing.notes,kind:'底盘拓展覆盖'});
  const fitsByAppPosition=group(data.fitments,r=>`${r.application_id}|${r.position}`);
  // Re-evaluate already-approved alias targets with the named rules on later
  // audits. Do not silently demote them again merely because V2 predates aliases.
  // This path cannot publish a new target and still rejects new DB conflicts.
  const verifiedSources=augmentSources(sourceRows,catalog),verifiedProducts=new Map();
  for(const c of catalog)for(const p of data.products.filter(p=>p.sku===c.sku&&p.active!==false))for(const pos of ['front','rear'].filter(pos=>c.position.toLowerCase().includes(pos))){const k=`${c.supplierRef}|${pos}`;if(!verifiedProducts.has(k))verifiedProducts.set(k,[]);verifiedProducts.get(k).push({sku:c.sku,id:p.id});}
  const rows=targets.map(r=>{
    const a=appMap.get(r.application_id);if(!a)throw new Error(`Application missing ${r.application_id}`);
    const sku=maps.products.get(r.product_variant_id).sku,db=cat.get(sku).supplierRef;
    const result=(conservative?evaluateBrakeFitmentConservative:evaluateBrakeFitment)(a,r.position,db,byFamily.get(brakeFamily(a.make,a.model))??[]);
    if(!conservative&&r.fitment_status==='published'&&r.notes?.includes(VERIFIED_ALIAS_POLICY)){
      const existing=data.fitments.filter(f=>f.application_id===a.application_id).map(f=>({...f,sku:maps.products.get(f.product_variant_id)?.sku,db:cat.get(maps.products.get(f.product_variant_id)?.sku)?.supplierRef})).filter(f=>f.db);
      const checked=assessReviewed({...a,rank:a.popular?.rank,group:a.popular?.label,all_years:a.years,
        engine_codes:a.engineCodes,displacement_cc:a.displacementCc,existing},r.position,verifiedSources,verifiedProducts);
      if(checked.status==='already_published_supported'&&checked.proposed_db===db)Object.assign(result,{keep:true,rule:'verified_alias_group_retained',reasons:[],candidate_db:checked.candidate_db,evidence_urls:checked.evidence_urls,warnings:[...(result.warnings??[]),'重新通过已核实分组规则，不按旧V2缺少别名映射再次降级']});
    }
    const otherPublished=(fitsByAppPosition.get(`${r.application_id}|${r.position}`)??[]).filter(f=>f.fitment_status==='published'&&f.product_variant_id!==r.product_variant_id&&cat.has(maps.products.get(f.product_variant_id)?.sku));
    if(otherPublished.length){result.keep=false;result.rule='multiple_live_products';result.reasons.push('同一application同位置仍发布其他刹车片，需要人工区分');}
    const old=histories.get(`${r.application_id}|${r.position}`)??[];
    return {review_id:`BSA-${r.application_id.slice(3)}-${r.position}-${sku}`,application_id:r.application_id,product_variant_id:r.product_variant_id,
      make:a.make,model:a.model,series:a.series,years:a.years,body:a.body,drive:a.drive,variant:a.variant,engine:a.engine,displacement_cc:a.displacementCc,
      position:r.position,sku,db,source:r.source,before_status:r.fitment_status,notes:r.notes,updated_at:r.updated_at,
      original_source_rows:(r.notes?.match(/source_rows=([^;]*)/)?.[1]??'').split(',').map(Number).filter(n=>n>0),
      popular_rank:a.popular?.rank??null,popular_group:a.popular?.label??'',history:old,
      ...result,after_status:result.keep?'published':'review',policy:ACTIVE_POLICY};
  });
  const desiredStatus=new Map(rows.map(r=>[key(r),r.after_status]));
  const afterFitments=data.fitments.map(r=>desiredStatus.has(key(r))?{...r,fitment_status:desiredStatus.get(key(r))}:r);
  const coverage=fits=>{
    const live=fits.filter(r=>r.fitment_status==='published'&&cat.has(maps.products.get(r.product_variant_id)?.sku));
    const covered=new Set(live.map(r=>r.application_id));
    const pop=applications.filter(a=>a.status==='active'&&a.popular);
    const all=applications.filter(a=>a.status==='active');
    const metric=(apps,yearFilter)=>{const total=apps.reduce((n,a)=>n+a.years.filter(yearFilter).length,0),hit=apps.filter(a=>covered.has(a.application_id)).reduce((n,a)=>n+a.years.filter(yearFilter).length,0);return {applications:apps.length,covered_applications:apps.filter(a=>covered.has(a.application_id)).length,application_years:total,covered_application_years:hit,rate:total?hit/total:null};};
    return {published_brake_fitments:live.length,all:metric(all,()=>true),popular_2000_2026:metric(pop,y=>y>=2000&&y<=2026)};
  };
  const historyOnly=[];
  for(const [ap,hs] of histories){if(rows.some(r=>`${r.application_id}|${r.position}`===ap))continue;const [id,pos]=ap.split('|');historyOnly.push({application_id:id,position:pos,history:hs,current:data.fitments.filter(r=>r.application_id===id&&r.position===pos).map(r=>({...r,sku:maps.products.get(r.product_variant_id)?.sku??''})),note:'历史覆盖位置当前已不在两个自动批次的published/review范围，未自动改动'});}
  return {policy:ACTIVE_POLICY,generated_at:new Date().toISOString(),snapshot_at:data.fetched_at,
    source_sha256:crypto.createHash('sha256').update(JSON.stringify(sourceRows)).digest('hex'),
    scope:SOURCES,mode:promoteReviewOnly?'promote_review_only':'full_reconciliation',counts:{audited:rows.length,published_before:rows.filter(r=>r.before_status==='published').length,
      retained_published:rows.filter(r=>r.keep&&r.before_status==='published').length,
      restored_to_published:rows.filter(r=>r.keep&&r.before_status==='review').length,
      total_published_after:rows.filter(r=>r.keep).length,
      provisional_published:rows.filter(r=>r.keep&&r.provisional).length,
      demoted_to_review:rows.filter(r=>!r.keep&&r.before_status==='published').length,
      already_review:rows.filter(r=>r.before_status==='review').length,
      review_total:rows.filter(r=>!r.keep).length,applications:new Set(rows.map(r=>r.application_id)).size,
      overridden_positions:new Set(rows.filter(r=>r.history.length).map(r=>`${r.application_id}|${r.position}`)).size,
      overridden_positions_retained:new Set(rows.filter(r=>r.history.length&&r.keep).map(r=>`${r.application_id}|${r.position}`)).size,
      overridden_positions_review:new Set(rows.filter(r=>r.history.length&&!r.keep).map(r=>`${r.application_id}|${r.position}`)).size,
      expansion_retained:rows.filter(r=>r.source===SOURCES[1]&&r.keep).length,expansion_review:rows.filter(r=>r.source===SOURCES[1]&&!r.keep).length},
    reasons:count(rows.filter(r=>!r.keep),r=>r.rule),rules:count(rows.filter(r=>r.keep),r=>r.rule),
    sources:count(rows,r=>r.source),before:coverage(data.fitments),projected_after:coverage(afterFitments),
    rows,history_only:historyOnly,sourceRows};
}

async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  if(process.argv.includes('--verify-only')){
    const applied=read(path.join(OUT,'applied.json')),audit=read(path.join(OUT,'audit.json')),db=client(),counts={};
    for(const status of ['published','review']){const {count,error}=await db.from('vehicle_catalog_product_fitments').select('*',{head:true,count:'exact'}).in('source',SOURCES).eq('fitment_status',status);if(error)throw error;counts[status]=count;}
    const live=await all(db,'vehicle_catalog_product_fitments','application_id'),liveMap=new Map(live.map(r=>[key(r),r]));
    const mismatches=audit.rows.filter(r=>liveMap.get(key(r))?.fitment_status!==r.after_status);
    if(mismatches.length)throw new Error(`Audited target statuses changed: ${mismatches.length}`);
    const auditedCounts=count(audit.rows,r=>liveMap.get(key(r))?.fitment_status??'missing');
    if((auditedCounts.review??0)!==applied.review_remaining||(auditedCounts.published??0)!==applied.retained_published)throw new Error(`Live audited count changed: ${JSON.stringify(auditedCounts)}`);
    console.log(JSON.stringify({policy:ACTIVE_POLICY,verified_audited_rows:audit.rows.length,verified_audited_statuses:auditedCounts,source_wide_statuses_including_other_categories:counts}));return;
  }
  const snapshotPath=path.join(OUT,'before-snapshot.json');
  let data;
  if(process.argv.includes('--cached')||process.argv.includes('--apply'))data=read(snapshotPath);
  else{data=await snapshot();fs.writeFileSync(snapshotPath,JSON.stringify(data));}
  if(!data.engineCodes){const db=client();[data.engineCodes,data.powertrainEngineCodes]=await Promise.all([all(db,'vehicle_catalog_engine_codes','engine_code_id'),all(db,'vehicle_catalog_powertrain_engine_codes','powertrain_id')]);fs.writeFileSync(snapshotPath,JSON.stringify(data));}
  const sourceRows=read('outputs/bendix-topstar-fitments-20261024/confirmation-data.json').sourceRows;
  const report=prepareAudit(data,sourceRows);
  fs.writeFileSync(path.join(OUT,'audit.json'),JSON.stringify(report));
  console.log(JSON.stringify({counts:report.counts,reasons:report.reasons,rules:report.rules,before:report.before,projected_after:report.projected_after,history_only:report.history_only.length},null,2));
  if(process.argv.includes('--apply'))await applyAudit(data,report);
}
async function snapshot(){
  const db=client();
  const specs=[['makes','vehicle_catalog_makes','make_id'],['models','vehicle_catalog_models','model_id'],['series','vehicle_catalog_series','series_id'],['variants','vehicle_catalog_variants','variant_id'],['engines','vehicle_catalog_powertrains','powertrain_id'],['applications','vehicle_catalog_applications','application_id'],['products','product_variants','id'],['fitments','vehicle_catalog_product_fitments','application_id'],['years','vehicle_catalog_application_years','application_id']];
  const result={fetched_at:new Date().toISOString()};
  await Promise.all(specs.map(async([name,table,id])=>{result[name]=await all(db,table,id);console.log(`${name}: ${result[name].length}`);}));
  return result;
}
async function applyAudit(data,report){
  const db=client();
  const targets=report.rows.filter(r=>r.after_status!==r.before_status);
  const current=await all(db,'vehicle_catalog_product_fitments','application_id');
  const currentMap=new Map(current.map(r=>[key(r),r]));
  if(fs.existsSync(path.join(OUT,'applied.json'))){
    if(report.rows.every(r=>{const live=currentMap.get(key(r));return live?.source===r.source&&live.fitment_status===r.after_status;})){
      console.log(JSON.stringify({already_applied:true,verified_targets:report.rows.length,policy:ACTIVE_POLICY}));return;
    }
    throw new Error('Saved audit was already applied and target state has since changed; create a fresh report before changing production.');
  }
  for(const r of report.rows){const live=currentMap.get(key(r));if(!live||live.source!==r.source||live.fitment_status!==r.before_status||live.notes!==r.notes||live.updated_at!==r.updated_at)throw new Error(`Preflight changed: ${key(r)}`);}
  const currentApps=await all(db,'vehicle_catalog_applications','application_id');
  const oldApps=new Map(data.applications.map(r=>[r.application_id,r]));
  const ids=new Set(report.rows.map(r=>r.application_id));
  for(const a of currentApps.filter(r=>ids.has(r.application_id)))if(JSON.stringify(a)!==JSON.stringify(oldApps.get(a.application_id)))throw new Error(`Application changed: ${a.application_id}`);
  for(const [name,table,id] of [['series','vehicle_catalog_series','series_id'],['variants','vehicle_catalog_variants','variant_id'],['engines','vehicle_catalog_powertrains','powertrain_id'],['years','vehicle_catalog_application_years','application_id'],['engineCodes','vehicle_catalog_engine_codes','engine_code_id'],['powertrainEngineCodes','vehicle_catalog_powertrain_engine_codes','powertrain_id']]){
    const digest=rows=>crypto.createHash('sha256').update(rows.map(r=>JSON.stringify(r)).sort().join('\n')).digest('hex');
    const live=await all(db,table,id);if(digest(live)!==digest(data[name]))throw new Error(`Evidence inputs changed: ${name}`);
  }
  const now=new Date().toISOString(),backup=path.resolve('tmp/production-backups',`brake-strict-audit-${now.replace(/[:.]/g,'-')}`);
  fs.mkdirSync(backup,{recursive:true});
  fs.writeFileSync(path.join(backup,'vehicle_catalog_product_fitments.json'),JSON.stringify(current));
  fs.copyFileSync(path.join(OUT,'before-snapshot.json'),path.join(backup,'before-snapshot.json'));
  fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({policy:ACTIVE_POLICY,created_at:now,target_count:targets.length,snapshot_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(OUT,'before-snapshot.json'))).digest('hex'),counts:report.counts},null,2));
  const payload=targets.map(r=>{const live=currentMap.get(key(r));return {...live,fitment_status:r.after_status,updated_at:now,
    notes:`${live.notes??''}; audit=${ACTIVE_POLICY}; audit_result=${r.after_status}; audit_reason=${r.rule}; provisional=${r.provisional?'true':'false'}`};});
  // Only existing, preflight-checked records; never restore an old rejected candidate.
  for(let i=0;i<payload.length;i+=150){const {error}=await db.from('vehicle_catalog_product_fitments').upsert(payload.slice(i,i+150),{onConflict:'application_id,product_variant_id,position'});if(error)throw error;console.log(`status ${Math.min(i+150,payload.length)}/${payload.length}`);}
  const after=await all(db,'vehicle_catalog_product_fitments','application_id');
  const afterMap=new Map(after.map(r=>[key(r),r])),changed=new Set(payload.map(key));
  if(after.length!==current.length)throw new Error('Unexpected fitment row creation/deletion');
  const desired=new Map(targets.map(r=>[key(r),r.after_status]));
  for(const old of current){const found=afterMap.get(key(old));if(changed.has(key(old))){if(found?.fitment_status!==desired.get(key(old))||found.source!==old.source||!found.notes.includes(ACTIVE_POLICY))throw new Error(`Readback failed ${key(old)}`);}else if(JSON.stringify(found)!==JSON.stringify(old))throw new Error(`Unrelated fitment changed ${key(old)}`);}
  const afterData={...data,fitments:after,verified_at:new Date().toISOString()};
  fs.writeFileSync(path.join(OUT,'after-snapshot.json'),JSON.stringify(afterData));
  const verify=prepareAudit(afterData,report.sourceRows);
  if(verify.counts.demoted_to_review!==0||verify.before.published_brake_fitments!==report.projected_after.published_brake_fitments)throw new Error('Post-apply reconciliation failed');
  const applied={policy:ACTIVE_POLICY,applied_at:now,backup,demoted:report.counts.demoted_to_review,restored:report.counts.restored_to_published,retained_published:report.counts.total_published_after,review_remaining:report.counts.review_total,verified_rows:after.length,remaining_unsafe_published:0,before:report.before,after:verify.before};
  fs.writeFileSync(path.join(OUT,'applied.json'),JSON.stringify(applied,null,2));console.log(JSON.stringify(applied,null,2));
}
function client(){for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^([^#=]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});}
async function all(db,table,id){
  const ordered=q=>{let r=q.order(id);if(table==='vehicle_catalog_product_fitments')r=r.order('product_variant_id').order('position');if(table==='vehicle_catalog_application_years')r=r.order('model_year');return r;};
  const first=await ordered(db.from(table).select('*',{count:'exact'})).range(0,999);if(first.error)throw first.error;
  const rows=[...first.data],pages=Math.ceil(first.count/1000);
  for(let from=1;from<pages;from+=6){const batch=await Promise.all(Array.from({length:Math.min(6,pages-from)},(_,i)=>ordered(db.from(table).select('*')).range((from+i)*1000,(from+i+1)*1000-1)));for(const b of batch){if(b.error)throw b.error;rows.push(...b.data);}}
  if(rows.length!==first.count)throw new Error(`Incomplete snapshot ${table}: ${rows.length}/${first.count}`);return rows;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
