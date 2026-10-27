import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {originVerification,quotaSecret} from '../lib/application/fitment/shared-quota';
for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const dir='outputs/pending-update-release-20261028',candidate=process.argv.includes('--candidate');
const deploy=JSON.parse(fs.readFileSync(`${dir}/candidate-deployment.json`,'utf8').replace(/^\uFEFF/,'')).deployment;
const base=candidate?deploy.url:'https://nexautoparts.co.nz';
const cli='C:/Users/Sanli/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/vercel/dist/index.js';
let cookie='';const checks:any[]=[];
async function request(route:string,method='GET',data?:unknown){
 const headers:Record<string,string>={...(cookie?{cookie}:{}),...(data?{'content-type':'application/json'}:{})};
 let status:number,h:Headers,body:string;
 if(candidate){
  headers['x-nexauto-quota-verification']=await originVerification(new Request(new URL(route,base),{method}),quotaSecret());
  const args=[cli,'curl',route,'--deployment',base,'--','--silent','--show-error','--include','--max-time','25','--request',method];
  for(const [k,v]of Object.entries(headers))args.push('--header',`${k}: ${v}`);
  if(data)args.push('--data-binary',JSON.stringify(data));
  const p=spawnSync(process.execPath,args,{cwd:`${dir}/source`,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:35000});assert.equal(p.status,0,route);
  const raw=p.stdout.replace(/\r\n/g,'\n'),at=raw.indexOf('\n\n'),head=raw.slice(0,at).split('\n');status=Number(head[0].match(/HTTP\/\S+\s+(\d+)/)?.[1]);h=new Headers();
  for(const line of head.slice(1)){const i=line.indexOf(':');if(i>0)h.append(line.slice(0,i),line.slice(i+1).trim());}body=raw.slice(at+2);
 }else{const r=await fetch(new URL(route,base),{method,headers,body:data?JSON.stringify(data):undefined,redirect:'manual',signal:AbortSignal.timeout(30000)});status=r.status;h=r.headers;body=await r.text();}
 const issued=h.get('set-cookie')?.match(/(?:^|,\s*)(__Host-nexauto_fitment=[^;]+)/)?.[1];if(issued)cookie=issued;
 checks.push({route,method,status,protection:h.get('x-fitment-protection')});return {status,h,body};
}
const expected=[['NBP1212','DB1849'],['NBP1252','DB2193'],['NBP1524','DB1405']];
for(const [sku,ref]of expected)for(const value of [sku,ref,ref+'W']){
 const r=await request(`/brake-pads/${value}`);assert.equal(r.status,200,value);assert.equal(r.h.get('x-fitment-protection'),'shared-v1');
 const title=r.body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1].replace(/<[^>]*>/g,'')||'';
 assert.ok(title.includes(ref+' Front'),`${value}: canonical title`);assert.ok(!title.includes(ref+'W'));
}
const shop=await request('/shop');assert.equal(shop.status,200);assert.equal(shop.h.get('x-fitment-protection'),'shared-v1');
const page=await request('/api/catalogue/page','POST',{page:2});assert.equal(page.status,200);const payload=JSON.parse(page.body);assert.equal(payload.pageSize,24);assert.equal(payload.items.length,24);assert.equal(payload.total,494);
for(const [sku,ref]of expected){const found=await request('/api/catalogue/page','POST',{query:sku});assert.equal(found.status,200);const items=JSON.parse(found.body).items;assert.equal(items.length,1);assert.equal(items[0].sku,sku);assert.ok(items[0].name.includes(ref));}
const makes=await request('/api/vehicles/catalog');assert.equal(makes.status,200);assert.equal(makes.h.get('x-fitment-protection'),'shared-v1');
for(const route of ['/cart','/checkout','/checkout/success']){const r=await request(route);assert.equal(r.status,200);if(route.endsWith('/success')){assert.match(r.body,/Awaiting payment confirmation/);assert.doesNotMatch(r.body,/>Payment received</);}}
fs.writeFileSync(`${dir}/${candidate?'candidate':'production'}-verification.json`,JSON.stringify({checkedAt:new Date().toISOString(),base,candidate,passed:true,checks,noDatabaseWrites:true,noOrdersOrPayments:true},null,2));
console.log(JSON.stringify({passed:true,checks:checks.length,base,legacyLinksPreserved:3,total:494,pageSize:24}));
