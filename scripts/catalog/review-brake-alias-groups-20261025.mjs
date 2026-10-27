import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {prepareAudit} from './audit-brake-pad-strict-20261024.mjs';

const outArg=process.argv.find(a=>a.startsWith('--out='))?.slice('--out='.length);
export const OUT=path.resolve(outArg||'outputs/brake-alias-group-review-20261025');
export const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export const put=(name,value)=>{fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,name),JSON.stringify(value,null,2));};
export const group=(rows,fn)=>{const m=new Map();for(const row of rows){const k=fn(row);if(!m.has(k))m.set(k,[]);m.get(k).push(row);}return m;};
export const unique=rows=>[...new Set(rows)].sort();
export const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function client(){
  for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){
    const m=line.match(/^([^#=]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export const SPECS=[['makes','vehicle_catalog_makes','make_id'],['models','vehicle_catalog_models','model_id'],['series','vehicle_catalog_series','series_id'],['variants','vehicle_catalog_variants','variant_id'],['engines','vehicle_catalog_powertrains','powertrain_id'],['applications','vehicle_catalog_applications','application_id'],['products','product_variants','id'],['fitments','vehicle_catalog_product_fitments','application_id'],['years','vehicle_catalog_application_years','application_id'],['engineCodes','vehicle_catalog_engine_codes','engine_code_id'],['powertrainEngineCodes','vehicle_catalog_powertrain_engine_codes','powertrain_id']];
export async function all(db,table,id){
  const order=q=>{let r=q.order(id);if(table==='vehicle_catalog_product_fitments')r=r.order('product_variant_id').order('position');if(table==='vehicle_catalog_application_years')r=r.order('model_year');if(table==='vehicle_catalog_powertrain_engine_codes')r=r.order('engine_code_id');return r;};
  const first=await order(db.from(table).select('*',{count:'exact'})).range(0,999);if(first.error)throw new Error(`${table}: ${first.error.message}`);
  const rows=[...first.data],pages=Math.ceil(first.count/1000);
  for(let from=1;from<pages;from+=5){const batch=await Promise.all(Array.from({length:Math.min(5,pages-from)},(_,i)=>order(db.from(table).select('*')).range((from+i)*1000,(from+i+1)*1000-1)));for(const b of batch){if(b.error)throw new Error(`${table}: ${b.error.message}`);rows.push(...b.data);}}
  if(rows.length!==first.count)throw new Error(`Incomplete ${table}: ${rows.length}/${first.count}`);
  return rows;
}
export async function snapshot(db){
  const result={fetched_at:new Date().toISOString()};
  // Bound parallel table requests to avoid burst pressure on production.
  for(let i=0;i<SPECS.length;i+=3)await Promise.all(SPECS.slice(i,i+3).map(async([name,table,id])=>{result[name]=await all(db,table,id);console.log(`${name}: ${result[name].length}`);}));
  result.completed_at=new Date().toISOString();return result;
}
function diagnostic(data){
  const sources=read('outputs/brake-pad-expansion-20261024/confirmation-data.json').sourceRows;
  const audit=prepareAudit(data,sources);put('live-original-policy-audit.json',audit);
  const pending=audit.rows.filter(r=>r.before_status==='review'&&r.years.some(y=>y>=2000&&y<=2026)&&r.popular_rank);
  const groups=[...group(pending,r=>[r.rule,r.make,r.model,r.series,r.body,r.drive,r.position,r.db].join('|'))].map(([k,rows])=>({key:k,rule:rows[0].rule,make:rows[0].make,model:rows[0].model,series:rows[0].series,body:rows[0].body,drive:rows[0].drive,position:rows[0].position,db:rows[0].db,relations:rows.length,years:unique(rows.flatMap(r=>r.years)),engines:unique(rows.map(r=>r.engine)),platform_db:unique(rows.flatMap(r=>r.platform_db)),source_ids:unique(rows.flatMap(r=>r.platform_source_rows)),applications:rows.map(r=>r.application_id)})).sort((a,b)=>b.relations-a.relations);
  put('pending-groups.json',groups);
  console.log(JSON.stringify({baseline:audit.before,pending_popular:pending.length,group_count:groups.length,top_groups:groups.slice(0,75)},null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
  if(process.argv.includes('--fetch')){const data=await snapshot(client());put('before-snapshot.json',data);diagnostic(data);}
  else diagnostic(read(path.join(OUT,'before-snapshot.json')));
}
