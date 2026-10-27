import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';
import { REQUESTED_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from './popular-vehicle-models.mjs';
import { canonicalModelKey } from './wipertech-direct-matcher.mjs';
import { evaluateBrakeFitment, UNIQUE_FIRST_POLICY_VERSION } from './brake-pad-strict-policy.mjs';

const ROOT=process.cwd();
const OUT=path.resolve('outputs/brake-pad-expansion-20261024');
const PRIOR=path.resolve('outputs/bendix-topstar-fitments-20261024');
const SOURCE='BENDIX_VERIFIED_PLATFORM_EXPANSION_2026_10_24';
export const compact=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function family(make,model){
  const rawMake=compact(make);
  const m=rawMake==='VW'?'VOLKSWAGEN':rawMake==='FORDAUSTRALIA'?'FORD':rawMake, n=compact(model).replace(/SERIES$/,'');
  const aliases={MAZDA:{DEMIO:'2',MAZDA2:'2',AXELA:'3',MAZDA3:'3',ATENZA:'6',MAZDA6:'6',PREMACY:'5',MAZDA5:'5'},
    TOYOTA:{VITZ:'YARIS',KLUGER:'HIGHLANDER',LANDCRUISERPRADO:'PRADO',PRIUSC:'AQUA',ALPHARDVELLFIRE:'ALPHARDVELLFIRE'},NISSAN:{DUALIS:'QASHQAI'},AUDI:{A4ALLROAD:'A4'}};
  return `${m}|${aliases[m]?.[n]??n}`;
}
export function exactChassisMatch(code,token){
  const a=compact(code), b=compact(token);
  if(a.length<2||b.length<2)return false;
  if(String(token).includes('_')) {
    const expression=String(token).toUpperCase().replace(/[^A-Z0-9_]/g,'').split('_').join('[A-Z0-9]*');
    return new RegExp(`^${expression}$`).test(a);
  }
  if(a===b)return true;
  // Prefix is allowed for a catalog platform, never an arbitrary embedded substring.
  return b.length>=2 && /^[A-Z]{1,3}\d?[A-Z]?$/.test(b) && a.startsWith(b)
    || b.length>=3 && a.startsWith(b) && /^[A-Z0-9]+$/.test(b);
}
export function sourceTokens(row){
  const groups=[...String(row.seriesName).toUpperCase().matchAll(/\(([^)]+)\)/g)].flatMap(m=>m[1].split(/[,/;|]+/));
  return [...new Set(groups.map(t=>String(t).trim().replace(/[^A-Z0-9_]/g,'')).filter(t=>compact(t).length>=2))];
}

export function identityIssue(a,sourceRows){
 const code=compact(a.series);
 const own=sourceRows.some(s=>s.family===a.family&&s.tokens.some(t=>exactChassisMatch(code,t)));
 if(own)return null;
 const alternatives=sourceRows.filter(s=>s.family.split('|')[0]===a.family.split('|')[0]&&s.family!==a.family
   &&s.tokens.some(t=>{const key=compact(t);return key===code||key.length>=3&&code.startsWith(key)||a.make==='MAZDA'&&key==='DK'&&code.startsWith('DK');}));
 const families=[...new Set(alternatives.map(s=>s.family))];
 if(families.length===1)return {reason:a.make==='BMW'&&code==='E36'?'共用E36代码，3系与Z3车型/卡钳需核实':'底盘在权威源中属于其他车型，需核实车型库或源表归属',suggested_family:families[0],source_rows:alternatives.map(s=>s.sourceRowId),source_series:[...new Set(alternatives.map(s=>s.seriesName))]};
 if(a.make==='BMW'&&a.family==='BMW|3'&&!/^(E(21|30|36|46|90|91|92|93)|F(30|31|34|35|80)|G(20|21|28|80|81))$/.test(code))return {reason:'数字车型名与底盘身份需核实',suggested_family:'待核实',source_rows:[]};
 if(a.family==='VOLKSWAGEN|GOLF'&&/^1T/.test(code))return {reason:'Golf名下1T底盘需核实是否Touran',suggested_family:'VOLKSWAGEN|TOURAN',source_rows:[],source_series:['TOURAN (1T1, 1T2)']};
 return null;
}

