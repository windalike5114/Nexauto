import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=path.join(root,'outputs/security-quota-20261028');
const base=path.join(root,'outputs/security-remediation-20261027/rebased-release/source'),target=path.join(out,'release/source');
const alias=JSON.parse((await fs.readFile(path.join(out,'production-alias-before.json'),'utf8')).replace(/^\uFEFF/,''));
if(alias.deployment.id!=='dpl_zNfLiHy8Aaq6x3qzdEan7pjzNeYW')throw Error('Refresh production source baseline');
const hash=b=>createHash('sha256').update(b).digest('hex');
const prior=JSON.parse(await fs.readFile(path.join(root,'outputs/security-remediation-20261027/rebased-release-manifest.json'),'utf8'));
for(const f of prior.files)if(hash(await fs.readFile(path.join(base,f.file)))!==f.after_sha256)throw Error(`Baseline changed: ${f.file}`);
await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(target);
await fs.cp(base,target,{recursive:true,filter:source=>{
  const first=path.relative(base,source).split(path.sep)[0];
  return !['node_modules','.git','outputs','deliverables'].includes(first)&&!first.startsWith('.next')&&(!first.startsWith('.env')||first==='.env.example');
}});
const files=['middleware.ts','lib/application/fitment/public-api.ts','lib/application/fitment/shared-quota.ts','lib/application/fitment/vehicle-catalog-api.ts','lib/application/fitment/vehicle-lookup-timing.ts',
  ...['makes','models','years','variants','results'].map(s=>`app/api/fitment/wipers/${s}/route.ts`),
  'tests/helpers/quota-fixture.ts','tests/shared-fitment-quota.test.ts','tests/fitment-api-security.test.ts','tests/vehicle-catalog-security.test.ts',
  'supabase/migrations/20261107_shared_fitment_quotas.sql'];
const changes=[];
for(const file of files){
  const to=path.join(target,file),data=await fs.readFile(path.join(root,file));let before=null;
  try{before=hash(await fs.readFile(to));}catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,data);changes.push({file,before_sha256:before,after_sha256:hash(data)});
}
const manifest={baseline:alias.deployment,source:target,files:changes,productionChanged:false,rollback:'Keep private quota tables/RLS; promote baseline deployment only if emergency service restoration is necessary. Baseline lacks shared quotas.'};
await fs.writeFile(path.join(out,'release-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({source:target,files:changes.length,baseline:alias.deployment.id}));
