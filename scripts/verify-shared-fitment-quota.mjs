import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const base=process.env.NEXT_PUBLIC_SUPABASE_URL,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if(!base||!service||!anon)throw Error('Missing environment');
const headers=key=>({apikey:key,...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`} : {}),'Content-Type':'application/json'});
const hash=s=>createHash('sha256').update(s).digest('hex');
async function rpc(network,session,vehicle=null,key=service){
  const r=await fetch(`${base}/rest/v1/rpc/consume_fitment_quota`,{method:'POST',headers:headers(key),signal:AbortSignal.timeout(15000),body:JSON.stringify({p_network_hash:network,p_session_hash:session,p_vehicle_hash:vehicle})});
  if(!r.ok)throw Error(`Quota RPC HTTP ${r.status}`);
  return r.json();
}
if(process.argv[2]==='--worker'){
  const [network,session,kind,start,count]=process.argv.slice(3);
  const rows=await Promise.all(Array.from({length:Number(count)},(_,i)=>rpc(network,session,kind==='vehicles'?hash(`lab-vehicle:${Number(start)+i}`):null)));
  process.stdout.write(JSON.stringify(rows));
}else{
  const lab=randomUUID(),network=hash(`lab-network:${lab}`),session=hash(`lab-session:${lab}`);
  function worker(n,s,kind,start,count){return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[import.meta.filename,'--worker',n,s,kind,String(start),String(count)],{cwd:process.cwd(),env:process.env,windowsHide:true});
    let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',()=>{});p.on('error',reject);p.on('exit',code=>code===0?resolve(JSON.parse(output)):reject(Error(`Worker failed: ${code}`)));
  });}
  const report={checkedAt:new Date().toISOString(),scope:'Isolated random lab hashes only; no customer, order or catalogue changes',crossProcess:true};
  let rows=(await Promise.all([worker(network,session,'vehicles',0,13),worker(network,session,'vehicles',13,13)])).flat();
  assert.equal(rows.filter(r=>r.allowed).length,24);assert.equal(rows.filter(r=>r.reason==='vehicle_quota').length,2);
  const known=rows.findIndex(r=>r.allowed);
  const repeat=await rpc(network,session,hash(`lab-vehicle:${known}`));assert.equal(repeat.allowed,true);assert.equal(repeat.vehicle_remaining,0);
  report.distinctModels={submitted:26,allowed:24,denied:2,repeatedKnownAllowed:true};
  const rateNetwork=hash(`rate-network:${lab}`),rateSession=hash(`rate-session:${lab}`);
  const probe=await rpc(rateNetwork,hash(`clock-probe:${lab}`));
  if(probe.reset_after<8)await new Promise(r=>setTimeout(r,(probe.reset_after+1)*1000));
  rows=(await Promise.all([worker(rateNetwork,rateSession,'requests',0,48),worker(rateNetwork,rateSession,'requests',48,48)])).flat();
  assert.equal(rows.filter(r=>r.allowed).length,90);assert.equal(rows.filter(r=>r.reason==='request_rate').length,6);
  report.requestRate={submitted:96,allowed:90,denied:6};
  // Seed only this lab's daily bucket, then verify the daily rule independently.
  const dailyNetwork=hash(`daily-network:${lab}`),dailySession=hash(`daily-session:${lab}`),dailyVehicle=hash(`daily-vehicle:${lab}`);
  await rpc(dailyNetwork,dailySession,dailyVehicle);
  const patch=await fetch(`${base}/rest/v1/fitment_quota_buckets?subject_hash=eq.${dailySession}&scope=eq.vehicles&window_seconds=eq.86400`,{method:'PATCH',headers:headers(service),body:JSON.stringify({vehicle_count:80})});
  assert.ok(patch.ok);
  assert.equal((await rpc(dailyNetwork,dailySession,dailyVehicle)).allowed,true);
  const dailyDenied=await rpc(dailyNetwork,dailySession,hash(`new-daily-vehicle:${lab}`));
  assert.equal(dailyDenied.allowed,false);assert.equal(dailyDenied.reason,'vehicle_quota');
  report.dailyQuota={limit:80,newModelDenied:true,knownModelAllowed:true,retryAfter:dailyDenied.retry_after};
  const cohort=hash(`cohort-network:${lab}`),cohortSession=hash(`cohort-session:${lab}`),cohortVehicle=hash(`cohort-vehicle:${lab}`);
  await rpc(cohort,cohortSession,cohortVehicle);
  const cohortPatch=await fetch(`${base}/rest/v1/fitment_quota_buckets?subject_hash=eq.${cohort}&scope=eq.vehicles&window_seconds=eq.900`,{method:'PATCH',headers:headers(service),body:JSON.stringify({vehicle_count:300})});
  assert.ok(cohortPatch.ok);
  assert.equal((await rpc(cohort,hash(`rotated-session:${lab}`),hash(`new-cohort-model:${lab}`))).allowed,false);
  assert.equal((await rpc(cohort,hash(`another-session:${lab}`),cohortVehicle)).allowed,true);
  report.networkCohort={limit:300,newSessionCannotResetModelBudget:true,knownModelAllowedInNewSession:true};
  report.anonymous=[];
  for(const table of ['fitment_quota_buckets','fitment_quota_vehicles']){
    const r=await fetch(`${base}/rest/v1/${table}?select=subject_hash&limit=1`,{headers:headers(anon)});
    assert.ok([401,403,404].includes(r.status));report.anonymous.push({table,status:r.status});
  }
  const denied=await fetch(`${base}/rest/v1/rpc/consume_fitment_quota`,{method:'POST',headers:headers(anon),body:JSON.stringify({p_network_hash:network,p_session_hash:session})});
  assert.ok([401,403,404].includes(denied.status));report.anonymousRpcStatus=denied.status;
  fs.writeFileSync('outputs/security-quota-20261028/database-concurrency-verification.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
