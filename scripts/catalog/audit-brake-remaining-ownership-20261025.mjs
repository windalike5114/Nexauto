import fs from 'node:fs';
import path from 'node:path';
import {enrich} from './process-brake-alias-review-20261025.mjs';

const snapshotPath=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11)
  ??'outputs/brake-exact-application-peer-round3-20261025/after-snapshot.json';
const outPath=process.argv.find(a=>a.startsWith('--out='))?.slice(6)
  ??'outputs/brake-remaining-ownership-audit-20261025.json';
const data=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
const apps=enrich(data).filter(a=>a.status==='active'&&a.all_years.length);
const yearKey=a=>a.all_years.join(',');
const normalizedSeries=a=>String(a.series??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const peerKey=a=>[a.make,normalizedSeries(a),a.variant_id,a.powertrain_id,yearKey(a)].join('|');
const groups=new Map();
for(const a of apps){const k=peerKey(a);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(a);}
const rows=[];
for(const cluster of groups.values()){
  if(new Set(cluster.map(a=>a.model)).size<2)continue;
  for(const a of cluster.filter(a=>a.rank&&a.years.length&&!a.published.length)){
    const peers=cluster.filter(p=>p.application_id!==a.application_id);
    rows.push({
      application_id:a.application_id,rank:a.rank,group:a.group,make:a.make,model:a.model,
      series:a.series,variant:a.variant,body:a.body,drive:a.drive,engine:a.engine,
      engine_codes:a.engine_codes,years:a.all_years,
      review:a.existing.filter(r=>r.fitment_status==='review').map(r=>({position:r.position,sku:r.sku,db:r.db})),
      peers:peers.map(p=>({application_id:p.application_id,model:p.model,series:p.series,variant:p.variant,
        engine:p.engine,years:p.all_years,published:p.published.map(r=>({position:r.position,sku:r.sku,db:r.db})),
        review:p.existing.filter(r=>r.fitment_status==='review').map(r=>({position:r.position,sku:r.sku,db:r.db}))}))
    });
  }
}
rows.sort((a,b)=>a.rank-b.rank||a.make.localeCompare(b.make)||a.model.localeCompare(b.model)||a.series.localeCompare(b.series));
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,JSON.stringify({created_at:new Date().toISOString(),snapshot:snapshotPath,count:rows.length,rows},null,2));
console.log(JSON.stringify({count:rows.length,by_group:Object.fromEntries([...new Map(rows.map(r=>[r.group,0]))].map(([g])=>[g,rows.filter(r=>r.group===g).length])),sample:rows.slice(0,30)},null,2));
