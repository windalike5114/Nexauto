import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,snapshot,all,hash} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';

const POLICY='BRAKE_UNIQUE_REVIEW_CANDIDATE_V1_20261025';
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
const OUT=path.resolve(outArg??'outputs/brake-unique-review-candidates-20261025');
const BEFORE=path.join(OUT,'before-snapshot.json'),PLAN=path.join(OUT,'plan.json'),APPLIED=path.join(OUT,'applied.json');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const put=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2));};
const key=r=>`${r.application_id}|${r.product_variant_id}|${r.position}`;
const canonical=r=>Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]]));
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(canonical(r))).sort());

function allCoverage(d){
  const apps=enrich(d).filter(a=>a.status==='active'&&a.all_years.length);
  const metric=position=>{const hit=a=>a.published.some(r=>!position||r.position===position),den=apps.reduce((n,a)=>n+a.all_years.length,0),num=apps.filter(hit).reduce((n,a)=>n+a.all_years.length,0);return {applications:apps.length,covered_applications:apps.filter(hit).length,application_years:den,covered_application_years:num,rate:den?num/den:null};};
  return {...metric(),front:metric('front'),rear:metric('rear')};
}

export function buildPlan(d){
  const catalog=new Map(read('data/brake-pads/catalog.json').map(r=>[r.sku,r]));
  const products=new Map(d.products.map(r=>[r.id,r]));
  const actions=[];
  for(const a of enrich(d).filter(a=>a.status==='active'))for(const position of ['front','rear']){
    if(a.published.some(r=>r.position===position))continue;
    const review=a.existing.filter(r=>r.position===position&&r.fitment_status==='review'&&products.get(r.product_variant_id)?.active!==false&&catalog.has(r.sku));
    const candidates=[...new Map(review.map(r=>[r.product_variant_id,r])).values()];
    if(candidates.length!==1)continue;
    const r=candidates[0],before=d.fitments.find(x=>key(x)===key(r));assert(before);
    actions.push({application_id:a.application_id,product_variant_id:r.product_variant_id,position,sku:r.sku,db:r.db,make:a.make,model:a.model,series:a.series,body:a.body,drive:a.drive,engine:a.engine,years:a.all_years,popular_rank:a.rank,popular_group:a.group,before});
  }
  assert.equal(actions.length,new Set(actions.map(key)).size);
  const targets=new Set(actions.map(key)),projected={...d,fitments:d.fitments.map(r=>targets.has(key(r))?{...r,fitment_status:'published'}:r)};
  const byGroup=[...Map.groupBy(actions.filter(a=>a.popular_rank),a=>a.popular_group)].map(([group,rows])=>({group,relations:rows.length,applications:new Set(rows.map(r=>r.application_id)).size})).sort((a,b)=>b.applications-a.applications);
  return {policy:POLICY,created_at:new Date().toISOString(),snapshot_hash:hash(d),counts:{relations:actions.length,applications:new Set(actions.map(r=>r.application_id)).size,popular_relations:actions.filter(a=>a.popular_rank).length,popular_applications:new Set(actions.filter(a=>a.popular_rank).map(r=>r.application_id)).size},
    rule:'Active application + no published brake product in the position + exactly one active NBP product candidate in review. Missing fields are allowed; two or more product candidates remain review.',before:{all:allCoverage(d),popular50:coverage(d)},projected:{all:allCoverage(projected),popular50:coverage(projected)},popular_by_group:byGroup,actions};
}

async function plan(){const d=await snapshot(client());put(BEFORE,d);const p=buildPlan(d);put(PLAN,p);console.log(JSON.stringify({...p,actions:undefined,before:{all:p.before.all.rate,popular50:p.before.popular50.application_year_rate},projected:{all:p.projected.all.rate,popular50:p.projected.popular50.application_year_rate}},null,2));}

async function apply(){
  assert(fs.existsSync(BEFORE)&&fs.existsSync(PLAN),'Generate plan first');assert(!fs.existsSync(APPLIED),'Plan already applied');
  const before=read(BEFORE),plan=read(PLAN),db=client();assert.equal(plan.snapshot_hash,hash(before));
  const live=await snapshot(db);for(const name of Object.keys(before).filter(k=>Array.isArray(before[k])))assert.equal(sortedHash(live[name]),sortedHash(before[name]),`Production input changed: ${name}`);
  const now=new Date().toISOString(),backup=path.resolve('tmp/production-backups',`brake-unique-review-${now.replace(/[:.]/g,'-')}`);fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'before-snapshot.json'),JSON.stringify(live));fs.copyFileSync(PLAN,path.join(backup,'plan.json'));
  const current=new Map(live.fitments.map(r=>[key(r),r]));
  const payload=plan.actions.map(a=>{const r=current.get(key(a));assert(r&&r.fitment_status==='review');return {...r,fitment_status:'published',notes:[r.notes,`${POLICY}; unique_review_candidate=true; db=${a.db}; missing_fields_allowed=true`].filter(Boolean).join('; '),updated_at:now};});
  for(let i=0;i<payload.length;i+=150){const q=await db.from('vehicle_catalog_product_fitments').upsert(payload.slice(i,i+150),{onConflict:'application_id,product_variant_id,position'});if(q.error)throw q.error;console.log(`published ${Math.min(i+150,payload.length)}/${payload.length}`);}
  const afterFits=await all(db,'vehicle_catalog_product_fitments','application_id'),afterMap=new Map(afterFits.map(r=>[key(r),r])),targets=new Set(payload.map(key));
  assert.equal(afterFits.length,live.fitments.length);for(const r of payload){const got=afterMap.get(key(r));assert.equal(got?.fitment_status,'published');assert(got.notes?.includes(POLICY));}
  assert.equal(sortedHash(afterFits.filter(r=>!targets.has(key(r)))),sortedHash(live.fitments.filter(r=>!targets.has(key(r)))),'Non-target fitments changed');
  const after={...live,fitments:afterFits,verified_at:new Date().toISOString()},result={policy:POLICY,applied_at:now,backup,counts:plan.counts,before:{all:allCoverage(live),popular50:coverage(live)},after:{all:allCoverage(after),popular50:coverage(after)},verified:true};put(APPLIED,result);put(path.join(OUT,'after-snapshot.json'),after);console.log(JSON.stringify({verified:true,counts:result.counts,backup,before:{all:result.before.all.rate,popular50:result.before.popular50.application_year_rate},after:{all:result.after.all.rate,popular50:result.after.popular50.application_year_rate}},null,2));
}

if(process.argv.includes('--apply'))await apply();else await plan();
