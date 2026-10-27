import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,all,hash,read} from './review-brake-alias-groups-20261025.mjs';
import {enrich,coverage} from './process-brake-alias-review-20261025.mjs';
import {identityCorrection} from './brake-alias-review-policy-20261025.mjs';

const POLICY='BRAKE_IDENTITY_REASSIGN_NO_PEER_V1_20261025';
const snapshotArg=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11)
  ??'outputs/brake-exact-application-peer-round3-20261025/after-snapshot.json';
const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice(6)
  ??'outputs/brake-identity-reassign-no-peer-20261025';
const OUT=path.resolve(outArg);
const put=(name,value)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));};
const canonical=r=>Object.fromEntries(Object.keys(r).sort().map(k=>[k,k.endsWith('_at')&&r[k]&&Number.isFinite(Date.parse(r[k]))?new Date(r[k]).toISOString():r[k]]));
const sortedHash=rows=>hash(rows.map(r=>JSON.stringify(canonical(r))).sort());

function makePlan(data){
  const apps=enrich(data),models=new Map(data.models.map(r=>[r.model_id,r])),series=new Map(data.series.map(r=>[r.series_id,r]));
  const changes=[],pending=[];
  for(const a of apps.filter(a=>a.status==='active')){
    const correction=identityCorrection(a);if(!correction)continue;
    const oldModel=models.get(a.model_id),oldSeries=series.get(a.series_id);
    const targetModel=data.models.find(m=>m.make_id===oldModel.make_id&&m.name===correction.model&&m.status==='active');
    const targetSeries=targetModel&&oldSeries?data.series.find(s=>s.model_id===targetModel.model_id&&s.normalized_code===oldSeries.normalized_code&&s.status==='active'):null;
    if(!targetModel||(oldSeries&&!targetSeries)){pending.push({application_id:a.application_id,rule_id:correction.rule_id,reason:!targetModel?'target_model_missing':'target_series_missing'});continue;}
    const canonical_key=[targetModel.model_id,targetSeries?.series_id??'',a.variant_id,a.powertrain_id,a.year_from,a.year_to].join('|');
    const peers=data.applications.filter(p=>p.application_id!==a.application_id&&p.canonical_key===canonical_key);
    if(peers.length){continue;}// Existing peer is handled by the merge workflow.
    changes.push({application_id:a.application_id,rule_id:correction.rule_id,make:a.make,old_model:a.model,new_model:correction.model,
      old_series:a.series,new_series:targetSeries?.code??'',model_id:targetModel.model_id,series_id:targetSeries?.series_id??null,
      canonical_key,before:data.applications.find(r=>r.application_id===a.application_id)});
  }
  assert.equal(changes.length,new Set(changes.map(r=>r.application_id)).size);
  const selected=[];
  for(const rows of Map.groupBy(changes,r=>r.canonical_key).values()){
    selected.push(rows[0]);
    for(const deferred of rows.slice(1))pending.push({application_id:deferred.application_id,rule_id:deferred.rule_id,
      reason:'same_target_key_deferred_after_primary_reassign',primary_application_id:rows[0].application_id,canonical_key:deferred.canonical_key});
  }
  return {policy:POLICY,created_at:new Date().toISOString(),snapshot_hash:hash(data),snapshot:snapshotArg,
    counts:{changes:selected.length,pending:pending.length},before:coverage(data),changes:selected,pending};
}

async function apply(plan,before){
  assert.equal(plan.snapshot_hash,hash(before));
  assert(!fs.existsSync(path.join(OUT,'applied.json')),'Already applied');
  const db=client(),liveApps=await all(db,'vehicle_catalog_applications','application_id');
  assert.equal(sortedHash(liveApps),sortedHash(before.applications),'Production applications changed; fetch a fresh snapshot');
  const backup=path.resolve('tmp/production-backups',`brake-identity-reassign-${new Date().toISOString().replace(/[:.]/g,'-')}`);
  fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'applications.json'),JSON.stringify(liveApps));fs.writeFileSync(path.join(backup,'plan.json'),JSON.stringify(plan,null,2));
  const expected=[...liveApps],updated=[];
  for(const c of plan.changes){
    const payload={model_id:c.model_id,series_id:c.series_id,canonical_key:c.canonical_key,review_status:'approved'};
    const q=await db.from('vehicle_catalog_applications').update(payload).eq('application_id',c.application_id)
      .eq('canonical_key',c.before.canonical_key).eq('status','active').select('*');
    if(q.error)throw q.error;assert.equal(q.data.length,1,`Concurrent application change ${c.application_id}`);
    expected[expected.findIndex(r=>r.application_id===c.application_id)]=q.data[0];updated.push(q.data[0]);
  }
  const afterApps=await all(db,'vehicle_catalog_applications','application_id');assert.equal(sortedHash(afterApps),sortedHash(expected),'Application readback differs from expected');
  const after={...before,applications:afterApps,verified_at:new Date().toISOString()};
  const result={...plan,applied_at:after.verified_at,backup,verified:true,updated,before_coverage:coverage(before),after_coverage:coverage(after)};
  put('after-snapshot.json',after);put('applied.json',result);console.log(JSON.stringify({counts:plan.counts,updated:updated.map(r=>r.application_id),before:result.before_coverage.application_year_rate,after:result.after_coverage.application_year_rate,backup},null,2));
}

const before=read(snapshotArg),plan=makePlan(before);put('plan.json',plan);
if(process.argv.includes('--apply'))await apply(plan,before);else console.log(JSON.stringify({counts:plan.counts,changes:plan.changes,pending:plan.pending},null,2));