async function main(){
 fs.mkdirSync(OUT,{recursive:true});
 const afterMode=process.argv.includes('--after');
 const cache=path.join(OUT,afterMode?'after-snapshot.json':'baseline-snapshot.json');
 let data;
 if(process.argv.includes('--cached')) data=JSON.parse(fs.readFileSync(cache,'utf8'));
 else {data=await loadProduction();fs.writeFileSync(cache,JSON.stringify(data));}
 if(process.argv.includes('--snapshot-only')){console.log(JSON.stringify({cache,applications:data.applications.length,years:data.years.length,fitments:data.fitments.length}));return;}
 const source=JSON.parse(fs.readFileSync(path.join(PRIOR,'confirmation-data.json'),'utf8')).sourceRows;
 const oldGaps=JSON.parse(fs.readFileSync(path.join(PRIOR,'popular-gap-analysis.json'),'utf8'));
 const prepared=prepare(data,source,oldGaps);
 fs.writeFileSync(path.join(OUT,afterMode?'remaining-plan.json':'plan.json'),JSON.stringify(prepared,null,2));
 console.log(JSON.stringify({...prepared,applications:undefined,publish:undefined,review:undefined,original124:undefined,identityReview:undefined,replacements:undefined},null,2));
 if(process.argv.includes('--apply')){
   const result=await applyPlan(data,prepared);
   fs.writeFileSync(path.join(OUT,'applied.json'),JSON.stringify(result,null,2));
   console.log(JSON.stringify(result,null,2));
 }
}

async function applyPlan(data,plan){
 const db=client(), ids=[...new Set(plan.publish.map(r=>r.application_id))];
 const live=await inChunks(db,'vehicle_catalog_product_fitments','*','application_id',ids);
 const currentApps=await inChunks(db,'vehicle_catalog_applications','*','application_id',ids);
 const oldApps=new Map(data.applications.map(r=>[r.application_id,r]));
 for(const a of currentApps){const old=oldApps.get(a.application_id);if(a.status!=='active'||['model_id','series_id','variant_id','powertrain_id','year_from','year_to'].some(k=>a[k]!==old[k]))throw new Error(`Application changed: ${a.application_id}`);}
 const baselineKeys=new Map(data.fitments.map(r=>[fitKey(r),r]));
 for(const r of live){const old=baselineKeys.get(fitKey(r));if(!old||old.fitment_status!==r.fitment_status||old.source!==r.source||old.notes!==r.notes)throw new Error(`Fitment changed since preflight: ${fitKey(r)}`);}
 const idSet=new Set(ids);
 if(data.fitments.filter(r=>idSet.has(r.application_id)).length!==live.length)throw new Error('Target fitment row count changed');
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=path.resolve('tmp/production-backups',`brake-platform-expansion-${stamp}`);
 fs.mkdirSync(backup,{recursive:true});
 fs.writeFileSync(path.join(backup,'vehicle_catalog_product_fitments.json'),JSON.stringify(live,null,2));
 fs.writeFileSync(path.join(backup,'vehicle_catalog_applications.json'),JSON.stringify(currentApps,null,2));
 const snapshotText=fs.readFileSync(path.join(OUT,'baseline-snapshot.json'),'utf8');
 fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({source:SOURCE,created_at:new Date().toISOString(),snapshot:path.join(OUT,'baseline-snapshot.json'),snapshot_sha256:crypto.createHash('sha256').update(snapshotText).digest('hex'),counts:plan.counts},null,2));
 const pvBySku=new Map(data.products.map(r=>[r.sku,r.id])),now=new Date().toISOString();
 const payload=plan.publish.map(r=>({application_id:r.application_id,product_variant_id:pvBySku.get(r.sku),position:r.position,fitment_status:'published',source:SOURCE,
   notes:[`rule=${r.rule}`,`db=${r.db}`,`sku=${r.sku}`,`chassis=${r.series}`,`source_rows=${r.source_rows.join(',')}`,`donors=${r.donors.map(d=>d.application_id).join(',')}`,`source_confidence=highest`,`publication_policy=${UNIQUE_FIRST_POLICY_VERSION}`,`match_confidence=${r.provisional?'unique_candidate_provisional':'complete_source_configuration'}`,`match_warnings=${r.warnings?.join(' / ')??''}`,`bridge=${r.bridge?.rule_id??''}`,`bridge_urls=${r.bridge?.urls?.join(',')??''}`].join('; '),updated_at:now}));
 if(payload.some(r=>!r.product_variant_id))throw new Error('Missing product variant');
 if(new Set(payload.map(r=>`${r.application_id}|${r.position}`)).size!==payload.length)throw new Error('Nonunique application/position plan');
 for(let i=0;i<payload.length;i+=150){const {error}=await db.from('vehicle_catalog_product_fitments').upsert(payload.slice(i,i+150),{onConflict:'application_id,product_variant_id,position'});if(error)throw error;}
 for(const row of plan.replacements){const r=row.existing;const {error}=await db.from('vehicle_catalog_product_fitments').update({fitment_status:'rejected',updated_at:now,notes:`${r.notes??''}; ${SOURCE}; superseded_by=${row.candidate.sku}`}).eq('application_id',r.application_id).eq('product_variant_id',r.product_variant_id).eq('position',r.position);if(error)throw error;}
 const verified=await inChunks(db,'vehicle_catalog_product_fitments','*','application_id',ids),keys=new Map(verified.map(r=>[fitKey(r),r]));
 for(const r of payload){const found=keys.get(fitKey(r));if(found?.fitment_status!=='published'||found.source!==SOURCE)throw new Error(`Verification missing ${fitKey(r)}`);}
 const brakeIds=new Set(data.products.filter(r=>/^NBP\d/.test(r.sku)).map(r=>r.id));
 const targets=new Map(payload.map(r=>[`${r.application_id}|${r.position}`,r.product_variant_id]));
 const conflicts=verified.filter(r=>r.fitment_status==='published'&&brakeIds.has(r.product_variant_id)&&targets.has(`${r.application_id}|${r.position}`)&&targets.get(`${r.application_id}|${r.position}`)!==r.product_variant_id);
 if(conflicts.length)throw new Error(`Post-apply conflicts=${conflicts.length}`);
 const afterFitments=[...data.fitments.filter(r=>!idSet.has(r.application_id)),...verified];
 fs.writeFileSync(path.join(OUT,'after-snapshot.json'),JSON.stringify({...data,fitments:afterFitments,verified_at:new Date().toISOString()}));
 const covered=new Set(afterFitments.filter(r=>r.fitment_status==='published'&&brakeIds.has(r.product_variant_id)).map(r=>r.application_id));
 const afterYears=plan.applications.filter(a=>covered.has(a.application_id)).reduce((n,a)=>n+reportYearCount(a),0);
 if(afterYears-plan.baseline.covered_application_years!==plan.counts.new_coverage_years)throw new Error('Coverage delta mismatch');
 return {source:SOURCE,applied_at:now,backup,published_fitments:payload.length,affected_applications:ids.length,newly_covered_applications:plan.counts.new_coverage_applications,newly_covered_application_years:plan.counts.new_coverage_years,original124_resolved:plan.counts.original124_resolved,original124_identity_review:plan.counts.original124_identity_review,superseded:plan.replacements.length,remaining_target_conflicts:conflicts.length,total_application_years:plan.baseline.application_years,before_covered_application_years:plan.baseline.covered_application_years,after_covered_application_years:afterYears,before_coverage:plan.baseline.covered_application_years/plan.baseline.application_years,after_coverage:afterYears/plan.baseline.application_years};
}

