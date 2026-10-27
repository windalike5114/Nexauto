import fs from 'node:fs';

// Reuse the central read-only calculation, with a separate immutable report location.
let source = fs.readFileSync(new URL('./report-product-knowledge-coverage.mjs', import.meta.url), 'utf8');
for (const module of ['@supabase/supabase-js', './wipertech-direct-matcher.mjs', './popular-vehicle-models.mjs']) {
  source = source.replace(`from "${module}"`, `from "${module.startsWith('.') ? new URL(module, import.meta.url).href : import.meta.resolve(module)}"`);
}
source = source.replace('"product-knowledge-coverage-20261025"', '"partner-coverage-20261025"');
source = source.replace('union(brakePadProduct, brakePadReferenceKnowledge)', 'union(brakePadProduct, brakePadDeterministicReferenceKnowledge)');
source = source.replace('Evidence-backed conditional one-of brake configurations are included but reported separately.', 'Unresolved conditional one-of brake configurations are excluded from knowledge coverage and reported separately.');
source = source.replace('fs.mkdirSync(OUTPUT_DIR, { recursive: true });', `
const detailedScopes = {};
for (const scopeName of ['core75', 'extended80']) {
  const groups = groupsForPopularScope(scopeName);
  const aliases = buildPopularAliasIndex(groups);
  const groupByApplication = new Map();
  for (const app of activeApplications) {
    const model = modelById.get(app.model_id);
    const make = makeById.get(model?.make_id);
    const variant = variantById.get(app.variant_id);
    const group = make && model ? aliases.get(canonicalModelKey(make.name, model.name)) : null;
    if (group && popularGroupMatchesApplication(group, {bodyStyle: variant?.body_style, variantName: variant?.display_name})) groupByApplication.set(app.application_id, group.id);
  }
  const rows = activeYears.filter(row => groupByApplication.has(row.application_id) && row.model_year >= 2000 && row.model_year <= 2026);
  const perGroup = groups.map(group => {
    const groupRows = rows.filter(row => groupByApplication.get(row.application_id) === group.id);
    const buckets = groupBy(groupRows, row => row.model_year);
    const coverage = {};
    for (const [line, sets] of Object.entries(lines)) {
      coverage[line] = {};
      for (const type of ['product', 'knowledge']) {
        const covered = sets[type];
        const any = [...buckets.values()].filter(values => values.some(row => covered.has(row.application_id))).length;
        const full = [...buckets.values()].filter(values => values.every(row => covered.has(row.application_id))).length;
        coverage[line][type] = {...metric(groupRows, new Set(groupRows.map(row => row.application_id)), covered), model_years_total:buckets.size, model_years_any:any, model_years_full:full};
      }
    }
    return {id:group.id, label:group.label, coverage};
  });
  const totals = {};
  for (const line of Object.keys(lines)) {
    totals[line] = {};
    for (const type of ['product', 'knowledge']) {
      const values = perGroup.map(group => group.coverage[line][type]);
      const sum = key => values.reduce((total, row) => total + row[key], 0);
      totals[line][type] = {
        model_groups_total:groups.length,
        model_groups_any:values.filter(row => row.application_years_covered > 0).length,
        model_groups_full:values.filter(row => row.application_years_total > 0 && row.application_years_covered === row.application_years_total).length,
        model_years_total:sum('model_years_total'),
        model_years_any:sum('model_years_any'),
        model_years_full:sum('model_years_full'),
        model_year_any_percent:percent(sum('model_years_any'), sum('model_years_total')),
        model_year_full_percent:percent(sum('model_years_full'), sum('model_years_total'))
      };
    }
  }
  detailedScopes[scopeName] = {totals, per_group:perGroup};
}
report.detailed_scopes = detailedScopes;
const fleet = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'outputs/nz-fleet-popular-expansion-20261025/report.json'), 'utf8'));
report.fleet_scope = {source_report_generated_at:fleet.generated_at, denominator:fleet.denominator, scope:'NZ registered light vehicles, vehicle years 2000-2026, local October MVR CSV snapshot; model-family reach, not verified individual-vehicle product fitment', core103:fleet.target_75, extended132:fleet.target_80};
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
`);
source = source.replace('console.log(JSON.stringify(report, null, 2));', 'console.log(JSON.stringify({generated_at:report.generated_at,catalog:report.catalog,core:report.popular_core_103_2000_2026,extended:report.popular_extended_132_2000_2026,model_metrics:Object.fromEntries(Object.entries(detailedScopes).map(([key,value])=>[key,value.totals])),fleet:report.fleet_scope},null,2));');
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
