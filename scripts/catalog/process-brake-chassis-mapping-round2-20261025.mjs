import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,snapshot,all,hash,unique} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';
import {augmentSources,assessReviewed} from './brake-alias-review-policy-20261025.mjs';

const POLICY='BRAKE_CHASSIS_MAPPING_ROUND2_20261025';
const RULE='TOPSTAR_MISFIELDED_CHASSIS_EXACT_CODE';
const OUT=path.resolve('outputs/brake-chassis-mapping-round2-20261025');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const put=(name,value)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));};
const relationKey=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const coreHash=d=>hash(Object.fromEntries(Object.entries(d).filter(([,v])=>Array.isArray(v))));
const group=(rows,fn)=>{const out=new Map();for(const r of rows){const k=fn(r);if(!out.has(k))out.set(k,[]);out.get(k).push(r);}return out;};
const catalog=read('data/brake-pads/catalog.json');
const originalMissing=read('outputs/brake-pad-unique-first-audit-20261024/audit.json').rows
  .filter(r=>!r.keep&&r.rule==='no_exact_platform'&&r.popular_rank&&r.years.some(y=>y>=2000&&y<=2026));

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

function buildPlan(d){
  const apps=new Map(enrich(d).map(a=>[a.application_id,a]));
  const sources=augmentSources(read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows,catalog);
  const sourceBy=new Map(sources.map(s=>[s.source_id,s]));
  const productsByDB=productIndex(d);
  const cases=new Map();
  for(const old of originalMissing){
    const a=apps.get(old.application_id);
    if(!a||a.status!=='active')continue;
    const k=`${old.application_id}|${old.position}`;
    if(!cases.has(k))cases.set(k,old);
  }
  const audits=[],publishes=[];
  for(const old of cases.values()){
    const a=apps.get(old.application_id);
    const result=assessReviewed(a,old.position,sources,productsByDB);
    const recovered=result.source_ids.map(id=>sourceBy.get(id)).filter(s=>s?.source_field==='engine_misfielded_chassis');
    const current=a.existing.filter(r=>r.position===old.position&&r.fitment_status==='review'&&r.db===result.proposed_db);
    const ready=result.status==='ready'&&recovered.length>0&&current.length===1&&result.proposed_db===old.db;
    audits.push({...result,old_db:old.db,recovered_source_ids:recovered.map(s=>s.source_id),selected_for_publish:ready});
    if(ready){
      const relation=current[0];
      publishes.push({application_id:a.application_id,product_variant_id:relation.product_variant_id,position:old.position,
        sku:relation.sku,db:relation.db,series:a.series,years:a.all_years,source_ids:recovered.map(s=>s.source_id),
        source_file:recovered[0].source_file,source_field:recovered[0].source_field,before:d.fitments.find(r=>relationKey(r)===relationKey(relation))});
    }
  }
  assert.equal(publishes.length,new Set(publishes.map(relationKey)).size,'duplicate publication target');
  assert(publishes.every(r=>r.before?.fitment_status==='review'),'all targets must still be review');
  const projection={...d,fitments:d.fitments.map(r=>publishes.some(t=>relationKey(t)===relationKey(r))?{...r,fitment_status:'published'}:r)};
  const unresolved=audits.filter(r=>r.status==='review_no_platform');
  const unresolvedGroups=[...group(unresolved,r=>`${r.make}|${r.model}|${r.series}`)].map(([key,rows])=>({key,make:rows[0].make,model:rows[0].model,
    series:rows[0].series,positions:unique(rows.map(r=>r.position)),applications:unique(rows.map(r=>r.application_id)).length,
    relations:rows.length,years:unique(rows.flatMap(r=>r.years)).sort((a,b)=>a-b),saved_db:unique(rows.map(r=>r.old_db))}))
    .sort((a,b)=>b.relations-a.relations||a.key.localeCompare(b.key));
  const before=coverage(d),after=coverage(projection);
  return {policy:POLICY,rule:RULE,created_at:new Date().toISOString(),snapshot_at:d.completed_at,snapshot_hash:coreHash(d),
    scope:'Original Popular50 no_exact_platform relations, 2000-2026; exact code-shaped Topstar chassis values misplaced in engine field only',
    counts:{original_missing_relations:originalMissing.length,active_position_cases:cases.size,publish_relations:publishes.length,
      publish_applications:unique(publishes.map(r=>r.application_id)).length,remaining_no_platform_positions:unresolved.length,
      remaining_no_platform_groups:unresolvedGroups.length},before,projected:after,
    gains:{any_application_years:after.covered_application_years-before.covered_application_years,
      front_application_years:after.front.covered_application_years-before.front.covered_application_years,
      rear_application_years:after.rear.covered_application_years-before.rear.covered_application_years},
    publishes,audits,unresolved_groups:unresolvedGroups};
}

