import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,snapshot,all,hash,unique} from './review-brake-alias-groups-20261025.mjs';
import {enrich} from './process-brake-alias-review-20261025.mjs';

const POLICY='BRAKE_STRUCTURE_ALL_MODELS_EXISTING_REVIEW_20261025';
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice('--out='.length);
const OUT=path.resolve(outArg||'outputs/brake-structure-all-models-20261025');
const CANDIDATES=path.join(OUT,'ready-existing-review.jsonl');
const readJsonl=p=>fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const put=(name,value)=>fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));
const key=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])))).sort());
const metric=d=>{
  const apps=enrich(d).filter(a=>a.status==='active'&&a.years.length);
  const calc=position=>{const hit=a=>a.published.some(r=>!position||r.position===position),den=apps.reduce((n,a)=>n+a.years.length,0),num=apps.filter(hit).reduce((n,a)=>n+a.years.length,0);
    return {applications:apps.length,covered_applications:apps.filter(hit).length,application_years:den,covered_application_years:num,rate:den?num/den:null};};
  return {...calc(),front:calc('front'),rear:calc('rear')};
};

assert(fs.existsSync(CANDIDATES),'run the read-only all-model audit first');
assert(!fs.existsSync(path.join(OUT,'applied.json')),'all-model restore already applied');
const candidates=readJsonl(CANDIDATES);
const summary=JSON.parse(fs.readFileSync(path.join(OUT,'summary.json'),'utf8'));
assert.equal(candidates.length,summary.counts.ready_existing_review_relations,'candidate file count changed; re-audit before apply');
assert.equal(candidates.length,new Set(candidates.map(key)).size,'duplicate candidates');
const db=client(),live=await snapshot(db),liveApps=new Map(enrich(live).map(a=>[a.application_id,a]));
for(const c of candidates){
  const a=liveApps.get(c.application_id);assert(a&&a.status==='active',`inactive/missing application ${c.application_id}`);
  assert(!a.existing.some(r=>r.position===c.position&&r.fitment_status==='published'),`published conflict ${key(c)}`);
  const row=live.fitments.find(r=>key(r)===key(c));assert(row&&row.fitment_status==='review',`target not review ${key(c)}`);
  assert.equal(row.updated_at,c.before.updated_at,`target changed after audit ${key(c)}`);
}
const stamp=new Date().toISOString();
const backup=path.resolve('tmp/production-backups',`brake-structure-all-models-${stamp.replace(/[:.]/g,'-')}`);
fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'core-snapshot.json'),JSON.stringify(live));fs.copyFileSync(CANDIDATES,path.join(backup,'ready-existing-review.jsonl'));
const journal={policy:POLICY,started_at:stamp,backup,candidate_count:candidates.length,updated:[]};put('apply-progress.json',journal);
for(const c of candidates){
  const addition=`${POLICY}; category=${c.category}; source_ids=${c.source_ids.join(',')}; rules=${c.rule_ids.join(',')}; evidence=${c.evidence_urls.join(',')}`;
  const payload={fitment_status:'published',notes:[c.before.notes,addition].filter(Boolean).join('; '),updated_at:stamp};
  const q=await db.from('vehicle_catalog_product_fitments').update(payload)
    .eq('application_id',c.application_id).eq('product_variant_id',c.product_variant_id).eq('position',c.position)
    .eq('fitment_status','review').eq('updated_at',c.before.updated_at).select('*');
  if(q.error)throw q.error;assert.equal(q.data.length,1,`concurrent fitment change ${key(c)}`);
  journal.updated.push(key(c));if(journal.updated.length%20===0)put('apply-progress.json',journal);
}
put('apply-progress.json',journal);
const afterFitments=await all(db,'vehicle_catalog_product_fitments','application_id'),targetKeys=new Set(candidates.map(key));
for(const c of candidates){const row=afterFitments.find(r=>key(r)===key(c));assert(row&&row.fitment_status==='published'&&row.notes.includes(POLICY),`readback failed ${key(c)}`);}
assert.equal(sortedHash(afterFitments.filter(r=>!targetKeys.has(key(r)))),sortedHash(live.fitments.filter(r=>!targetKeys.has(key(r)))),'non-target fitments changed during apply');
const after={...live,fitments:afterFitments,verified_at:new Date().toISOString()};
const result={...journal,completed_at:after.verified_at,verified:true,applications:unique(candidates.map(r=>r.application_id)).length,
  by_category:Object.fromEntries([...Map.groupBy(candidates,r=>r.category)].map(([k,v])=>[k,v.length])),before:metric(live),after:metric(after)};
put('applied.json',result);put('after-snapshot.json',after);
console.log(JSON.stringify({verified:true,updated:result.updated.length,applications:result.applications,by_category:result.by_category,backup,
  before:{any:result.before.rate,front:result.before.front.rate,rear:result.before.rear.rate},after:{any:result.after.rate,front:result.after.front.rate,rear:result.after.rear.rate}},null,2));
