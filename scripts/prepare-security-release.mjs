import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=process.cwd(),dir=path.join(root,'outputs/security-remediation-20261027');
const rebase=process.argv.includes('--rebase');
const base=path.join(root,rebase?'outputs/catalogue-release-20261027/source':'outputs/global-vehicle-20261027/release/source');
const target=path.join(dir,rebase?'rebased-release/source':'release/source');
const blockedDownloads=['public/downloads/nexautoparts-brake-pad-fitment-validation.xlsx','public/downloads/nexautoparts-oil-filter-fitment-validation.xlsx'];
const hash=data=>createHash('sha256').update(data).digest('hex');
let deployment=JSON.parse((await fs.readFile(path.join(dir,'production-deployment-before.json'),'utf8')).replace(/^\uFEFF/,''));
if(rebase){
  const latest=JSON.parse((await fs.readFile(path.join(root,'outputs/catalogue-release-20261027/release-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
  const alias=JSON.parse((await fs.readFile(path.join(dir,'production-alias-current.json'),'utf8')).replace(/^\uFEFF/,''));
  if(latest.deployment.id!==alias.deployment.id)throw new Error('Latest production source cannot be confirmed');
  for(const file of latest.files)if(hash(await fs.readFile(path.join(base,file.path)))!==file.afterSha256.toLowerCase())throw new Error(`Latest production source changed: ${file.path}`);
  deployment=latest.deployment;
}else if (deployment.id!=='dpl_GQbQdNUnbWyi2CqKFvoYnEpq5A1Z') throw new Error('Production changed: refresh release baseline');
await fs.mkdir(path.dirname(target),{recursive:true});
await fs.mkdir(target); // Do not overwrite another release.
await fs.cp(base,target,{recursive:true,filter:source=>{
  const relative=path.relative(base,source),first=relative.split(path.sep)[0];
  return !blockedDownloads.includes(relative.split(path.sep).join('/')) && !['node_modules','.git','outputs','deliverables'].includes(first) && !first.startsWith('.next') && (!first.startsWith('.env')||first==='.env.example');
}});
const overlay=[
  'app/checkout/success/page.tsx','components/checkout-success-actions.tsx','lib/application/checkout/verify-checkout-payment.ts',
  'app/api/vehicles/catalog/route.ts','app/api/vehicles/applications/route.ts','lib/application/fitment/vehicle-catalog-api.ts',
  'lib/application/fitment/public-api.ts','lib/queries/public-vehicle-catalog.ts','lib/queries/vehicle-catalog.ts',
  'components/friendly-vehicle-parts-finder.tsx','components/account-auth.tsx',
  'tests/checkout-payment-verification.test.ts','tests/checkout-success-actions.test.mjs','tests/vehicle-catalog-security.test.ts',
  'supabase/migrations/20261105_private_events_and_internal_functions.sql','supabase/migrations/20261106_vehicle_catalog_server_access.sql'
];
const files=[];
for(const file of overlay){
  const to=path.join(target,file),data=await fs.readFile(path.join(root,file));
  let before=null; try{before=hash(await fs.readFile(to));}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.mkdir(path.dirname(to),{recursive:true}); await fs.writeFile(to,data);
  files.push({file,before_sha256:before,after_sha256:hash(data)});
}
await fs.writeFile(path.join(target,'.vercelignore'),'.git\n.next*\nnode_modules\n.env*\n!.env.example\noutputs\ndeliverables\n.artifact-work\n');
await fs.writeFile(path.join(dir,rebase?'rebased-release-manifest.json':'release-manifest.json'),JSON.stringify({baseline:deployment.id,rollback:deployment.url,source:target,files,removed_public_files:blockedDownloads,productionChanged:false,preservedCatalogueUpdate:rebase},null,2));
console.log(JSON.stringify({source:target,files:files.length,baseline:deployment.id}));
