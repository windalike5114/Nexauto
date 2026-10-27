import fs from 'node:fs';
import assert from 'node:assert/strict';
const base=process.argv[2]||'http://localhost:3055';
const checks=[];
async function json(route,status=200){
  const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,status,route);
  const text=await response.text();
  const result=JSON.parse(text);
  checks.push({route,status:response.status,bytes:Buffer.byteLength(text)});
  return result;
}
const catalog=await json('/api/vehicles/catalog');
assert.ok(catalog.makes.length>0&&catalog.makes.length<=100);
assert.ok(catalog.makes.every(make=>Object.keys(make).sort().join(',')==='id,name'));
const make=catalog.makes.find(make=>make.name.toUpperCase()==='TOYOTA');assert.ok(make);
const models=await json(`/api/vehicles/catalog?makeId=${make.id}`);
assert.ok(!('makes' in models)&&models.models.length>0);
assert.ok(models.models.every(model=>!('years' in model)));
const model=models.models.find(model=>model.name.toUpperCase()==='COROLLA');assert.ok(model);
const years=await json(`/api/vehicles/catalog?makeId=${make.id}&modelId=${model.id}`);
assert.ok(years.years.includes(2017));
const query=`makeId=${make.id}&modelId=${model.id}`;
const applications=await json(`/api/vehicles/applications?${query}&year=2017`);
assert.ok(applications.applications.length>0&&applications.applications.length<=500);
assert.equal((await json(`/api/vehicles/applications?${query}&year=1900`)).applications.length,0);
await json('/api/vehicles/catalog?all=true',400);
await json('/api/vehicles/catalog?catalog=full',400);
await json(`/api/vehicles/catalog?makeId=${make.id}&makeId=${make.id}`,400);
await json(`/api/vehicles/applications?${query}&year=2017&year=2018`,400);
for(const route of ['/checkout/success','/checkout/success?session_id=cs_test_nonexistentSecurityVerification123']){
  const response=await fetch(new URL(route,base),{signal:AbortSignal.timeout(30000)});
  const html=await response.text();
  assert.equal(response.status,200);
  assert.ok(html.includes('Awaiting payment confirmation'));
  assert.doesNotMatch(html,/>Payment received</);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  checks.push({route,status:response.status,pending:true,privateCache:true});
}
const report={checkedAt:new Date().toISOString(),base,readOnly:true,passed:true,checks};
fs.writeFileSync(`outputs/security-remediation-20261027/${base.startsWith('http://localhost')?'local':'production'}-http-verification.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
