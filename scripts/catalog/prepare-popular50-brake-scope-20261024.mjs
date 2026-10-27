// Offline only. Reads dated JSON snapshots; never reads env or creates a DB client.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { REQUESTED_POPULAR_VEHICLE_GROUPS as groups, buildPopularAliasIndex } from './popular-vehicle-models.mjs';
import { canonicalModelKey } from './wipertech-direct-matcher.mjs';

const output = path.resolve('outputs/brake-popular50-delegation-20261024/scope');
const snapshotPath = 'outputs/brake-pad-unique-first-audit-20261024/after-snapshot.json';
const oldReportPath = 'outputs/brake-pad-expansion-20261024/popular-gap-analysis.json';
const sourcePath = 'outputs/brake-pad-expansion-20261024/confirmation-data.json';
const v4Path = 'outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4/local_data/cases.json';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const snapshot = read(snapshotPath), old = read(oldReportPath), source = read(sourcePath), v4 = read(v4Path);
const catalogPath = 'data/brake-pads/catalog.json';
const catalog = read(catalogPath);
const by = (rows, key) => new Map(rows.map(r => [r[key], r]));
const collect = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const uniq = rows => [...new Set(rows)];
const compact = v => String(v ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sumYears = rows => rows.reduce((n, r) => n + r.years.length, 0);
const mk = by(snapshot.makes, 'make_id'), md = by(snapshot.models, 'model_id'), sr = by(snapshot.series, 'series_id');
const vr = by(snapshot.variants, 'variant_id'), pt = by(snapshot.engines, 'powertrain_id'), products = by(snapshot.products, 'id');
const alias = buildPopularAliasIndex(groups);
const sourceGroup = s => {
  const make = s.makeName==='VW'?'VOLKSWAGEN':s.makeName==='FORD AUSTRALIA'?'FORD':s.makeName;
  const names = [s.modelName,...(s.modelKeys ?? [])];
  if(make==='TOYOTA'&&compact(s.modelName)==='PRIUSC')names.push('AQUA');
  return names.map(model=>alias.get(canonicalModelKey(make,model))).find(Boolean);
};
const catalogBySku = by(catalog,'sku');
const lookupReference = fit => {
  const product = catalogBySku.get(sku(fit));
  return product ? {sku:product.sku,supplier_ref:product.supplierRef,
    source:catalogPath,kind:'sku_cross_reference_only_not_vehicle_fitment_evidence'} : null;
};
const years = collect(snapshot.years, r => r.application_id), allFits = collect(snapshot.fitments, r => r.application_id);
const oldRows = new Map([...old.gaps, ...old.partial].map(r => [r.application_id, r]));
const v4ByApp = collect(v4, r => r.application_id);
const engineCodes = by(snapshot.engineCodes ?? [], 'engine_code_id');
const engineLinks = collect(snapshot.powertrainEngineCodes ?? [], r => r.powertrain_id);
const sku = fit => products.get(fit.product_variant_id)?.sku ?? '';
const brake = fit => /^NBP\d+$/.test(sku(fit));
const published = fit => brake(fit) && fit.fitment_status === 'published' && ['front', 'rear'].includes(fit.position);
const serializeFit = f => ({ position: f.position, sku: sku(f), status: f.fitment_status, source: f.source,
  db: uniq(String(f.notes ?? '').match(/\bDB\d+[A-Z]*\b/g) ?? []),
  reference_lookup:lookupReference(f),
  source_rows: uniq([...String(f.notes ?? '').matchAll(/source_rows?=([\d,]+)/g)].flatMap(m => m[1].split(',').map(Number))) });
const activePopular = snapshot.applications.filter(a => a.status === 'active').map(a => {
  const model = md.get(a.model_id), make = mk.get(model?.make_id);
  return { a, model, make, group: alias.get(canonicalModelKey(make?.name ?? '', model?.name ?? '')) };
}).filter(a => a.group);
const rows = [], excluded = [];
for (const {a, model, make, group} of activePopular) {
  const allYears = uniq((years.get(a.application_id) ?? []).map(r => Number(r.model_year))).sort((a,b) => a-b);
  const scopedYears = allYears.filter(y => y >= 2000 && y <= 2026);
  if (!scopedYears.length) { excluded.push({ application_id: a.application_id, rank: group.rank, years: allYears,
    reason: allYears.length ? 'outside_2000_2026' : 'missing_linked_years' }); continue; }
  const variant = vr.get(a.variant_id), series = sr.get(a.series_id), engine = pt.get(a.powertrain_id);
  const fits = allFits.get(a.application_id) ?? [], live = fits.filter(published);
  const positions = uniq(live.map(f => f.position)).sort();
  const oldRow = oldRows.get(a.application_id);
  rows.push({ application_id: a.application_id, rank: group.rank, group: group.label,
    make: make?.name ?? '', model: model?.name ?? '', model_id: a.model_id,
    series: series?.code ?? '', series_display: series?.display_name ?? '', series_id: a.series_id,
    body: variant?.body_style ?? '', drive: variant?.drive_type ?? '', variant: variant?.display_name ?? '', variant_id: a.variant_id,
    engine: engine?.display_name ?? '', engine_raw: engine?.raw_name ?? '', powertrain_id: a.powertrain_id,
    engine_codes: uniq((engineLinks.get(a.powertrain_id) ?? []).map(l => engineCodes.get(l.engine_code_id)?.code).filter(Boolean)),
    years: scopedYears, application_years: scopedYears.length, catalog_year_from: a.year_from, catalog_year_to: a.year_to,
    coverage: live.length ? (positions.length === 2 ? 'front_and_rear' : 'one_position_published') : 'no_published_pad',
    published: live.map(serializeFit), review_candidates: fits.filter(f => brake(f) && !published(f)).map(serializeFit),
    v4_review_ids: (v4ByApp.get(a.application_id) ?? []).map(r => r.review_id),
    historical_source_clue: oldRow ? { report: oldReportPath, stale: true, reason: oldRow.reason,
      source_model_rows: oldRow.source_model_rows, source_series: oldRow.source_series,
      source_year_min: oldRow.source_year_min, source_year_max: oldRow.source_year_max,
      candidate_db: oldRow.candidate_db, candidate_skus: oldRow.candidate_skus } : null,
    canonical_key: a.canonical_key });
}
rows.sort((a,b) => a.rank - b.rank || a.series.localeCompare(b.series) || a.application_id.localeCompare(b.application_id));
if (new Set(rows.map(r => r.application_id)).size !== rows.length) throw new Error('Duplicate application IDs in snapshot');
const rowById = by(rows, 'application_id');
const donorGroups = collect(rows.filter(r => r.published.length && r.series), r => `${r.rank}|${compact(r.series)}`);
const donorIndex = [];
for (const r of rows) {
  const donors = (donorGroups.get(`${r.rank}|${compact(r.series)}`) ?? []).filter(d => d.application_id !== r.application_id);
  r.published_donor_hints = donors.map(d => ({ application_id: d.application_id,
    same_body: compact(d.body) === compact(r.body), same_variant: d.variant_id === r.variant_id,
    same_engine: d.powertrain_id === r.powertrain_id, shared_years: d.years.filter(y => r.years.includes(y)),
    published: d.published.map(f => ({position: f.position, sku: f.sku, db: f.db, reference_lookup:f.reference_lookup})) }));
  if (r.coverage !== 'front_and_rear' && donors.length) donorIndex.push({ application_id:r.application_id,
    rank:r.rank, donor_application_ids: donors.map(d=>d.application_id), policy:'lead_only_not_fitment_evidence' });
}
const gaps = rows.filter(r => r.coverage === 'no_published_pad');
const partial = rows.filter(r => r.coverage === 'one_position_published');
const covered = rows.filter(r => r.published.length);
const summaries = [], modelYears = [], reusableSource = [];
for (const g of groups) {
  const gr = rows.filter(r => r.rank === g.rank), gc = gr.filter(r => r.published.length), gg = gr.filter(r => !r.published.length);
  const linkedSource = source.sourceRows.filter(s => sourceGroup(s)?.id===g.id);
  const sourceRows = linkedSource.map(s => ({ source_row_id:s.sourceRowId, make:s.makeName, model:s.modelName,
    series:s.seriesName, series_tokens:s.seriesTokens, from:s.yearFrom, to:s.yearTo,
    year_to_status:s.yearTo===0?'unknown_zero_after_numeric_coercion':'explicit_normalized_numeric_end',
    body:s.bodyStyle, drive:s.driveType, displacement_cc:s.displacementCc, engine_codes:s.engineCodes,
    position:s.position, db:s.bendixReference }));
  reusableSource.push({rank:g.rank,group:g.label,aliases:g.aliases,source_file:sourcePath,source_rows:sourceRows,
    hint_policy:'Retrieval lookup only, including VW→VOLKSWAGEN, FORD AUSTRALIA→FORD and PRIUS C→AQUA source-name hints. These are not denominator alias changes or fitment rules. Verify identity, year, engine and caliper.'});
  for (let year=2000; year<=2026; year++) {
    const yr = gr.filter(r => r.years.includes(year)), yc = yr.filter(r => r.published.length);
    modelYears.push({ rank:g.rank,group:g.label,year,applications:yr.length,covered:yc.length,gaps:yr.length-yc.length,
      state:!yr.length?'no_catalog_application':!yc.length?'all_applications_uncovered':yc.length<yr.length?'some_applications_uncovered':'all_applications_have_one_position' });
  }
  summaries.push({rank:g.rank,group:g.label,aliases:g.aliases,applications:gr.length,application_years:sumYears(gr),
    covered_applications:gc.length,covered_application_years:sumYears(gc),gap_applications:gg.length,gap_application_years:sumYears(gg),
    application_year_coverage:sumYears(gr)?sumYears(gc)/sumYears(gr):null,
    partial_position_applications:gr.filter(r=>r.coverage==='one_position_published').length,
    gap_years:uniq(gg.flatMap(r=>r.years)).sort((a,b)=>a-b),
    no_catalog_years:modelYears.filter(r=>r.rank===g.rank&&!r.applications).map(r=>r.year),
    source_model_alias_rows:linkedSource.length,v4_review_applications:gr.filter(r=>r.v4_review_ids.length).length});
}
const canonicalDuplicates = [...collect(rows, r=>r.canonical_key).entries()].filter(([key,list])=>key&&list.length>1)
  .map(([canonical_key,list])=>({canonical_key,application_ids:list.map(r=>r.application_id)}));
const historicalCovered = old.covered_applications ?? old.applications-old.missing_applications;
const summary = {generated_at:new Date().toISOString(),scope:'Official requested popular 50 groups; 2000–2026; every active application, body and engine',
  snapshot:{path:snapshotPath,sha256:crypto.createHash('sha256').update(fs.readFileSync(snapshotPath)).digest('hex'),
    fetched_at:snapshot.fetched_at,verified_at:snapshot.verified_at,live:false,
    warning:'Offline historical snapshot; later first-round AI proposals or production changes are not applied here.',
    table_counts:Object.fromEntries(Object.entries(snapshot).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))},
  policy:{coverage:'at least one published front/rear fitment with SKU /^NBP\\d+$/',
    years:'linked model_year records only, unique per application; 2000–2026 inclusive',
    denominator:'all active applications, no body/engine/canonical-key deduplication',
    partial:'one published position; missing rear can mean drum brakes and is not asserted to need a pad',
    donor:'published same popular group and normalized chassis hints only; not proof and not publication authority',
    source:'existing local source rows and historical analysis are leads; revalidate original evidence'},
  totals:{groups:groups.length,applications:rows.length,application_years:sumYears(rows),covered_applications:covered.length,
    covered_application_years:sumYears(covered),gap_applications:gaps.length,gap_application_years:sumYears(gaps),
    coverage:sumYears(covered)/sumYears(rows),partial_position_applications:partial.length,partial_position_application_years:sumYears(partial),
    front_and_rear_applications:rows.length-gaps.length-partial.length,
    gap_model_years:modelYears.filter(r=>r.gaps).length,no_catalog_model_years:modelYears.filter(r=>!r.applications).length,
    gaps_with_published_donor_hints:gaps.filter(r=>r.published_donor_hints.length).length,
    gaps_with_v4_review_cases:gaps.filter(r=>r.v4_review_ids.length).length,gaps_outside_v4_review:gaps.filter(r=>!r.v4_review_ids.length).length,
    all_v4_review_cases:v4.length,all_v4_review_applications:new Set(v4.map(r=>r.application_id)).size,
    popular_applications_in_v4:rows.filter(r=>r.v4_review_ids.length).length,canonical_duplicate_groups:canonicalDuplicates.length,
    excluded_active_popular_applications:excluded.length,excluded_missing_years:excluded.filter(r=>r.reason==='missing_linked_years').length},
  previous_report:{path:oldReportPath,generated_at:old.generated_at,applications:old.applications,
    application_years:old.total,covered_application_years:old.covered,gap_application_years:old.missing,
    covered_applications:historicalCovered,gap_applications:old.missing_applications,
    covered_application_year_delta:sumYears(covered)-old.covered,
    explanation:'Same denominator; publication-state audit changed coverage. Earlier report reasons retained solely as dated clues.'},
  reference_lookup:{source:catalogPath,kind:'SKU cross-reference only; does not verify vehicle fitment or alter coverage',
    published_fitments:rows.flatMap(r=>r.published).length,
    published_fitments_with_lookup:rows.flatMap(r=>r.published).filter(f=>f.reference_lookup).length},
  reconciliation:{applications:covered.length+gaps.length===rows.length,application_years:sumYears(covered)+sumYears(gaps)===sumYears(rows),
    groups:summaries.reduce((n,r)=>n+r.application_years,0)===sumYears(rows),model_years:modelYears.reduce((n,r)=>n+r.applications,0)===sumYears(rows)}};
