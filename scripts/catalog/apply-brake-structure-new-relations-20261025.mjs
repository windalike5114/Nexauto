import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,snapshot,all,hash,unique} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';
import {augmentSources,assessReviewed} from './brake-alias-review-policy-20261025.mjs';
import {family} from './brake-popular50-script-first-policy.mjs';

const POLICY='BRAKE_STRUCTURE_UNIQUE_NEW_RELATIONS_20261025';
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice('--out='.length);
const OUT=path.resolve(outArg||'outputs/brake-structure-all-models-20261025');
const INPUT=path.join(OUT,'ready-missing-relations.jsonl');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const readJsonl=p=>fs.readFileSync(p,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const put=(name,value)=>fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));
const key=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k=>[k,r[k]])))).sort());
const catalog=read('data/brake-pads/catalog.json');

function productIndex(d){
  const out=new Map();
  for(const c of catalog)for(const p of d.products.filter(p=>p.sku===c.sku&&p.active!==false))
    for(const position of ['front','rear'].filter(pos=>c.position.toLowerCase().includes(pos))){
      const k=`${c.supplierRef}|${position}`;
      if(!out.has(k))out.set(k,[]);
      out.get(k).push({sku:c.sku,id:p.id});
    }
  return out;
}

function allCoverage(d){
  const apps=enrich(d).filter(a=>a.status==='active'&&a.years.length);
  const calc=position=>{const hit=a=>a.published.some(r=>!position||r.position===position),den=apps.reduce((n,a)=>n+a.years.length,0),num=apps.filter(hit).reduce((n,a)=>n+a.years.length,0);
    return {applications:apps.length,covered_applications:apps.filter(hit).length,application_years:den,covered_application_years:num,rate:den?num/den:null};};
  return {...calc(),front:calc('front'),rear:calc('rear')};
}

assert(fs.existsSync(INPUT),'run all-model read-only audit first');
assert(!fs.existsSync(path.join(OUT,'applied-new-relations.json')),'new-relation repair already applied');
const candidates=readJsonl(INPUT);
const summary=read(path.join(OUT,'summary.json'));
assert.equal(candidates.length,summary.counts.ready_missing_relations,'candidate count changed; re-audit before apply');
assert.equal(candidates.length,new Set(candidates.map(key)).size,'duplicate candidate key');
assert.equal(candidates.length,new Set(candidates.map(r=>`${r.application_id}|${r.position}`)).size,'multiple candidates for one application position');

const db=client(),live=await snapshot(db),apps=new Map(enrich(live).map(a=>[a.application_id,a]));
const sources=augmentSources(read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows,catalog);
const sourcesByFamily=Map.groupBy(sources,s=>s.family),productsByDB=productIndex(live),productById=new Map(live.products.map(p=>[p.id,p]));
for(const c of candidates){
  const a=apps.get(c.application_id);assert(a&&a.status==='active',`inactive/missing application ${c.application_id}`);
  const p=productById.get(c.product_variant_id);assert(p?.active!==false&&/^NBP\d+$/.test(p?.sku??''),`inactive/non-brake product ${key(c)}`);
  assert(!live.fitments.some(r=>key(r)===key(c)),`relationship now exists ${key(c)}`);
  assert(!a.existing.some(r=>r.position===c.position&&r.fitment_status==='published'),`published conflict ${key(c)}`);
  const result=assessReviewed(a,c.position,sourcesByFamily.get(family(a.make,a.model))??[],productsByDB);
  assert.equal(result.status,'ready',`candidate no longer ready ${key(c)}: ${result.status}`);
  assert.equal(result.proposed_db,c.proposed_db,`DB changed ${key(c)}`);
  assert.equal(result.product_variant_id,c.product_variant_id,`product changed ${key(c)}`);
}

const stamp=new Date().toISOString(),backup=path.resolve('tmp/production-backups',`brake-structure-new-relations-${stamp.replace(/[:.]/g,'-')}`);
fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'core-snapshot.json'),JSON.stringify(live));fs.copyFileSync(INPUT,path.join(backup,'ready-missing-relations.jsonl'));
const payload=candidates.map(c=>({application_id:c.application_id,product_variant_id:c.product_variant_id,position:c.position,fitment_status:'published',source:POLICY,
  notes:[`db=${c.proposed_db}`,`category=${c.category}`,`source_ids=${c.source_ids.join(',')}`,`rules=${c.rule_ids.join(',')}`,`evidence=${c.evidence_urls.join(',')}`,'publication=full_application_years_unique_no_conflict'].join('; '),created_at:stamp,updated_at:stamp}));
put('new-relations-plan.json',{policy:POLICY,created_at:stamp,count:payload.length,applications:unique(payload.map(r=>r.application_id)).length,payload});
const inserted=await db.from('vehicle_catalog_product_fitments').insert(payload).select('*');
if(inserted.error)throw inserted.error;
assert.equal(inserted.data.length,payload.length,'insert count mismatch');
const afterFitments=await all(db,'vehicle_catalog_product_fitments','application_id'),targetKeys=new Set(payload.map(key));
for(const row of payload){const found=afterFitments.find(r=>key(r)===key(row));assert(found?.fitment_status==='published'&&found.source===POLICY,`readback failed ${key(row)}`);}
assert.equal(sortedHash(afterFitments.filter(r=>!targetKeys.has(key(r)))),sortedHash(live.fitments),'non-target fitments changed during insert');
const brakeIds=new Set(live.products.filter(p=>/^NBP\d+$/.test(p.sku??'')).map(p=>p.id));
const targetPositions=new Map(payload.map(r=>[`${r.application_id}|${r.position}`,r.product_variant_id]));
const conflicts=afterFitments.filter(r=>r.fitment_status==='published'&&brakeIds.has(r.product_variant_id)&&targetPositions.has(`${r.application_id}|${r.position}`)&&targetPositions.get(`${r.application_id}|${r.position}`)!==r.product_variant_id);
assert.equal(conflicts.length,0,'post-insert published conflicts');
const after={...live,fitments:afterFitments,verified_at:new Date().toISOString()},beforePopular=coverage(live),afterPopular=coverage(after);
const result={policy:POLICY,created_at:stamp,completed_at:after.verified_at,verified:true,backup,inserted:payload.length,applications:unique(payload.map(r=>r.application_id)).length,
  by_category:Object.fromEntries([...Map.groupBy(candidates,r=>r.category)].map(([k,v])=>[k,v.length])),
  all_models:{before:allCoverage(live),after:allCoverage(after)},popular50:{before:beforePopular,after:afterPopular}};
put('applied-new-relations.json',result);put('after-new-relations-snapshot.json',after);
console.log(JSON.stringify({verified:true,inserted:result.inserted,applications:result.applications,by_category:result.by_category,backup,
  all_models:{before:result.all_models.before.rate,after:result.all_models.after.rate},popular50:{before:result.popular50.before.application_year_rate,after:result.popular50.after.application_year_rate}},null,2));
