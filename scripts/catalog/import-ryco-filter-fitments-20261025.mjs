import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {client, all} from './review-brake-alias-groups-20261025.mjs';

export const OUT=path.resolve('outputs/ryco-filter-import-20261025');
export const POLICY='RYCO_ENGINE_CONFIG_INTERSECTION_V1_20261025';
const SOURCE='RYCO_USER_WORKBOOKS_20261025';
const IN_SCOPE=new Set(['oil_filter','air_filter']);
const scopedSource=source=>({...source,rows:source.rows.filter(r=>IN_SCOPE.has(classify(r)))});
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const put=(n,v)=>fs.writeFileSync(path.join(OUT,n),JSON.stringify(v,null,2));
const compact=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const unique=v=>[...new Set(v)];
const group=(v,f)=>{const m=new Map();for(const r of v){const k=f(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const family=(make,model)=>{let m=compact(model);if(compact(make)==='MAZDA')m=m.replace(/^MAZDA/,'');return compact(make)+'|'+m;};
const body=v=>/cab.?chassis|platform/i.test(v)?'chassis':/ute|utility|pickup/i.test(v)?'pickup':/hatch/i.test(v)?'hatch':/sedan|saloon/i.test(v)?'sedan':/wagon|estate/i.test(v)?'wagon':/suv|off.?road/i.test(v)?'suv':/van/i.test(v)?'van':'';
const drive=v=>/AWD|4WD|4X4/i.test(v)?'awd':/FWD/i.test(v)?'fwd':/RWD/i.test(v)?'rwd':'';
export function classify(r){
 const d=r.description.toUpperCase(),c=r.category;
 if(/REMOV|TOOL|PLIERS|CUP|STRAP|ADAPTER|INFO ONLY/.test(d)||/Removal|Tools/.test(c))return 'accessory';
 if(/SENSOR/.test(d))return 'sensor';
 if(/UPGRADE|ASSEMBLY|UNIVERSAL CRANKCASE|总成/.test(d+' '+c))return 'assembly';
 if(/OIL FILTER/.test(d))return 'oil_filter';
 if(/CABIN/.test(d))return 'cabin_filter';
 if(/BATTERY/.test(d))return 'battery_cooling_filter';
 if(/AIR FILTER/.test(d))return 'air_filter';
 if(/FUEL.*STRAINER/.test(d))return 'fuel_strainer';
 if(/FUEL WATER|F\/W|燃油水|油水分离/.test(d+' '+c))return 'fuel_water_separator_filter';
 if(/FUEL FILTER/.test(d))return 'fuel_filter';
 if(/TRANS|变速箱/.test(d+' '+c))return 'transmission_filter';
 if(/CRANKCASE|VENTILATION|油气分离/.test(d+' '+c))return 'crankcase_filter';
 if(/SERVICE KIT/.test(d)||c==='Filter Kit')return 'filter_service_kit';
 return 'unclassified';
}
export function normalize(r){
 const yy=r.year.match(/\d{4}/g)?.map(Number)??[];
 return {...r,type:classify(r),reference:compact(r.reference),family:family(r.make,r.model),from:yy[0],to:yy.at(-1),
 engineCode:compact(r.engine.match(/\b(?:PET|DIE)\s+([^\s]+)/i)?.[1]??r.engine.match(/^\s*((?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]{3,})\b/i)?.[1]??''),
 displacement:Number(r.engine.match(/^\s*(\d+(?:\.\d+)?)\s*(?:L\b|(?=[,\s]))/i)?.[1]??0)*1000,
 inferred:/沿用|同系列同发动机|推断|推测|inferred|assum/i.test(r.vehicle+' '+r.engine),
 body:body(r.vehicle),drive:drive(r.vehicle),seriesTokens:r.series.toUpperCase().split(/[,;/]+/).map(compact).filter(v=>v&&v!=='ALL')};
}
export function seriesMatch(a,r){
 const s=compact(a.series);if(!s||!r.seriesTokens.length)return false;
 return r.seriesTokens.some(t=>s===t||(a.make==='TOYOTA'&&s.replace(/R$/,'')===t.replace(/R$/,'')));
}
export function compatible(a,r){
 if(r.inferred||!r.engineCode||!a.engine_codes.length||!a.engine_codes.every(c=>compact(c)===r.engineCode))return false;
 if(r.displacement&&a.displacement_cc&&Math.abs(r.displacement-a.displacement_cc)>110)return false;
 if(r.seriesTokens.length&&!seriesMatch(a,r))return false;
 if(!r.seriesTokens.length&&r.type!=='oil_filter')return false;
 if(a.body&&r.body&&a.body!==r.body)return false;
 if(a.drive&&r.drive&&a.drive!==r.drive)return false;
 return true;
}
export function enrich(d){
 const by=(rr,k)=>new Map(rr.map(r=>[r[k],r]));
 const models=by(d.models,'model_id'),makes=by(d.makes,'make_id'),series=by(d.series,'series_id'),variants=by(d.variants,'variant_id'),engines=by(d.engines,'powertrain_id'),codes=by(d.engineCodes,'engine_code_id');
 const ys=group(d.years,r=>r.application_id),ec=group(d.powertrainEngineCodes,r=>r.powertrain_id);
 return d.applications.filter(a=>a.status==='active').map(a=>{const m=models.get(a.model_id),mk=makes.get(m?.make_id),s=series.get(a.series_id),v=variants.get(a.variant_id),e=engines.get(a.powertrain_id);return {...a,make:mk?.name,model:m?.name,family:family(mk?.name,m?.name),series:s?.code??'',body:body(v?.body_style??''),drive:drive(v?.drive_type??''),engine:e?.display_name,displacement_cc:e?.displacement_cc,engine_codes:(ec.get(a.powertrain_id)??[]).map(r=>codes.get(r.engine_code_id)?.code).filter(Boolean),years:(ys.get(a.application_id)??[]).map(r=>r.model_year)};});
}
export function intersectEvidence(a,rows){
 const candidates=rows.filter(r=>compatible(a,r));
 let common=null;const proof=[];
 for(const y of a.years){
  const yr=candidates.filter(r=>y>=r.from&&y<=r.to);if(!yr.length)return {refs:[],reason:'missing_exact_engine_config_year',missing_year:y};
  // Each source vehicle configuration must list the reference. This prevents
  // a trim/gearbox-specific result from becoming a universal application.
  for(const rr of group(yr,r=>[r.file,r.year,r.series,r.engine,r.vehicle].join('|')).values()){
   const refs=new Set(rr.map(r=>r.reference));common=common===null?refs:new Set([...common].filter(v=>refs.has(v)));proof.push(...rr);
  }
 }
 return {refs:[...(common??[])],reason:common?.size?'complete_config_year_intersection':'configuration_or_year_conflict',proof};
}
export function prepare(source,d){
 const rows=scopedSource(source).rows.map(normalize),refs=[...group(rows,r=>r.type+'|'+r.reference)].map(([key,rr])=>({key,type:rr[0].type,reference:rr[0].reference,rows:rr}));
 const sourceGroups=group(rows,r=>r.family),apps=enrich(d).filter(a=>sourceGroups.has(a.family)&&a.years.length),fits=[],review=[];
 const supported=new Set(['oil_filter','air_filter','cabin_filter','fuel_filter','battery_cooling_filter','fuel_strainer','fuel_water_separator_filter','crankcase_filter']);
 for(const a of apps){
  for(const [type,rr] of group(sourceGroups.get(a.family),r=>r.type)){
   if(!supported.has(type))continue;
   const result=intersectEvidence(a,rr);
   if(!result.refs.length){review.push({application_id:a.application_id,make:a.make,model:a.model,series:a.series,engine:a.engine,type,reason:result.reason,missing_year:result.missing_year});continue;}
   for(const ref of result.refs)fits.push({application_id:a.application_id,key:type+'|'+ref,type,reference:ref,years:a.years,proof:result.proof.filter(r=>r.reference===ref).map(r=>({file:r.file,sheet:r.sheet,row:r.row})),rule:'exact_engine_all_years_all_compatible_source_configs'});
  }
 }
 const pBy=new Map(d.products.map(p=>[p.id,p])),categories=new Map(d.productRows.map(p=>[p.id,p.category_slug]));
 const links=[],blocked=[];
 for(const r of refs.filter(r=>r.type==='oil_filter')){
  const ids=unique(d.identifiers.filter(i=>i.identifier_type==='cross_reference'&&compact(i.normalized_value)===r.reference&&compact(i.identifier_brand??i.metadata?.brand)==='RYCO'&&!['conflict','rejected'].includes(i.verification_status)).map(i=>i.product_variant_id));
  const eligible=ids.filter(id=>{const p=pBy.get(id);return p&&p.active!==false&&categories.get(p.product_id)==='filter'&&/^NOF\d+$/.test(p.sku);});
  if(eligible.length===1)links.push({key:r.key,product_variant_id:eligible[0],sku:pBy.get(eligible[0]).sku});
  else if(eligible.length>1)blocked.push({key:r.key,reason:'multiple_products_for_reference',skus:eligible.map(id=>pBy.get(id).sku)});
 }
 const existing=new Map(d.fitments.map(r=>[[r.application_id,r.product_variant_id,r.position].join('|'),r]));
 const products=[];
 for(const f of fits)for(const l of links.filter(l=>l.key===f.key)){
  const k=[f.application_id,l.product_variant_id,'engine'].join('|'),old=existing.get(k);
  if(d.fitments.some(x=>x.application_id===f.application_id&&x.product_variant_id===l.product_variant_id&&x.fitment_status==='published'))continue;
  if(old?.fitment_status==='published')continue;
  if(old&&old.fitment_status==='rejected'){blocked.push({key:k,reason:'existing_rejected_product_fitment'});continue;}
  products.push({application_id:f.application_id,product_variant_id:l.product_variant_id,position:'engine',fitment_status:'published',source:SOURCE,notes:POLICY+'; '+f.reference,before:old??null,sku:l.sku,reference:f.reference});
 }
 const productPlan=[...new Map(products.map(r=>[[r.application_id,r.product_variant_id,r.position].join('|'),r])).values()];
 return {policy:POLICY,source_hash:hash(source),snapshot_hash:hash(d),refs,fits,links,products:productPlan,review,blocked,apps,
 summary:{source_rows:rows.length,source_files:source.files.length,inferred_rows:rows.filter(r=>r.inferred).length,reference_counts:Object.fromEntries([...group(refs,r=>r.type)].map(([k,v])=>[k,v.length])),reference_fitments:fits.length,reference_applications:unique(fits.map(r=>r.application_id)).length,product_reference_links:links.length,product_fitment_writes:productPlan.length,review_cases:review.length,blocked:blocked.length}};
}

export function coverageReport(p,d){
 const activeOil=new Set(d.products.filter(r=>r.active!==false&&/^NOF\d+$/.test(r.sku)).map(r=>r.id));
 const oilBefore=new Set(d.fitments.filter(r=>r.fitment_status==='published'&&activeOil.has(r.product_variant_id)).map(r=>r.application_id));
 const oilAfter=new Set([...oilBefore,...p.products.map(r=>r.application_id)]);
 const scope=p.apps.map(a=>({...a,years:a.years.filter(y=>y>=2000&&y<=2026)})).filter(a=>a.years.length);
 const metric=(apps,ids)=>{const cells=[...group(apps.flatMap(a=>a.years.map(y=>({id:a.application_id,key:a.family+'|'+y}))),r=>r.key).values()];return {applications:apps.length,covered_applications:apps.filter(a=>ids.has(a.application_id)).length,application_years:apps.reduce((n,a)=>n+a.years.length,0),covered_application_years:apps.filter(a=>ids.has(a.application_id)).reduce((n,a)=>n+a.years.length,0),model_years:cells.length,model_year_any:cells.filter(rr=>rr.some(r=>ids.has(r.id))).length,model_year_full:cells.filter(rr=>rr.every(r=>ids.has(r.id))).length};};
 const result=[];
 for(const [fam,apps] of group(scope,a=>a.family))for(const type of IN_SCOPE){
  const baselineProduct=type==='oil_filter'?oilBefore:new Set(),afterProduct=type==='oil_filter'?oilAfter:new Set();
  const oldKnowledge=new Set(d.referenceFits.filter(f=>f.fitment_status==='published'&&d.references.some(r=>r.id===f.part_reference_id&&r.product_type===type)).map(f=>f.application_id));
  const before=new Set([...baselineProduct,...oldKnowledge]),after=new Set([...before,...afterProduct,...p.fits.filter(f=>f.type===type).map(f=>f.application_id)]);
  result.push({family:fam,type,before_product:metric(apps,baselineProduct),after_product:metric(apps,afterProduct),before_knowledge:metric(apps,before),after_knowledge:metric(apps,after)});
 }
 return {scope:'Source make/model families, active applications, model years 2000-2026; same denominator before and after',per_model:result};
}

const pk={catalog_product_lines:['code'],catalog_reference_schemes:['product_type','code'],catalog_data_sources:['code'],catalog_import_batches:['id'],catalog_source_records:['batch_id','sheet_name','row_number'],catalog_part_references:['product_type','reference_scheme','normalized_value'],catalog_part_reference_products:['part_reference_id','product_variant_id','relation_type'],vehicle_catalog_part_reference_fitments:['application_id','part_reference_id','position','data_source_id'],vehicle_catalog_product_fitments:['application_id','product_variant_id','position']};
const uuid=(s)=>{const h=crypto.createHash('sha256').update(SOURCE+'|'+s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
function payloads(p,source,d){
 source=scopedSource(source);
 const sourceId=d.sources.find(r=>r.code===SOURCE)?.id??uuid('source');
 const registry=p.refs.map(r=>r.type),types=unique(registry);
 const referenceId=new Map(p.refs.map(r=>[r.key,d.references.find(x=>x.product_type===r.type&&x.reference_scheme==='ryco'&&x.normalized_value===r.reference)?.id??uuid(r.key)]));
 const batches=source.files.map(f=>({id:uuid(f.sha256),data_source_id:sourceId,source_file:path.basename(f.file),source_file_hash:f.sha256,sheet_name:f.sheets.join(','),import_status:'published',row_count:source.rows.filter(r=>r.file===path.basename(f.file)).length,imported_by:'scripts/catalog/import-ryco-filter-fitments-20261025.mjs',metadata:{policy:POLICY,source_claim:'User-supplied Ryco catalogue extraction; not independently recrawled'}}));
 const batchBy=new Map(batches.map(r=>[r.source_file,r.id]));
 const oldRef=new Map(d.references.map(r=>[r.id,r]));
 return [
 ['catalog_product_lines',types.filter(t=>!d.lines.some(l=>l.code===t)).map(t=>({code:t,name:t.replaceAll('_',' '),category_slug:t==='oil_filter'?'filter':'air-filter',specification_table:t==='oil_filter'?'filter_variant_specs':'air_filter_variant_specs',reference_layer_enabled:true,active:t==='oil_filter',metadata:{policy:POLICY,reference_only:t!=='oil_filter',...(t==='air_filter'?{status:'future_product_line'}:{}),matching_rule:t==='oil_filter'?'exact_engine_and_complete_year_config_intersection':'exact_series_engine_and_complete_year_config_intersection'}}))],
 ['catalog_reference_schemes',types.filter(t=>!d.schemes.some(s=>s.product_type===t&&s.code==='ryco')).map(t=>({product_type:t,code:'ryco',name:'Ryco catalogue reference',issuer:'Ryco',active:true,metadata:{market:'AU',policy:POLICY}}))],
 ['catalog_data_sources',d.sources.some(r=>r.code===SOURCE)?[]:[{id:sourceId,code:SOURCE,name:'User supplied Ryco vehicle-to-filter workbooks 2026-10-25',source_kind:'product_catalogue',vehicle_identity_priority:100,product_fitment_priority:20,active:true,metadata:{policy:POLICY,files:source.files.map(r=>({name:path.basename(r.file),sha256:r.sha256})),evidence_status:'user_supplied_extraction'}}]],
 ['catalog_import_batches',batches],
 ['catalog_source_records',source.rows.map(r=>{const n=normalize(r);return {batch_id:batchBy.get(r.file),sheet_name:r.sheet,row_number:r.row,raw_values:r,normalized_values:{product_type:n.type,reference:n.reference,engine_code:n.engineCode,inferred:n.inferred},parse_status:n.inferred?'review':'accepted',parse_notes:n.inferred?['Source explicitly infers another year; excluded from published fitments']:[],source_record_hash:hash(r)};})],
 ['catalog_part_references',p.refs.map(r=>{const old=oldRef.get(referenceId.get(r.key));return {...(old??{}),id:referenceId.get(r.key),product_type:r.type,reference_scheme:'ryco',reference_value:r.reference,normalized_value:r.reference,lifecycle_status:old?.lifecycle_status??'unknown',metadata:{...old?.metadata,policy:POLICY,source_code:SOURCE,source_files:unique(r.rows.map(x=>x.file)),source_row_count:r.rows.length,source_configurations:unique(r.rows.map(x=>[x.make,x.model,x.year,x.series,x.engine,x.vehicle].join('|'))).length,reference_only:!p.links.some(l=>l.key===r.key)}};})],
 ['catalog_part_reference_products',p.links.filter(l=>!d.referenceLinks.some(x=>x.part_reference_id===referenceId.get(l.key)&&x.product_variant_id===l.product_variant_id&&x.relation_type==='exact_cross_reference')).map(l=>({part_reference_id:referenceId.get(l.key),product_variant_id:l.product_variant_id,relation_type:'exact_cross_reference',verification_status:'verified',metadata:{policy:POLICY,source_code:SOURCE}}))],
 ['vehicle_catalog_part_reference_fitments',p.fits.map(f=>({application_id:f.application_id,part_reference_id:referenceId.get(f.key),position:'vehicle',data_source_id:sourceId,fitment_status:'published',confidence:'exact',source_row_numbers:unique(f.proof.map(r=>r.row)).sort((a,b)=>a-b),match_reasons:[f.rule],metadata:{policy:POLICY,source_code:SOURCE,source_rows:f.proof,application_years:f.years}}))],
 ['vehicle_catalog_product_fitments',p.products.map(({before,sku,reference,...r})=>r)]
 ];
}
async function fetchKeys(db,table,rows){
 if(!rows.length)return [];
 const keys=pk[table],first=keys[0],out=[];
 for(let i=0,ids=unique(rows.map(r=>r[first]));i<ids.length;i+=60){
  let q=db.from(table).select('*').in(first,ids.slice(i,i+60));for(const k of keys)q=q.order(k);
  for(let offset=0;;offset+=1000){const {data,error}=await q.range(offset,offset+999);if(error)throw error;out.push(...data);if(data.length<1000)break;}
 }
 const wanted=new Set(rows.map(r=>JSON.stringify(keys.map(k=>r[k]))));return out.filter(r=>wanted.has(JSON.stringify(keys.map(k=>r[k]))));
}
async function rollback(db,journal){
 for(const entry of [...journal].reverse()){
  const keys=pk[entry.table],old=new Map(entry.before.map(r=>[JSON.stringify(keys.map(k=>r[k])),r]));
  for(const row of entry.rows){if(old.has(JSON.stringify(keys.map(k=>row[k]))))continue;let q=db.from(entry.table).delete();for(const k of keys)q=q.eq(k,row[k]);const {error}=await q;if(error)throw error;}
  for(let i=0;i<entry.before.length;i+=200){const {error}=await db.from(entry.table).upsert(entry.before.slice(i,i+200),{onConflict:keys.join(',')});if(error)throw error;}
  const restored=await fetchKeys(db,entry.table,entry.rows);assert.equal(hash(restored.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),hash(entry.before.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))),`Rollback mismatch ${entry.table}`);
 }
 put('rollback.json',{verified:true,at:new Date().toISOString()});
}
async function apply(p,source,d){
 assert.equal(p.source_hash,hash(source));assert.equal(p.snapshot_hash,hash(d));
 assert(!fs.existsSync(path.join(OUT,'apply-journal.json')),'Prior apply exists; inspect verification before rerunning');
 const db=client(),payload=payloads(p,source,d),journal=[];
 for(const f of source.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.file)).digest('hex'),f.sha256,'Workbook changed');
 const liveProducts=await all(db,'product_variants','id'),liveIdentifiers=await all(db,'product_identifiers','id');
 const stable=rr=>hash(rr.map(r=>JSON.stringify(r)).sort());
 assert.equal(stable(liveProducts.filter(r=>/^NOF\d+$/.test(r.sku))),stable(d.products.filter(r=>/^NOF\d+$/.test(r.sku))),'Oil products changed since snapshot');
 assert.equal(stable(liveIdentifiers),stable(d.identifiers),'Identifiers changed since snapshot');
 const affected=unique(p.fits.map(r=>r.application_id));
 for(let i=0;i<affected.length;i+=50){
  const ids=affected.slice(i,i+50);let r=await db.from('vehicle_catalog_applications').select('*').in('application_id',ids);if(r.error)throw r.error;assert.equal(stable(r.data),stable(d.applications.filter(a=>ids.includes(a.application_id))),'Vehicle identity changed');
  r=await db.from('vehicle_catalog_application_years').select('*').in('application_id',ids).order('application_id').order('model_year');if(r.error)throw r.error;assert(r.data.length<1000,'Year preflight exceeds page');assert.equal(stable(r.data),stable(d.years.filter(a=>ids.includes(a.application_id))),'Application years changed');
 }
 // Capture every affected preimage before the first mutation.
 for(const [table,rows] of payload){const before=await fetchKeys(db,table,rows);if(table==='vehicle_catalog_product_fitments')assert.equal(stable(before),stable(p.products.map(r=>r.before).filter(Boolean)),'Product fitments changed');journal.push({table,rows,before});}
 put('preimage-backup.json',journal.map(({table,before})=>({table,before})));
 const progress=[];
 try{
  for(const entry of journal){
   progress.push(entry);put('apply-journal.json',progress);
   for(let i=0;i<entry.rows.length;i+=200){const {error}=await db.from(entry.table).upsert(entry.rows.slice(i,i+200),{onConflict:pk[entry.table].join(',')});if(error)throw new Error(entry.table+': '+error.message);}
   console.log(entry.table+': '+entry.rows.length);
   const stored=await fetchKeys(db,entry.table,entry.rows);assert.equal(stored.length,entry.rows.length,`Readback count ${entry.table}`);
   const by=new Map(stored.map(r=>[JSON.stringify(pk[entry.table].map(k=>r[k])),r]));
   for(const row of entry.rows){const actual=by.get(JSON.stringify(pk[entry.table].map(k=>row[k])));for(const [k,v] of Object.entries(row)){if(k.endsWith('_at'))continue;assert.deepEqual(actual[k],v,`Readback ${entry.table}.${k}`);}}
  }
  put('applied.json',{verified:true,at:new Date().toISOString(),summary:p.summary,tables:journal.map(r=>({table:r.table,rows:r.rows.length})),backup:'preimage-backup.json'});
 }catch(error){put('apply-error.json',{message:error.message});await rollback(db,progress);throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const source=read('source.json'),d=read('before-snapshot.json');
 if(process.argv.includes('--apply'))await apply(read('plan.json'),source,d);
 else{const p=prepare(source,d);put('plan.json',p);put('summary.json',p.summary);put('coverage-before-projected.json',coverageReport(p,d));console.log(JSON.stringify(p.summary,null,2));}
}