if (Object.values(summary.reconciliation).some(v=>!v)) throw new Error('Reconciliation failed');
fs.mkdirSync(output,{recursive:true});
const json = (name,value) => fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const jsonl = (name,value) => fs.writeFileSync(path.join(output,name),value.map(r=>JSON.stringify(r)).join('\n')+'\n');
json('summary.json',summary); json('groups.json',summaries); json('model-years.json',modelYears);
jsonl('all-applications.jsonl',rows); jsonl('gap-applications.jsonl',gaps); jsonl('partial-position-applications.jsonl',partial);
json('published-donor-index.json',donorIndex); json('source-reuse-index.json',reusableSource);
json('excluded-applications.json',excluded); json('canonical-duplicates-preserved.json',canonicalDuplicates);
const correctionPath = 'outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4/runs/round1/catalog_corrections.jsonl';
const corrections = fs.readFileSync(correctionPath,'utf8').trim().split(/\r?\n/).map(JSON.parse).filter(c =>
  (c.current_vehicle.make==='MAZDA' && c.proposed_changes.model==='CX-3') ||
  (c.current_vehicle.make==='BMW' && c.proposed_changes.model==='X3') ||
  (c.current_vehicle.make==='FORD' && c.current_vehicle.series==='DM2' && c.proposed_changes.model==='FOCUS C-MAX'));
