// Pure offline matching. No database or network imports.
import { brakeFamily, bodyKey, chassisTokens, platformCodeMatch, compact } from './brake-pad-strict-policy.mjs';

export const POLICY = 'POPULAR50_SCRIPT_FIRST_UNIQUE_NO_CONFLICT_20261024';
export const unique = a => [...new Set(a)].sort();
export const family = brakeFamily;
export function driveSet(value) {
  const s=String(value??'').toUpperCase();
  if (/AWD|4WD|4X4|四驱/.test(s)) return ['awd'];
  if (/FWD|前驱/.test(s)) return ['fwd'];
  if (/RWD|后驱/.test(s)) return ['rwd'];
  if (/2WD|4X2|两驱/.test(s)) return ['fwd','rwd'];
  return [];
}
export function compatible(a,s) {
  const ab=bodyKey(a.body),sb=bodyKey(s.body);
  const ad=driveSet(a.drive||a.variant),sd=driveSet(s.drive);
  return (!ab||!sb||ab===sb)&&(!ad.length||!sd.length||ad.some(d=>sd.includes(d)));
}
export function engineExact(a,s) {
  return a.engine_codes?.length&&s.engine_codes?.length&&a.engine_codes.map(compact).some(c=>s.engine_codes.map(compact).includes(c))
    &&Number(a.displacement_cc)>0&&Number(s.displacement_cc)>0
    &&Math.abs(a.displacement_cc-s.displacement_cc)<=Math.max(30,a.displacement_cc*.02);
}
export function matchPlatform(a,s) {
  return family(a.make,a.model)===s.family&&!!compact(a.series)&&s.tokens.some(t=>platformCodeMatch(s.family,a.series,t));
}
export function normalizeBendix(rows) {
  return rows.map(r=>({source_id:`B:${r.sourceRowId}`,source_kind:'bendix_supplied',source_row:r.sourceRowId,
    family:family(r.makeName,r.modelName),make:r.makeName,model:r.modelName,series:r.seriesName,
    tokens:chassisTokens(r),from:r.yearFrom,to:r.yearTo,body:r.bodyStyle,drive:r.driveType,
    engine_codes:r.engineCodes??[],displacement_cc:r.displacementCc,position:r.position,db:r.bendixReference,
    year_kind:r.yearFrom>0&&r.yearTo>=r.yearFrom?'closed':'unknown_end',
    source_file:'Bendix_TopstarSupplied_Rows_2026-10-24.xlsx'}));
}
export function topstarFitmentTokens(row) {
  const explicit=String(row.chassis??'').toUpperCase().split(/\s*[/,;|]\s*/)
    .map(v=>v.trim()).filter(v=>/^[A-Z0-9_ -]+$/.test(v)&&v.length>=2);
  if(explicit.length)return explicit;
  // Some supplier rows put chassis codes in the column imported as `engine`.
  // Recover only an entirely code-shaped list. Values such as 2.0L, EV, or
  // free-text engine descriptions deliberately remain empty.
  const misplaced=String(row.engine??'').toUpperCase().split(/\s*[/,;|]\s*/)
    .map(v=>v.trim()).filter(Boolean);
  return misplaced.length&&misplaced.every(v=>/^(?=.*[A-Z])(?=.*\d)[A-Z0-9_]{2,7}$/.test(v))?misplaced:[];
}
export function normalizeTopstar(catalog) {
  return catalog.flatMap(p=>p.fitments.flatMap((r,i)=>{
    const positions=['front','rear'].filter(pos=>String(p.position).toLowerCase().includes(pos));
    const tokens=topstarFitmentTokens(r);
    const recoveredFromEngine=!String(r.chassis??'').trim()&&tokens.length>0;
    return positions.map(position=>({source_id:`T:${p.sku}:${i+1}:${position}`,source_kind:'topstar_chassis_catalog',
      source_row:i+1,source_sku:p.sku,family:family(r.make,r.model),make:r.make,model:r.model,series:recoveredFromEngine?r.engine:r.chassis,
      tokens,from:null,to:null,body:'',drive:'',engine_codes:[],displacement_cc:null,
      engine_description:r.engine,position,db:p.supplierRef,year_kind:'not_supplied_chassis_only',
      source_field:recoveredFromEngine?'engine_misfielded_chassis':'chassis',
      source_file:'brakepad_fitment_with_sku.csv (normalized catalog.json)'}));
  }));
}

export function assessYear(a,position,year,platform) {
  const config=platform.filter(s=>s.position===position&&compatible(a,s));
  let possible=config.filter(s=>(!s.bridge_years||s.bridge_years.includes(year))&&(s.year_kind==='not_supplied_chassis_only'
    ||(s.from>0&&year>=s.from&&(s.year_kind==='unknown_end'||year<=s.to))));
  let engine_narrowed=false;
  const beforeDB=unique(possible.map(s=>s.db));
  if(beforeDB.length>1){
    const exact=possible.filter(s=>engineExact(a,s));
    // Unknown source configuration remains plausible; never select a majority DB.
    const unknown=possible.filter(s=>!s.engine_codes.length||!s.displacement_cc);
    if(exact.length&&unique([...exact,...unknown].map(s=>s.db)).length===1){possible=[...exact,...unknown];engine_narrowed=true;}
  }
  const dbs=unique(possible.map(s=>s.db));
  const affirmative=possible.filter(s=>s.year_kind!=='unknown_end');
  const sole=dbs.length===1?dbs[0]:null;
  const proof=affirmative.filter(s=>s.db===sole);
  const dated=proof.filter(s=>s.year_kind==='closed');
  return {year,candidate_db:dbs,db:sole,source_ids:unique(possible.map(s=>s.source_id)),
    unknown_end_source_ids:unique(possible.filter(s=>s.year_kind==='unknown_end').map(s=>s.source_id)),
    positive_source_ids:unique(proof.map(s=>s.source_id)),dated_source_ids:unique(dated.map(s=>s.source_id)),
    engine_narrowed,
    status:dbs.length>1?'multiple_db':!sole?'no_source_for_year':!proof.length?'unknown_end_only':'unique_supported',
    support:dated.length?'dated_configuration':proof.length?'exact_chassis_years_not_supplied':'none'};
}

