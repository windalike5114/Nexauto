// Read-only recovery/final verification. NEVER rerun the apply command to retry verification.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {OUT,read,put,client,all,hash} from './review-brake-alias-groups-20261025.mjs';
import {coverage} from './process-brake-alias-review-20261025.mjs';
import {POLICY} from './brake-alias-review-policy-20261025.mjs';
const saved=read(path.join(OUT,'plan.json')),journal=read(path.join(OUT,'apply-progress.json'));
const original=read(path.join(journal.backup,'core-snapshot.json')),oldWipers=read(path.join(journal.backup,'wipers.json')),oldProv=read(path.join(journal.backup,'provenance.json'));
assert.equal(journal.restored.length,saved.restores.length,'Apply did not finish restoring all targets');assert.equal(journal.merged.length,saved.corrections.length,'Apply did not finish all merges');
const key=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`,wkey=r=>`${r.application_id}|${r.wiper_configuration_id}`,pkey=r=>`${r.application_id}|${r.source_group}|${r.source_url}`;
const fitRows=structuredClone(original.fitments),wiperRows=structuredClone(oldWipers),provRows=structuredClone(oldProv),products=new Map(original.products.map(p=>[p.id,p]));
const productFamily=id=>String(products.get(id)?.sku??'').match(/^[A-Z]+/)?.[0]??`unknown:${id}`,now=journal.started_at;
for(const r of saved.restores){const i=fitRows.findIndex(x=>key(x)===key(r));assert(i>=0);
 const addition=`${POLICY}; verified_group=${r.rule_ids.join(',')}; source_ids=${r.source_ids.join(',')}; evidence=${r.evidence_urls.join(',')}`;
 fitRows[i]={...fitRows[i],fitment_status:'published',notes:[r.before.notes,addition].filter(Boolean).join('; '),updated_at:now};
}
for(const c of saved.corrections){
 const tf=fitRows.filter(r=>r.application_id===c.target_id),tw=wiperRows.filter(r=>r.application_id===c.target_id);
 const pi=fitRows.filter(r=>r.application_id===c.source_id&&!tf.some(t=>t.product_variant_id===r.product_variant_id&&t.position===r.position)).map(r=>{
  const conflict=r.fitment_status==='published'&&tf.some(t=>t.fitment_status==='published'&&t.position===r.position&&productFamily(t.product_variant_id)===productFamily(r.product_variant_id)&&t.product_variant_id!==r.product_variant_id);
  return {...r,application_id:c.target_id,fitment_status:conflict?'review':r.fitment_status,notes:[r.notes,`${POLICY}; merged_from=${c.source_id}; identity_rule=${c.rule_id}${conflict?'; merge_conflict=review':''}`].filter(Boolean).join('; '),updated_at:now};});
 const wi=wiperRows.filter(r=>r.application_id===c.source_id&&!tw.some(t=>t.wiper_configuration_id===r.wiper_configuration_id)).map(r=>{
  const conflict=r.fitment_status==='published'&&tw.some(t=>t.fitment_status==='published'&&t.wiper_configuration_id!==r.wiper_configuration_id);
  return {...r,application_id:c.target_id,fitment_status:conflict?'review':r.fitment_status,notes:[r.notes,`${POLICY}; merged_from=${c.source_id}${conflict?'; merge_conflict=review':''}`].filter(Boolean).join('; '),updated_at:now};});
 const pr=provRows.filter(r=>r.application_id===c.source_id&&!provRows.some(t=>t.application_id===c.target_id&&t.source_group===r.source_group&&t.source_url===r.source_url)).map(r=>({...r,application_id:c.target_id}));
 fitRows.push(...pi);wiperRows.push(...wi);provRows.push(...pr);
}
const originalFitKeys=new Set(original.fitments.map(key));
assert.deepEqual(new Set(fitRows.filter(r=>!originalFitKeys.has(key(r))).map(key)),new Set(journal.product_inserts));
const db=client();
const [fitments,applications,wipers,provenance]=await Promise.all([all(db,'vehicle_catalog_product_fitments','application_id'),all(db,'vehicle_catalog_applications','application_id'),all(db,'vehicle_catalog_wiper_fitments','application_id'),all(db,'vehicle_catalog_application_provenance','application_id')]);
const after={...original,fitments,applications,verified_at:new Date().toISOString()};
put('after-snapshot.json',after);put('after-wipers.json',wipers);put('after-provenance.json',provenance);
function normalized(r){return Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]]));}
function compare(name,expected,actual,k){
 const em=new Map(expected.map(r=>[k(r),r])),am=new Map(actual.map(r=>[k(r),r]));assert.equal(em.size,expected.length,`${name}: expected duplicate keys`);assert.equal(am.size,actual.length,`${name}: duplicate actual keys`);
 const changes=[];for(const [id,e]of em){const a=am.get(id);if(!a){changes.push({id,missing:true});continue;}const en=normalized(e),an=normalized(a);if(hash(en)!==hash(an))changes.push({id,fields:Object.keys({...en,...an}).filter(f=>JSON.stringify(en[f])!==JSON.stringify(an[f])).map(field=>({field,expected:e[field],actual:a[field]}))});}for(const id of am.keys())if(!em.has(id))changes.push({id,unexpected:true});
 put(`verification-${name}.json`,{expected:expected.length,actual:actual.length,changes});assert.equal(changes.length,0,`${name}: readback differs, inspect verification-${name}.json`);
 return {rows:actual.length,differences:changes.length};
}
const ids=new Set(saved.corrections.map(c=>c.source_id)),expectedApps=original.applications.map(a=>ids.has(a.application_id)?{...a,status:'inactive',review_status:'approved'}:a);
const checks={products:compare('products',fitRows,fitments,key),wipers:compare('wipers',wiperRows,wipers,wkey),provenance:compare('provenance',provRows,provenance,pkey),applications:compare('applications',expectedApps,applications,r=>r.application_id)};
const before=coverage(original),afterCoverage=coverage(after),publicationOnly=saved.projected_publication_only;
const result={...journal,completed_at:after.verified_at,verified:true,verification:checks,before,after:afterCoverage,publication_only:publicationOnly,
 denominator_explanation:'publication_only使用原始分母，只反映恢复发布。after使用纠错合并后的active车型库，单独列出去重影响。',timestamp_normalization:'PostgreSQL +00:00 与 JS Z 统一为同一UTC瞬间后比较；不忽略其他字段。'};
put('applied.json',result);
console.log(JSON.stringify({verified:true,restored:journal.restored.length,merged:journal.merged.length,before,after:afterCoverage,publication_only:{...publicationOnly,per_group:undefined},backup:journal.backup,verification:checks},null,2));
