import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {client,snapshot,all,hash} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';

const POLICY='BRAKE_EXACT_APPLICATION_PEER_V1_20261025';
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice('--out='.length);
const OUT=path.resolve(outArg||'outputs/brake-exact-application-peer-20261025');
const BEFORE=path.join(OUT,'before-snapshot.json');
const PLAN=path.join(OUT,'plan.json');
const APPLIED=path.join(OUT,'applied.json');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const put=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2));};
const fitKey=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const canonical=r=>Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]]));
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(canonical(r))).sort());

function group(rows,key){const out=new Map();for(const row of rows){const k=key(row);if(!out.has(k))out.set(k,[]);out.get(k).push(row);}return out;}

export function buildPlan(d){
  const apps=enrich(d).filter(a=>a.status==='active'&&a.all_years.length);
  const raw=new Map(d.applications.map(a=>[a.application_id,a]));
  const models=new Map(d.models.map(r=>[r.model_id,r]));
  const series=new Map(d.series.map(r=>[r.series_id,r]));
  const products=new Map(d.products.map(r=>[r.id,r]));
  const signature=a=>{
    const r=raw.get(a.application_id),m=models.get(r.model_id),s=series.get(r.series_id);
    return [m.make_id,s?.normalized_code??'',r.variant_id,r.powertrain_id,a.all_years.join(',')].join('|');
  };
  const actions=[];
  for(const [identity,members] of group(apps,signature)){
    if(members.length<2)continue;
    for(const position of ['front','rear']){
      const published=[...new Map(members.flatMap(a=>a.published.filter(f=>f.position===position&&products.get(f.product_variant_id)?.active!==false)).map(f=>[f.product_variant_id,f])).values()];
      if(published.length!==1)continue;
      const candidate=published[0];
      const sourceApps=members.filter(a=>a.published.some(f=>f.position===position&&f.product_variant_id===candidate.product_variant_id));
      for(const a of members){
        if(a.published.some(f=>f.position===position))continue;
        const exactReviews=a.existing.filter(f=>f.position===position&&f.product_variant_id===candidate.product_variant_id&&f.fitment_status==='review');
        if(exactReviews.length>1)continue;
        const before=exactReviews.length===1?d.fitments.find(f=>fitKey(f)===fitKey(exactReviews[0])):null;
        actions.push({identity,application_id:a.application_id,product_variant_id:candidate.product_variant_id,position,sku:candidate.sku,db:candidate.db,
          action:before?'restore':'create',make:a.make,model:a.model,series:a.series,body:a.body,drive:a.drive,engine:a.engine,years:a.all_years,
          popular_rank:a.rank,popular_group:a.group,source_application_ids:sourceApps.map(x=>x.application_id),source_models:[...new Set(sourceApps.map(x=>x.model))],before});
      }
    }
  }
  assert.equal(actions.length,new Set(actions.map(fitKey)).size,'Duplicate actions');
  const fitments=d.fitments.map(r=>({...r}));
  for(const a of actions){
    const i=fitments.findIndex(r=>fitKey(r)===fitKey(a));
    if(i>=0)fitments[i].fitment_status='published';
    else fitments.push({application_id:a.application_id,product_variant_id:a.product_variant_id,position:a.position,fitment_status:'published'});
  }
  const projected={...d,fitments};
  const byGroup=[...group(actions.filter(a=>a.popular_rank),a=>a.popular_group)].map(([name,rows])=>({group:name,relations:rows.length,applications:new Set(rows.map(r=>r.application_id)).size,application_years:new Set(rows.flatMap(r=>r.years.filter(y=>y>=2000&&y<=2026).map(y=>`${r.application_id}|${y}`))).size})).sort((a,b)=>b.application_years-a.application_years);
  return {policy:POLICY,created_at:new Date().toISOString(),snapshot_hash:hash(d),counts:{relations:actions.length,restores:actions.filter(a=>a.action==='restore').length,creates:actions.filter(a=>a.action==='create').length,popular_relations:actions.filter(a=>a.popular_rank).length,popular_applications:new Set(actions.filter(a=>a.popular_rank).map(a=>a.application_id)).size},
    safeguards:['same make','same normalized chassis/series','same variant id (body/drive)','same powertrain id','identical full model-year set','exactly one published product candidate per position','target has no published product in that position'],before:coverage(d),projected:coverage(projected),popular_by_group:byGroup,actions};
}

async function fetchPlan(){const d=await snapshot(client());put(BEFORE,d);const p=buildPlan(d);put(PLAN,p);console.log(JSON.stringify({...p,actions:undefined},null,2));}

async function apply(){
  assert(fs.existsSync(BEFORE)&&fs.existsSync(PLAN),'Generate a fresh plan first');
  assert(!fs.existsSync(APPLIED),'This plan was already applied');
  const before=read(BEFORE),plan=read(PLAN),db=client();assert.equal(plan.snapshot_hash,hash(before));
  const live=await snapshot(db);
  for(const name of Object.keys(before).filter(k=>Array.isArray(before[k])))assert.equal(sortedHash(live[name]),sortedHash(before[name]),`Production input changed: ${name}`);
  const now=new Date().toISOString(),backup=path.resolve('tmp/production-backups',`brake-exact-application-peer-${now.replace(/[:.]/g,'-')}`);
  fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'before-snapshot.json'),JSON.stringify(live));fs.copyFileSync(PLAN,path.join(backup,'plan.json'));
  const current=new Map(live.fitments.map(r=>[fitKey(r),r]));
  const rows=plan.actions.map(a=>{
    const note=`${POLICY}; exact_application_peer=${a.source_application_ids.join(',')}; identity=${a.identity}`;
    if(a.action==='restore'){
      const old=current.get(fitKey(a));assert(old&&old.fitment_status==='review');
      return {...old,fitment_status:'published',notes:[old.notes,note].filter(Boolean).join('; '),updated_at:now};
    }
    assert(!current.has(fitKey(a)));
    return {application_id:a.application_id,product_variant_id:a.product_variant_id,position:a.position,fitment_status:'published',source:POLICY,notes:note,created_at:now,updated_at:now};
  });
  for(let i=0;i<rows.length;i+=100){const q=await db.from('vehicle_catalog_product_fitments').upsert(rows.slice(i,i+100),{onConflict:'application_id,product_variant_id,position'});if(q.error)throw q.error;console.log(`fitments ${Math.min(i+100,rows.length)}/${rows.length}`);}
  const afterFits=await all(db,'vehicle_catalog_product_fitments','application_id'),afterMap=new Map(afterFits.map(r=>[fitKey(r),r]));
  for(const r of rows){const got=afterMap.get(fitKey(r));assert.equal(got?.fitment_status,'published');assert(got.notes?.includes(POLICY));}
  assert.equal(afterFits.length,live.fitments.length+plan.counts.creates,'Unexpected fitment row count');
  const after={...live,fitments:afterFits,verified_at:new Date().toISOString()};
  const result={policy:POLICY,applied_at:now,backup,counts:plan.counts,before:coverage(live),after:coverage(after),verified:true};put(APPLIED,result);put(path.join(OUT,'after-snapshot.json'),after);console.log(JSON.stringify(result,null,2));
}

if(process.argv.includes('--apply'))await apply();else if(process.argv.includes('--cached')){const d=read(BEFORE),p=buildPlan(d);put(PLAN,p);console.log(JSON.stringify({...p,actions:undefined},null,2));}else await fetchPlan();
