import fs from 'node:fs';
import path from 'node:path';
import {OUT} from './expand-filter-model-years-20261025.mjs';
import {enrich} from './import-ryco-filter-fitments-20261025.mjs';
import {DEFAULT_POPULAR_VEHICLE_GROUPS,buildPopularAliasIndex,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const d=read('before-snapshot.json'),p=read('plan.json'),v=read('verification.json'),coverage=read('coverage-before-projected.json');
if(!v.verified)throw new Error('Verify before reporting');
const apps=enrich(d),variants=new Map(d.variants.map(r=>[r.variant_id,r])),refs=new Map(d.references.map(r=>[r.id,r])),products=new Map(d.products.map(r=>[r.id,r])),aliases=buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS);
const bp=new Set(d.fitments.filter(f=>f.fitment_status==='published'&&products.get(f.product_variant_id)?.active!==false&&/^NOF\d/.test(products.get(f.product_variant_id)?.sku??'')).map(f=>f.application_id));
const perGroup=[];
for(const group of DEFAULT_POPULAR_VEHICLE_GROUPS){
 const aa=apps.filter(a=>aliases.get(canonicalModelKey(a.make,a.model))?.id===group.id&&popularGroupMatchesApplication(group,{bodyStyle:variants.get(a.variant_id)?.body_style,variantName:variants.get(a.variant_id)?.display_name})).map(a=>({...a,years:a.years.filter(y=>y>=2000&&y<=2026)})).filter(a=>a.years.length);
 const metric=ids=>{const yy=aa.flatMap(a=>a.years.map(y=>({id:a.application_id,year:y}))),years=[...new Set(yy.map(r=>r.year))];return {applications:aa.length,covered_applications:aa.filter(a=>ids.has(a.application_id)).length,application_years:yy.length,covered_application_years:yy.filter(r=>ids.has(r.id)).length,model_years:years.length,model_year_any:years.filter(y=>yy.some(r=>r.year===y&&ids.has(r.id))).length,model_year_full:years.filter(y=>yy.filter(r=>r.year===y).every(r=>ids.has(r.id))).length};};
 for(const type of ['oil_filter','air_filter']){const beforeP=type==='oil_filter'?bp:new Set(),afterP=new Set([...beforeP,...p.productWrites.filter(r=>r.type===type).map(r=>r.application_id)]),beforeK=new Set([...beforeP,...d.referenceFits.filter(f=>f.fitment_status==='published'&&refs.get(f.part_reference_id)?.product_type===type).map(f=>f.application_id)]),afterK=new Set([...beforeK,...afterP,...p.referenceWrites.filter(f=>f.type===type).map(f=>f.application_id)]);perGroup.push({group:group.label,type,before_product:metric(beforeP),after_product:metric(afterP),before_knowledge:metric(beforeK),after_knowledge:metric(afterK)});}
}
fs.writeFileSync(path.join(OUT,'per-popular-group-coverage.json'),JSON.stringify(perGroup,null,2));
const percent=n=>Number(n).toFixed(2)+'%';
const ext=coverage.extended132.oil_filter,all=coverage.all.oil_filter;
const changes=p.productWrites.map(r=>({application_id:r.application_id,make:r.make,model:r.model,series:r.series,engine:r.engine,sku:r.sku,reference:r.reference,full_years:r.years,primary_supported_years:r.evidence.supported,corroborated_gap_years:r.evidence.missing,primary_sources:r.evidence.primary,secondary_sources:r.evidence.secondary}));
fs.writeFileSync(path.join(OUT,'confirmed-year-expansions.json'),JSON.stringify(changes,null,2));
const text=[
 '滤芯车型年份扩展结果（2026-10-25）',
 '规则：相同车型族、确切底盘、发动机；至少两个Ryco年份锚点编号一致，且另一份资料的原文明示缺口年份在适用区间内。辅证同时匹配发动机、车身和驱动，排除附加条件及无法表达的月份边界。',
 '已完成：7条旧review机油产品适配确认发布；8条机油参考适配发布。补齐7个配置的29个配置年份证据缺口，使其完整62个配置年份能够发布。',
 '未改动车型库生产年份，分母保持不变。空气滤芯本轮没有新增，47个空气年份缺口需补独立的进气配置证据。',
 '',
 ...changes.map(r=>`${r.model} ${r.series} / ${r.engine} / ${r.reference} -> ${r.sku}：完整适配 ${r.full_years[0]}-${r.full_years.at(-1)}；补齐来源年份 ${r.corroborated_gap_years.join(', ')}。`),
 '',
 '覆盖率（配置年份口径）',
 `全库全部收录年份：机油产品 ${percent(all.before_product.application_year_percent)} -> ${percent(all.after_product.application_year_percent)}；机油知识 ${percent(all.before_knowledge.application_year_percent)} -> ${percent(all.after_knowledge.application_year_percent)}。`,
 `Extended132 / 2000-2026：机油产品 ${percent(ext.before_product.application_year_percent)} -> ${percent(ext.after_product.application_year_percent)}（${ext.after_product.application_years_covered}/${ext.after_product.application_years_total}）；机油知识 ${percent(ext.before_knowledge.application_year_percent)} -> ${percent(ext.after_knowledge.application_year_percent)}（${ext.after_knowledge.application_years_covered}/${ext.after_knowledge.application_years_total}）。`,
 `Extended132配置覆盖：产品 ${ext.before_product.applications_covered} -> ${ext.after_product.applications_covered}/${ext.after_product.applications_total}；知识 ${ext.before_knowledge.applications_covered} -> ${ext.after_knowledge.applications_covered}/${ext.after_knowledge.applications_total}。`,
 `Extended132车型年份any/full：产品 any ${ext.before_product.model_year_any} -> ${ext.after_product.model_year_any}/${ext.after_product.model_years_total}，full保持${ext.after_product.model_year_full}/${ext.after_product.model_years_total}；知识 any ${ext.before_knowledge.model_year_any} -> ${ext.after_knowledge.model_year_any}/${ext.after_knowledge.model_years_total}，full保持${ext.after_knowledge.model_year_full}/${ext.after_knowledge.model_years_total}。`,
 '待核对：134个有限年份缺口案例，以及1组RAV4 GSA33 / R2648P起始年份分歧。没有凭相邻年份、同排量或旧版全球发动机匹配直接发布。',
 'GSA33原文2005-2012与制造商Wesfil目录的2007起点不一致，2005/2006保留复核： https://resize.shop033.com/resources/BE/6846/Other/www%20brettstruck%20com%20au%20wesfil_catalog_2016.pdf',
 '核验：备份完成、逐项回读通过、无重复、无产品创建、无车型年限修改；其他产品适配保持不变；重复规划写入为0；实际覆盖与计划一致。',
 '逐行证据、备份、确认清单、待核对清单及各车型组覆盖数据保存在同目录。'
].join('\n');
fs.writeFileSync(path.join(OUT,'车型年份扩展结果.txt'),text,'utf8');
console.log(JSON.stringify({verified:v.verified,product_relationships:changes.length,year_evidence_gaps:changes.reduce((n,r)=>n+r.corroborated_gap_years.length,0),application_year_gain:ext.after_product.application_years_covered-ext.before_product.application_years_covered,extended132_product:ext.after_product.application_year_percent,extended132_knowledge:ext.after_knowledge.application_year_percent,report:'车型年份扩展结果.txt'}));
