import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { REQUESTED_POPULAR_VEHICLE_GROUPS, buildPopularAliasIndex } from './popular-vehicle-models.mjs';
import { canonicalModelKey } from './wipertech-direct-matcher.mjs';
import { family as normalizedBrakeFamily } from './expand-brake-pad-platforms-20261024.mjs';

const outputFlag=process.argv.indexOf('--output-dir');
const out = path.resolve(outputFlag>=0?process.argv[outputFlag+1]:'outputs/bendix-topstar-fitments-20261024');
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const confirmation = JSON.parse(fs.readFileSync(path.join(out, 'confirmation-data.json'), 'utf8'));
if (process.argv.includes('--refine-only')) {
  const prior = JSON.parse(fs.readFileSync(path.join(out, 'popular-gap-analysis.json'), 'utf8'));
  refineReasons(prior, confirmation.sourceRows);
  fs.writeFileSync(path.join(out, 'popular-gap-analysis.json'), JSON.stringify(prior, null, 2));
  console.log(JSON.stringify({coverage:prior.coverage,reasons:prior.reasons,same_chassis_potential:prior.same_chassis_potential},null,2));
  process.exit(0);
}
const catalog = JSON.parse(fs.readFileSync('data/brake-pads/catalog.json', 'utf8'));
const snapshotFlag=process.argv.indexOf('--snapshot');
const snapshot=snapshotFlag>=0?JSON.parse(fs.readFileSync(process.argv[snapshotFlag+1],'utf8')):null;
const [makes, models, series, variants, engines, apps, years, fits, products] = snapshot
 ? [snapshot.makes,snapshot.models,snapshot.series,snapshot.variants,snapshot.engines,snapshot.applications,snapshot.years,snapshot.fitments,snapshot.products]
 : await Promise.all([
  all('vehicle_catalog_makes', 'make_id,name,status'),
  all('vehicle_catalog_models', 'model_id,make_id,name,status'),
  all('vehicle_catalog_series', 'series_id,code,display_name'),
  all('vehicle_catalog_variants', 'variant_id,body_style,drive_type,display_name'),
  all('vehicle_catalog_powertrains', 'powertrain_id,display_name'),
  all('vehicle_catalog_applications', 'application_id,model_id,series_id,variant_id,powertrain_id,status'),
  all('vehicle_catalog_application_years', 'application_id,model_year'),
  all('vehicle_catalog_product_fitments', 'application_id,product_variant_id,position,fitment_status,source'),
  all('product_variants', 'id,sku')
]);
const by = (items, key) => new Map(items.map(r => [r[key], r]));
const mk = by(makes, 'make_id'), md = by(models, 'model_id'), sr = by(series, 'series_id');
const vr = by(variants, 'variant_id'), pt = by(engines, 'powertrain_id'), pv = by(products, 'id');
const catalogBySku = new Map(catalog.map(r => [r.sku, r]));
const alias = buildPopularAliasIndex(REQUESTED_POPULAR_VEHICLE_GROUPS);
const yearsByApp = group(years, r => r.application_id);
const live = fits.filter(r => r.fitment_status === 'published' && /^NBP\d/.test(pv.get(r.product_variant_id)?.sku ?? ''));
const liveByApp = group(live, r => r.application_id);
const candidatesByApp = group(confirmation.review.filter(r => r.application_id), r => r.application_id);
const expanded = apps.filter(r => r.status === 'active').map(r => {
  const model = md.get(r.model_id), make = mk.get(model?.make_id), v = vr.get(r.variant_id), s = sr.get(r.series_id);
  return { id:r.application_id, make:make?.name ?? '', model:model?.name ?? '', series:s?.code ?? '',
    series_display:s?.display_name ?? '', body:v?.body_style ?? '', drive:v?.drive_type ?? '',
    variant:v?.display_name ?? '', engine:pt.get(r.powertrain_id)?.display_name ?? '',
    years:(yearsByApp.get(r.application_id) ?? []).map(y => +y.model_year).sort((a,b)=>a-b),
    live:liveByApp.get(r.application_id) ?? [], popular:alias.get(canonicalModelKey(make?.name ?? '', model?.name ?? '')) };
});
const sourceGroupKey = (make,model) => confirmation.expansion ? normalizedBrakeFamily(make,model) : canonicalModelKey(make === 'VW' ? 'VOLKSWAGEN' : make,model);
const sourceByModel = group(confirmation.sourceRows, r => sourceGroupKey(r.makeName,r.modelName));
const allByExactSeries = group(expanded.filter(r => r.series), r => `${sourceGroupKey(r.make,r.model)}|${compact(r.series)}`);
const popular = expanded.filter(r => r.popular && r.years.some(y=>y>=2000 && y<=2026));
const gaps = [], partial = [], expansions = [];
for (const a of popular) {
  const ys = a.years.filter(y=>y>=2000 && y<=2026);
  const positions = [...new Set(a.live.map(r=>r.position))];
  const candidates = candidatesByApp.get(a.id) ?? [];
  const exactSource = sourceByModel.get(sourceGroupKey(a.make,a.model)) ?? [];
  const aliasSource = confirmation.sourceRows.filter(s => s.makeName === a.make && (
    a.popular.aliases.some(([make,model])=>sourceGroupKey(make,model)===sourceGroupKey(s.makeName,s.modelName))));
  const source = exactSource.length ? exactSource : aliasSource;
  const peers = a.series ? allByExactSeries.get(`${sourceGroupKey(a.make,a.model)}|${compact(a.series)}`) ?? [] : [];
  const donors = peers.filter(p=>p.id!==a.id && p.live.length);
  const donorChoices = {};
  for (const p of donors) for (const f of p.live) {
    const key = f.position;
    (donorChoices[key] ??= new Set()).add(pv.get(f.product_variant_id)?.sku);
  }
  const uniqueDonors = Object.entries(donorChoices).filter(([pos, skus]) => ['front','rear'].includes(pos) && skus.size===1);
  const proposed = uniqueDonors.map(([position,skus])=>({position,sku:[...skus][0]}));
  const row = { application_id:a.id, rank:a.popular.rank, group:a.popular.label, make:a.make, model:a.model,
    series:a.series, body:a.body, drive:a.drive, engine:a.engine, variant:a.variant,
    years:ys, year_label:ranges(ys), application_years:ys.length,
    published_positions:positions.join('/'), published_skus:[...new Set(a.live.map(f=>pv.get(f.product_variant_id)?.sku))].join(' / '),
    candidate_skus:[...new Set(candidates.map(r=>r.candidate_sku))].join(' / '),
    candidate_db:[...new Set(candidates.map(r=>r.bendix_reference))].join(' / '),
    source_model_rows:source.length, same_chassis_donors:donors.length,
    proposed:proposed.map(p=>`${p.position}:${p.sku}/${catalogBySku.get(p.sku)?.supplierRef ?? ''}`).join(' | '),
    donor_application_ids:donors.map(p=>p.id).join(' / ')
  };
  if (!a.live.length) {
    const identity=(confirmation.identityReview??[]).find(r=>r.application_id===a.id);
    if(identity){row.reason='车型身份/底盘归属需核实';row.action=identity.reason+'；建议核实车型：'+identity.suggested_family;}
    else if (candidates.length) { row.reason='同位置多个DB待区分卡钳'; row.action='核实卡钳/OEM/制动盘或轮毂尺寸，确认唯一DB或适用条件'; }
    else if (proposed.length) { row.reason='同底盘已有适配可评估复用'; row.action='核实供体来源和卡钳配置，同一底盘+位置唯一后复用'; }
    else if (!source.length) { row.reason='本批源表无对应车型名称'; row.action='先查市场别名和平台映射，再搜索厂家/Bendix目录或补上架SKU'; }
    else { row.reason='源表有车型但底盘代际尚未对齐'; row.action='核实底盘别名、代际和年份边界，避免仅按车型年份套用'; }
    gaps.push(row);
    if (proposed.length) expansions.push(row);
  } else if (!positions.includes('front') || !positions.includes('rear')) {
    partial.push({...row, reason:'已计覆盖但前后位置未齐', action:'缺失后轮需先确认是否鼓刹；前后均有片时再补另一位置'});
  }
}
const modelYears=[], summary=[];
for (const def of REQUESTED_POPULAR_VEHICLE_GROUPS) {
  const rows=popular.filter(a=>a.popular.id===def.id);
  const yearList=[...new Set(rows.flatMap(a=>a.years.filter(y=>y>=2000&&y<=2026)))].sort((a,b)=>a-b);
  const gs=gaps.filter(g=>g.rank===def.rank);
  let total=0,covered=0;
  for (const year of yearList) {
    const yr=rows.filter(a=>a.years.includes(year)), cov=yr.filter(a=>a.live.length);
    total+=yr.length; covered+=cov.length;
    if (cov.length<yr.length) modelYears.push({rank:def.rank,group:def.label,year,total:yr.length,covered:cov.length,
      missing:yr.length-cov.length,coverage:cov.length/yr.length,
      state:cov.length?'部分底盘/版本缺口':'该车型年份全空',
      missing_series:[...new Set(yr.filter(a=>!a.live.length).map(a=>a.series||'(未记录底盘)'))].join(' / '),
      reasons:[...new Set(gs.filter(g=>g.years.includes(year)).map(g=>g.reason))].join('；')});
  }
  summary.push({rank:def.rank,group:def.label,total,covered,missing:total-covered,coverage:total?covered/total:null,
    applications:rows.length,covered_applications:rows.filter(a=>a.live.length).length,missing_applications:gs.length,
    missing_years:ranges([...new Set(gs.flatMap(g=>g.years))]),
    completely_empty_years:ranges(modelYears.filter(r=>r.rank===def.rank&&r.covered===0).map(r=>r.year)),
    reasons:[...new Set(gs.map(g=>g.reason))].join('；')});
}
const reasonSummary=[...group(gaps,r=>r.reason)].map(([reason,rows])=>({reason,applications:rows.length,application_years:rows.reduce((n,r)=>n+r.application_years,0)}));
const total=summary.reduce((n,r)=>n+r.total,0), covered=summary.reduce((n,r)=>n+r.covered,0);
if (gaps.reduce((n,r)=>n+r.application_years,0)!==total-covered) throw new Error('Gap reconciliation failed');
const report={generated_at:new Date().toISOString(),scope:'热门50车型 2000–2026',
  definition:'application至少有一个已发布前或后刹车片即计覆盖；该指标不代表前后均齐全。后轮可能鼓刹，不能一律视为缺片。',
  total,covered,missing:total-covered,coverage:covered/total,applications:popular.length,
  missing_applications:gaps.length, partially_positioned_applications:partial.length,
  gap_model_years:modelYears.length, reasons:reasonSummary,
  same_chassis_potential:{applications:expansions.length,application_years:expansions.reduce((n,r)=>n+r.application_years,0),status:'仅评估，尚未发布'},
  summary,modelYears,gaps,partial,expansions};