export function assessPosition(a,position,sourceRows,{identityFlags=[],productsByDB=new Map(),existing=[]}={}) {
  const platform=sourceRows.filter(s=>matchPlatform(a,s)&&s.position===position);
  const perYear=a.all_years.map(y=>assessYear(a,position,y,platform));
  const fullUnique=perYear.length>0&&perYear.every(y=>y.status==='unique_supported')&&unique(perYear.map(y=>y.db)).length===1;
  const candidateDB=unique(perYear.flatMap(y=>y.candidate_db));
  const proposedDB=fullUnique?perYear[0].db:null;
  const pub=existing.filter(f=>f.position===position&&f.fitment_status==='published');
  const currentDB=unique(pub.map(f=>f.db).filter(Boolean));
  const products=proposedDB?productsByDB.get(`${proposedDB}|${position}`)??[]:[];
  const uncertainPublic=pub.some(f=>!f.db);
  const pubConflict=pub.length&&(uncertainPublic||currentDB.length!==1||(proposedDB&&currentDB[0]!==proposedDB));
  const rejected=proposedDB&&existing.some(f=>f.position===position&&f.db===proposedDB&&f.fitment_status==='rejected');
  let status,reason;
  if(identityFlags.length){status='review_identity_risk';reason='已发现车型归属或市场版本风险，不能把现车名的目录当适配证据';}
  else if(pubConflict){status='review_published_conflict';reason='同位置已发布DB与候选不同，或现有发布产品无法确定DB';}
  else if(!platform.length){status=pub.length?'published_unverified':'review_no_platform';reason='没有同品牌车型的已确认底盘源行，不按年份硬套其他代际';}
  else if(!fullUnique){
    status=perYear.some(y=>y.status==='multiple_db')?'review_multiple_db':
      perYear.some(y=>y.status==='unknown_end_only')?'review_unknown_end':
      perYear.every(y=>y.status==='unique_supported')?'review_year_split':'review_year_or_config';
    reason={review_multiple_db:'配置筛选后仍有多个DB',review_unknown_end:'唯一候选仅靠结束年0的源行支持',
      review_year_split:'不同年份对应不同DB，不能给整个application直接挂单一产品',review_year_or_config:'部分年份没有正面源证据，或已知车身/驱动不相容'}[status];
  }else if(rejected){status='review_prior_rejection';reason='所选关系已有rejected历史，不能静默重新发布';}
  else if(products.length!==1){status='db_unique_product_mapping_pending';reason='DB已唯一，但当前同位置可用NBP产品不是唯一一个';}
  else if(pub.length){status='already_published_supported';reason='已发布相同DB，无需重复录入';}
  else{status='ready';reason='全部application关联年份均唯一，且无已发布冲突';}
  const warnings=[];
  if(!bodyKey(a.body))warnings.push('目标车身未明确');
  if(!driveSet(a.drive||a.variant).length)warnings.push('目标驱动未明确');
  if(perYear.some(y=>y.support==='exact_chassis_years_not_supplied'))warnings.push('包含TOPSTAR精确底盘目录，原目录未提供年份；不是把Bendix结束年0外推');
  if(fullUnique&&!perYear.every(y=>y.positive_source_ids.some(id=>{const s=sourceRows.find(s=>s.source_id===id);return s&&engineExact(a,s);})))warnings.push('发动机未逐年逐条证实，按同底盘配置唯一DB复用');
  return {case_id:`${a.application_id}|${position}`,application_id:a.application_id,rank:a.rank,group:a.group,
    make:a.make,model:a.model,series:a.series,body:a.body,drive:a.drive,variant:a.variant,engine:a.engine,
    engine_codes:a.engine_codes,displacement_cc:a.displacement_cc,position,years:a.years,all_years:a.all_years,
    candidate_db:candidateDB,proposed_db:proposedDB,proposed_sku:products.length===1?products[0].sku:null,
    product_variant_id:products.length===1?products[0].id:null,current_published_db:currentDB,current_published_sku:pub.map(p=>p.sku),
    status,reason,warnings,identity_flags:identityFlags,platform_source_ids:unique(platform.map(s=>s.source_id)),
    platform_names:unique(platform.map(s=>s.series)),source_ids:unique(perYear.flatMap(y=>y.source_ids)),
    year_segments:perYear,existing_relation_status:proposedDB?unique(existing.filter(f=>f.position===position&&f.db===proposedDB).map(f=>f.fitment_status)):[],
    support:fullUnique&&perYear.every(y=>y.support==='dated_configuration')?'closed_year_source':fullUnique?'chassis_unique_years_unspecified':'unresolved',
    action:status==='ready'?(existing.some(f=>f.position===position&&f.db===proposedDB&&f.fitment_status==='review')?'publish_existing_review':'insert_new_relation'):'none',
    all_original_ids:{model_id:a.model_id,series_id:a.series_id,variant_id:a.variant_id,powertrain_id:a.powertrain_id},
    production_changed:false,policy:POLICY};
}
