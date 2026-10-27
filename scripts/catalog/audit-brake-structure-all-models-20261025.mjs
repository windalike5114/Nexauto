// Read-only whole-catalog evaluation. It deliberately does not mutate Supabase.
import fs from 'node:fs';
import path from 'node:path';
import {client,snapshot,unique} from './review-brake-alias-groups-20261025.mjs';
import {enrich} from './process-brake-alias-review-20261025.mjs';
import {augmentSources,assessReviewed} from './brake-alias-review-policy-20261025.mjs';
import {family} from './brake-popular50-script-first-policy.mjs';

const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice('--out='.length);
const OUT=path.resolve(outArg||'outputs/brake-structure-all-models-20261025');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const catalog=read('data/brake-pads/catalog.json');
const relationKey=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const put=(name,value)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));};
const jsonl=(name,rows)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),rows.map(r=>JSON.stringify(r)).join('\n')+(rows.length?'\n':''));};

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

function metric(d,apps){
  const calc=position=>{
    const hit=a=>a.published.some(r=>!position||r.position===position);
    const applicationYears=apps.reduce((n,a)=>n+a.years.length,0);
    const coveredApplicationYears=apps.filter(hit).reduce((n,a)=>n+a.years.length,0);
    return {applications:apps.length,covered_applications:apps.filter(hit).length,application_years:applicationYears,
      covered_application_years:coveredApplicationYears,rate:applicationYears?coveredApplicationYears/applicationYears:null};
  };
  return {...calc(),front:calc('front'),rear:calc('rear')};
}

function project(d,updates,creates){
  const updateKeys=new Set(updates.map(relationKey));
  return {...d,fitments:[...d.fitments.map(r=>updateKeys.has(relationKey(r))?{...r,fitment_status:'published'}:r),
    ...creates.map(r=>({application_id:r.application_id,product_variant_id:r.product_variant_id,position:r.position,fitment_status:'published'}))]};
}

const d=await snapshot(client());
const apps=enrich(d).filter(a=>a.status==='active'&&a.years.length);
const sources=augmentSources(read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows,catalog);
const sourceByFamily=Map.groupBy(sources,s=>s.family);
const sourceById=new Map(sources.map(s=>[s.source_id,s]));
const productsByDB=productIndex(d);
const audits=[],restores=[],creates=[];

for(const a of apps){
  const local=sourceByFamily.get(family(a.make,a.model))??[];
  if(!local.length)continue;
  for(const position of ['front','rear']){
    const hasPublished=a.existing.some(r=>r.position===position&&r.fitment_status==='published');
    const review=a.existing.filter(r=>r.position===position&&r.fitment_status==='review');
    if(hasPublished&&!review.length)continue;
    const result=assessReviewed(a,position,local,productsByDB);
    if(result.status==='review_no_platform'&&!review.length)continue;
    const selectedSources=result.source_ids.map(id=>sourceById.get(id)).filter(Boolean);
    const category=selectedSources.some(s=>s.source_field==='engine_misfielded_chassis')?'misfielded_chassis'
      :selectedSources.some(s=>s.rule_id)?'verified_chassis_alias'
      :selectedSources.some(s=>s.tokens?.includes(a.series))?'exact_chassis'
      :'model_config_unique';
    const base={application_id:a.application_id,make:a.make,model:a.model,series:a.series,body:a.body,drive:a.drive,
      engine:a.engine,engine_codes:a.engine_codes,years:a.all_years,position,status:result.status,reason:result.reason,
      proposed_db:result.proposed_db,product_variant_id:result.product_variant_id,sku:result.sku,source_ids:result.source_ids,
      rule_ids:result.rule_ids,evidence_urls:result.evidence_urls,category,review_db:unique(review.map(r=>r.db))};
    audits.push(base);
    if(result.status!=='ready'||hasPublished)continue;
    const same=review.filter(r=>r.db===result.proposed_db&&r.product_variant_id===result.product_variant_id);
    if(same.length===1)restores.push({...base,before:d.fitments.find(r=>relationKey(r)===relationKey(same[0]))});
    else if(review.length===0)creates.push(base);
  }
}

const dedupe=rows=>[...new Map(rows.map(r=>[`${r.application_id}|${r.product_variant_id}|${r.position}`,r])).values()];
const safeRestores=dedupe(restores),safeCreates=dedupe(creates);
const projectedRestores=project(d,safeRestores,[]),projectedAll=project(d,safeRestores,safeCreates);
const beforeApps=enrich(d).filter(a=>a.status==='active'&&a.years.length);
const restoresApps=enrich(projectedRestores).filter(a=>a.status==='active'&&a.years.length);
const allApps=enrich(projectedAll).filter(a=>a.status==='active'&&a.years.length);
const byCategory=rows=>Object.fromEntries([...Map.groupBy(rows,r=>r.category)].map(([k,v])=>[k,{relations:v.length,applications:unique(v.map(r=>r.application_id)).length}]));
const reviewGroups=[...Map.groupBy(audits.filter(r=>r.status!=='ready'),r=>`${r.make}|${r.model}|${r.series}|${r.position}|${r.status}`)]
  .map(([key,rows])=>({key,make:rows[0].make,model:rows[0].model,series:rows[0].series,position:rows[0].position,status:rows[0].status,
    applications:unique(rows.map(r=>r.application_id)).length,years:unique(rows.flatMap(r=>r.years)).sort((a,b)=>a-b),candidate_db:unique(rows.map(r=>r.proposed_db).filter(Boolean)),review_db:unique(rows.flatMap(r=>r.review_db))}))
  .sort((a,b)=>b.applications-a.applications||a.key.localeCompare(b.key));
const summary={policy:'BRAKE_STRUCTURE_ALL_MODELS_READONLY_20261025',created_at:new Date().toISOString(),scope:'All active NexAuto applications with model years 2000-2026; full application ranges validated; no database writes',
  counts:{active_applications:apps.length,audited_positions:audits.length,ready_existing_review_relations:safeRestores.length,
    ready_existing_review_applications:unique(safeRestores.map(r=>r.application_id)).length,ready_missing_relations:safeCreates.length,
    ready_missing_relation_applications:unique(safeCreates.map(r=>r.application_id)).length,remaining_review_groups:reviewGroups.length},
  ready_existing_by_category:byCategory(safeRestores),ready_missing_by_category:byCategory(safeCreates),
  coverage:{before:metric(d,beforeApps),projected_existing_review_only:metric(projectedRestores,restoresApps),projected_including_new_relations:metric(projectedAll,allApps)},
  safeguards:['read-only evaluation','application full year range checked','front/rear position checked separately','multiple DB candidates remain review','published conflicts are not overwritten']};
put('summary.json',summary);jsonl('ready-existing-review.jsonl',safeRestores);jsonl('ready-missing-relations.jsonl',safeCreates);jsonl('all-audits.jsonl',audits);put('remaining-review-groups.json',reviewGroups);
console.log(JSON.stringify(summary,null,2));
