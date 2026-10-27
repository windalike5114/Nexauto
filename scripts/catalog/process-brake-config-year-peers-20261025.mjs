import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,all,hash,read} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';

const POLICY='BRAKE_EXACT_CONFIG_YEAR_PEER_V1_20261025';
const snapshotArg=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11)
  ??'outputs/brake-identity-reassign-no-peer-20261025/after-snapshot.json';
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice(6)
  ??'outputs/brake-config-year-peer-20261025';
const OUT=path.resolve(outArg);
const put=(name,value)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));};
const relationKey=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const canonical=r=>Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]]));
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(canonical(r))).sort());
const normalize=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]/g,'');

function makePlan(data){
  const products=new Map(data.products.map(r=>[r.id,r]));
  const apps=enrich(data).filter(a=>a.status==='active'&&a.all_years.length);
  const configKey=a=>[a.make,normalize(a.series),a.variant_id,a.powertrain_id].join('|');
  const groups=Map.groupBy(apps,configKey),restores=[],creates=[],skips=[];
  for(const a of apps){
    const peers=groups.get(configKey(a))??[];
    for(const position of ['front','rear']){
      if(a.published.some(r=>r.position===position))continue;
      const productByYear=new Map(a.all_years.map(y=>[y,new Set()]));
      const sourceApps=new Map();
      for(const p of peers){
        const published=p.published.filter(r=>r.position===position&&/^NBP\d+$/.test(r.sku??''));
        for(const r of published)for(const y of p.all_years)if(productByYear.has(y)){
          productByYear.get(y).add(r.product_variant_id);sourceApps.set(p.application_id,p);
        }
      }
      if([...productByYear.values()].some(set=>set.size!==1))continue;
      const candidates=new Set([...productByYear.values()].flatMap(set=>[...set]));
      if(candidates.size!==1)continue;
      const product_variant_id=[...candidates][0],sku=products.get(product_variant_id)?.sku;
      if(!/^NBP\d+$/.test(sku??''))continue;
      const same=a.existing.filter(r=>r.position===position&&r.product_variant_id===product_variant_id);
      if(same.some(r=>r.fitment_status==='rejected')){skips.push({application_id:a.application_id,position,sku,reason:'matching_relation_previously_rejected'});continue;}
      const base={application_id:a.application_id,product_variant_id,position,sku,make:a.make,model:a.model,series:a.series,
        variant:a.variant,engine:a.engine,years:a.all_years,rank:a.rank,group:a.group,
        source_applications:[...sourceApps.keys()],source_models:[...new Set([...sourceApps.values()].map(p=>p.model))],
        source_rule:'same make + exact normalized chassis + exact variant + exact powertrain; every target year has the same sole published NBP product'};
      const review=same.filter(r=>r.fitment_status==='review');
      if(review.length===1)restores.push({...base,before:data.fitments.find(r=>relationKey(r)===relationKey(review[0]))});
      else if(same.length===0)creates.push(base);
    }
  }
  const dedupe=rows=>[...new Map(rows.map(r=>[relationKey(r),r])).values()];
  const rr=dedupe(restores),cc=dedupe(creates),projected={...data,fitments:[...data.fitments.map(r=>rr.some(x=>relationKey(x)===relationKey(r))?{...r,fitment_status:'published'}:r),...cc.map(r=>({application_id:r.application_id,product_variant_id:r.product_variant_id,position:r.position,fitment_status:'published'}))]};
  return {policy:POLICY,created_at:new Date().toISOString(),snapshot:snapshotArg,snapshot_hash:hash(data),
    safeguards:['same make','exact normalized chassis/series','exact variant id (body/drive)','exact powertrain id','every full-range target year covered by source','exactly one published NBP product in every target year','same product across all target years','prior rejected relation is never restored'],
    counts:{relations:rr.length+cc.length,restores:rr.length,creates:cc.length,applications:new Set([...rr,...cc].map(r=>r.application_id)).size,
      popular_relations:[...rr,...cc].filter(r=>r.rank).length,popular_applications:new Set([...rr,...cc].filter(r=>r.rank).map(r=>r.application_id)).size,skips:skips.length},
    before:coverage(data),projected:coverage(projected),restores:rr,creates:cc,skips};
}

async function apply(plan,before){
  assert.equal(plan.snapshot_hash,hash(before));assert(plan.counts.relations>0,'No changes to apply');assert(!fs.existsSync(path.join(OUT,'applied.json')),'Already applied');
  const db=client(),liveFits=await all(db,'vehicle_catalog_product_fitments','application_id'),liveApps=await all(db,'vehicle_catalog_applications','application_id');
  assert.equal(sortedHash(liveFits),sortedHash(before.fitments),'Production fitments changed; fetch a fresh snapshot');
  assert.equal(sortedHash(liveApps),sortedHash(before.applications),'Production applications changed; fetch a fresh snapshot');
  const backup=path.resolve('tmp/production-backups',`brake-config-year-peer-${new Date().toISOString().replace(/[:.]/g,'-')}`);fs.mkdirSync(backup,{recursive:true});
  fs.writeFileSync(path.join(backup,'fitments.json'),JSON.stringify(liveFits));fs.writeFileSync(path.join(backup,'plan.json'),JSON.stringify(plan,null,2));
  const now=new Date().toISOString(),expected=[...liveFits],restored=[],created=[];
  for(const r of plan.restores){
    const notes=[r.before.notes,`${POLICY}; source_applications=${r.source_applications.join(',')}`].filter(Boolean).join('; ');
    const q=await db.from('vehicle_catalog_product_fitments').update({fitment_status:'published',notes,updated_at:now})
      .eq('application_id',r.application_id).eq('product_variant_id',r.product_variant_id).eq('position',r.position)
      .eq('fitment_status','review').eq('updated_at',r.before.updated_at).select('*');
    if(q.error)throw q.error;assert.equal(q.data.length,1,`Concurrent relation change ${relationKey(r)}`);expected[expected.findIndex(x=>relationKey(x)===relationKey(r))]=q.data[0];restored.push(relationKey(r));
  }
  for(const r of plan.creates){
    const row={application_id:r.application_id,product_variant_id:r.product_variant_id,position:r.position,fitment_status:'published',source:POLICY,
      notes:`${POLICY}; source_applications=${r.source_applications.join(',')}`,created_at:now,updated_at:now};
    const q=await db.from('vehicle_catalog_product_fitments').insert(row).select('*');if(q.error)throw q.error;assert.equal(q.data.length,1);expected.push(q.data[0]);created.push(relationKey(r));
  }
  const afterFits=await all(db,'vehicle_catalog_product_fitments','application_id');assert.equal(sortedHash(afterFits),sortedHash(expected),'Fitment readback differs from expected');
  const after={...before,fitments:afterFits,verified_at:new Date().toISOString()},result={...plan,applied_at:after.verified_at,backup,verified:true,restored,created,after:coverage(after)};
  put('after-snapshot.json',after);put('applied.json',result);console.log(JSON.stringify({counts:plan.counts,before:plan.before.application_year_rate,projected:plan.projected.application_year_rate,after:result.after.application_year_rate,backup},null,2));
}

const before=read(snapshotArg),plan=makePlan(before);put('plan.json',plan);
if(process.argv.includes('--apply'))await apply(plan,before);else console.log(JSON.stringify({counts:plan.counts,before:plan.before.application_year_rate,projected:plan.projected.application_year_rate,popular_by_group:Object.fromEntries([...Map.groupBy([...plan.restores,...plan.creates].filter(r=>r.rank),r=>r.group)].map(([k,v])=>[k,v.length]))},null,2));