refineReasons(report, confirmation.sourceRows);
fs.writeFileSync(path.join(out,'popular-gap-analysis.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,summary:undefined,modelYears:undefined,gaps:undefined,partial:undefined,expansions:undefined,
  biggest_gaps:[...summary].sort((a,b)=>b.missing-a.missing).slice(0,15)},null,2));

async function all(table,columns){const result=[];for(let from=0;;from+=1000){const {data,error}=await db.from(table).select(columns).range(from,from+999);if(error)throw error;result.push(...data);if(data.length<1000)return result;}}
function group(rows,key){const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r);}return m;}
function compact(v){return String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
function ranges(values){const a=[...new Set(values)].sort((a,b)=>a-b),out=[];for(let i=0;i<a.length;i++){const start=a[i];let end=start;while(a[i+1]===end+1)end=a[++i];out.push(start===end?String(start):`${start}–${end}`);}return out.join(', ');}

function refineReasons(report, sourceRows) {
  for (const gap of report.gaps) {
    const definition = REQUESTED_POPULAR_VEHICLE_GROUPS.find(r=>r.rank===gap.rank);
    const modelKey=confirmation.expansion?normalizedBrakeFamily:canonicalModelKey;
    const exactKey=modelKey(gap.make,gap.model);
    const exact=sourceRows.filter(r=>modelKey(r.makeName==='VW'?'VOLKSWAGEN':r.makeName,r.modelName)===exactKey);
    const aliases=sourceRows.filter(r=>definition.aliases.some(([make,model])=>modelKey(make,model)===modelKey(r.makeName==='VW'?'VOLKSWAGEN':r.makeName,r.modelName)));
    const applicable=exact.length?exact:aliases;
    gap.source_series=[...new Set(applicable.map(r=>r.seriesName))].join(' / ');
    gap.source_year_min=applicable.length?Math.min(...applicable.map(r=>r.yearFrom)):null;
    gap.source_year_max=applicable.length?Math.max(...applicable.map(r=>r.yearTo)):null;
    gap.source_years_not_listed=gap.years.filter(y=>!applicable.some(r=>y>=r.yearFrom&&y<=r.yearTo));
    if (gap.reason==='源表有车型但底盘代际尚未对齐') {
      if (!exact.length && aliases.length) {
        gap.reason='市场车型别名尚未映射';
        gap.action='把市场别名与源车型按底盘代际建立明确对应，再按位置复用';
      } else if (!gap.years.some(y=>applicable.some(r=>y>=r.yearFrom&&y<=r.yearTo))) {
        gap.reason='源表缺该代际或年份';
        gap.action='查新/旧代底盘与对应DB；源表年份之外需有同底盘证据，部分车型库年份也需核实';
      } else {
        gap.reason='源表有重叠年份但底盘代际尚未对齐';
        gap.action='核实底盘代码、平台和源车系的明确对应；同时检查application是否跨代';
      }
    }
  }
  const gapById=new Map(report.gaps.map(r=>[r.application_id,r]));
  report.expansions=report.expansions.map(r=>gapById.get(r.application_id));
  report.reasons=[...group(report.gaps,r=>r.reason)].map(([reason,rows])=>({reason,applications:rows.length,application_years:rows.reduce((n,r)=>n+r.application_years,0)}));
  for(const row of report.summary)row.reasons=[...new Set(report.gaps.filter(g=>g.rank===row.rank).map(g=>g.reason))].join('；');
  for(const row of report.modelYears)row.reasons=[...new Set(report.gaps.filter(g=>g.rank===row.rank&&g.years.includes(row.year)).map(g=>g.reason))].join('；');
  const withoutAmbiguity=report.expansions.filter(r=>r.reason!=='同位置多个DB待区分卡钳');
  report.same_chassis_potential.without_source_ambiguity_applications=withoutAmbiguity.length;
  report.same_chassis_potential.without_source_ambiguity_application_years=withoutAmbiguity.reduce((n,r)=>n+r.application_years,0);
  report.same_chassis_potential.also_in_caliper_review=report.expansions.length-withoutAmbiguity.length;
}