const correctionByApp = collect(corrections,c=>c.application_id);
const projectedChanges = [];
for (const [application_id, evidence] of correctionByApp) {
  const r = rowById.get(application_id);
  if (!r) throw new Error(`Correction application outside baseline: ${application_id}`);
  const targetNames = r.make==='FORD' ? ['FOCUS C-MAX','C-MAX'] : [evidence[0].proposed_changes.model];
  const candidates = snapshot.models.filter(m => mk.get(m.make_id)?.name===r.make && targetNames.includes(m.name)).map(m => {
    const targetSeries = snapshot.series.filter(s=>s.model_id===m.model_id && compact(s.code)===compact(r.series));
    return {model_id:m.model_id,name:m.name,status:m.status,
      popular_rank:alias.get(canonicalModelKey(r.make,m.name))?.rank ?? null,
      existing_exact_series:targetSeries.map(s=>({series_id:s.series_id,code:s.code,status:s.status})),
      active_applications:snapshot.applications.filter(a=>a.model_id===m.model_id&&a.status==='active').length};
  });
  projectedChanges.push({application_id,make:r.make,current_model:r.model,current_model_id:r.model_id,
    current_rank:r.rank,current_series:r.series,current_series_id:r.series_id,
    years:r.years,application_years:r.years.length,coverage:r.coverage,published:r.published,
    target_model_candidates:candidates,projected_target_rank:candidates.length===1?candidates[0].popular_rank:null,
    decision:r.make==='FORD'?'FOCUS C-MAX versus C-MAX canonical naming requires choice':'target model exists; proposal only',
    evidence_review_ids:uniq(evidence.map(c=>c.review_id)),
    safety:'Keep application ID. Baseline is unchanged. Existing fitments stay associated but are not evidence for corrected identity; revalidate before publication.'});
}
const departing = projectedChanges.filter(r=>!r.projected_target_rank);
const departedIds = new Set(departing.map(r=>r.application_id));
const projectedRows = rows.filter(r=>!departedIds.has(r.application_id));
const projectedCovered = projectedRows.filter(r=>r.published.length);
const projection = {proposal_only:true,baseline_unchanged:true,source:correctionPath,
  explanation:'Projection covers only Mazda3 DK → CX-3, BMW3 E83 → X3 and Ford Focus DM2 → FOCUS C-MAX/C-MAX. No fitments are added or promoted.',
  affected_applications:projectedChanges.length,affected_application_years:sumYears(projectedChanges),
  transfers_within_popular50:projectedChanges.filter(r=>r.projected_target_rank).length,
  depart_popular50_applications:departing.length,depart_popular50_application_years:sumYears(departing),
  projected_popular50:{applications:projectedRows.length,application_years:sumYears(projectedRows),
    covered_applications:projectedCovered.length,covered_application_years:sumYears(projectedCovered),
    gap_applications:projectedRows.length-projectedCovered.length,gap_application_years:sumYears(projectedRows)-sumYears(projectedCovered)},
  changes:projectedChanges};
