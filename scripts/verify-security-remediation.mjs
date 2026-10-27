import fs from 'node:fs';
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m=line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if(m && !process.env[m[1]]) process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !anon || !service) throw new Error('Missing database configuration');
const headers=key=>({apikey:key,...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})});
const snapshot=JSON.parse(fs.readFileSync('outputs/security-remediation-20261027/production-before.json','utf8').replace(/^\uFEFF/,''));
const includeCatalog=process.argv.includes('--catalog');
const targets=snapshot.tables.filter(t=>includeCatalog || ['order_claim_events','stripe_webhook_events'].includes(t.name));
const results=[];
for(const target of targets){
  const url=`${base}/rest/v1/${target.name}?select=*&limit=1`;
  const anonymous=await fetch(url,{headers:headers(anon),signal:AbortSignal.timeout(20000)});
  // Never retain row contents. Even unexpected success is reported only as a status.
  const anonymousBody=await anonymous.json().catch(()=>null);
  const server=await fetch(url,{headers:headers(service),signal:AbortSignal.timeout(20000)});
  await server.arrayBuffer();
  results.push({table:target.name,anonymousStatus:anonymous.status,errorCode:!anonymous.ok?anonymousBody?.code:null,
    anonymousDenied:!anonymous.ok,serverStatus:server.status,serverReadable:server.ok});
}
const report={checkedAt:new Date().toISOString(),phase:includeCatalog?'private-and-catalog':'private-events',readOnly:true,
  dataRetained:false,results,passed:results.every(r=>r.anonymousDenied&&r.serverReadable)};
const file=`outputs/security-remediation-20261027/${includeCatalog?'catalog':'private-events'}-access-after.json`;
fs.writeFileSync(file,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
