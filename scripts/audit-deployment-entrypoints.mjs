import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const cli='C:/Users/Sanli/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/vercel/dist/index.js';
const team='team_QfLZmgxpE1WfMPq3qxg7vjxL',project='prj_XhtfDnaj0DtWZBmWnM1BlzqFcKgz';
const out='outputs/security-quota-20261028';
function api(route){
  const p=spawnSync(process.execPath,[cli,'api',route,'--raw'],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:8*1024*1024});
  if(p.status!==0)throw Error(`Vercel inventory failed: ${p.status}`);
  return JSON.parse(p.stdout);
}
async function inventory(){
  const p=api(`/v9/projects/${project}?teamId=${team}`);
  // Do not persist environment variables, access tokens, bypass secrets or member identities.
  const settings={name:p.name,id:p.id,ssoProtection:p.ssoProtection,passwordProtectionEnabled:Boolean(p.passwordProtection),trustedIpsEnabled:Boolean(p.trustedIps),protectionBypassTokenCount:Object.keys(p.protectionBypass||{}).length};
  const domains=api(`/v9/projects/${project}/domains?teamId=${team}&limit=100`);
  let deployments=[],cursor=null,pages=0;
  do{
    const page=api(`/v6/deployments?projectId=${project}&teamId=${team}&limit=100${cursor?`&until=${cursor}`:''}`);
    deployments.push(...page.deployments.map(d=>({id:d.uid||d.id,url:d.url,state:d.state,target:d.target,created:d.created,readyState:d.readyState})));
    cursor=page.pagination?.next;pages++;
    if(pages>30)throw Error('Deployment inventory exceeds safety bound; do not claim complete');
  }while(cursor);
  let aliases=[],aliasCursor=null,aliasPages=0;
  do{
    const page=api(`/v4/aliases?projectId=${project}&teamId=${team}&limit=100${aliasCursor?`&until=${aliasCursor}`:''}`);
    aliases.push(...page.aliases.map(a=>({alias:a.alias,deploymentId:a.deploymentId||a.deployment?.id})));
    aliasCursor=page.pagination?.next;aliasPages++;
    if(aliasPages>30)throw Error('Alias inventory exceeds safety bound');
  }while(aliasCursor);
  const result={checkedAt:new Date().toISOString(),settings,domains:domains.domains.map(d=>({name:d.name,redirect:d.redirect,gitBranch:d.gitBranch})),domainsComplete:!domains.pagination?.next,deployments,aliases,deploymentPages:pages,aliasPages,complete:true};
  fs.writeFileSync(`${out}/entrypoint-inventory.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({settings,domains:result.domains,deployments:deployments.length,aliases:aliases.length,pages,aliasPages}));
}
async function probe(){
  const inventory=JSON.parse(fs.readFileSync(`${out}/entrypoint-inventory.json`,'utf8'));
  const hosts=[...new Set([...inventory.domains.map(d=>d.name),...inventory.aliases.map(a=>a.alias),...inventory.deployments.map(d=>d.url)])];
  const rows=[];
  // Anonymous, no cookies or platform bypass token. Bounded response prefix only.
  async function one(host,path){
    const start=Date.now();
    try{
      const r=await fetch(`https://${host}${path}`,{redirect:'manual',signal:AbortSignal.timeout(12000)});
      const reader=r.body?.getReader();let prefix='';
      if(reader){const value=await reader.read();prefix=new TextDecoder().decode(value.value||new Uint8Array()).slice(0,1000);await reader.cancel();}
      return {host,path,status:r.status,location:r.headers.get('location'),protection:r.headers.get('x-fitment-protection'),cache:r.headers.get('cache-control'),contentType:r.headers.get('content-type'),platformLogin:/vercel\.com\/(sso-api|login)/.test(r.headers.get('location')||'')||/Authentication Required|Vercel Authentication/.test(prefix),jsonCatalogue:/"makes"\s*:|"models"\s*:/.test(prefix),durationMs:Date.now()-start};
    }catch{return {host,path,error:'network-or-timeout'};}
  }
  for(let i=0;i<hosts.length;i+=6){
    const batch=hosts.slice(i,i+6);
    rows.push(...await Promise.all(batch.flatMap(host=>['/api/vehicles/catalog','/shop'].map(path=>one(host,path)))));
  }
  const result={checkedAt:new Date().toISOString(),anonymous:true,hostCount:hosts.length,inventoryComplete:inventory.complete&&inventory.domainsComplete,rows};
  fs.writeFileSync(`${out}/entrypoint-probes-${process.argv.includes('--after')?'after':'before'}.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({hosts:hosts.length,requests:rows.length,counts:rows.reduce((a,r)=>(a[r.status||r.error]=(a[r.status||r.error]||0)+1,a),{}),publicCatalogues:rows.filter(r=>r.jsonCatalogue),errors:rows.filter(r=>r.error).length}));
}
if(process.argv.includes('--probe'))await probe();else await inventory();
