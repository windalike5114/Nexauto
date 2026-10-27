import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const manifestPath=process.argv.find(a=>a.startsWith('--manifest='))?.slice(11)||'outputs/production-rollup-20261028/release-manifest.json';
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const base=manifest.source;
const folders=['app','components','lib','utils','data','public','styles','types'];
const config=['middleware.ts','next.config.mjs','package.json','package-lock.json','tsconfig.json','tailwind.config.ts','postcss.config.mjs','vercel.json'];
const hash=b=>createHash('sha256').update(b).digest('hex');
function walk(root,relative){
  const absolute=path.join(root,relative);if(!fs.existsSync(absolute))return [];
  return fs.readdirSync(absolute,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(root,path.join(relative,e.name)):[path.join(relative,e.name).replaceAll('\\','/')]);
}
const roots=[process.cwd(),base];
const files=[...new Set([...folders.flatMap(folder=>roots.flatMap(root=>walk(root,folder))),...config])].sort();
const changes=[];let identical=0;const formattingOnly=[];
for(const file of files){
  const local=path.join(process.cwd(),file),deployed=path.join(base,file);
  const localHash=fs.existsSync(local)?hash(fs.readFileSync(local)):null,deployedHash=fs.existsSync(deployed)?hash(fs.readFileSync(deployed)):null;
  if(localHash===deployedHash){identical++;continue;}
  if(localHash&&deployedHash&&/\.(?:tsx?|m?js|json|css|svg|txt|html)$/.test(file)){
    const normalize=file=>fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
    if(normalize(local)===normalize(deployed)){formattingOnly.push(file);continue;}
  }
  changes.push({file,status:localHash===null?'deleted':deployedHash===null?'added':'modified',localSha256:localHash,deployedSha256:deployedHash});
}
const report={checkedAt:new Date().toISOString(),baselineDeployment:manifest.productionDeployment||manifest.deployment,baselineSource:base,identical,formattingOnly,changes};
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'outputs/security-quota-20261028/pending-runtime-audit.json';
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({identical,formattingOnly:formattingOnly.length,changes:changes.map(({file,status})=>({file,status}))},null,2));
