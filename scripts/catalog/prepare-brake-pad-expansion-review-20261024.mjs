import fs from 'node:fs';
import path from 'node:path';
const prior=path.resolve('outputs/bendix-topstar-fitments-20261024'),out=path.resolve('outputs/brake-pad-expansion-20261024');
const old=JSON.parse(fs.readFileSync(path.join(prior,'confirmation-data.json'),'utf8'));
const plan=JSON.parse(fs.readFileSync(path.join(out,'plan.json'),'utf8'));
const applied=JSON.parse(fs.readFileSync(path.join(out,'applied.json'),'utf8'));
const after=JSON.parse(fs.readFileSync(path.join(out,'after-snapshot.json'),'utf8'));
const sourceById=new Map(old.sourceRows.map(r=>[r.sourceRowId,r]));
const catalog=JSON.parse(fs.readFileSync('data/brake-pads/catalog.json','utf8'));
const byDB=new Map(catalog.map(r=>[r.supplierRef,r.sku]));
const resolved=new Set(plan.publish.map(r=>`${r.application_id}|${r.position}`));
const identities=new Set(plan.identityReview.map(r=>r.application_id));
const priorCases=new Set(old.review.filter(r=>r.application_id).map(r=>`${r.application_id}|${r.position}`));
const mappedSource=new Set([...plan.publish.flatMap(r=>r.source_rows),...plan.review.flatMap(r=>r.source_rows)]);
const review=old.review.filter(r=>r.application_id?!resolved.has(`${r.application_id}|${r.position}`)&&!identities.has(r.application_id):!mappedSource.has(r.source_row_id));
const products=new Map(after.products.map(r=>[r.id,r.sku]));
const currentByApp=new Map();
for(const f of after.fitments.filter(r=>r.fitment_status==='published'&&/^NBP\d/.test(products.get(r.product_variant_id)??''))){const k=`${f.application_id}|${f.position}`;if(!currentByApp.has(k))currentByApp.set(k,[]);currentByApp.get(k).push(products.get(f.product_variant_id));}
for(const r of review.filter(r=>r.application_id))r.existing_skus=(currentByApp.get(`${r.application_id}|${r.position}`)??[]).join(' / ');
let added=0;
for(const r of plan.review){
 const key=`${r.application_id}|${r.position}`;
 if(priorCases.has(key)||!r.candidate_db.length)continue;
 for(const db of r.candidate_db){
  const src=r.source_rows.map(id=>sourceById.get(id)).filter(s=>s?.bendixReference===db);
  const first=src[0];
  review.push({reason:r.reason,application_id:r.application_id,application_make:r.make,application_model:r.model,application_series:r.series,application_years:r.years.join(','),application_engine:r.engine,application_variant:r.variant,
   position:r.position,bendix_reference:db,candidate_sku:byDB.get(db)??'',existing_skus:(currentByApp.get(key)??[]).join(' / '),make:r.make,model:r.model,series:first?.seriesName??r.series,source_row_ids:src.map(s=>s.sourceRowId).join(','),matched_on:'chassis+position; pending_caliper',
   source_evidence:src.map(s=>({source_row_id:s.sourceRowId,series:s.seriesName,years:`${s.yearFrom}-${s.yearTo}`,engine_codes:s.engineCodes.join(' / '),body:s.bodyStyle,drive:s.driveType,bendix_reference:db,raw_part_number:s.rawPartNumber,engine_matches_application:false}))});
  added++;
 }
 priorCases.add(key);
}
const replacements=plan.replacements.map(({candidate:r,existing:e})=>({application_id:r.application_id,make:r.make,model:r.model,series:r.series,years:r.years.join(','),position:r.position,old_sku:e.sku,old_source:e.source,old_status:e.fitment_status,nexauto_sku:r.sku,bendix_reference:r.db,source_row_ids:r.source_rows.join(','),matched_on:r.rule}));
const result={report:{...old.report,matching:{conflictCasesToReplace:new Set(replacements.map(r=>`${r.application_id}|${r.position}`)).size}},review,sourceRows:old.sourceRows,replacements,identityReview:plan.identityReview,
 expansion:{applied,original124:plan.original124,published:plan.publish,baseline:plan.baseline,rules:plan.rules,prior_multiple_cases_removed:[...new Set(old.review.filter(r=>r.application_id&&resolved.has(`${r.application_id}|${r.position}`)).map(r=>`${r.application_id}|${r.position}`))].length,new_review_detail_rows:added}};
fs.writeFileSync(path.join(out,'confirmation-data.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({remaining_multiple_cases:new Set(review.filter(r=>r.application_id).map(r=>`${r.application_id}|${r.position}`)).size,remaining_unmatched_source_rows:review.filter(r=>!r.application_id).length,identity_review:plan.identityReview.length,source_rows_mapped:mappedSource.size,new_review_detail_rows:added},null,2));
