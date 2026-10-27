import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {originVerification,quotaSecret,quotaHash} from '../lib/application/fitment/shared-quota';
for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
  const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const candidate=process.argv.includes('--candidate');
const base=candidate?JSON.parse(fs.readFileSync('outputs/security-quota-20261028/candidate-deployment.json','utf8').replace(/^\uFEFF/,'')).deployment.url:'https://nexautoparts.co.nz';
const cli='C:/Users/Sanli/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/vercel/dist/index.js';
let sessionCookie='';const checks:unknown[]=[];
async function request(route:string,extra:Record<string,string>={}){
  const url=new URL(route,base);let status:number,headers:Headers,body:string;
  const start=Date.now();
  if(candidate){
    const args=[cli,'curl',route,'--deployment',base,'--','--silent','--show-error','--include','--max-time','25'];
    const signed=await originVerification(new Request(url),quotaSecret());
    for(const [k,v] of Object.entries({'x-nexauto-quota-verification':signed,...(sessionCookie?{cookie:sessionCookie}:{}),...extra}))args.push('--header',`${k}: ${v}`);
    const p=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:35000,maxBuffer:8*1024*1024,cwd:'outputs/security-quota-20261028/release/source'});
    if(p.status!==0)throw Error(`Candidate request failed (${route}): ${p.status}`);
    const raw=p.stdout.replace(/\r\n/g,'\n'),at=raw.indexOf('\n\n'),head=raw.slice(0,at).split('\n');
    status=Number(head[0].match(/HTTP\/\S+\s+(\d+)/)?.[1]);headers=new Headers();
    for(const line of head.slice(1)){const i=line.indexOf(':');if(i>0)headers.append(line.slice(0,i),line.slice(i+1).trim());}
    body=raw.slice(at+2);
  }else{
    const r=await fetch(url,{headers:{...(sessionCookie?{cookie:sessionCookie}:{}),...extra},redirect:'manual',signal:AbortSignal.timeout(30000)});
    status=r.status;headers=r.headers;body=await r.text();
  }
  const issued=headers.get('set-cookie')?.match(/(?:^|,\s*)(__Host-nexauto_fitment=[^;]+)/)?.[1];if(issued)sessionCookie=issued;
  checks.push({route,status,protection:headers.get('x-fitment-protection'),rate:headers.get('ratelimit'),vehicleQuota:headers.get('x-vehicle-quota'),cache:headers.get('cache-control'),durationMs:Date.now()-start});
  return {status,headers,body};
}
async function json(route:string,status=200){const r=await request(route);assert.equal(r.status,status,route);assert.equal(r.headers.get('x-fitment-protection'),'shared-v1');assert.match(r.headers.get('cache-control')||'',/private.*no-store/);return JSON.parse(r.body);}
const onlyRoute=process.argv.find(a=>a.startsWith('--route='))?.slice(8);
if(onlyRoute){const r=await request(onlyRoute);console.log(JSON.stringify({checks,body:r.status>=400?r.body.slice(0,400):undefined}));process.exit(0);}
const first=await json('/api/vehicles/catalog');assert.ok(first.makes.length);assert.ok(sessionCookie);
const make=first.makes.find((m:{name:string})=>m.name.toUpperCase()==='TOYOTA');assert.ok(make);
const models=await json(`/api/vehicles/catalog?makeId=${make.id}`);const model=models.models.find((m:{name:string})=>m.name.toUpperCase()==='COROLLA');assert.ok(model);
const query=`makeId=${make.id}&modelId=${model.id}`;
const years=await json(`/api/vehicles/catalog?${query}`);assert.ok(years.years.includes(2017));
const apps=await json(`/api/vehicles/applications?${query}&year=2017`);assert.ok(apps.applications.length);
const repeated=await request(`/api/vehicles/applications?${query}&year=2018`);assert.equal(repeated.status,200);assert.match(repeated.headers.get('x-vehicle-quota')||'',/remaining=23/);
await json('/api/vehicles/catalog?all=true',400);
const cross=await request('/api/vehicles/catalog',{'sec-fetch-site':'cross-site'});assert.equal(cross.status,403);
const spoof=await request('/api/vehicles/catalog',{'cf-connecting-ip':'198.51.100.20','x-forwarded-for':'203.0.113.20','x-vercel-forwarded-for':'192.0.2.20','x-real-ip':'192.0.2.21'});
if(spoof.status===200)assert.equal(spoof.headers.get('x-fitment-protection'),'shared-v1');
else {assert.equal(spoof.status,403);assert.doesNotMatch(spoof.body,/"makes"\s*:/);}
const shop=await request('/shop');assert.equal(shop.status,200);assert.equal(shop.headers.get('x-fitment-protection'),'shared-v1');assert.match(shop.body,/Shop|Browse/);
for(const route of ['/cart','/checkout','/checkout/success','/checkout/success?session_id=cs_test_nonexistentSecurityVerification123']){
  const r=await request(route);assert.equal(r.status,200);assert.equal(r.headers.get('x-fitment-protection'),null);
  if(route.startsWith('/checkout/success')){assert.match(r.body,/Awaiting payment confirmation/);assert.doesNotMatch(r.body,/>Payment received</);}
}
// Only this script's newly issued session is seeded; real visitor/network quotas are untouched.
const sessionId=sessionCookie.split('=')[1].split('.')[0],sessionHash=await quotaHash(quotaSecret(),'session',sessionId);
const db=process.env.NEXT_PUBLIC_SUPABASE_URL!,service=process.env.SUPABASE_SERVICE_ROLE_KEY!;
const serviceHeaders={apikey:service,...(service.startsWith('eyJ')?{Authorization:`Bearer ${service}`} : {}),'Content-Type':'application/json'};
async function seed(scope:string,seconds:number,count:number){
  const epoch=Math.floor(Date.now()/1000),start=Math.floor(epoch/seconds)*seconds;
  const r=await fetch(`${db}/rest/v1/fitment_quota_buckets`,{method:'POST',headers:{...serviceHeaders,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({subject_hash:sessionHash,scope,window_seconds:seconds,window_start:start,request_count:scope==='vehicles'?0:count,vehicle_count:scope==='vehicles'?count:0,expires_at:new Date((start+seconds+3600)*1000).toISOString()})});assert.ok(r.ok);
}
await seed('vehicles',900,24);
const anotherModel=models.models.find((m:{id:string})=>m.id!==model.id);assert.ok(anotherModel);
const distinctDenied=await request(`/api/vehicles/catalog?makeId=${make.id}&modelId=${anotherModel.id}`);assert.equal(distinctDenied.status,429);assert.equal(JSON.parse(distinctDenied.body).code,'VEHICLE_QUOTA_EXCEEDED');assert.ok(Number(distinctDenied.headers.get('retry-after'))>0);
const knownAgain=await request(`/api/vehicles/catalog?${query}`);assert.equal(knownAgain.status,200);
const untilMinute=60-Math.floor(Date.now()/1000)%60;if(untilMinute<5)await new Promise(r=>setTimeout(r,(untilMinute+1)*1000));
await seed('api',60,90);
const rateDenied=await request('/api/vehicles/catalog');assert.equal(rateDenied.status,429);assert.equal(JSON.parse(rateDenied.body).code,'FITMENT_RATE_LIMITED');
const cartWhileLimited=await request('/cart');assert.equal(cartWhileLimited.status,200);
const checkoutWhileLimited=await request('/checkout');assert.equal(checkoutWhileLimited.status,200);
const result={checkedAt:new Date().toISOString(),base,passed:true,candidate,checks};
fs.writeFileSync(`outputs/security-quota-20261028/${candidate?'candidate':'production'}-http-verification.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
