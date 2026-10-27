import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {OUT} from './import-ryco-filter-fitments-20261025.mjs';
import {groupsForPopularScope,buildPopularAliasIndex,popularGroupMatchesApplication} from './popular-vehicle-models.mjs';
import {canonicalModelKey} from './wipertech-direct-matcher.mjs';
const read=n=>JSON.parse(fs.readFileSync(path.join(OUT,n),'utf8'));
const d=read('before-snapshot.json'),p=read('plan.json');
const current=JSON.parse(fs.readFileSync('outputs/product-knowledge-coverage-20261025/coverage-report.json','utf8'));
const by=(rr,k)=>new Map(rr.map(r=>[r[k],r]));
const models=by(d.models,'model_id'),makes=by(d.makes,'make_id'),variants=by(d.variants,'variant_id'),products=by(d.products,'id'),categories=new Map(d.productRows.map(r=>[r.id,r.category_slug]));
const oilBefore=new Set(d.fitments.filter(r=>r.fitment_status==='published'&&(categories.get(products.get(r.product_variant_id)?.product_id)==='filter'||/^NOF\d/.test(products.get(r.product_variant_id)?.sku??''))).map(r=>r.application_id));
const oilAfter=new Set([...oilBefore,...p.products.map(r=>r.application_id)]);
const lineSets={oil_filter:{before:oilBefore,product:oilAfter,knowledge:new Set([...oilAfter,...p.fits.filter(r=>r.type==='oil_filter').map(r=>r.application_id)])},air_filter:{before:new Set(),product:new Set(),knowledge:new Set(p.fits.filter(r=>r.type==='air_filter').map(r=>r.application_id))}};
const result={coverage_generated_at:current.generated_at,period:'2000-2026',scopes:{}};
for(const [scope,reportKey] of [['core75','popular_core_103_2000_2026'],['extended80','popular_extended_132_2000_2026']]){
 const aliases=buildPopularAliasIndex(groupsForPopularScope(scope));
 const selected=new Map();
 for(const a of d.applications.filter(r=>r.status==='active')){
  const m=models.get(a.model_id),mk=makes.get(m?.make_id),g=aliases.get(canonicalModelKey(mk?.name??'',m?.name??'')),v=variants.get(a.variant_id);
  if(g&&popularGroupMatchesApplication(g,{bodyStyle:v?.body_style,variantName:v?.display_name}))selected.set(a.application_id,g.id);
 }
 const yy=d.years.filter(r=>selected.has(r.application_id)&&r.model_year>=2000&&r.model_year<=2026),apps=new Set(yy.map(r=>r.application_id)),cells=new Map();
 for(const r of yy){const k=selected.get(r.application_id)+'|'+r.model_year;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(r.application_id);}
 const percent=(n,den)=>Number((n/den*100).toFixed(2));
 const metric=ids=>{const ac=[...apps].filter(id=>ids.has(id)).length,ay=yy.filter(r=>ids.has(r.application_id)).length,any=[...cells.values()].filter(rr=>rr.some(id=>ids.has(id))).length,full=[...cells.values()].filter(rr=>rr.every(id=>ids.has(id))).length;return {applications:`${ac}/${apps.size}`,application_percent:percent(ac,apps.size),application_years:`${ay}/${yy.length}`,application_year_percent:percent(ay,yy.length),model_year_any:`${any}/${cells.size}`,model_year_any_percent:percent(any,cells.size),model_year_full:`${full}/${cells.size}`,model_year_full_percent:percent(full,cells.size)};};
 result.scopes[scope]={};
 for(const [line,sets] of Object.entries(lineSets)){
  const row={before:metric(sets.before),product:metric(sets.product),knowledge:metric(sets.knowledge)};
  assert.equal(row.product.application_year_percent,current[reportKey][line].product.application_year_coverage_percent,'Live report differs');
  assert.equal(row.knowledge.application_year_percent,current[reportKey][line].knowledge.application_year_coverage_percent,'Live report differs');
  result.scopes[scope][line]=row;
 }
}
fs.writeFileSync(path.join(OUT,'coverage-metrics.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