function fitKey(r){return `${r.application_id}|${r.product_variant_id}|${r.position}`;}
async function inChunks(db,table,cols,field,ids){const result=[];for(let i=0;i<ids.length;i+=100)result.push(...await all(db,table,cols,q=>q.in(field,ids.slice(i,i+100))));return result;}

export function prepare(data,source,oldGaps){
 const map=(items,key)=>new Map(items.map(r=>[r[key],r]));
 const makes=map(data.makes,'make_id'),models=map(data.models,'model_id'),series=map(data.series,'series_id'),variants=map(data.variants,'variant_id'),engines=map(data.engines,'powertrain_id');
 const years=group(data.years,r=>r.application_id),fits=group(data.fitments.filter(r=>r.fitment_status==='published'),r=>r.application_id);
 const products=map(data.products,'id'), catalog=JSON.parse(fs.readFileSync('data/brake-pads/catalog.json','utf8'));
 const catalogBySku=new Map(catalog.map(r=>[r.sku,r])),skuByDB=new Map(catalog.map(r=>[r.supplierRef,r.sku]));
 const popularIndex=buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
 const apps=data.applications.filter(r=>r.status==='active').map(r=>{
  const md=models.get(r.model_id),mk=makes.get(md?.make_id),v=variants.get(r.variant_id),s=series.get(r.series_id);
  return {...r,make:mk?.name??'',model:md?.name??'',series:s?.code??'',variant:v?.display_name??'',body:v?.body_style??'',drive:v?.drive_type??'',engine:engines.get(r.powertrain_id)?.display_name??'',
    displacementCc:engines.get(r.powertrain_id)?.displacement_cc??null,
    family:family(mk?.name,md?.name),years:(years.get(r.application_id)??[]).map(y=>+y.model_year),
    fits:(fits.get(r.application_id)??[]).filter(f=>catalogBySku.has(products.get(f.product_variant_id)?.sku)).map(f=>({...f,sku:products.get(f.product_variant_id).sku})),
    popular:popularIndex.get(canonicalModelKey(mk?.name??'',md?.name??''))};
 });
 const popular=apps.filter(a=>a.popular&&reportYearCount(a)>0);
 const appById=map(apps,'application_id'),sameSeries=group(apps.filter(a=>a.series),a=>`${a.family}|${compact(a.series)}`);
 const sourceRows=source.map(r=>({...r,family:family(r.makeName,r.modelName),tokens:sourceTokens(r)}));
 const byFamily=group(sourceRows,r=>r.family), old124=new Set(oldGaps.expansions.filter(r=>r.reason!=='同位置多个DB待区分卡钳').map(r=>r.application_id));
 const publish=[],review=[],identityReview=[],replacements=[];
 for(const a of popular){
  const issue=identityIssue(a,sourceRows);
  if(issue){identityReview.push({application_id:a.application_id,make:a.make,model:a.model,series:a.series,years:a.years,engine:a.engine,variant:a.variant,rank:a.popular.rank,group:a.popular.label,was_original124:old124.has(a.application_id),...issue});continue;}
  const familySource=sourceRows.filter(s=>s.family===a.family||(a.make==='TOYOTA'&&['ALPHARD','VELLFIRE'].includes(compact(a.model))&&s.family==='TOYOTA|ALPHARDVELLFIRE'));
  let matched=familySource.filter(s=>s.tokens.some(t=>exactChassisMatch(a.series,t)));
  let bridge=null;
  if(a.family==='VOLKSWAGEN|GOLF'&&/^AU[12]$/.test(compact(a.series))){
    matched=familySource.filter(s=>s.seriesName.startsWith('GOLF VII '));
    bridge={rule_id:'vw_golf7_au_to_5g',urls:['https://www.volkswagen-newsroom.com/en/vehicle-data-golf-7-profile-20039','https://www.volkswagen.fr/fr/entretenir-ma-volkswagen/anciens-modeles/compactes/golf-7.html']};
  }
  const peers=(sameSeries.get(`${a.family}|${compact(a.series)}`)??[]).filter(p=>p.application_id!==a.application_id&&p.fits.length);
  for(const position of ['front','rear']){
   const current=a.fits.filter(f=>f.position===position);
   let direct=matched.filter(s=>s.position===position);
   const allDirect=direct;
   let directDB=[...new Set(direct.map(s=>s.bendixReference))];
   let engineDisambiguation=false;
   if(directDB.length>1){
     const codes=new Set(String(a.engine).split('—').slice(1).join('—').split('/').map(compact).filter(Boolean));
     const narrowed=direct.filter(s=>s.engineCodes.some(c=>codes.has(compact(c))));
     const narrowDB=[...new Set(narrowed.map(s=>s.bendixReference))];
     if(narrowDB.length===1){direct=narrowed;directDB=narrowDB;engineDisambiguation=true;}
   }
   const donorFits=peers.flatMap(p=>p.fits.filter(f=>f.position===position).map(f=>({...f,donor:p.application_id})));
   const donorSku=[...new Set(donorFits.map(f=>f.sku))];
   const base={application_id:a.application_id,make:a.make,model:a.model,series:a.series,position,years:a.years,engine:a.engine,variant:a.variant,rank:a.popular.rank,group:a.popular.label,was_original124:old124.has(a.application_id)};
   if(directDB.length===1&&skuByDB.has(directDB[0])){
    const sku=skuByDB.get(directDB[0]);
    const strict=evaluateBrakeFitment(a,position,directDB[0],sourceRows);
    if(!strict.keep){review.push({...base,reason:`严格复核：${strict.reasons.join('；')}`,candidate_db:strict.candidate_db??strict.platform_db,candidate_skus:[],source_rows:strict.platform_source_rows});continue;}
    if(current.length&&current.every(f=>f.sku===sku))continue;
    const candidate={...base,sku,db:directDB[0],rule:strict.rule,source_rows:strict.source_rows,all_source_candidates:[...new Set(allDirect.map(s=>s.bendixReference))],donors:[],bridge,evidence_urls:strict.evidence_urls,provisional:strict.provisional??false,warnings:strict.warnings??[]};
    publish.push(candidate);
    for(const existing of current.filter(f=>f.sku!==sku))replacements.push({candidate,existing});
   }else if(directDB.length>1){
    review.push({...base,reason:'同底盘同位置源表多个DB',candidate_db:directDB,candidate_skus:directDB.map(db=>skuByDB.get(db)).filter(Boolean),source_rows:direct.map(s=>s.sourceRowId)});
   }else if(current.length){continue;
   }else if(donorSku.length===1){
    review.push({...base,reason:'同底盘现网单一供体不等于已验证适配，须补充具体配置源证据',candidate_skus:donorSku,candidate_db:donorSku.map(s=>catalogBySku.get(s).supplierRef),source_rows:[]});
   }else if(!a.fits.length){
    review.push({...base,reason:donorSku.length>1?'同底盘供体有多个SKU':'尚无明确底盘或代际映射',candidate_skus:donorSku,candidate_db:donorSku.map(s=>catalogBySku.get(s).supplierRef),source_rows:[]});
   }
  }
 }
 const covered=new Set(popular.filter(a=>a.fits.length).map(a=>a.application_id));
 const fresh=publish.filter(r=>!covered.has(r.application_id));
 const original124=[...old124].map(id=>({application_id:id,published_positions:publish.filter(r=>r.application_id===id).map(r=>r.position),identity_issue:identityReview.find(r=>r.application_id===id)??null,remaining:review.filter(r=>r.application_id===id)}));
 return {source:SOURCE,generated_at:new Date().toISOString(),baseline:{applications:popular.length,application_years:popular.reduce((n,a)=>n+reportYearCount(a),0),covered_application_years:popular.filter(a=>covered.has(a.application_id)).reduce((n,a)=>n+reportYearCount(a),0)},
 counts:{publish:publish.length,applications:new Set(publish.map(r=>r.application_id)).size,new_coverage_applications:new Set(fresh.map(r=>r.application_id)).size,new_coverage_years:[...new Set(fresh.map(r=>r.application_id))].reduce((n,id)=>n+reportYearCount(appById.get(id)),0),original124_resolved:original124.filter(r=>r.published_positions.length).length,original124_identity_review:original124.filter(r=>r.identity_issue).length,review:review.length,identity_review:identityReview.length,replacements:replacements.length},
 rules:counts(publish,r=>r.rule),applications:popular,publish,review,original124,identityReview,replacements};
}

