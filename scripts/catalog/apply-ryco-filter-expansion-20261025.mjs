import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {client,all} from './review-brake-alias-groups-20261025.mjs';
import {OUT,POLICY,SOURCE,plan,coverage} from './expand-ryco-filter-knowledge-20261025.mjs';
import {normalize} from './import-ryco-filter-fitments-20261025.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const put=(n,v)=>fs.writeFileSync(path.join(OUT,n),JSON.stringify(v,null,2));
const unique=rr=>[...new Set(rr)];
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stable=rr=>hash(rr.map(r=>JSON.stringify(r)).sort());
const sem=rr=>hash(rr.map(r=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='updated_at')))).sort());
const db=client(),d=read('before-snapshot.json'),p=read('plan.json');
const source=JSON.parse(fs.readFileSync('outputs/ryco-filter-import-20261025/source.json','utf8'));
assert.equal(p.snapshot_hash,hash(d));assert.equal(p.source_hash,hash(source));
const keys={catalog_data_sources:['code'],catalog_source_records:['id'],catalog_part_references:['id'],product_identifiers:['id'],catalog_part_reference_products:['part_reference_id','product_variant_id','relation_type'],vehicle_catalog_part_reference_fitments:['application_id','part_reference_id','position','data_source_id'],vehicle_catalog_product_fitments:['application_id','product_variant_id','position']};
const key=(table,r)=>JSON.stringify(keys[table].map(k=>r[k]));
async function fetchRows(table,rows){
 if(!rows.length)return [];
 const first=keys[table][0],values=unique(rows.map(r=>r[first])),out=[];
 for(let i=0;i<values.length;i+=60)for(let from=0;;from+=1000){let q=db.from(table).select('*').in(first,values.slice(i,i+60));for(const k of keys[table])q=q.order(k);const r=await q.range(from,from+999);if(r.error)throw r.error;out.push(...r.data);if(r.data.length<1000)break;}
 const wanted=new Set(rows.map(r=>key(table,r)));return out.filter(r=>wanted.has(key(table,r)));
}
async function checkRows(table,rows){
 const stored=await fetchRows(table,rows);assert.equal(stored.length,rows.length,`Count ${table}`);
 const by=new Map(stored.map(r=>[key(table,r),r]));for(const row of rows)for(const [k,v] of Object.entries(row)){if(k.endsWith('_at'))continue;assert.deepEqual(by.get(key(table,row))?.[k],v,`Readback ${table}.${k}`);}return stored;
}
async function rollback(journal){
 for(const {table,rows,before} of [...journal].reverse()){
  const existed=new Set(before.map(r=>key(table,r))),inserted=rows.filter(r=>!existed.has(key(table,r)));
  if(keys[table].length===1){for(let i=0;i<inserted.length;i+=100){const r=await db.from(table).delete().in(keys[table][0],inserted.slice(i,i+100).map(r=>r[keys[table][0]]));if(r.error)throw r.error;}}
  else for(const row of inserted){let q=db.from(table).delete();for(const k of keys[table])q=q.eq(k,row[k]);const r=await q;if(r.error)throw r.error;}
  for(let i=0;i<before.length;i+=100){const r=await db.from(table).upsert(before.slice(i,i+100),{onConflict:keys[table].join(',')});if(r.error)throw r.error;}
  assert.equal(sem(await fetchRows(table,rows)),sem(before),`Rollback ${table}`);
 }
 put('rollback.json',{verified:true,at:new Date().toISOString()});
}
async function apply(){
 assert(!fs.existsSync(path.join(OUT,'apply-journal.json')),'Prior apply exists; verify or roll back before applying');
 for(const f of source.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.file)).digest('hex'),f.sha256,'Source changed');
 const liveProducts=await all(db,'product_variants','id'),liveIds=await all(db,'product_identifiers','id');
 assert.equal(stable(liveProducts.filter(r=>/^NOF\d+$/.test(r.sku))),stable(d.products.filter(r=>/^NOF\d+$/.test(r.sku))),'Oil product state changed');
 assert.equal(stable(liveIds),stable(d.identifiers),'Identifiers changed');
 const ids=unique([...p.referenceWrites,...p.productWrites].map(r=>r.application_id));
 for(let i=0;i<ids.length;i+=40){const chunk=ids.slice(i,i+40);for(const [table,before,cols] of [['vehicle_catalog_applications',d.applications,'application_id'],['vehicle_catalog_application_years',d.years,'application_id']]){let q=db.from(table).select('*').in(cols,chunk).order(cols);if(table.endsWith('_years'))q=q.order('model_year');const r=await q;if(r.error)throw r.error;assert(r.data.length<1000);assert.equal(stable(r.data),stable(before.filter(a=>chunk.includes(a.application_id))),`Vehicle changed ${table}`);}}
 const sourceId=crypto.randomUUID();
 const z9=d.references.find(r=>r.product_type==='oil_filter'&&r.reference_scheme==='ryco'&&r.normalized_value==='Z9');assert(z9);
 const positioning={NOF1839:{positioning:'偏向小排量家用车',authority:'user_instruction',tendency_only:true,automatic_fitment_permission:false},NOF1804:{positioning:'偏向大排量商用车或皮卡',authority:'user_instruction',tendency_only:true,automatic_fitment_permission:false}};
 const z9Identifiers=d.identifiers.filter(r=>r.identifier_brand==='Ryco'&&r.normalized_value==='Z9'&&Object.hasOwn(positioning,d.products.find(p=>p.id===r.product_variant_id)?.sku??''));
 const z9Links=Object.keys(positioning).map(sku=>({part_reference_id:z9.id,product_variant_id:d.products.find(p=>p.sku===sku).id,relation_type:'exact_cross_reference',verification_status:'review',metadata:{policy:POLICY,source_code:SOURCE,selection_mode:'application_constrained',positioning:positioning[sku],approved_application_ids:p.productWrites.filter(r=>r.sku===sku&&r.reference==='Z9').map(r=>r.application_id)}}));
 const oldSource=d.sources.find(r=>r.code==='RYCO_USER_WORKBOOKS_20261025');assert(oldSource);
 const batches=await db.from('catalog_import_batches').select('*').eq('data_source_id',oldSource.id);if(batches.error)throw batches.error;
 const normalizedUpdates=[];
 for(const batch of batches.data){
  const relevant=source.rows.map(normalize).filter(r=>r.file===batch.source_file&&['oil_filter','air_filter'].includes(r.type)&&((r.engineCode&&!/\b(?:PET|DIE)\s+/i.test(r.engine))||p.engineResolvedRows.some(x=>x.file===r.file&&x.sheet===r.sheet&&x.row===r.row)));
  if(!relevant.length)continue;
  const r=await db.from('catalog_source_records').select('*').eq('batch_id',batch.id);if(r.error)throw r.error;assert(r.data.length<1000,'Source repair requires pagination');
  for(const n of relevant){const old=r.data.find(x=>x.row_number===n.row&&x.sheet_name===n.sheet);assert(old);const resolved=p.engineResolvedRows.find(x=>x.file===n.file&&x.sheet===n.sheet&&x.row===n.row);normalizedUpdates.push({...old,normalized_values:{...old.normalized_values,engine_code:n.engineCode||null,...(resolved?{engine_codes:resolved.resolvedCodes,engine_resolution:resolved.engineResolution,resolved_application_ids:resolved.resolvedApplications}:{}),displacement_cc:n.displacement||null,parser_policy:POLICY}});}
 }
 const refFits=p.referenceWrites.map(r=>({application_id:r.application_id,part_reference_id:r.part_reference_id,position:'vehicle',data_source_id:sourceId,fitment_status:'published',confidence:'high',source_row_numbers:unique(r.proof.map(x=>x.row)).sort((a,b)=>a-b),match_reasons:[r.rule],metadata:{policy:POLICY,source_code:SOURCE,source_rows:r.proof,application_years:r.years,field_dependency_analysis:'outputs/ryco-filter-expansion-20261025/field-dependency-analysis.json'}}));
 const productFits=p.productWrites.map(r=>({application_id:r.application_id,product_variant_id:r.product_variant_id,position:'engine',fitment_status:'published',source:SOURCE,notes:JSON.stringify({policy:POLICY,rule:r.rule,reference:r.reference,z9_rule:r.z9_rule,source_rows:r.proof})}));
 const payload=[
 ['catalog_data_sources',[{id:sourceId,code:SOURCE,name:'Ryco source-record engine/configuration expansion 2026-10-25',source_kind:'product_catalogue',vehicle_identity_priority:100,product_fitment_priority:20,active:true,metadata:{policy:POLICY,parent_source:oldSource.code,evidence:'user_supplied_Ryco_workbooks',z9_positioning_authority:'user_instruction',source_hash:p.source_hash}}]],
 ['catalog_source_records',normalizedUpdates],
 ['product_identifiers',z9Identifiers.map(r=>({...r,metadata:{...r.metadata,application_positioning:positioning[d.products.find(p=>p.id===r.product_variant_id).sku],positioning_policy:POLICY}}))],
 ['catalog_part_references',[{...z9,metadata:{...z9.metadata,product_selection_mode:'application_constrained',product_positioning:positioning,reference_only:false,positioning_policy:POLICY}}]],
 ['catalog_part_reference_products',z9Links],
 ['vehicle_catalog_part_reference_fitments',refFits],
 ['vehicle_catalog_product_fitments',productFits]
 ];
 const journal=[];
 for(const [table,rows] of payload){const before=await fetchRows(table,rows);if(table==='vehicle_catalog_product_fitments')assert.equal(stable(before),stable(p.productWrites.map(r=>r.before).filter(Boolean)),'Existing product fitments changed');if(table==='catalog_part_references')assert.equal(stable(before),stable([z9]),'Z9 reference changed');if(table==='product_identifiers')assert.equal(stable(before),stable(z9Identifiers),'Z9 identifiers changed');journal.push({table,rows,before});}
 put('preimage-backup.json',journal.map(({table,before})=>({table,before})));put('write-plan.json',payload);
 const completed=[];
 try{
  for(const entry of journal){completed.push(entry);put('apply-journal.json',completed);for(let i=0;i<entry.rows.length;i+=100){const r=await db.from(entry.table).upsert(entry.rows.slice(i,i+100),{onConflict:keys[entry.table].join(',')});if(r.error)throw new Error(`${entry.table}: ${r.error.message}`);}await checkRows(entry.table,entry.rows);console.log(entry.table+': '+entry.rows.length);}
  put('applied.json',{verified:true,at:new Date().toISOString(),source_id:sourceId,summary:p.summary,source_normalization_repairs:normalizedUpdates.length,tables:journal.map(r=>({table:r.table,rows:r.rows.length})),backup:'preimage-backup.json'});
 }catch(error){put('apply-error.json',{message:error.message});await rollback(completed);throw error;}
}
async function verify(){
 const applied=read('applied.json');assert(applied.verified);
 const journal=read('apply-journal.json');for(const entry of journal)await checkRows(entry.table,entry.rows);
 const fits=await all(db,'vehicle_catalog_product_fitments','application_id');
 const changed=new Set(p.productWrites.map(r=>key('vehicle_catalog_product_fitments',r)));
 assert.equal(stable(fits.filter(r=>!changed.has(key('vehicle_catalog_product_fitments',r)))),stable(d.fitments.filter(r=>!changed.has(key('vehicle_catalog_product_fitments',r)))),'Unrelated product fitments changed');
 assert.equal(fits.length,new Set(fits.map(r=>key('vehicle_catalog_product_fitments',r))).size);
 const products=await all(db,'product_variants','id');assert.equal(stable(products),stable(d.products),'Product rows changed');
 const r=await db.from('vehicle_catalog_part_reference_fitments').select('*').eq('data_source_id',applied.source_id);if(r.error)throw r.error;
 assert.equal(r.data.length,p.referenceWrites.length);assert.equal(r.data.length,new Set(r.data.map(x=>key('vehicle_catalog_part_reference_fitments',x))).size);
 const nextData={...d,fitments:fits,referenceFits:[...d.referenceFits,...r.data]};
 const next=plan(source,nextData);assert.equal(next.productWrites.length,0);assert.equal(next.referenceWrites.length,0,'Repeat plan would add references');
 const actual=coverage(nextData,{...p,productWrites:[],referenceWrites:[]}),projection=read('coverage-before-projected.json');
 for(const scope of Object.keys(actual))for(const line of ['oil_filter','air_filter'])for(const layer of ['product','knowledge'])assert.deepEqual(actual[scope][line]['after_'+layer],projection[scope][line]['after_'+layer],`Coverage ${scope} ${line}`);
 put('coverage-after.json',actual);put('review-queue.json',p.review);put('conflict-queue.json',p.conflicts);put('legacy-z9-audit.json',p.z9Audit);
 const result={verified:true,at:new Date().toISOString(),summary:p.summary,unchanged_unrelated_product_fitments:true,no_product_creation:true,no_duplicate_fitments:true,repeat_product_writes:next.productWrites.length,repeat_reference_writes:next.referenceWrites.length,coverage_matches_projection:true,source_normalization_repairs:applied.source_normalization_repairs,core103:projection.core103};
 put('verification.json',result);console.log(JSON.stringify(result,null,2));
}
if(process.argv.includes('--apply'))await apply();
else if(process.argv.includes('--verify'))await verify();
else throw new Error('Use --apply or --verify');
