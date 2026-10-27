import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createFitmentRequestGuard} from '../lib/application/fitment/public-api';
import {allowQuotaOrigin,originVerification,quotaHash,quotaNetwork,quotaSession,quotaVehicle,type QuotaInput} from '../lib/application/fitment/shared-quota';
import {allowedQuota,fixtureGuard,fixtureSecret} from './helpers/quota-fixture';
const model='md_1234567890abcdef1234',make='mk_1234567890abcdef1234';
const url=`https://nexautoparts.co.nz/api/vehicles/applications?makeId=${make}&modelId=${model}&year=2017`;
const cookieOf=(headers:Headers)=>headers.get('set-cookie')!.split(';')[0];

test('two independent guards share store consumption, signed session and vehicle keys across hosts',async()=>{
  const inputs:QuotaInput[]=[];
  const store={consume:async(input:QuotaInput)=>{inputs.push(input);return {...allowedQuota,remaining:90-inputs.length};}};
  const a=fixtureGuard(store),b=fixtureGuard(store);
  const first=await a(new Request(url));
  const second=await b(new Request(url.replace('nexautoparts.co.nz','another-instance.test'),{headers:{cookie:cookieOf(first.headers)}}));
  assert.equal(first.response,null);assert.equal(second.response,null);
  assert.equal(inputs.length,2);
  assert.deepEqual(inputs[0],inputs[1]);
  assert.match(second.headers.get('RateLimit')!,/remaining=88/);
  assert.equal(second.headers.get('X-Fitment-Protection'),'shared-v1');
  assert.equal(second.headers.get('set-cookie'),null);
  assert.ok(Object.values(inputs[0]).filter(v=>v!=='api').every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)));
});

test('changing year or public product URL does not consume a new model identity',()=>{
  assert.equal(quotaVehicle(new Request(url)),quotaVehicle(new Request(url.replace('2017','2018'))));
  const vehicle=encodeURIComponent(JSON.stringify({makeId:make,modelId:model}));
  assert.equal(quotaVehicle(new Request('https://nexautoparts.co.nz/shop',{headers:{cookie:`nexauto_vehicle_context_v3=${vehicle}`}})),`model:${make}:${model}`);
  assert.equal(quotaVehicle(new Request(`https://nexautoparts.co.nz/shop?makeId=${make}&modelId=md_aaaaaaaaaaaaaaaaaaaa`,{headers:{cookie:`nexauto_vehicle_context_v3=${vehicle}`}})),`model:${make}:${model}`);
  assert.equal(quotaVehicle(new Request('https://nexautoparts.co.nz/shop',{headers:{cookie:'nexauto_vehicle_context_v3=malformed'}})),null);
});

test('forged/expired cookies are replaced, secure cookies are HttpOnly and identities are not disclosed',async()=>{
  const now=1800000000;
  const session=await quotaSession(new Request(url),fixtureSecret,now);
  assert.match(session.setCookie!,/^__Host-nexauto_fitment=/);
  assert.match(session.setCookie!,/HttpOnly/);assert.match(session.setCookie!,/; Secure/);
  const original=session.setCookie!.split(';')[0];
  assert.equal((await quotaSession(new Request(url,{headers:{cookie:original}}),fixtureSecret,now)).id,session.id);
  assert.notEqual((await quotaSession(new Request(url,{headers:{cookie:original.replace(/.$/,'x')}}),fixtureSecret,now)).id,session.id);
  assert.notEqual((await quotaSession(new Request(url,{headers:{cookie:original}}),fixtureSecret,now+86401)).id,session.id);
  assert.notEqual(await quotaHash(fixtureSecret,'network','same'),await quotaHash(fixtureSecret,'session','same'));
});

test('only the Vercel-overwritten ingress header is used, arbitrary proxy chains are rejected',()=>{
  const headers={'x-vercel-forwarded-for':'192.0.2.3','x-forwarded-for':'203.0.113.9','cf-connecting-ip':'198.51.100.4','x-real-ip':'198.51.100.5'};
  assert.equal(quotaNetwork(new Request(url,{headers}),true),'203.0.113.9');
  assert.throws(()=>quotaNetwork(new Request(url,{headers:{'x-vercel-forwarded-for':'203.0.113.9'}}),true));
  assert.throws(()=>quotaNetwork(new Request(url,{headers:{'x-forwarded-for':'192.0.2.3, 192.0.2.4'}}),true));
});

test('quota rejection returns 429 and Retry-After, outages fail closed without exposing errors',async()=>{
  const limited=fixtureGuard({consume:async()=>({...allowedQuota,allowed:false,reason:'vehicle_quota',retryAfterSeconds:900,vehicleRemaining:0})});
  const response=(await limited(new Request(url))).response!;
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'900');
  assert.equal((await response.json()).code,'VEHICLE_QUOTA_EXCEEDED');
  const outage=fixtureGuard({consume:async()=>{throw new Error('SQL password=secret');}});
  const error=(await outage(new Request(url))).response!;
  assert.equal(error.status,503);assert.doesNotMatch(await error.text(),/password|SQL/);
});

test('cross-site product navigation works, while cross-site data API access stays rejected',async()=>{
  let calls=0;
  const guard=fixtureGuard({consume:async()=>{calls++;return {...allowedQuota};}});
  assert.equal((await guard(new Request(url,{headers:{'sec-fetch-site':'cross-site'}}))).response?.status,403);
  assert.equal((await guard(new Request('https://nexautoparts.co.nz/wipers/WPFP1624',{headers:{'sec-fetch-site':'cross-site'}}),{requestClass:'page'})).response,null);
  assert.equal(calls,1);
});

test('production deployment host cannot evade quota; signed verification does not bypass counting',async()=>{
  const privateUrl=url.replace('nexautoparts.co.nz','candidate.vercel.app');
  let calls=0;
  const guard=createFitmentRequestGuard({store:{consume:async()=>{calls++;return {...allowedQuota};}},secret:()=>fixtureSecret,network:()=> 'network',production:()=>true});
  assert.equal((await guard(new Request(privateUrl,{headers:{'x-vercel-protection-bypass':'fake'}}))).response?.status,403);
  assert.equal(calls,0);
  const token=await originVerification(new Request(privateUrl),fixtureSecret);
  assert.equal((await guard(new Request(privateUrl,{headers:{'x-nexauto-quota-verification':token}}))).response,null);
  assert.equal(calls,1);
  assert.equal(await allowQuotaOrigin(new Request(privateUrl.replace('2017','2018'),{headers:{'x-nexauto-quota-verification':token}}),fixtureSecret,true),false);
  assert.equal((await guard(new Request('https://candidate.vercel.app/shop'),{requestClass:'page'})).response?.status,308);
});

test('middleware covers catalogue SSR and prefetch but leaves checkout, account and callbacks outside quota',()=>{
  const source=readFileSync('middleware.ts','utf8');
  assert.match(source,/guardFitmentApiRequest\(request,\{requestClass:'page'\}\)/);
  assert.match(source,/"\/parts"/);assert.match(source,/"\/bulbs"/);
  assert.doesNotMatch(source,/obviousScriptClient/);
  assert.ok(source.indexOf('guardFitmentApiRequest(request')<source.indexOf('await updateSession(request)'));
});