async function loadProduction(){
 const db=client();
 const [makes,models,series,variants,engines,applications,fitments,products]=await Promise.all([
 all(db,'vehicle_catalog_makes','*'),all(db,'vehicle_catalog_models','*'),all(db,'vehicle_catalog_series','*'),all(db,'vehicle_catalog_variants','*'),all(db,'vehicle_catalog_powertrains','*'),all(db,'vehicle_catalog_applications','*'),all(db,'vehicle_catalog_product_fitments','*'),all(db,'product_variants','id,sku')]);
 const modelMap=new Map(models.map(r=>[r.model_id,r])),makeMap=new Map(makes.map(r=>[r.make_id,r])),alias=buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
 const targetIds=applications.filter(r=>r.status==='active'&&alias.has(canonicalModelKey(makeMap.get(modelMap.get(r.model_id)?.make_id)?.name??'',modelMap.get(r.model_id)?.name??''))).map(r=>r.application_id);
 const years=[];
 for(let i=0;i<targetIds.length;i+=100)years.push(...await all(db,'vehicle_catalog_application_years','application_id,model_year',q=>q.in('application_id',targetIds.slice(i,i+100))));
 return {fetched_at:new Date().toISOString(),makes,models,series,variants,engines,applications,fitments,products,years};
}
function client(){for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)){const m=line.match(/^([^#=]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});}
async function all(db,table,columns,filter=q=>q){const rows=[];for(let from=0;;from+=1000){const {data,error}=await filter(db.from(table).select(columns)).range(from,from+999);if(error)throw error;rows.push(...data);if(data.length<1000)return rows;}}
function group(rows,key){const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;}
function counts(rows,key){const out={};for(const r of rows)out[key(r)]=(out[key(r)]??0)+1;return out;}
function reportYearCount(a){return a.years.filter(y=>y>=2000&&y<=2026).length;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
