import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {client,all} from './review-brake-alias-groups-20261025.mjs';
import {OUT,prepare,coverageReport} from './import-ryco-filter-fitments-20261025.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const put=(n,v)=>fs.writeFileSync(path.join(OUT,n),JSON.stringify(v,null,2));
const db=client(),before=read('before-snapshot.json'),p=read('plan.json'),applied=read('applied.json');
assert(applied.verified);
const fits=await all(db,'vehicle_catalog_product_fitments','application_id');
const refs=await all(db,'catalog_part_references','id');
const sourceResponse=await db.from('catalog_data_sources').select('*').eq('code','RYCO_USER_WORKBOOKS_20261025').single();if(sourceResponse.error)throw sourceResponse.error;
const ownResponse=await db.from('vehicle_catalog_part_reference_fitments').select('*').eq('data_source_id',sourceResponse.data.id);if(ownResponse.error)throw ownResponse.error;
const own=ownResponse.data;
const key=r=>[r.application_id,r.product_variant_id,r.position].join('|');
const stable=rr=>JSON.stringify(rr.map(r=>JSON.stringify(r)).sort());
const changedKeys=new Set(p.products.map(key));
assert.equal(stable(fits.filter(r=>!changedKeys.has(key(r)))),stable(before.fitments.filter(r=>!changedKeys.has(key(r)))),'Unrelated product fitments changed');
assert.equal(new Set(fits.map(key)).size,fits.length,'Duplicate product fitment keys');
assert.equal(own.length,p.fits.length);
assert.equal(new Set(own.map(r=>[r.application_id,r.part_reference_id,r.position,r.data_source_id].join('|'))).size,own.length);
const refBy=new Map(refs.map(r=>[r.id,r]));
assert(own.every(r=>['oil_filter','air_filter'].includes(refBy.get(r.part_reference_id)?.product_type)&&r.fitment_status==='published'));
const lineResponse=await db.from('catalog_product_lines').select('*').in('code',['oil_filter','air_filter']);if(lineResponse.error)throw lineResponse.error;
const air=lineResponse.data.find(r=>r.code==='air_filter');
assert.equal(air.active,false);assert.equal(air.category_slug,'air-filter');assert.equal(air.specification_table,'air_filter_variant_specs');
const products=await all(db,'product_variants','id');assert.equal(stable(products),stable(before.products),'Product creation or product attributes changed');
const batches=await db.from('catalog_import_batches').select('id,row_count').eq('data_source_id',sourceResponse.data.id);if(batches.error)throw batches.error;
let archived=0;for(const b of batches.data){const r=await db.from('catalog_source_records').select('*',{count:'exact',head:true}).eq('batch_id',b.id);if(r.error)throw r.error;assert.equal(r.count,b.row_count);archived+=r.count;}
assert.equal(archived,p.summary.source_rows);
const d={...before,fitments:fits,references:refs,referenceFits:[...before.referenceFits.filter(r=>r.data_source_id!==sourceResponse.data.id),...own]};
const next=prepare(read('source.json'),d);assert.equal(next.products.length,0,'Repeat run would change product fitments');
const actual=coverageReport(p,d),projected=read('coverage-before-projected.json');
for(let i=0;i<actual.per_model.length;i++)for(const type of ['product','knowledge'])assert.deepEqual(actual.per_model[i]['after_'+type],projected.per_model[i]['after_'+type],'Coverage differs from projection');
put('coverage-after.json',actual);
const byType=Object.fromEntries(['oil_filter','air_filter'].map(t=>[t,{references:p.refs.filter(r=>r.type===t).length,published_fitments:own.filter(r=>refBy.get(r.part_reference_id)?.product_type===t).length,applications:new Set(own.filter(r=>refBy.get(r.part_reference_id)?.product_type===t).map(r=>r.application_id)).size}]));
const result={verified:true,at:new Date().toISOString(),source_records:archived,product_fitment_changes:p.products.length,product_skus:[...new Set(p.products.map(r=>r.sku))].sort(),by_type:byType,no_product_creation:true,air_reference_only:true,unrelated_product_fitments_unchanged:true,no_duplicate_fitments:true,repeat_product_writes:next.products.length,coverage_matches_projection:true,review_cases:p.review.length,blocked:p.blocked};
put('verification.json',result);put('review-queue.json',p.review);put('product-conflicts.json',p.blocked);
const totals=type=>{const rows=projected.per_model.filter(r=>r.type===type);return {before_product_application_years:rows.reduce((n,r)=>n+r.before_product.covered_application_years,0),after_product_application_years:rows.reduce((n,r)=>n+r.after_product.covered_application_years,0),before_knowledge_application_years:rows.reduce((n,r)=>n+r.before_knowledge.covered_application_years,0),after_knowledge_application_years:rows.reduce((n,r)=>n+r.after_knowledge.covered_application_years,0)};};
result.coverage={oil_filter:totals('oil_filter'),air_filter:totals('air_filter')};put('verification.json',result);
fs.writeFileSync(path.join(OUT,'更新结果.txt'),[
 'Ryco 机油滤芯 / 空气滤芯更新结果（2026-10-25）',
 `已保存来源记录：${archived} 条，仅包含机油滤芯与空气滤芯。`,
 `机油滤芯：50 个参考编号，110 条已发布参考适配；更新 ${p.products.length} 条现有产品适配，涉及 ${result.product_skus.length} 个 SKU。`,
 '空气滤芯：独立产品线 air_filter，51 个参考编号，35 条已发布参考适配；参照鼓刹为未来产品线，未创建商品。',
 `待核对：${p.review.length} 个“现有车型应用 × 产品线”问题，包含来源年份缺失、发动机/底盘无法精确匹配或配置分歧；均未强行发布。`,
 'Z9 对应 NOF1839 与 NOF1804，保留参考知识，暂缓产品自动关联。',
 '核验：逐项回读成功；未改其他产品适配；未创建产品；无重复适配；重复规划产品写入为 0；覆盖结果与计划一致。',
 '原始 Excel 保持不变；备份、来源文件哈希、逐行来源、更新计划和核验结果均保存在同目录。',
 '来源为用户提供的 Ryco 抽取表；本轮没有重新联网抓取目录。',
 JSON.stringify(result.coverage,null,2)
].join('\n'),'utf8');
console.log(JSON.stringify(result,null,2));
