import fs from 'node:fs';

let source=fs.readFileSync(new URL('./report-product-knowledge-coverage.mjs',import.meta.url),'utf8');
for(const module of ['@supabase/supabase-js','./wipertech-direct-matcher.mjs','./popular-vehicle-models.mjs']) source=source.replace(`from "${module}"`,`from "${module.startsWith('.')?new URL(module,import.meta.url).href:import.meta.resolve(module)}"`);
source=`import { loadNZFleetIndex, resolveFamily } from '${new URL('./nz-fleet-ay-scope-20261026.mjs',import.meta.url).href}';\nconst startedAt=new Date().toISOString();\nconst fleetPromise=loadNZFleetIndex();\n`+source;
source=source.replace('"product-knowledge-coverage-20261025"','"nz-light-ay-20261026"');
source=source.replace('union(brakePadProduct, brakePadReferenceKnowledge)','union(brakePadProduct, brakePadDeterministicReferenceKnowledge)');
source=source.replace('Evidence-backed conditional one-of brake configurations are included but reported separately.','Unresolved conditional brake configurations excluded.');
source=source.replace('fs.mkdirSync(OUTPUT_DIR, { recursive: true });',`
const fleet=await fleetPromise;
const fleetByKey=new Map(fleet.families.map(row=>[row.key,row]));
const appFamily=new Map();
for(const app of activeApplications){
  const model=modelById.get(app.model_id),make=makeById.get(model?.make_id),variant=variantById.get(app.variant_id);
  if(make&&model)appFamily.set(app.application_id,resolveFamily(make.name,model.name,variant?.body_style??variant?.display_name));
}
const bounded=activeYears.filter(row=>row.model_year>=2000&&row.model_year<=2026);
const scoped=bounded.filter(row=>fleetByKey.get(appFamily.get(row.application_id)?.key)?.years[row.model_year]>0);
const popular=scoped.filter(row=>appFamily.get(row.application_id).popular);
const remaining=scoped.filter(row=>!appFamily.get(row.application_id).popular);
function summary(rows){
 const ids=new Set(rows.map(row=>row.application_id));
 const buckets=groupBy(rows,row=>appFamily.get(row.application_id).key+'|'+row.model_year);
 const familyIds=new Set(rows.map(row=>appFamily.get(row.application_id).key));
 const result={applications:ids.size,ay:rows.length,ay_share_percent:percent(rows.length,scoped.length),families:familyIds.size,coverage:summarizeLines(rows,ids,lines)};
 for(const [line,sets] of Object.entries(lines))for(const type of ['product','knowledge']){
  const covered=sets[type];
  const any=[...buckets.values()].filter(values=>values.some(row=>covered.has(row.application_id))).length;
  const full=[...buckets.values()].filter(values=>values.every(row=>covered.has(row.application_id))).length;
  Object.assign(result.coverage[line][type],{model_year_total:buckets.size,model_year_any:any,model_year_full:full,model_year_any_percent:percent(any,buckets.size),model_year_full_percent:percent(full,buckets.size),model_families_any:new Set(rows.filter(row=>covered.has(row.application_id)).map(row=>appFamily.get(row.application_id).key)).size});
 }
 return result;
}
const summaries={all_nz_model_year_catalog:summary(scoped),popular132:summary(popular),remaining:summary(remaining)};
const catalogMY=new Set(scoped.map(row=>appFamily.get(row.application_id).key+'|'+row.model_year));
const fleetReconciliation={total:0,popular:0,remaining:0,with_catalog_model_year:0,without_catalog_model_year:0,popular_with_catalog_model_year:0,popular_without_catalog_model_year:0,remaining_with_catalog_model_year:0,remaining_without_catalog_model_year:0};
const unmatched=[];
for(const f of fleet.families){
 const section=f.popular?'popular':'remaining';fleetReconciliation.total+=f.count;fleetReconciliation[section]+=f.count;
 for(const [year,count] of Object.entries(f.years)){
  const has=catalogMY.has(f.key+'|'+year),kind=has?'with_catalog_model_year':'without_catalog_model_year';
  fleetReconciliation[kind]+=count;fleetReconciliation[section+'_'+kind]+=count;
  if(!has)unmatched.push({family:f.key,label:f.label,year:Number(year),fleet_count:count,popular:f.popular,raw_models:Object.keys(f.raw_models).join(';')});
 }
}
const perFamily=fleet.families.map(f=>{const rows=scoped.filter(row=>appFamily.get(row.application_id).key===f.key);return {key:f.key,label:f.label,popular:f.popular,fleet_count:f.count,...summary(rows)};});
report.nz_light_scope={started_at:startedAt,completed_at:new Date().toISOString(),policy:{years:[2000,2026],vehicle_classes:['MA','MB','MC','NA'],ay_definition:'Distinct active catalog application_id + model_year. Include only normalized NZ MVR light-fleet family+year combinations observed in the local October CSV snapshot. Partition with maintained Extended132 aliases and body filter.',limitation:'Model-year presence only: does not prove each catalog engine, chassis, drivetrain, body or weight variant is registered in NZ. Missing/unresolved fleet models have no known catalog AY count and are reported separately. This is a NZ-observed model-year catalog AY scope, not an exact census of NZ-registered configurations.',filter_denominator:'Common catalog AY denominator including EV and other potentially non-applicable configurations; not applicability-adjusted.',product_rules:'Published product relationships; complete active front-pair for wipers, at least one brake-pad axle. Deterministic published knowledge only, conditional unresolved references excluded.'},catalog_ay_reconciliation:{all_years_ay:activeYears.length,years_2000_2026_ay:bounded.length,outside_year_range_ay:activeYears.length-bounded.length,nz_observed_model_year_ay:scoped.length,no_nz_model_year_evidence_ay:bounded.length-scoped.length,popular132_ay:popular.length,remaining_ay:remaining.length},summaries,fleet_reconciliation:fleetReconciliation,per_family:perFamily,unmatched_fleet_model_years:unmatched.sort((a,b)=>b.fleet_count-a.fleet_count)};
if(popular.length+remaining.length!==scoped.length)throw Error('AY partition mismatch');
if(new Set(scoped.map(row=>row.application_id+'|'+row.model_year)).size!==scoped.length)throw Error('Duplicate AY');
if(fleetReconciliation.total!==fleet.total||fleetReconciliation.popular+fleetReconciliation.remaining!==fleet.total||fleetReconciliation.with_catalog_model_year+fleetReconciliation.without_catalog_model_year!==fleet.total)throw Error('Fleet reconciliation mismatch');
for(const line of Object.keys(lines))for(const type of ['product','knowledge'])if(summaries.popular132.coverage[line][type].application_years_covered+summaries.remaining.coverage[line][type].application_years_covered!==summaries.all_nz_model_year_catalog.coverage[line][type].application_years_covered)throw Error('Coverage sum mismatch');
fs.mkdirSync(OUTPUT_DIR,{recursive:true});
fs.writeFileSync(path.join(OUTPUT_DIR,'fleet-index.json'),JSON.stringify(fleet,null,2));
fs.writeFileSync(path.join(OUTPUT_DIR,'scope-membership.csv'),'application_id,model_year,family_key,section\\r\\n'+scoped.map(row=>[row.application_id,row.model_year,appFamily.get(row.application_id).key,appFamily.get(row.application_id).popular?'popular132':'remaining'].join(',')).join('\\r\\n'));
const csvRows=[];
for(const [section,scope] of Object.entries(summaries))for(const [line,values] of Object.entries(scope.coverage))for(const type of ['product','knowledge'])csvRows.push({section,line,type,...values[type]});
const headers=Object.keys(csvRows[0]);
fs.writeFileSync(path.join(OUTPUT_DIR,'nz-ay-coverage.csv'),'\\uFEFF'+headers.join(',')+'\\r\\n'+csvRows.map(row=>headers.map(key=>csvCell(row[key])).join(',')).join('\\r\\n'));
`);
source=source.replace('console.log(JSON.stringify(report, null, 2));','console.log(JSON.stringify({timestamp:report.nz_light_scope.completed_at,reconciliation:report.nz_light_scope.catalog_ay_reconciliation,summaries:report.nz_light_scope.summaries,fleet:report.nz_light_scope.fleet_reconciliation,top_unmatched:report.nz_light_scope.unmatched_fleet_model_years.slice(0,20)},null,2));');
source=source.replace('const { data, error } = await db.from(table).select(columns).range(from, from + 999);',`let query=db.from(table).select(columns);const fields=columns.split(',');const orderFields=['application_id','model_year','product_variant_id','part_reference_id','wiper_configuration_id','position'].filter(key=>fields.includes(key));if(!orderFields.length)orderFields.push(fields[0]);for(const key of orderFields)query=query.order(key,{ascending:true});const {data,error}=await query.range(from,from+999);`);
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
