import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {groupsForPopularScope,buildPopularAliasIndex,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
const out=path.resolve('outputs/filter-overall-status-20261025');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const d=read('outputs/ryco-filter-expansion-20261025/before-snapshot.json'),p=read('outputs/ryco-filter-expansion-20261025/plan.json');
const live=read('outputs/product-knowledge-coverage-20261025/coverage-report.json'),status=read(path.join(out,'live-status.json'));
const models=new Map(d.models.map(r=>[r.model_id,r])),makes=new Map(d.makes.map(r=>[r.make_id,r])),variants=new Map(d.variants.map(r=>[r.variant_id,r])),products=new Map(d.products.map(r=>[r.id,r])),categories=new Map(d.productRows.map(r=>[r.id,r.category_slug])),refs=new Map(d.references.map(r=>[r.id,r]));
const aliases=buildPopularAliasIndex(groupsForPopularScope('extended80'));
const aa=d.applications.filter(r=>r.status==='active');
const appBy=new Map(aa.map(a=>{const m=models.get(a.model_id),mk=makes.get(m?.make_id),g=aliases.get(canonicalModelKey(mk?.name??'',m?.name??''));return [a.application_id,{...a,group:g?.id??a.model_id,popular:g&&popularGroupMatchesApplication(g,{bodyStyle:variants.get(a.variant_id)?.body_style,variantName:variants.get(a.variant_id)?.display_name})}];}));
const oilProduct=new Set([...d.fitments.filter(f=>f.fitment_status==='published'&&products.get(f.product_variant_id)?.active!==false&&(categories.get(products.get(f.product_variant_id)?.product_id)==='filter'||/^NOF\d/.test(products.get(f.product_variant_id)?.sku??''))).map(f=>f.application_id),...p.productWrites.map(f=>f.application_id)]);
const reference=[...d.referenceFits.filter(r=>r.fitment_status==='published').map(r=>({...r,type:refs.get(r.part_reference_id)?.product_type})),...p.referenceWrites];
const lines={oil_filter:{product:oilProduct,knowledge:new Set([...oilProduct,...reference.filter(r=>r.type==='oil_filter').map(r=>r.application_id)])},air_filter:{product:new Set(),knowledge:new Set(reference.filter(r=>r.type==='air_filter').map(r=>r.application_id))}};
const percent=(n,d)=>d?Number((n/d*100).toFixed(2)):0;
const report={generated_at:live.generated_at,source_status:status,scopes:{}};
for(const [scope,liveKey] of [['overall','all_application_years'],['extended132','popular_extended_132_2000_2026']]){
 const appIds=new Set([...appBy.values()].filter(a=>scope==='overall'||a.popular).map(a=>a.application_id));
 const years=d.years.filter(r=>appIds.has(r.application_id)&&(scope==='overall'||(r.model_year>=2000&&r.model_year<=2026)));
 const den=scope==='overall'?appIds:new Set(years.map(r=>r.application_id)),cells=new Map();
 for(const y of years){const key=appBy.get(y.application_id).group+'|'+y.model_year;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(y.application_id);}
 report.scopes[scope]={year_scope:scope==='overall'?'All attached catalog years':'2000-2026',lines:{}};
 for(const [line,layers] of Object.entries(lines)){
  report.scopes[scope].lines[line]={};
  for(const [layer,covered] of Object.entries(layers)){
   const apps=[...den].filter(id=>covered.has(id)).length,ay=years.filter(r=>covered.has(r.application_id)).length,any=[...cells.values()].filter(rr=>rr.some(id=>covered.has(id))).length,full=[...cells.values()].filter(rr=>rr.every(id=>covered.has(id))).length;
   const metric={applications_total:den.size,applications_covered:apps,application_percent:percent(apps,den.size),application_years_total:years.length,application_years_covered:ay,application_year_percent:percent(ay,years.length),model_years_total:cells.size,model_year_any:any,model_year_any_percent:percent(any,cells.size),model_year_full:full,model_year_full_percent:percent(full,cells.size)};
   assert.equal(metric.applications_covered,live[liveKey][line][layer].applications_covered,'Fresh production application reconciliation failed');
   assert.equal(metric.application_years_covered,live[liveKey][line][layer].application_years_covered,'Fresh production application-year reconciliation failed');
   assert.equal(metric.applications_total,live[liveKey][line][layer].applications_total);assert.equal(metric.application_years_total,live[liveKey][line][layer].application_years_total);
   report.scopes[scope].lines[line][layer]=metric;
  }
 }
}
fs.writeFileSync(path.join(out,'coverage-and-status.json'),JSON.stringify(report,null,2));
const text=['滤芯录入状态与覆盖率（2026-10-25）','范围：机油滤芯、空气滤芯。',
 '已录入：7份Ryco表中的8802条来源记录；机油50个、空气51个参考编号；312条已发布参考适配（机油269、空气43）；本次两轮共新增或确认106条机油产品关系。',
 '不能认定全部资料均已审核完成：最新oilfilter_fitment.xlsx仅做评估，主要内容与早期清洗数据重合；旧版OFF来源仍有17107条review产品适配关系，不计入覆盖率。另有1组已发布编号冲突、7条历史Z9适配待复核。',
 '总体口径：全库活跃车型配置、所有已收录年份；Extended132口径：维护中的132车型族、2000-2026年。产品与知识覆盖分开统计。',
 JSON.stringify(report.scopes,null,2)].join('\n');
fs.writeFileSync(path.join(out,'滤芯录入状态与覆盖率.txt'),text,'utf8');
console.log(JSON.stringify(report.scopes,null,2));