json('identity-correction-projection.json',projection);
const auditPath = 'outputs/brake-pad-unique-first-audit-20261024/audit.json';
const audit = read(auditPath), zero = audit.sourceRows.filter(s=>s.yearTo===0), zeroIds = new Set(zero.map(s=>s.sourceRowId));
const intersectsZero = ids => (ids ?? []).some(id=>zeroIds.has(Number(id)));
const auditLinked = audit.rows.filter(r=>['source_rows','original_source_rows','platform_source_rows'].some(key=>intersectsZero(r[key])));
const auditUsedZero = audit.rows.filter(r=>intersectsZero(r.source_rows));
const auditPlatformZero = audit.rows.filter(r=>intersectsZero(r.platform_source_rows));
const popularZero = zero.filter(s=>sourceGroup(s));
const v4Linked = v4.filter(r=>intersectsZero(r.platform_source_ids));
const countRows = rs => ({rows:rs.length,applications:new Set(rs.map(r=>r.application_id)).size,
  popular_rows:rs.filter(r=>rowById.has(r.application_id)).length,
  popular_applications:new Set(rs.filter(r=>rowById.has(r.application_id)).map(r=>r.application_id)).size});
const boundaryAudit = {generated_at:new Date().toISOString(),offline_only:true,matching_executed:false,raw_xlsx_read:false,
  scope:'Normalized JSON lineage and source-code review only; no corrected-year replay or SQL',
  source:{audit_path:auditPath,source_sha256:audit.source_sha256,confirmation_path:sourcePath},
  conclusion:{year_to_zero:'Invalid/unknown end boundary after numeric normalization, never literal year 0.',
    mechanism:"readSourceWorkbook uses sheet_to_json({defval:'',raw:true}); normalizeSourceRow calls Number(row['年款止']); Number('') is 0.",
    raw_cell_proof:'Raw year-end cell content is absent from retained sourceRows. The code proves blanks can become 0, but JSON alone cannot prove each of 406 cells was blank rather than explicit numeric zero.',
    open_interval_proven:false,classification:'unknown_end_pending_source_semantics',
    cannot_assume:'Blank/zero is not proof of open-ended fitment, continuing production, or applicability through 2026. Active status is not a year-boundary proof.'},
  totals:{source_rows:audit.sourceRows.length,year_to_zero:zero.length,year_from_zero:audit.sourceRows.filter(s=>s.yearFrom===0).length,
    inverted_ranges:audit.sourceRows.filter(s=>s.yearTo<s.yearFrom).length,
    popular50_source_rows:popularZero.length,popular50_groups:new Set(popularZero.map(s=>sourceGroup(s).rank)).size,
    zero_rows_also_in_confirmation:source.sourceRows.filter(s=>s.yearTo===0&&zeroIds.has(s.sourceRowId)).length,
    audit_linked_any_source_field:countRows(auditLinked),audit_used_source_rows:countRows(auditUsedZero),audit_platform_source_rows:countRows(auditPlatformZero),
    v4_cases_with_zero_platform_source:countRows(v4Linked),
    note:'Counts are existing lineage references, not confirmed incorrect fitments or a recomputed matching benefit.'},
  per_popular_group:groups.map(g=>({rank:g.rank,group:g.label,zero_end_rows:popularZero.filter(s=>sourceGroup(s).rank===g.rank).length,
    source_row_ids:popularZero.filter(s=>sourceGroup(s).rank===g.rank).map(s=>s.sourceRowId)})).filter(g=>g.zero_end_rows),
  per_make:[...collect(zero,s=>s.makeName)].map(([make,rs])=>({make,rows:rs.length})),
  affected_logic:[
    {path:'scripts/catalog/import-bendix-topstar-fitments-20261024.mjs',lines:[379,404,283,290,300],
      effect:'defval blank is numerically coerced to 0. scoreMatch year overlap fails for positive years; exact series can still collect candidates via seriesExact || overlap, so zero does not exclude every import candidate.'},
    {path:'scripts/catalog/brake-pad-strict-policy.mjs',lines:[92,93,115,164,176,177,191,200],
      effect:'Conservative positive-year bounds never accept end=0; unique-first logic can retain platform candidates when year coverage is incomplete, then issue provisional warnings. Thus zero can cause lost year support, missed engine narrowing or provisional results; it is not proof every linked publication is invalid.'},
    {path:'scripts/catalog/prepare-brake-agent-v4-lowtoken-20261024.mjs',lines:[62,91],
      effect:'Array.from length yearTo-yearFrom+1 yields an empty year expansion for [positive,0]; compact local source retains [yearFrom,0].'},
    {path:'outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4/tools/low_token.py',lines:[62,66],
      effect:'assess_year requires source start <= target year <= end, so end=0 is excluded for all modern years.'},
    {path:'scripts/catalog/brake-agent-v3-work.py',lines:[100,101],
      effect:'range(year_from,year_to+1) is empty for positive start and zero end.'},
    {path:'scripts/catalog/analyze-popular-brake-pad-gaps-20261024.mjs',lines:[152,153,158],
      effect:'Historical source max, unsupported-year and missing-generation explanations can be distorted by 0 boundaries; retained reasons are clues only.'}
  ],
  safe_fix_recommendations:[
    'Preserve raw year_from/year_to cells and separate parsed values from statuses. Trim blank/null to null before Number; flag explicit 0 and end-before-start as invalid/unknown.',
    'Use a shared boundary evaluator returning supported, unsupported, or unknown; unknown must not silently become no-source or supported-through-2026.',
    'Document original supplier semantics or obtain explicit row/generation evidence before marking any end as open. A verified open interval may be bounded to the reporting horizon only with the provenance retained.',
    'After semantics are resolved, run a new report-only comparison against a fresh backed-up baseline. Compare candidates, conflicts, year splits and existing publications; do not promote, replace or extend fitments based on this audit.',
    'Preserve source row IDs and distinguish identity-only platform hints from full year/body/engine/caliper evidence. Current coverage totals remain unchanged.'
  ],
  zero_end_rows:zero.map(s=>({source_row_id:s.sourceRowId,make:s.makeName,model:s.modelName,series:s.seriesName,
    year_from:s.yearFrom,year_to_raw_normalized:s.yearTo,year_to_interpreted:null,year_to_status:'unknown_end_pending_source_semantics',
    position:s.position,db:s.bendixReference,popular_rank:sourceGroup(s)?.rank??null})),
  linked_audit_records:auditLinked.map(r=>({application_id:r.application_id,review_id:r.review_id,popular_rank:r.popular_rank,
    before:r.before_status,after:r.after_status,rule:r.rule,
    zero_used_source_rows:(r.source_rows??[]).filter(id=>zeroIds.has(id)),
    zero_original_source_rows:(r.original_source_rows??[]).filter(id=>zeroIds.has(id)),
    zero_platform_source_rows:(r.platform_source_rows??[]).filter(id=>zeroIds.has(id))}))};
