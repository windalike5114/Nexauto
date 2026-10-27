import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='outputs/security-quota-20261028',cli='C:/Users/Sanli/AppData/Local/npm-cache/_npx/46dba4b4f8747427/node_modules/vercel/dist/index.js';
const read=f=>JSON.parse(fs.readFileSync(`${dir}/${f}`,'utf8').replace(/^\uFEFF/,''));
const hash=b=>createHash('sha256').update(b).digest('hex');
function call(args){const p=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024*1024,cwd:`${dir}/release/source`});if(p.status!==0)throw Error(`Vercel ${args[0]} failed`);return p.stdout;}
const candidate=read('candidate-deployment.json').deployment,manifest=read('release-manifest.json'),test=read('candidate-http-verification.json');
if(!test.passed||test.base!==candidate.url)throw Error('Candidate verification mismatch');
for(const file of manifest.files){
  const data=fs.readFileSync(path.join(manifest.source,file.file));
  if(hash(data)!==hash(fs.readFileSync(file.file)))throw Error(`Release/source mismatch: ${file.file}`);
  file.after_sha256=hash(data);
}
const state=JSON.parse(call(['inspect',candidate.url,'--json']));if(state.id!==candidate.id||state.readyState!=='READY')throw Error('Candidate is not ready');
fs.writeFileSync(`${dir}/final-candidate-status.json`,JSON.stringify({id:state.id,url:state.url,readyState:state.readyState,target:state.target,duration:state.duration},null,2));
const aliasPath='/v4/aliases/nexautoparts.co.nz?teamId=team_QfLZmgxpE1WfMPq3qxg7vjxL';
const before=JSON.parse(call(['api',aliasPath,'--raw']));
if(before.deployment.id!==manifest.baseline.id)throw Error('Production changed: rebase required before promotion');
fs.writeFileSync(`${dir}/alias-immediately-before.json`,JSON.stringify({alias:before.alias,deployment:before.deployment,checkedAt:new Date().toISOString()},null,2));
fs.writeFileSync(`${dir}/promotion-output.txt`,call(['promote',candidate.url,'--yes']));
const after=JSON.parse(call(['api',aliasPath,'--raw']));if(after.deployment.id!==candidate.id)throw Error('Post-promotion alias mismatch');
manifest.productionChanged=true;manifest.productionDeployment=candidate;manifest.promotedAt=new Date().toISOString();
fs.writeFileSync(`${dir}/release-manifest.json`,JSON.stringify(manifest,null,2));
fs.writeFileSync(`${dir}/alias-after.json`,JSON.stringify({alias:after.alias,deployment:after.deployment,checkedAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({promoted:true,id:candidate.id,url:candidate.url,baseline:manifest.baseline.id,files:manifest.files.length}));
