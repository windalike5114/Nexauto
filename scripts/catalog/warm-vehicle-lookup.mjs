import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';

// An explicit, bounded post-release operation through the same public guards.
// No privileged endpoint, bypass token, arbitrary model list or full export.
const args=process.argv.slice(2), baseIndex=args.indexOf('--base-url'), reportIndex=args.indexOf('--report');
if(baseIndex<0||!args[baseIndex+1])throw new Error('Provide --base-url for the local or deployed site.');
const base=new URL(args[baseIndex+1]);
if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('Use a plain site origin.');
if(base.protocol!=='https:'&&!(['localhost','127.0.0.1','[::1]'].includes(base.hostname)&&base.protocol==='http:'))throw new Error('Use HTTPS except for loopback development.');
const samples=[['TOYOTA','COROLLA',2017],['HONDA','CIVIC',2015],['FORD','RANGER',2018]];
const results=[]; let requestCount=0;
async function read(path,label){
  if(++requestCount>12)throw new Error('Warm-up request cap reached.');
  const started=performance.now();const response=await fetch(new URL(path,base),{signal:AbortSignal.timeout(30000),redirect:'error'});
  if(response.status===429)throw new Error(`Warm-up stopped at HTTP 429; Retry-After=${response.headers.get('retry-after')??'unspecified'}. No retry was attempted.`);
  if(!response.ok)throw new Error(`${label}: HTTP ${response.status}`);
  const body=await response.json();
  results.push({label,status:response.status,durationMs:Math.round(performance.now()-started)});
  return body;
}
let failure;
try{
  const makes=await read('/api/vehicles/catalog','makes');
  if(!Array.isArray(makes.makes)||makes.makes.length>100||makes.makes.some(make=>'models'in make))throw new Error('Unexpected unbounded make response.');
  for(const [makeName,modelName,year] of samples){
    const make=makes.makes.find(make=>make.name.toUpperCase()===makeName);if(!make)throw new Error(`Missing make ${makeName}`);
    const models=await read(`/api/vehicles/catalog?makeId=${encodeURIComponent(make.id)}`,`${makeName} models`);
    if(!Array.isArray(models.models)||models.models.length>500||models.models.some(model=>'years'in model))throw new Error('Unexpected unbounded model response.');
    const model=models.models.find(model=>model.name.toUpperCase()===modelName);if(!model)throw new Error(`Missing model ${modelName}`);
    const query=new URLSearchParams({makeId:make.id,modelId:model.id});
    const years=await read(`/api/vehicles/catalog?${query}`,`${modelName} years`);
    if(!Array.isArray(years.years)||!years.years.includes(year))throw new Error(`Missing selected year for ${modelName}`);
    query.set('year',String(year));
    const applications=await read(`/api/vehicles/applications?${query}`,`${modelName} ${year} configurations`);
    if(!Array.isArray(applications.applications)||!applications.applications.length||applications.applications.length>500)throw new Error('Unexpected configuration response.');
  }
}catch(error){failure=error.message;process.exitCode=1;}
const report={completedAt:new Date().toISOString(),origin:base.origin,passed:!failure,requests:requestCount,requestCap:12,failure,results};
if(reportIndex>=0&&args[reportIndex+1])await writeFile(args[reportIndex+1],JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