json('source-year-boundary-audit.json',boundaryAudit);
fs.writeFileSync(path.join(output,'README.txt'),[
  '热门50车型 2000–2026 离线全范围分工底稿',
  `快照 ${summary.snapshot.verified_at}；不是现网实时，亦未把首轮AI建议视为已发布。`,
  `全部 ${rows.length} application / ${sumYears(rows)} application-year；覆盖 ${covered.length} / ${sumYears(covered)}；零覆盖缺口 ${gaps.length} / ${sumYears(gaps)}。`,
  'all-applications.jsonl：全部范围，不筛车身、发动机，不合并重复application。gap-applications.jsonl：至少一个位置都未发布的缺口。',
  'partial-position-applications.jsonl：已计覆盖但前/后仅有一位置；后鼓刹不是缺片，必须另查。',
  'groups.json：正式50组汇总；model-years.json：50×27年完整网格，no_catalog_application不能误当现实车辆不存在。',
  'published_donor_hints：同正式组与底盘的已发布供体线索，附同车身/同引擎标志；不是适配证据。',
  'source-reuse-index.json：本地源表按正式别名找到的候选行；没匹配不等于无源，旧报告的source_series也可继续查。',
  '5541是V4历史待审适配行数，既不是热门50范围，也不是缺口应用总量；看summary.json中的交集对账。',
  'identity-correction-projection.json：首轮20条application车型归属提案和目标车型ID备选，仅计算投影，不改基准分母。',
  'reference_lookup是现有SKU→supplierRef目录引用，不是车辆适配证据；db字段仅保留原notes提取值。',
  'source-year-boundary-audit.json：406条yearTo=0为未知结束边界，未证明开放区间，不能按公元0或自动延长至2026。',
  '所有原文件保持不变，本脚本不联网、不读.env、不发布。'
].join('\n')+'\n');
console.log(JSON.stringify({output,totals:summary.totals,previous_report:summary.previous_report,reconciliation:summary.reconciliation}));
