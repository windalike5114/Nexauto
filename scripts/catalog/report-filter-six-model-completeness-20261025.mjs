import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {normalize,enrich} from './import-ryco-filter-fitments-20261025.mjs';
import {DEFAULT_POPULAR_VEHICLE_GROUPS,buildPopularAliasIndex,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
const OUT=path.resolve('outputs/filter-six-model-completeness-20261025');
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const d=read('live-snapshot.json'),ingestion=read('source-ingestion-verification.json');
const source=JSON.parse(fs.readFileSync('outputs/ryco-filter-import-20261025/source.json','utf8'));
assert(ingestion.files.every(f=>f.expected===f.stored&&f.missing===0&&f.file_hash_match));
const rr=source.rows.map(normalize).filter(r=>['oil_filter','air_filter'].includes(r.type));
const apps=enrich(d),aliases=buildPopularAliasIndex(DEFAULT_POPULAR_VEHICLE_GROUPS),variants=new Map(d.variants.map(r=>[r.variant_id,r])),products=new Map(d.products.map(r=>[r.id,r])),refs=new Map(d.references.map(r=>[r.id,r]));
const oilProducts=new Set(d.fitments.filter(f=>f.fitment_status==='published'&&products.get(f.product_variant_id)?.active!==false&&/^NOF\d/.test(products.get(f.product_variant_id)?.sku??'')).map(f=>f.application_id));
const knowledge=Object.fromEntries(['oil_filter','air_filter'].map(type=>[type,new Set([...(type==='oil_filter'?oilProducts:[]),...d.referenceFits.filter(f=>f.fitment_status==='published'&&refs.get(f.part_reference_id)?.product_type===type&&f.metadata?.selection_mode!=='conditional_one_of').map(f=>f.application_id)])]));
const result=[];
for(const [make,model] of [['TOYOTA','COROLLA'],['TOYOTA','HILUX'],['TOYOTA','LANDCRUISER'],['FORD','RANGER'],['TOYOTA','RAV4'],['SUZUKI','SWIFT']]){
 const group=aliases.get(canonicalModelKey(make,model));assert(group,'Popular scope missing '+model);
 const aa=apps.filter(a=>aliases.get(canonicalModelKey(a.make,a.model))?.id===group.id&&popularGroupMatchesApplication(group,{bodyStyle:variants.get(a.variant_id)?.body_style,variantName:variants.get(a.variant_id)?.display_name})).map(a=>({...a,years:a.years.filter(y=>y>=2000&&y<=2026)})).filter(a=>a.years.length);
 const file=ingestion.files.find(f=>f.file.toUpperCase().includes(model)&&!f.file.includes('搜索引擎'));assert(file);
 const rows=rr.filter(r=>r.file===file.file),explicitYears=[...new Set(rows.filter(r=>!r.inferred).flatMap(r=>Array.from({length:r.to-r.from+1},(_,i)=>r.from+i)))].sort((a,b)=>a-b),years=[...new Set(rows.flatMap(r=>Array.from({length:r.to-r.from+1},(_,i)=>r.from+i)))].sort((a,b)=>a-b);
 const yy=aa.flatMap(a=>a.years.map(year=>({id:a.application_id,year}))),modelYears=[...new Set(yy.map(r=>r.year))];
 const metric=ids=>{const n=yy.filter(r=>ids.has(r.id)).length;return {applications:aa.length,covered_applications:aa.filter(a=>ids.has(a.application_id)).length,application_years:yy.length,covered_application_years:n,application_year_percent:Number((n/yy.length*100).toFixed(2)),model_years:modelYears.length,model_year_any:modelYears.filter(y=>yy.some(r=>r.year===y&&ids.has(r.id))).length,model_year_full:modelYears.filter(y=>yy.filter(r=>r.year===y).every(r=>ids.has(r.id))).length};};
 result.push({model,group:group.label,file:file.file,source_records:rows.length,source_year_from:years[0],source_year_to:years.at(-1),explicit_years:explicitYears,missing_years_inside_file_span:years.length?Array.from({length:years.at(-1)-years[0]+1},(_,i)=>years[0]+i).filter(y=>!explicitYears.includes(y)):[],missing_direct_years_in_2000_2026:Array.from({length:27},(_,i)=>2000+i).filter(y=>!explicitYears.includes(y)),inferred_rows:rows.filter(r=>r.inferred).map(r=>({row:r.row,year:r.year,type:r.type})),all_source_rows_stored:true,oil_product:metric(oilProducts),oil_knowledge:metric(knowledge.oil_filter),air_knowledge:metric(knowledge.air_filter)});
}
const report={checked_at:d.fetched_at,period:'2000-2026',scope_note:'Published coverage uses the maintained popular groups. Land Cruiser excludes Prado; Prado rows in the source workbook are independently classified. A year label in a file is not proof that all vehicle configurations were extracted.',six_source_rows:result.reduce((n,r)=>n+r.source_records,0),all_seven_files_source_rows:ingestion.files.reduce((n,r)=>n+r.stored,0),source_rows_missing:0,models:result};
fs.writeFileSync(path.join(OUT,'completeness-report.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(OUT,'六车型资料完整性核对.txt'),[
 '六车型滤芯资料完整性核对（2026-10-25）',
 `机油+空气滤芯：六份车型表${report.six_source_rows}条来源记录已全部保存，逐行哈希核验漏录0条；连同搜索结果表共${report.all_seven_files_source_rows}条。`,
 '资料保存完整，不等于车型配置适配完整；待核对、月份边界、推断记录不自动计入确认覆盖。',
 ...result.map(r=>`${r.model}：本表${r.source_records}条，年份标签${r.source_year_from}-${r.source_year_to}；2000-2026缺少直接记录年份：${r.missing_direct_years_in_2000_2026.join(', ')||'无（但不能证明配置齐全）'}；机油知识配置年份覆盖${r.oil_knowledge.application_year_percent}%，空气知识${r.air_knowledge.application_year_percent}%。`),
 'RAV4原表机油/空气记录缺2020和2021，已交叉补充部分适配，不代表全部配置已解决。Swift 2004年两条机油/空气记录注明沿用2006年，仍属于推断。',
 'Land Cruiser文件中的Prado独立分类；上述Land Cruiser覆盖指标不混入Prado。',
 '未宣称六份资料穷尽全部市场版本、发动机和车身；当前完整性仅对已提供且可读取的来源记录负责。'
].join('\n'),'utf8');
console.log(JSON.stringify({six_source_rows:report.six_source_rows,missing:0,models:result.map(r=>({model:r.model,source_years:[r.source_year_from,r.source_year_to],missing_years:r.missing_direct_years_in_2000_2026,oil_knowledge:r.oil_knowledge.application_year_percent,air_knowledge:r.air_knowledge.application_year_percent,oil_any_full:[r.oil_knowledge.model_year_any,r.oil_knowledge.model_year_full]}))},null,2));
