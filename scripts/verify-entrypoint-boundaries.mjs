import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='outputs/security-quota-20261028',read=f=>JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8').replace(/^\uFEFF/,''));
const fallback='https://nexauto-neon.vercel.app',preview=read('preview-deployment.json').deployment.url;
const checks=[];
async function probe(base,path,headers={},method='GET'){
  const r=await fetch(new URL(path,base),{headers,method,...(method==='POST'?{body:'{}'}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  const body=await r.text();const result={base,path,method,status:r.status,location:r.headers.get('location'),protection:r.headers.get('x-fitment-protection'),spoofHeaders:Object.keys(headers),publicVehicleData:/"makes"\s*:|"models"\s*:|"items"\s*:/.test(body)};
  checks.push(result);return result;
}
for(const path of ['/api/vehicles/catalog','/api/vehicles/applications','/api/vehicles/makes','/api/vehicles/models','/api/vehicles/years','/api/fitment/wipers/makes']){
  const r=await probe(fallback,path);assert.equal(r.status,403,path);assert.equal(r.publicVehicleData,false);
}
assert.equal((await probe(fallback,'/api/catalogue/page',{'content-type':'application/json'},'POST')).status,403);
for(const headers of [ {'x-forwarded-host':'nexautoparts.co.nz'}, {'host':'nexauto-neon.vercel.app','x-original-host':'nexautoparts.co.nz'}, {'x-vercel-protection-bypass':'invalid-lab-token'}, {'x-middleware-subrequest':'middleware:middleware:middleware:middleware:middleware'} ]){
  assert.equal((await probe(fallback,'/api/vehicles/catalog',headers)).status,403);
}
for(const headers of [{},{RSC:'1','Next-Router-Prefetch':'1'},{'x-middleware-subrequest':'middleware:middleware:middleware:middleware:middleware'}]){
  const r=await probe(fallback,'/shop',headers);assert.equal(r.status,308);assert.match(r.location||'',/^https:\/\/nexautoparts.co.nz\/shop/);
}
for(const path of ['/api/vehicles/catalog','/shop']){
  const r=await probe(preview,path);assert.equal(r.status,302);assert.match(r.location||'',/^https:\/\/vercel.com\/sso-api/);
}
// Explicitly retain the boundary: this is data-route protection, not complete origin isolation.
for(const path of ['/','/cart','/checkout'])await probe(fallback,path);
fs.writeFileSync(`${dir}/entrypoint-boundary-verification.json`,JSON.stringify({checkedAt:new Date().toISOString(),passed:true,preview,checks,remaining:'Default host remains publicly reachable for home/cart/checkout. Cloudflare-wide origin isolation is not established.'},null,2));
console.log(JSON.stringify({passed:true,checks:checks.length,defaultDataDenied:11,previewProtected:2,publicNonCatalogueRoutes:checks.filter(r=>r.base===fallback&&r.status===200).map(r=>r.path)}));
