import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {client,all} from './review-brake-alias-groups-20261025.mjs';
import {OUT,POLICY,SOURCE,hash,plan,coverage} from './expand-filter-model-years-20261025.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const put=(n,v)=>fs.writeFileSync(path.join(OUT,n),JSON.stringify(v,null,2));
const d=read('before-snapshot.json'),p=read('plan.json'),secondary=read('secondary-source.json'),primary=JSON.parse(fs.readFileSync('outputs/ryco-filter-import-20261025/source.json','utf8'));
const stable=rr=>hash(rr.map(r=>JSON.stringify(r)).sort());
const semantic=rr=>stable(rr.map(r=>Object.fromEntries(Object.entries(r).filter(([k])=>k!=='updated_at'))));
const unique=rr=>[...new Set(rr)];
const db=client(),keys={catalog_data_sources:['code'],vehicle_catalog_part_reference_fitments:['application_id','part_reference_id','position','data_source_id'],vehicle_catalog_product_fitments:['application_id','product_variant_id','position']};
const key=(table,r)=>JSON.stringify(keys[table].map(k=>r[k]));
async function fetchRows(table,rows){
 if(!rows.length)return [];
 const field=keys[table][0],values=unique(rows.map(r=>r[field])),out=[];
 for(let i=0;i<values.length;i+=50)for(let from=0;;from+=1000){let q=db.from(table).select('*').in(field,values.slice(i,i+50));for(const k of keys[table])q=q.order(k);const r=await q.range(from,from+999);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<1000)break;}
 const wanted=new Set(rows.map(r=>key(table,r)));return out.filter(r=>wanted.has(key(table,r)));
}
async function check(table,rows){const data=await fetchRows(table,rows);assert.equal(data.length,rows.length);const by=new Map(data.map(r=>[key(table,r),r]));for(const row of rows)for(const [k,v] of Object.entries(row))assert.deepEqual(by.get(key(table,row))?.[k],v,`Readback ${table}.${k}`);return data;}
async function rollback(journal){
 for(const {table,rows,before} of [...journal].reverse()){
  const existed=new Set(before.map(r=>key(table,r)));for(const row of rows.filter(r=>!existed.has(key(table,r)))){let q=db.from(table).delete();for(const k of keys[table])q=q.eq(k,row[k]);const r=await q;if(r.error)throw r.error;}
  if(before.length){const r=await db.from(table).upsert(before,{onConflict:keys[table].join(',')});if(r.error)throw r.error;}
  assert.equal(semantic(await fetchRows(table,rows)),semantic(before),`Rollback ${table}`);
 }
 put('rollback.json',{verified:true,at:new Date().toISOString()});
}
async function apply(){
 assert(!fs.existsSync(path.join(OUT,'apply-journal.json')),'Prior apply exists; inspect before retrying');
 assert.equal(p.snapshot_hash,hash(d));assert.equal(p.source_hash,hash(primary));assert.equal(p.secondary_hash,hash(secondary));
 for(const f of [...primary.files,{file:secondary.file,sha256:secondary.sha256},{file:secondary.cleaned_file,sha256:secondary.cleaned_sha256}])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.file)).digest('hex'),f.sha256,'Source changed');
 const products=await all(db,'product_variants','id'),identifiers=await all(db,'product_identifiers','id');
 assert.equal(stable(products.filter(r=>/^NOF\d/.test(r.sku))),stable(d.products.filter(r=>/^NOF\d/.test(r.sku))),'Oil products changed');assert.equal(stable(identifiers),stable(d.identifiers),'Identifiers changed');
 const ids=unique([...p.referenceWrites,...p.productWrites].map(r=>r.application_id));
 for(const [table,before] of [['vehicle_catalog_applications',d.applications],['vehicle_catalog_application_years',d.years]]){let q=db.from(table).select('*').in('application_id',ids).order('application_id');if(table.endsWith('_years'))q=q.order('model_year');const r=await q;if(r.error)throw r.error;assert(r.data.length<1000);assert.equal(stable(r.data),stable(before.filter(r=>ids.includes(r.application_id))),`Identity changed ${table}`);}
 const sourceId=crypto.randomUUID();
 const payload=[
 ['catalog_data_sources',[{id:sourceId,code:SOURCE,name:'Exact platform/engine cross-source filter model-year completion 2026-10-25',source_kind:'manual',vehicle_identity_priority:100,product_fitment_priority:25,active:true,metadata:{policy:POLICY,primary_evidence:'User supplied Ryco annual records',secondary_evidence:{file:path.basename(secondary.file),sha256:secondary.sha256,source:'Tinkr extracted text; corroboration only'},year_rule:'two_primary_anchor_years_and_explicit_secondary_interval_same_platform_engine_body_drive',month_boundaries_excluded:true}}]],
 ['vehicle_catalog_part_reference_fitments',p.referenceWrites.map(r=>({application_id:r.application_id,part_reference_id:r.part_reference_id,position:'vehicle',data_source_id:sourceId,fitment_status:'published',confidence:'high',source_row_numbers:unique(r.evidence.primary.map(x=>x.row)).sort((a,b)=>a-b),match_reasons:[r.rule],metadata:{policy:POLICY,source_code:SOURCE,application_years:r.years,source_supported_years:r.evidence.supported,corroborated_gap_years:r.evidence.missing,primary_rows:r.evidence.primary,secondary_file:path.basename(secondary.file),secondary_file_sha256:secondary.sha256,secondary_rows:r.evidence.secondary,selection_mode:'deterministic_exact_platform_engine_year_interval'}}))],
 ['vehicle_catalog_product_fitments',p.productWrites.map(r=>({application_id:r.application_id,product_variant_id:r.product_variant_id,position:'engine',fitment_status:'published',source:SOURCE,notes:JSON.stringify({policy:POLICY,rule:r.rule,reference:r.reference,primary_years:r.evidence.supported,corroborated_gap_years:r.evidence.missing,secondary_workbook:path.basename(secondary.file),secondary_rows:r.evidence.secondary.flatMap(s=>s.workbook_rows)})}))]
 ];
 const journal=[];
 for(const [table,rows] of payload){const before=await fetchRows(table,rows);if(table==='vehicle_catalog_product_fitments')assert.equal(stable(before),stable(p.productWrites.map(r=>r.before).filter(Boolean)),'Product fitments changed');if(table==='catalog_data_sources')assert.equal(before.length,0,'Source already exists');journal.push({table,rows,before});}
 put('preimage-backup.json',journal.map(({table,before})=>({table,before})));put('write-plan.json',payload);
 const completed=[];
 try{
  for(const entry of journal){completed.push(entry);put('apply-journal.json',completed);if(entry.rows.length){const r=await db.from(entry.table).upsert(entry.rows,{onConflict:keys[entry.table].join(',')});if(r.error)throw r.error;}await check(entry.table,entry.rows);console.log(entry.table+': '+entry.rows.length);}
  put('applied.json',{verified:true,at:new Date().toISOString(),source_id:sourceId,summary:p.summary,backup:'preimage-backup.json'});
 }catch(error){put('apply-error.json',{message:error.message});await rollback(completed);throw error;}
}
async function verify(){
 const applied=read('applied.json');assert(applied.verified);for(const e of read('apply-journal.json'))await check(e.table,e.rows);
 const fits=await all(db,'vehicle_catalog_product_fitments','application_id'),changed=new Set(p.productWrites.map(r=>key('vehicle_catalog_product_fitments',r)));
 assert.equal(stable(fits.filter(r=>!changed.has(key('vehicle_catalog_product_fitments',r)))),stable(d.fitments.filter(r=>!changed.has(key('vehicle_catalog_product_fitments',r)))),'Unrelated fitments changed');
 assert.equal(fits.length,new Set(fits.map(r=>key('vehicle_catalog_product_fitments',r))).size);
 const ref=await db.from('vehicle_catalog_part_reference_fitments').select('*').eq('data_source_id',applied.source_id);if(ref.error)throw ref.error;assert.equal(ref.data.length,p.referenceWrites.length);
 const products=await all(db,'product_variants','id');assert.equal(stable(products),stable(d.products),'Product rows changed');
 const after={...d,fitments:fits,referenceFits:[...d.referenceFits,...ref.data]};
 const next=plan(primary,secondary,after);assert.equal(next.productWrites.length,0);assert.equal(next.referenceWrites.length,0);
 const actual=coverage(after,{productWrites:[],referenceWrites:[]}),projected=read('coverage-before-projected.json');for(const scope of Object.keys(actual))for(const type of ['oil_filter','air_filter'])for(const layer of ['product','knowledge'])assert.deepEqual(actual[scope][type]['after_'+layer],projected[scope][type]['after_'+layer],`Coverage ${scope} ${type}`);
 put('coverage-after.json',actual);put('review-queue.json',p.review);put('conflict-queue.json',p.conflicts);
 const result={verified:true,at:new Date().toISOString(),summary:p.summary,unchanged_unrelated_product_fitments:true,no_vehicle_year_changes:true,no_product_creation:true,no_duplicate_fitments:true,repeat_product_writes:0,repeat_reference_writes:0,coverage_matches_projection:true};put('verification.json',result);console.log(JSON.stringify({verification:result,extended132:actual.extended132},null,2));
}
if(process.argv.includes('--apply'))await apply();else if(process.argv.includes('--verify'))await verify();else throw new Error('Use --apply or --verify');
