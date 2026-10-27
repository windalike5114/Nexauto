import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {OUT,read,put,group,unique,hash,client,all,snapshot} from './review-brake-alias-groups-20261025.mjs';
import {POLICY,EVIDENCE,augmentSources,assessReviewed,identityCorrection} from './brake-alias-review-policy-20261025.mjs';
import {REQUESTED_POPULAR_VEHICLE_GROUPS,buildPopularAliasIndex} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
const key=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const wkey=r=>`${r.application_id}|${r.wiper_configuration_id}`;
const pkey=r=>`${r.application_id}|${r.source_group}|${r.source_url}`;
const canonical=r=>Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]]));
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(canonical(r))).sort());
const catalog=read('data/brake-pads/catalog.json');
const catBy=new Map(catalog.map(r=>[r.sku,r]));
const popular=buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
export function enrich(d){
 const by=(rows,id)=>new Map(rows.map(r=>[r[id],r]));
 const makes=by(d.makes,'make_id'),models=by(d.models,'model_id'),series=by(d.series,'series_id'),variants=by(d.variants,'variant_id'),engines=by(d.engines,'powertrain_id'),products=by(d.products,'id'),codes=by(d.engineCodes,'engine_code_id');
 const ys=group(d.years,r=>r.application_id),links=group(d.powertrainEngineCodes,r=>r.powertrain_id),fits=group(d.fitments,r=>r.application_id);
 return d.applications.map(a=>{const m=models.get(a.model_id),mk=makes.get(m?.make_id),s=series.get(a.series_id),v=variants.get(a.variant_id),e=engines.get(a.powertrain_id);
  const all_years=unique((ys.get(a.application_id)??[]).map(r=>Number(r.model_year))).sort((a,b)=>a-b);
  const existing=(fits.get(a.application_id)??[]).map(r=>({...r,sku:products.get(r.product_variant_id)?.sku,db:catBy.get(products.get(r.product_variant_id)?.sku)?.supplierRef})).filter(r=>/^NBP\d+$/.test(r.sku??'')&&['front','rear'].includes(r.position));
  const g=popular.get(canonicalModelKey(mk?.name??'',m?.name??''));
  return {...a,make:mk?.name??'',model:m?.name??'',series:s?.code??'',body:v?.body_style??'',drive:v?.drive_type??'',variant:v?.display_name??'',engine:e?.display_name??'',
   engine_codes:(links.get(a.powertrain_id)??[]).map(l=>codes.get(l.engine_code_id)?.code).filter(Boolean),displacement_cc:e?.displacement_cc,
   all_years,years:all_years.filter(y=>y>=2000&&y<=2026),rank:g?.rank??null,group:g?.label??'',existing,published:existing.filter(r=>r.fitment_status==='published')};});
}
export function coverage(d,fixedIDs=null){
 const apps=enrich(d).filter(a=>a.status==='active'&&a.years.length&&(fixedIDs?fixedIDs.has(a.application_id):a.rank));
 const metric=position=>{const hit=a=>a.published.some(r=>!position||r.position===position),den=apps.reduce((n,a)=>n+a.years.length,0),num=apps.filter(hit).reduce((n,a)=>n+a.years.length,0);
  return {applications:apps.length,covered_applications:apps.filter(hit).length,application_years:den,covered_application_years:num,application_year_rate:den?num/den:null,application_rate:apps.length?apps.filter(hit).length/apps.length:null};};
 const modelyears=group(apps.flatMap(a=>a.years.map(y=>({a,y}))),r=>`${r.a.group}|${r.y}`);
 return {...metric(),front:metric('front'),rear:metric('rear'),model_years:modelyears.size,model_year_any:[...modelyears.values()].filter(rr=>rr.some(r=>r.a.published.length)).length,model_year_full:[...modelyears.values()].filter(rr=>rr.every(r=>r.a.published.length)).length,
  per_group:REQUESTED_POPULAR_VEHICLE_GROUPS.map(g=>{const aa=apps.filter(a=>a.rank===g.rank),n=aa.reduce((n,a)=>n+a.years.length,0),h=aa.filter(a=>a.published.length).reduce((n,a)=>n+a.years.length,0);return {rank:g.rank,group:g.label,applications:aa.length,covered_applications:aa.filter(a=>a.published.length).length,application_years:n,covered_application_years:h,rate:n?h/n:null};})};
}
export function plan(d){
 const apps=enrich(d),rawApps=new Map(d.applications.map(a=>[a.application_id,a])),sources=augmentSources(read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows,catalog),productsByDB=new Map();
 for(const c of catalog)for(const p of d.products.filter(p=>p.sku===c.sku&&p.active!==false))for(const pos of ['front','rear'].filter(pos=>c.position.toLowerCase().includes(pos))){const k=`${c.supplierRef}|${pos}`;if(!productsByDB.has(k))productsByDB.set(k,[]);productsByDB.get(k).push({sku:c.sku,id:p.id});}
 const knownCases=new Map(fs.readFileSync('outputs/brake-popular50-script-first-20261024/deliverable/all-position-audit.jsonl','utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).map(r=>[r.case_id,r]));
 const audits=[],restores=[],corrections=[],correctionPending=[];
 for(const a of apps.filter(a=>a.status==='active'&&a.all_years.length)){
  const correction=identityCorrection(a);
  if(correction){const oldModel=d.models.find(m=>m.model_id===a.model_id),targetModel=d.models.find(m=>m.make_id===oldModel.make_id&&m.name===correction.model&&m.status==='active'),s=d.series.find(s=>s.series_id===a.series_id);
   const targetSeries=targetModel&&s?d.series.find(t=>t.model_id===targetModel.model_id&&t.normalized_code===s.normalized_code):null;
   if(!targetModel||(s&&!targetSeries)){correctionPending.push({application_id:a.application_id,make:a.make,old_model:a.model,new_model:correction.model,series:a.series,reason:!targetModel?'target_model_missing':'target_series_missing'});continue;}
   const ck=[targetModel.model_id,targetSeries?.series_id??'',a.variant_id,a.powertrain_id,a.year_from,a.year_to].join('|');
   const peer=d.applications.filter(p=>p.canonical_key===ck&&p.status==='active');
   if(peer.length!==1){correctionPending.push({application_id:a.application_id,make:a.make,old_model:a.model,new_model:correction.model,series:a.series,reason:`canonical_peer_count_${peer.length}`});continue;}
   const target=peer[0],targetYears=apps.find(p=>p.application_id===target.application_id).all_years;
   const mismatches=['variant_id','powertrain_id','year_from','year_to','year_status'].filter(field=>a[field]!==target[field]);
   if(JSON.stringify(a.all_years)!==JSON.stringify(targetYears)||mismatches.length){correctionPending.push({application_id:a.application_id,target_id:target.application_id,make:a.make,old_model:a.model,new_model:correction.model,series:a.series,reason:'canonical_peer_fields_differ',mismatches});continue;}
   corrections.push({source_id:a.application_id,target_id:target.application_id,make:a.make,old_model:a.model,new_model:correction.model,series:a.series,years:a.all_years,rule_id:correction.rule_id,evidence_urls:correction.evidence.map(k=>EVIDENCE[k].url),before:rawApps.get(a.application_id)});
  }
  if(!a.rank||!a.years.length)continue;
  for(const position of ['front','rear']){
   if(!a.existing.some(r=>r.position===position&&r.fitment_status==='review'))continue;
   const result=assessReviewed(a,position,sources,productsByDB),known=knownCases.get(result.case_id);
   if(known?.identity_flags.length&&!result.rule_ids.includes('FOCUS_II_VERIFIED_FRONT')){result.status='review_identity_risk';result.reason='已有车型身份/市场版本风险提示，未经本轮证实不能恢复';result.action='none';result.identity_flags=known.identity_flags;}
   const same=a.existing.filter(r=>r.position===position&&r.fitment_status==='review'&&r.db===result.proposed_db);
   if(result.status==='ready'&&same.length===1){
    const old=same[0];assert.equal(old.product_variant_id,result.product_variant_id);
    restores.push({application_id:a.application_id,product_variant_id:old.product_variant_id,position,sku:old.sku,db:old.db,rule_ids:result.rule_ids.length?result.rule_ids:['EXISTING_SOURCE_EXACT_CHASSIS_UNIQUE'],source_ids:result.source_ids,evidence_urls:result.evidence_urls,before:d.fitments.find(r=>key(r)===key(old))});
   }
   audits.push({...result,review_db:unique(a.existing.filter(r=>r.position===position&&r.fitment_status==='review').map(r=>r.db)),review_sku:unique(a.existing.filter(r=>r.position===position&&r.fitment_status==='review').map(r=>r.sku))});
  }
 }
 assert.equal(restores.length,new Set(restores.map(key)).size);
 const projection={...d,fitments:d.fitments.map(r=>restores.some(t=>key(r)===key(t))?{...r,fitment_status:'published'}:r)};
 const result={policy:POLICY,created_at:new Date().toISOString(),snapshot_at:d.completed_at,snapshot_hash:hash(d),catalog_hash:hash(catalog),scope:'All active applications for proven identity corrections; Popular50 / 2000–2026 for pending brake publication',counts:{restore_relations:restores.length,restore_applications:unique(restores.map(r=>r.application_id)).length,identity_merges:corrections.length,identity_pending:correctionPending.length,review_positions:audits.length},before:coverage(d),projected_publication_only:coverage(projection),restores,corrections,correction_pending:correctionPending,audits,evidence:EVIDENCE};
 put('plan.json',result);
 console.log(JSON.stringify({counts:result.counts,before:result.before.application_year_rate,publication_projection:result.projected_publication_only.application_year_rate,restores_by_rule:Object.fromEntries([...group(restores,r=>r.rule_ids.join('+'))].map(([k,v])=>[k,v.length])),corrections:corrections.map(r=>[r.make,r.old_model,r.new_model,r.series])},null,2));
 return result;
}
export async function inChunks(db,table,field,ids){const out=[];for(let i=0;i<ids.length;i+=80){const r=await db.from(table).select('*').in(field,ids.slice(i,i+80));if(r.error)throw r.error;out.push(...r.data);}return out;}
async function apply(){
 const saved=read(path.join(OUT,'plan.json')),before=read(path.join(OUT,'before-snapshot.json')),db=client();
 assert.equal(saved.snapshot_hash,hash(before));assert.equal(saved.catalog_hash,hash(catalog));
 assert(!fs.existsSync(path.join(OUT,'applied.json'))&&!fs.existsSync(path.join(OUT,'apply-progress.json')),'Apply already started: use the read-only verification script, do not repeat mutations');
 const live=await snapshot(db);
 for(const name of Object.keys(before).filter(k=>Array.isArray(before[k])))assert.equal(sortedHash(live[name]),sortedHash(before[name]),`Production input changed: ${name}. Generate a fresh plan.`);
 const [wipers,provenance]=await Promise.all([all(db,'vehicle_catalog_wiper_fitments','application_id'),all(db,'vehicle_catalog_application_provenance','application_id')]);
 const ids=saved.corrections.map(r=>r.source_id),refs={};
 for(const [table,field] of [['customer_vehicles','vehicle_catalog_application_id'],['order_items','vehicle_catalog_application_id'],['order_vehicle_snapshots','vehicle_catalog_application_id'],['order_wiper_fulfillment','vehicle_catalog_application_id']]){refs[table]=await inChunks(db,table,field,ids);assert.equal(refs[table].length,0,`Existing customer/order references prevent automatic merge: ${table}`);}
 const backup=path.resolve('tmp/production-backups',`brake-alias-groups-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.mkdirSync(backup,{recursive:true});
 fs.writeFileSync(path.join(backup,'core-snapshot.json'),JSON.stringify(live));fs.writeFileSync(path.join(backup,'wipers.json'),JSON.stringify(wipers));fs.writeFileSync(path.join(backup,'provenance.json'),JSON.stringify(provenance));fs.writeFileSync(path.join(backup,'reference-checks.json'),JSON.stringify(refs));fs.copyFileSync(path.join(OUT,'plan.json'),path.join(backup,'plan.json'));
 const now=new Date().toISOString(),journal={policy:POLICY,backup,started_at:now,restored:[],merged:[],product_inserts:[],wiper_inserts:[],provenance_inserts:[]};
 fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({created_at:now,core_hash:hash(live),wipers_hash:hash(wipers),provenance_hash:hash(provenance),plan_hash:hash(saved)},null,2));put('apply-progress.json',journal);
 const fitRows=[...live.fitments],wiperRows=[...wipers],provRows=[...provenance],products=new Map(live.products.map(p=>[p.id,p]));
 const familyOfProduct=id=>String(products.get(id)?.sku??'').match(/^[A-Z]+/)?.[0]??`unknown:${id}`;
 for(const r of saved.restores){
  const addition=`${POLICY}; verified_group=${r.rule_ids.join(',')}; source_ids=${r.source_ids.join(',')}; evidence=${r.evidence_urls.join(',')}`;
  const payload={fitment_status:'published',notes:[r.before.notes,addition].filter(Boolean).join('; '),updated_at:now};
  const q=await db.from('vehicle_catalog_product_fitments').update(payload).eq('application_id',r.application_id).eq('product_variant_id',r.product_variant_id).eq('position',r.position).eq('fitment_status','review').eq('updated_at',r.before.updated_at).select('*');
  if(q.error)throw q.error;assert.equal(q.data.length,1,`Concurrent fitment change ${key(r)}`);fitRows[fitRows.findIndex(x=>key(x)===key(r))]=q.data[0];journal.restored.push(key(r));put('apply-progress.json',journal);
 }
 const insert=async(table,rows)=>{if(!rows.length)return;const q=await db.from(table).insert(rows);if(q.error)throw q.error;};
 for(const c of saved.corrections){
  const targetFits=fitRows.filter(r=>r.application_id===c.target_id),targetWipers=wiperRows.filter(r=>r.application_id===c.target_id);
  const pi=fitRows.filter(r=>r.application_id===c.source_id&&!targetFits.some(t=>t.product_variant_id===r.product_variant_id&&t.position===r.position)).map(r=>{
   const conflict=r.fitment_status==='published'&&targetFits.some(t=>t.fitment_status==='published'&&t.position===r.position&&familyOfProduct(t.product_variant_id)===familyOfProduct(r.product_variant_id)&&t.product_variant_id!==r.product_variant_id);
   return {...r,application_id:c.target_id,fitment_status:conflict?'review':r.fitment_status,notes:[r.notes,`${POLICY}; merged_from=${c.source_id}; identity_rule=${c.rule_id}${conflict?'; merge_conflict=review':''}`].filter(Boolean).join('; '),updated_at:now};});
  const wi=wiperRows.filter(r=>r.application_id===c.source_id&&!targetWipers.some(t=>t.wiper_configuration_id===r.wiper_configuration_id)).map(r=>{
   const conflict=r.fitment_status==='published'&&targetWipers.some(t=>t.fitment_status==='published'&&t.wiper_configuration_id!==r.wiper_configuration_id);
   return {...r,application_id:c.target_id,fitment_status:conflict?'review':r.fitment_status,notes:[r.notes,`${POLICY}; merged_from=${c.source_id}${conflict?'; merge_conflict=review':''}`].filter(Boolean).join('; '),updated_at:now};});
  const pr=provRows.filter(r=>r.application_id===c.source_id&&!provRows.some(t=>t.application_id===c.target_id&&t.source_group===r.source_group&&t.source_url===r.source_url)).map(r=>({...r,application_id:c.target_id}));
  await insert('vehicle_catalog_product_fitments',pi);fitRows.push(...pi);journal.product_inserts.push(...pi.map(key));
  await insert('vehicle_catalog_wiper_fitments',wi);wiperRows.push(...wi);journal.wiper_inserts.push(...wi.map(wkey));
  await insert('vehicle_catalog_application_provenance',pr);provRows.push(...pr);journal.provenance_inserts.push(...pr.map(pkey));
  const q=await db.from('vehicle_catalog_applications').update({status:'inactive',review_status:'approved'}).eq('application_id',c.source_id).eq('status','active').eq('canonical_key',c.before.canonical_key).select('*');
  if(q.error)throw q.error;assert.equal(q.data.length,1,`Concurrent application change ${c.source_id}`);journal.merged.push({source_id:c.source_id,target_id:c.target_id});put('apply-progress.json',journal);
 }
 const after={...live,fitments:await all(db,'vehicle_catalog_product_fitments','application_id'),applications:await all(db,'vehicle_catalog_applications','application_id'),verified_at:new Date().toISOString()};
 const afterWipers=await all(db,'vehicle_catalog_wiper_fitments','application_id'),afterProvenance=await all(db,'vehicle_catalog_application_provenance','application_id');
 assert.equal(sortedHash(after.fitments),sortedHash(fitRows),'Fitment readback differs from expected');
 assert.equal(sortedHash(afterWipers),sortedHash(wiperRows),'Wiper readback differs from expected');assert.equal(sortedHash(afterProvenance),sortedHash(provRows),'Provenance readback differs from expected');
 const expectedApps=live.applications.map(a=>ids.includes(a.application_id)?{...a,status:'inactive',review_status:'approved'}:a);
 assert.equal(sortedHash(after.applications),sortedHash(expectedApps),'Application readback differs from expected');
 // Ensure every former child is still represented on the canonical target; originals remain untouched.
 for(const c of saved.corrections){for(const r of live.fitments.filter(r=>r.application_id===c.source_id))assert(after.fitments.some(t=>t.application_id===c.target_id&&t.product_variant_id===r.product_variant_id&&t.position===r.position));for(const r of wipers.filter(r=>r.application_id===c.source_id))assert(afterWipers.some(t=>t.application_id===c.target_id&&t.wiper_configuration_id===r.wiper_configuration_id));}
 put('after-snapshot.json',after);put('after-wipers.json',afterWipers);put('after-provenance.json',afterProvenance);
 const result={...journal,completed_at:after.verified_at,verified:true,before:coverage(live),after:coverage(after),publication_only: saved.projected_publication_only,denominator_explanation:'车型纠错合并会移除重复application。publication_only在旧分母上单独计算发布提升；after使用纠错后的实际车型库。'};
 put('applied.json',result);console.log(JSON.stringify({restored:journal.restored.length,merged:journal.merged.length,product_inserts:journal.product_inserts.length,wiper_inserts:journal.wiper_inserts.length,before:result.before,after:result.after,backup},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 if(process.argv.includes('--apply'))await apply();else plan(read(path.join(OUT,'before-snapshot.json')));
}
