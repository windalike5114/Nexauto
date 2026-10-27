import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {enrich,seriesMatch} from './import-ryco-filter-fitments-20261025.mjs';
import {prepareSource,engineMatches,selectZ9} from './expand-ryco-filter-knowledge-20261025.mjs';
import {expandCodeField} from './fitment-v4-matcher.mjs';
import {DEFAULT_POPULAR_VEHICLE_GROUPS,buildPopularAliasIndex,groupsForPopularScope,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';

export const OUT=path.resolve('outputs/filter-year-expansion-20261025');
export const POLICY='FILTER_EXACT_PLATFORM_ENGINE_CORROBORATED_YEAR_RANGE_V1_20261025';
export const SOURCE='FILTER_CORROBORATED_MODEL_YEARS_20261025';
export const compact=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const put=(n,v)=>fs.writeFileSync(path.join(OUT,n),JSON.stringify(v,null,2));
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const uniq=v=>[...new Set(v)];
const group=(rr,f)=>{const m=new Map();for(const r of rr){const k=f(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;};
const aliases=buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS);
const family=(make,model)=>aliases.get(canonicalModelKey(make,model))?.id??canonicalModelKey(make,model);
export function secondaryYearBounds(raw,asOf=2026){
 const text=String(raw).replace(/[–—]/g,'-');
 const month=text.match(/[\[(](\d{1,2})\/(\d{2,4})\s*(?:-\s*(\d{1,2})\/(\d{2,4})|(?:ON|on))[\])]?/);
 const yy=v=>Number(v)<100?(Number(v)>30?1900:2000)+Number(v):Number(v);
 if(month){const start=yy(month[2]),end=month[4]?yy(month[4]):asOf;return {from:start+(Number(month[1])>1?1:0),to:end-(month[3]&&Number(month[3])<12?1:0),raw_from:start,raw_to:end,month_boundary_excluded:true};}
 const years=text.match(/[\[(]((?:19|20)\d{2})\s*-\s*((?:19|20)\d{2}|ON|On|on)[\])]/);
 return years?{from:Number(years[1]),to:/on/i.test(years[2])?asOf:Number(years[2]),raw_from:Number(years[1]),raw_to:/on/i.test(years[2])?asOf:Number(years[2]),month_boundary_excluded:false}:null;
}
export function prepareSecondary(source){
 return source.rows.map(r=>({...r,reference:compact(r.reference),families:r.model.split(/\s*\/\s*/).filter(Boolean).map(model=>family(r.make,model)),
 seriesTokens:uniq(r.series.toUpperCase().replace(/[()]/g,' ').split(/[\s,;|]+/).filter(x=>/[A-Z0-9]/.test(x)).flatMap(expandCodeField).filter(x=>x.length>=2&&!x.includes('_'))),
 engineCodes:r.engine_codes.split(/[,;]+/).filter(x=>/[A-Z0-9]/i.test(x)).flatMap(expandCodeField),displacements:[...r.displacement.matchAll(/(\d+(?:\.\d+)?)\s*L/gi)].map(m=>Math.round(Number(m[1])*1000)),
 bodies:uniq([/hatch/i.test(r.raw)?'hatch':null,/sedan|saloon/i.test(r.raw)?'sedan':null,/wagon|estate/i.test(r.raw)?'wagon':null,/suv/i.test(r.raw)?'suv':null,/cab chassis|platform\/chassis/i.test(r.raw)?'chassis':null,/utility|pickup|\bute\b/i.test(r.raw)?'pickup':null,/\bvan\b/i.test(r.raw)?'van':null,/\bmpv\b/i.test(r.raw)?'mpv':null,/convertible/i.test(r.raw)?'convertible':null,/coupe/i.test(r.raw)?'coupe':null].filter(Boolean)),
 drives:uniq([/FWD/i.test(r.drive+' '+r.raw)?'fwd':null,/RWD/i.test(r.drive+' '+r.raw)?'rwd':null,/AWD|4WD/i.test(r.drive+' '+r.raw)?'awd':null].filter(Boolean)),
 bounds:secondaryYearBounds(r.raw),conditional:/for some|some models|except|excluding|model year from|model year to|use\s+[ZR]\d/i.test(r.raw)}));
}
export function secondaryMatches(a,r){
 return !r.conditional&&r.bounds&&r.families.includes(a.family)&&a.series&&!a.series.includes('_')&&seriesMatch(a,r)
  &&a.engine_codes.length>0&&a.engine_codes.every(c=>r.engineCodes.includes(compact(c)))
  &&(!r.displacements.length||r.displacements.some(cc=>Math.abs(cc-a.displacement_cc)<=110))
  &&a.body&&r.bodies.includes(a.body)&&a.drive&&r.drives.includes(a.drive);
}
export function yearDecision(a,type,primary,secondary){
 const rows=primary.filter(r=>engineMatches(a,r)&&seriesMatch(a,r)
  &&(type==='oil_filter'||(r.body===a.body&&r.drive===a.drive&&a.body&&a.drive)));
 const evidenceByYear=new Map();
 for(const y of a.years){const yr=rows.filter(r=>y>=r.from&&y<=r.to);if(!yr.length)continue;let common=null;for(const cc of group(yr,r=>[r.file,r.year,r.series,r.engine,r.vehicle].join('|')).values()){const refs=new Set(cc.map(r=>r.reference));common=common===null?refs:new Set([...common].filter(ref=>refs.has(ref)));}evidenceByYear.set(y,{refs:[...(common??[])],rows:yr});}
 const supported=[...evidenceByYear.keys()],missing=a.years.filter(y=>!evidenceByYear.has(y));
 if(!supported.length)return {safe:[],reason:'no_exact_platform_engine_anchor'};
 if(!missing.length)return {safe:[],reason:'not_a_year_gap_case'};
 if(supported.length<2)return {safe:[],reason:'fewer_than_two_primary_anchor_years',supported,missing};
 let common=new Set(evidenceByYear.get(supported[0]).refs);for(const y of supported.slice(1))common=new Set([...common].filter(ref=>evidenceByYear.get(y).refs.includes(ref)));
 if(!common.size)return {safe:[],reason:'primary_reference_changes_within_application',supported,missing};
 if(type==='air_filter')return {safe:[],reason:'air_filter_year_gap_needs_independent_intake_evidence',supported,missing,candidates:[...common]};
 const safe=[],branches=[];
 for(const reference of common){const corroboration=secondary.filter(r=>r.reference===reference&&secondaryMatches(a,r));const missingSupported=missing.every(y=>corroboration.some(r=>y>=r.bounds.from&&y<=r.bounds.to));
  if(missingSupported)safe.push({reference,supported,missing,primary:uniq([...evidenceByYear.values()].flatMap(x=>x.rows.filter(r=>r.reference===reference)).map(r=>JSON.stringify({file:r.file,sheet:r.sheet,row:r.row,year:r.year,series:r.series,engine:r.engine}))).map(JSON.parse),secondary:corroboration.filter(r=>missing.some(y=>y>=r.bounds.from&&y<=r.bounds.to)).map(r=>({cleaned_row:r.cleaned_row,workbook_rows:r.workbook_rows,raw:r.raw,bounds:r.bounds,supplier:r.supplier,reference:r.reference}))});
  else branches.push({reference,reason:corroboration.some(r=>missing.every(y=>y>=r.bounds.raw_from&&y<=r.bounds.raw_to))?'month_boundary_not_representable':'no_explicit_secondary_range_for_all_missing_years'});
 }
 return {safe,reason:safe.length?'cross_source_exact_platform_engine_year_range':'year_gap_not_safely_corroborated',supported,missing,branches};
}
export function plan(source,secondarySource,d){
 const apps=enrich(d).map(a=>({...a,family:family(a.make,a.model)})),primary=prepareSource(source,apps),secondary=prepareSecondary(secondarySource);
 const priBy=group(primary,r=>r.family+'|'+r.type),refBy=new Map(d.references.map(r=>[r.id,r])),known=group(d.referenceFits.filter(r=>r.fitment_status==='published'),r=>r.application_id),fitBy=group(d.fitments,r=>r.application_id),productBy=new Map(d.products.map(r=>[r.id,r]));
 const rycoIds=d.identifiers.filter(i=>i.identifier_type==='cross_reference'&&compact(i.identifier_brand??i.metadata?.brand)==='RYCO'&&!['conflict','rejected'].includes(i.verification_status));
 const referenceWrites=[],productWrites=[],review=[],conflicts=[];
 for(const a of apps.filter(a=>a.years.length))for(const type of ['oil_filter','air_filter']){
  const rr=priBy.get(a.family+'|'+type);if(!rr)continue;
  const decision=yearDecision(a,type,rr,secondary);
  if(!decision.safe.length){if(!['no_exact_platform_engine_anchor','not_a_year_gap_case'].includes(decision.reason))review.push({application_id:a.application_id,make:a.make,model:a.model,series:a.series,engine:a.engine,type,...decision});continue;}
  const existingValues=(known.get(a.application_id)??[]).filter(f=>refBy.get(f.part_reference_id)?.product_type===type).map(f=>refBy.get(f.part_reference_id).normalized_value);
  const existingOil=(fitBy.get(a.application_id)??[]).filter(f=>f.fitment_status==='published'&&/^NOF\d/.test(productBy.get(f.product_variant_id)?.sku??''));
  const existingProductRefs=type==='oil_filter'?existingOil.flatMap(f=>rycoIds.filter(i=>i.product_variant_id===f.product_variant_id).map(i=>i.normalized_value)):[];
  if([...existingValues,...existingProductRefs].length&&![...existingValues,...existingProductRefs].some(ref=>decision.safe.some(r=>r.reference===ref))){conflicts.push({application_id:a.application_id,type,reason:'existing_published_reference_conflict',existing:uniq([...existingValues,...existingProductRefs]),proposed:decision.safe.map(r=>r.reference)});continue;}
  for(const evidence of decision.safe){const ref=d.references.find(r=>r.product_type===type&&r.reference_scheme==='ryco'&&r.normalized_value===evidence.reference);if(!ref)throw new Error('Reference not in Ryco registry');
   if(a.make==='TOYOTA'&&a.model==='RAV4'&&a.series==='GSA33'&&evidence.reference==='R2648P'&&evidence.missing.some(y=>y<2007)){
    conflicts.push({application_id:a.application_id,type,reference:evidence.reference,reason:'source_start_year_disagreement_requires_review',missing:evidence.missing,primary_first_year:Math.min(...evidence.supported),secondary:evidence.secondary,evidence_url:'https://resize.shop033.com/resources/BE/6846/Other/www%20brettstruck%20com%20au%20wesfil_catalog_2016.pdf',note:'Manufacturer Wesfil catalogue lists GSA33 2GR-FE from 2007, while Tinkr text uses 2005-2012; retain 2005/2006 for review.'});continue;
   }
   const row={application_id:a.application_id,type,part_reference_id:ref.id,position:'vehicle',reference:evidence.reference,make:a.make,model:a.model,series:a.series,body:a.body,drive:a.drive,engine:a.engine,engine_codes:a.engine_codes,years:a.years,rule:'two_primary_anchor_years_plus_exact_platform_engine_secondary_explicit_year_range',evidence};
   if(!existingValues.includes(evidence.reference))referenceWrites.push(row);
   if(type!=='oil_filter')continue;
   const candidates=uniq(rycoIds.filter(i=>i.normalized_value===evidence.reference).map(i=>i.product_variant_id)).map(id=>productBy.get(id)).filter(p=>p&&p.active!==false&&/^NOF\d+$/.test(p.sku));
   const product=candidates.length===1?candidates[0]:evidence.reference==='Z9'?candidates.find(p=>p.sku===selectZ9(a)):null;
   if(!product){if(candidates.length>1)conflicts.push({application_id:a.application_id,type,reference:evidence.reference,reason:'multiple_product_candidates'});continue;}
   const existing=(fitBy.get(a.application_id)??[]).filter(f=>f.product_variant_id===product.id);
   if(existing.some(f=>f.fitment_status==='published'))continue;if(existing.some(f=>f.fitment_status==='rejected')){conflicts.push({application_id:a.application_id,type,reason:'rejected_product_relationship'});continue;}
   productWrites.push({...row,product_variant_id:product.id,position:'engine',sku:product.sku,before:existing.find(f=>f.position==='engine')??null});
  }
 }
 const pp=[...new Map(productWrites.map(r=>[[r.application_id,r.product_variant_id,r.position].join('|'),r])).values()];
 return {policy:POLICY,generated_at:new Date().toISOString(),snapshot_hash:hash(d),source_hash:hash(source),secondary_hash:hash(secondarySource),referenceWrites,productWrites:pp,review,conflicts,summary:{reference_writes:referenceWrites.length,oil_reference_writes:referenceWrites.filter(r=>r.type==='oil_filter').length,air_reference_writes:referenceWrites.filter(r=>r.type==='air_filter').length,product_writes:pp.length,product_applications:uniq(pp.map(r=>r.application_id)).length,review:review.length,conflicts:conflicts.length,secondary_source_rows:secondary.length}};
}
export function coverage(d,p){
 const apps=enrich(d),variants=new Map(d.variants.map(r=>[r.variant_id,r])),products=new Map(d.products.map(r=>[r.id,r])),refs=new Map(d.references.map(r=>[r.id,r]));
 const bp=new Set(d.fitments.filter(f=>f.fitment_status==='published'&&products.get(f.product_variant_id)?.active!==false&&/^NOF\d/.test(products.get(f.product_variant_id)?.sku??'')).map(f=>f.application_id));
 const result={};
 for(const scope of ['all','core103','extended132']){
  const index=scope==='all'?null:buildPopularAliasIndex(groupsForPopularScope(scope==='core103'?'core75':'extended80'));
  const aa=apps.flatMap(a=>{const g=index?.get(canonicalModelKey(a.make,a.model)),v=variants.get(a.variant_id);if(index&&(!g||!popularGroupMatchesApplication(g,{bodyStyle:v?.body_style,variantName:v?.display_name})))return [];return [{...a,group:g?.id??a.family,years:a.years.filter(y=>scope==='all'||(y>=2000&&y<=2026))}];}).filter(a=>scope==='all'||a.years.length);
  const metric=ids=>{const yy=aa.flatMap(a=>a.years.map(y=>({id:a.application_id,k:a.group+'|'+y}))),cells=group(yy,r=>r.k),n=yy.filter(y=>ids.has(y.id)).length;return {applications_total:aa.length,applications_covered:aa.filter(a=>ids.has(a.application_id)).length,application_years_total:yy.length,application_years_covered:n,application_year_percent:Number((n/yy.length*100).toFixed(3)),model_years_total:cells.size,model_year_any:[...cells.values()].filter(rr=>rr.some(r=>ids.has(r.id))).length,model_year_full:[...cells.values()].filter(rr=>rr.every(r=>ids.has(r.id))).length};};
  result[scope]={};for(const type of ['oil_filter','air_filter']){const beforeP=type==='oil_filter'?bp:new Set(),afterP=new Set([...beforeP,...p.productWrites.filter(r=>r.type===type).map(r=>r.application_id)]),beforeK=new Set([...beforeP,...d.referenceFits.filter(f=>f.fitment_status==='published'&&refs.get(f.part_reference_id)?.product_type===type).map(f=>f.application_id)]),afterK=new Set([...beforeK,...afterP,...p.referenceWrites.filter(f=>f.type===type).map(f=>f.application_id)]);result[scope][type]={before_product:metric(beforeP),after_product:metric(afterP),before_knowledge:metric(beforeK),after_knowledge:metric(afterK)};}
 }
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const d=read('before-snapshot.json'),secondary=read('secondary-source.json'),source=JSON.parse(fs.readFileSync('outputs/ryco-filter-import-20261025/source.json','utf8'));
 const p=plan(source,secondary,d);put('plan.json',p);put('coverage-before-projected.json',coverage(d,p));console.log(JSON.stringify({summary:p.summary,applications:p.productWrites.map(r=>({application_id:r.application_id,model:r.model,series:r.series,reference:r.reference,years:r.years,added_source_years:r.evidence.missing})),review_reasons:p.review.reduce((o,r)=>(o[r.reason]=(o[r.reason]??0)+1,o),{})},null,2));
}