async function makeReport(){
  const d=await snapshot(client());
  put('before-snapshot.json',d);
  const plan=buildPlan(d);put('plan.json',plan);
  console.log(JSON.stringify({counts:plan.counts,gains:plan.gains,before:{any:plan.before.application_year_rate,front:plan.before.front.application_year_rate,rear:plan.before.rear.application_year_rate},
    projected:{any:plan.projected.application_year_rate,front:plan.projected.front.application_year_rate,rear:plan.projected.rear.application_year_rate},
    targets:plan.publishes.map(r=>({application_id:r.application_id,series:r.series,position:r.position,sku:r.sku,db:r.db,years:r.years})),top_remaining:plan.unresolved_groups.slice(0,20)},null,2));
}

async function apply(){
  assert(fs.existsSync(path.join(OUT,'plan.json'))&&fs.existsSync(path.join(OUT,'before-snapshot.json')),'run report first');
  assert(!fs.existsSync(path.join(OUT,'applied.json')),'already applied');
  const plan=read(path.join(OUT,'plan.json')),before=read(path.join(OUT,'before-snapshot.json')),db=client();
  assert.equal(plan.snapshot_hash,coreHash(before),'saved snapshot changed');
  const live=await snapshot(db);
  assert.equal(coreHash(live),coreHash(before),'production changed since report; rebuild plan');
  const stamp=new Date().toISOString();
  const backup=path.resolve('tmp/production-backups',`brake-chassis-mapping-round2-${stamp.replace(/[:.]/g,'-')}`);
  fs.mkdirSync(backup,{recursive:true});
  fs.writeFileSync(path.join(backup,'core-snapshot.json'),JSON.stringify(live));
  fs.writeFileSync(path.join(backup,'plan.json'),JSON.stringify(plan,null,2));
  const journal={policy:POLICY,rule:RULE,started_at:stamp,backup,updated:[]};put('apply-progress.json',journal);
  for(const t of plan.publishes){
    const addition=`${POLICY}; mapping_rule=${RULE}; source_ids=${t.source_ids.join(',')}; source_field=${t.source_field}`;
    const payload={fitment_status:'published',notes:[t.before.notes,addition].filter(Boolean).join('; '),updated_at:stamp};
    const q=await db.from('vehicle_catalog_product_fitments').update(payload)
      .eq('application_id',t.application_id).eq('product_variant_id',t.product_variant_id).eq('position',t.position)
      .eq('fitment_status','review').eq('updated_at',t.before.updated_at).select('*');
    if(q.error)throw q.error;
    assert.equal(q.data.length,1,`concurrent fitment change ${relationKey(t)}`);
    journal.updated.push(relationKey(t));put('apply-progress.json',journal);
  }
  const afterFitments=await all(db,'vehicle_catalog_product_fitments','application_id');
  const targetKeys=new Set(plan.publishes.map(relationKey));
  for(const t of plan.publishes){
    const row=afterFitments.find(r=>relationKey(r)===relationKey(t));
    assert(row&&row.fitment_status==='published'&&row.notes.includes(POLICY),`readback failed ${relationKey(t)}`);
  }
  const untouchedBefore=before.fitments.filter(r=>!targetKeys.has(relationKey(r)));
  const untouchedAfter=afterFitments.filter(r=>!targetKeys.has(relationKey(r)));
  assert.equal(hash(untouchedAfter),hash(untouchedBefore),'non-target fitments changed during apply');
  const after={...before,fitments:afterFitments,verified_at:new Date().toISOString()};put('after-snapshot.json',after);
  const result={...journal,completed_at:after.verified_at,verified:true,before:coverage(before),after:coverage(after)};
  put('applied.json',result);
  console.log(JSON.stringify({verified:true,updated:journal.updated.length,backup,before:{any:result.before.application_year_rate,front:result.before.front.application_year_rate},after:{any:result.after.application_year_rate,front:result.after.front.application_year_rate}},null,2));
}

if(process.argv.includes('--apply'))await apply();else await makeReport();
