import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),out=path.join(root,'outputs/pending-update-release-20261028');
const prior=JSON.parse(await fs.readFile('outputs/production-rollup-20261028/release-manifest.json','utf8'));
const base=prior.source,target=path.join(out,'source'),hash=b=>createHash('sha256').update(b).digest('hex');
for(const f of prior.files)if(hash(await fs.readFile(path.join(base,f.path)))!==f.afterSha256)throw Error(`Production snapshot changed: ${f.path}`);
await fs.mkdir(out);await fs.mkdir(target);
await fs.cp(base,target,{recursive:true,filter:source=>{
  const first=path.relative(base,source).split(path.sep)[0];
  return !['node_modules','.git','outputs','deliverables'].includes(first)&&!first.startsWith('.next')&&(!first.startsWith('.env')||first==='.env.example');
}});
const files=[];
for(const file of ['data/brake-pads/catalog.json','lib/queries/brake-pad-catalog.ts']){
  const to=path.join(target,file),data=await fs.readFile(file);
  files.push({file,beforeSha256:hash(await fs.readFile(to)),afterSha256:hash(data)});await fs.writeFile(to,data);
}
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),baselineDeployment:prior.deployment,source:target,files,status:'prepared',scope:'Three canonical brake reference corrections and preservation of legacy links; no database writes',excluded:['Local-only build configuration','Maintenance/test scripts','Unreferenced bulb import source','Line-ending-only changes'],rollback:prior.deployment},null,2));
console.log(JSON.stringify({source:target,changedFiles:files.length,baseline:prior.deployment.id}));
