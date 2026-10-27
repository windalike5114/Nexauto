import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {normalize,enrich,seriesMatch} from './import-ryco-filter-fitments-20261025.mjs';
import {client,all} from './review-brake-alias-groups-20261025.mjs';
import {buildPopularAliasIndex,DEFAULT_POPULAR_VEHICLE_GROUPS,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';

export const OUT=path.resolve('outputs/ryco-filter-expansion-20261025');
export const POLICY='RYCO_ENGINE_YEAR_INVARIANT_AND_AIR_INTAKE_V2_20261025';
export const SOURCE='RYCO_ENGINE_CONFIG_EXPANSION_20261025';
const put=(n,v)=>fs.writeFileSync(path.join(OUT,n),JSON.stringify(v,null,2));
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const unique=v=>[...new Set(v)];
const compact=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stable=rr=>hash(rr.map(r=>JSON.stringify(r)).sort());
const group=(rr,f)=>{const m=new Map();for(const r of rr){const k=f(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const aliases=buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS);
const family=(make,model)=>aliases.get(canonicalModelKey(make,model))?.id??canonicalModelKey(make,model);
const proof=r=>({file:r.file,sheet:r.sheet,row:r.row,engine_resolution:r.engineResolution??'explicit_source_engine'});
const cylinders=v=>Number(String(v).match(/(?:\b[IVH](\d)\b|\b(\d)-cyl\b)/i)?.slice(1).find(Boolean)??0);
export function engineMatches(a,r){
 const codes=r.resolvedCodes??[r.engineCode];
 return !r.inferred&&codes.filter(Boolean).length>0&&a.engine_codes.length>0&&a.engine_codes.every(c=>codes.includes(compact(c)))
  &&(!r.displacement||!a.displacement_cc||Math.abs(r.displacement-a.displacement_cc)<=110);
}
export function prepareSource(source,apps){
 return source.rows.map(normalize).filter(r=>['oil_filter','air_filter'].includes(r.type)).map(r=>{
  const model=r.make==='TOYOTA'&&/PRADO/i.test(r.vehicle)?'PRADO':r.model;
  r={...r,family:family(r.make,model)};
  if(r.engineCode)return r;
  // No engine-code invention: a code-free row can be resolved only to one
  // stored powertrain under exact series, body, drive, capacity and cylinders.
  const candidates=apps.filter(a=>a.family===r.family&&seriesMatch(a,r)&&r.body&&a.body===r.body&&r.drive&&a.drive===r.drive
   &&r.displacement&&Math.abs(r.displacement-a.displacement_cc)<=110&&cylinders(r.engine)&&cylinders(r.engine)===cylinders(a.engine)
   &&a.years.some(y=>y>=r.from&&y<=r.to));
  const pts=unique(candidates.map(a=>a.powertrain_id));
  return pts.length===1?{...r,resolvedCodes:unique(candidates.flatMap(a=>a.engine_codes.map(compact))),engineResolution:'unique_catalog_powertrain_exact_series_body_drive_capacity_cylinders',resolvedApplications:candidates.map(a=>a.application_id)}:r;
 });
}
export function evaluate(a,type,rows){
 let candidates=rows.filter(r=>engineMatches(a,r));
 if(type==='air_filter')candidates=candidates.filter(r=>seriesMatch(a,r)&&r.body&&a.body&&r.body===a.body);
 const primary=evaluateCandidates(a,candidates);
 if(primary.refs.length)return {...primary,scope:type==='oil_filter'?'engine_year_configuration_invariant':'series_body_engine_year_configuration_invariant'};
 // A learned reference branch requires stored discriminators; exact series,
 // body and drive can separate the conflicting 2022 Corolla / Ranger rows.
 const precise=candidates.filter(r=>seriesMatch(a,r)&&r.body&&a.body&&r.body===a.body&&r.drive&&a.drive&&r.drive===a.drive);
 const branch=evaluateCandidates(a,precise);
 return branch.refs.length?{...branch,scope:'exact_series_body_drive_engine_year_branch'}:primary;
}
function evaluateCandidates(a,candidates){
 let common=null;const proofs=[];
 for(const y of a.years){
  const yr=candidates.filter(r=>y>=r.from&&y<=r.to);
  if(!yr.length)return {refs:[],reason:'full_application_years_not_supported',missing_year:y};
  // Oil: same model family + engine + year, every observed chassis/body/drive.
  // Air: exact series + body + engine, every observed drive/trim configuration.
  for(const rr of group(yr,r=>[r.file,r.year,r.series,r.engine,r.vehicle].join('|')).values()){
   const refs=new Set(rr.map(r=>r.reference));common=common===null?refs:new Set([...common].filter(v=>refs.has(v)));proofs.push(...rr);
  }
 }
 return {refs:[...(common??[])],proofs,reason:common?.size?'safe':'reference_conflict_across_configurations'};
}
export function selectZ9(a){
 // Finite reviewed configuration supported by the supplied source row. The
 // user's "tends toward" product positioning is never a global capacity cutoff.
 if(a.make==='FORD'&&a.model==='FALCON'&&a.series==='XH'&&['van','pickup'].includes(a.body)&&a.drive==='rwd'
  &&a.displacement_cc===4000&&cylinders(a.engine)===6&&a.years.every(y=>y>=1996&&y<=1999))return 'NOF1804';
 return null;
}
export function plan(source,d){
 const apps=enrich(d).map(a=>({...a,family:family(a.make,a.model)})),rows=prepareSource(source,apps),sourceBy=group(rows,r=>r.family+'|'+r.type);
 const refsBy=new Map(d.references.map(r=>[r.id,r])),pBy=new Map(d.products.map(r=>[r.id,r]));
 const fitsBy=group(d.fitments,r=>r.application_id),rfBy=group(d.referenceFits.filter(r=>r.fitment_status==='published'),r=>r.application_id);
 const rycoIds=d.identifiers.filter(i=>i.identifier_type==='cross_reference'&&compact(i.identifier_brand??i.metadata?.brand)==='RYCO'&&!['rejected','conflict'].includes(i.verification_status));
 const byRef=group(rycoIds,r=>compact(r.normalized_value)),byProduct=group(rycoIds,r=>r.product_variant_id);
 const referenceWrites=[],productWrites=[],review=[],conflicts=[];
 for(const a of apps.filter(a=>a.years.length))for(const type of ['oil_filter','air_filter']){
  const rr=sourceBy.get(a.family+'|'+type);if(!rr)continue;
  const result=evaluate(a,type,rr);if(!result.refs.length){review.push({application_id:a.application_id,make:a.make,model:a.model,series:a.series,engine:a.engine,type,reason:result.reason,missing_year:result.missing_year});continue;}
  const known=(rfBy.get(a.application_id)??[]).filter(f=>refsBy.get(f.part_reference_id)?.product_type===type);
  const oldValues=unique(known.map(f=>refsBy.get(f.part_reference_id).normalized_value));
  const currentOil=(fitsBy.get(a.application_id)??[]).filter(f=>f.fitment_status==='published'&&/^NOF\d+$/.test(pBy.get(f.product_variant_id)?.sku??''));
  const productOld=type==='oil_filter'?currentOil.flatMap(f=>(byProduct.get(f.product_variant_id)??[]).map(i=>i.normalized_value)):[];
  if((oldValues.length&&!oldValues.some(v=>result.refs.includes(v)))||(productOld.length&&!productOld.some(v=>result.refs.includes(v)))){
   conflicts.push({application_id:a.application_id,type,reason:'existing_published_reference_disagrees',existing:unique([...oldValues,...productOld]),proposed:result.refs});continue;
  }
  for(const ref of result.refs){
   const reference=d.references.find(r=>r.product_type===type&&r.reference_scheme==='ryco'&&r.normalized_value===ref);assert(reference,`Missing source reference ${type} ${ref}`);
   const evidence=result.proofs.filter(r=>r.reference===ref);const f={application_id:a.application_id,part_reference_id:reference.id,position:'vehicle',type,reference:ref,years:a.years,make:a.make,model:a.model,series:a.series,engine:a.engine,body:a.body,drive:a.drive,proof:unique(evidence.map(r=>JSON.stringify(proof(r)))).map(JSON.parse),rule:result.scope};
   if(!known.some(x=>x.part_reference_id===reference.id))referenceWrites.push(f);
   if(type!=='oil_filter')continue;
   const candidates=unique((byRef.get(ref)??[]).map(i=>i.product_variant_id)).map(id=>pBy.get(id)).filter(p=>p&&p.active!==false&&/^NOF\d+$/.test(p.sku));
   let product=candidates.length===1?candidates[0]:ref==='Z9'?candidates.find(p=>p.sku===selectZ9(a)):null;
   if(!product){if(candidates.length>1)conflicts.push({application_id:a.application_id,type,reference:ref,reason:'product_requires_application_specific_selection',skus:candidates.map(p=>p.sku)});continue;}
   const existing=(fitsBy.get(a.application_id)??[]).filter(x=>x.product_variant_id===product.id);
   if(existing.some(x=>x.fitment_status==='published'))continue;
   if(existing.some(x=>x.fitment_status==='rejected')){conflicts.push({application_id:a.application_id,type,reference:ref,reason:'existing_rejected_product_relationship'});continue;}
   productWrites.push({...f,product_variant_id:product.id,position:'engine',sku:product.sku,before:existing.find(x=>x.position==='engine')??null,z9_rule:ref==='Z9'?'user_positioning_plus_exact_Falcon_XH_4L_6cyl_van_source':null});
  }
 }
 const pp=[...new Map(productWrites.map(r=>[[r.application_id,r.product_variant_id,r.position].join('|'),r])).values()];
 const z9Id=d.products.find(r=>r.sku==='NOF1839')?.id;
 const z9Audit=d.fitments.filter(r=>r.product_variant_id===z9Id&&r.fitment_status==='published').map(f=>{const a=apps.find(a=>a.application_id===f.application_id);return {application_id:a.application_id,make:a.make,model:a.model,engine:a.engine,body:a.body,reason:'legacy_Z9_product_relationship_requires_independent_revalidation',action:'report_only_existing_fitment_preserved'};});
 return {policy:POLICY,generated_at:new Date().toISOString(),snapshot_hash:hash(d),source_hash:hash(source),referenceWrites,productWrites:pp,review,conflicts,z9Audit,engineResolvedRows:rows.filter(r=>r.engineResolution),summary:{source_rows:rows.length,engine_code_recovered_rows:rows.filter(r=>r.engineCode&&!/\b(?:PET|DIE)\s+/i.test(r.engine)).length,unique_powertrain_resolved_rows:rows.filter(r=>r.engineResolution).length,reference_writes:referenceWrites.length,oil_reference_writes:referenceWrites.filter(r=>r.type==='oil_filter').length,air_reference_writes:referenceWrites.filter(r=>r.type==='air_filter').length,product_writes:pp.length,product_applications:unique(pp.map(r=>r.application_id)).length,review:review.length,conflicts:conflicts.length,z9_product_writes:pp.filter(r=>r.reference==='Z9').length,legacy_z9_audit:z9Audit.length}};
}

export function coverage(d,p){
 const apps=enrich(d),refBy=new Map(d.references.map(r=>[r.id,r])),pBy=new Map(d.products.map(r=>[r.id,r]));
 const beforeProduct=new Set(d.fitments.filter(f=>f.fitment_status==='published'&&pBy.get(f.product_variant_id)?.active!==false&&/^NOF\d+$/.test(pBy.get(f.product_variant_id)?.sku??'')).map(r=>r.application_id));
 const scopes={all:apps.map(a=>({...a,group:a.family,years:a.years.filter(y=>y>=2000&&y<=2026)})).filter(a=>a.years.length),core103:apps.flatMap(a=>{const g=aliases.get(canonicalModelKey(a.make,a.model));return g&&popularGroupMatchesApplication(g,{bodyStyle:a.body,variantName:a.body})?[{...a,group:g.id,years:a.years.filter(y=>y>=2000&&y<=2026)}]:[];}).filter(a=>a.years.length)};
 const metric=(aa,ids)=>{const cells=group(aa.flatMap(a=>a.years.map(y=>({id:a.application_id,k:a.group+'|'+y}))),r=>r.k);const den=aa.reduce((n,a)=>n+a.years.length,0),num=aa.filter(a=>ids.has(a.application_id)).reduce((n,a)=>n+a.years.length,0);return {applications_total:aa.length,applications_covered:aa.filter(a=>ids.has(a.application_id)).length,application_years_total:den,application_years_covered:num,application_year_percent:Number((num/den*100).toFixed(3)),model_years_total:cells.size,model_year_any:[...cells.values()].filter(rr=>rr.some(r=>ids.has(r.id))).length,model_year_full:[...cells.values()].filter(rr=>rr.every(r=>ids.has(r.id))).length};};
 return Object.fromEntries(Object.entries(scopes).map(([scope,aa])=>[scope,Object.fromEntries(['oil_filter','air_filter'].map(type=>{const bp=type==='oil_filter'?beforeProduct:new Set(),ap=new Set([...bp,...p.productWrites.filter(r=>r.type===type).map(r=>r.application_id)]),bk=new Set([...bp,...d.referenceFits.filter(f=>f.fitment_status==='published'&&refBy.get(f.part_reference_id)?.product_type===type).map(r=>r.application_id)]),ak=new Set([...bk,...ap,...p.referenceWrites.filter(r=>r.type===type).map(r=>r.application_id)]);return [type,{before_product:metric(aa,bp),after_product:metric(aa,ap),before_knowledge:metric(aa,bk),after_knowledge:metric(aa,ak)}];}))]));
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const d=read('before-snapshot.json'),source=JSON.parse(fs.readFileSync('outputs/ryco-filter-import-20261025/source.json','utf8'));
 const p=plan(source,d);put('plan.json',p);put('coverage-before-projected.json',coverage(d,p));console.log(JSON.stringify(p.summary,null,2));
}
