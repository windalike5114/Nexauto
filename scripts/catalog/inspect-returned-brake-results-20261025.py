"""Read-only reconciliation of returned AI evidence; never opens a database client."""
import collections
import hashlib
import json
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCE = pathlib.Path('C:/Users/Sanli/Desktop/NexAuto_刹车片DB_原始结果_results+collected.zip')
BASE = ROOT / 'outputs/brake-popular50-script-first-20261024/final/AI_DB_ONLY'
OUT = ROOT / 'outputs/brake-returned-results-inspection-20261025'


def read(p):
    return json.loads(pathlib.Path(p).read_text(encoding='utf-8-sig'))


def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def compact(v):
    return re.sub('[^A-Z0-9]', '', str(v or '').upper())


def schema_errors(value, schema, location=()):
    """Validate the subset of JSON Schema used by this task's supplied schema."""
    errors = []
    def fail(message):
        errors.append({'path': list(location), 'message': message})
    kinds = schema.get('type')
    if kinds:
        kinds = kinds if isinstance(kinds, list) else [kinds]
        matches = {'object': isinstance(value, dict), 'array': isinstance(value, list),
                   'string': isinstance(value, str), 'integer': type(value) is int,
                   'number': type(value) in [int, float], 'null': value is None,
                   'boolean': type(value) is bool}
        if not any(matches.get(k, False) for k in kinds):
            fail('Unexpected value type; expected ' + str(kinds))
            return errors
    if 'enum' in schema and value not in schema['enum']:
        fail('Value outside enum')
    if isinstance(value, dict):
        props = schema.get('properties', {})
        for key in schema.get('required', []):
            if key not in value:
                fail('Missing required property ' + key)
        if schema.get('additionalProperties') is False:
            for key in value.keys() - props.keys():
                fail('Unexpected property ' + key)
        for key in value.keys() & props.keys():
            errors.extend(schema_errors(value[key], props[key], location + (key,)))
    if isinstance(value, list):
        if len(value) < schema.get('minItems', 0):
            fail('Array too short')
        if schema.get('uniqueItems') and len(set(json.dumps(x, sort_keys=True) for x in value)) != len(value):
            fail('Duplicate array values')
        for i, item in enumerate(value):
            errors.extend(schema_errors(item, schema.get('items', {}), location + (i,)))
    if isinstance(value, str):
        if len(value) < schema.get('minLength', 0):
            fail('String too short')
        if schema.get('pattern') and not re.search(schema['pattern'], value):
            fail('String does not match required pattern')
    if type(value) in [int, float]:
        if value < schema.get('minimum', float('-inf')) or value > schema.get('maximum', float('inf')):
            fail('Number out of bounds')
    return errors


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SOURCE) as z:
        assert z.testzip() is None, 'Archive CRC failure'
        names = z.namelist()
        assert len(names) == len(set(names)), 'Duplicate archive paths'
        assert all(not pathlib.PurePosixPath(n.replace('\\', '/')).is_absolute()
                   and '..' not in pathlib.PurePosixPath(n.replace('\\', '/')).parts for n in names)
        raw = [(n, json.loads(z.read(n).decode('utf-8-sig'))) for n in names
               if n.startswith('results/') and n.endswith('.json')]
        collected = json.loads(z.read('collected/round-final/answers.json').decode('utf-8-sig'))
        collector_summary = json.loads(z.read('collected/round-final/summary.json').decode('utf-8-sig'))
    assert collected == [d for _, d in raw], 'Collected answers differ from raw results'
    schema = read(BASE / 'result.schema.json')
    snapshot = read(ROOT / 'outputs/brake-alias-group-review-20261025/after-snapshot.json')
    merges = {c['source_id']: c['target_id'] for c in read(ROOT / 'outputs/brake-alias-group-review-20261025/plan.json')['corrections']}
    apps = {a['application_id']: a for a in snapshot['applications']}
    series = {a['series_id']: a for a in snapshot['series']}
    models = {a['model_id']: a for a in snapshot['models']}
    makes = {a['make_id']: a for a in snapshot['makes']}
    variants = {a['variant_id']: a for a in snapshot['variants']}
    engines = {a['powertrain_id']: a for a in snapshot['engines']}
    years = collections.defaultdict(set)
    for y in snapshot['years']:
        years[y['application_id']].add(y['model_year'])
    catalog = read(ROOT / 'data/brake-pads/catalog.json')
    cat_by_sku = {p['sku']: p for p in catalog}
    products = {p['id']: p for p in snapshot['products']}
    by_db = collections.defaultdict(list)
    for p in snapshot['products']:
        c = cat_by_sku.get(p.get('sku'))
        if c and p.get('active') is not False:
            for pos in ['front', 'rear']:
                if pos in c['position'].lower():
                    by_db[(c['supplierRef'], pos)].append({'sku': p['sku'], 'product_variant_id': p['id']})
    fits = collections.defaultdict(list)
    for f in snapshot['fitments']:
        c = cat_by_sku.get(products.get(f['product_variant_id'], {}).get('sku'))
        if c:
            fits[(f['application_id'], f['position'])].append({**f, 'db': c['supplierRef']})
    audits_path = ROOT / 'outputs/brake-popular50-script-first-20261024/final/all-position-audit.jsonl'
    audits = {r['case_id']: r for r in map(json.loads, audits_path.read_text(encoding='utf-8-sig').splitlines()) if r}
    questions = {}
    targets = {}
    validation = []
    findings = []
    unresolved = []
    entries = collections.defaultdict(list)
    unresolved_years = collections.defaultdict(set)
    covered_configs = set()
    declared_scope = set()
    for filename, result in raw:
        qid = result['question_id']
        if qid not in questions:
            questions[qid] = read(BASE / 'questions' / (qid + '.json'))
            targets[qid] = read(BASE / 'local_targets' / (qid + '.json'))['targets']
        q = questions[qid]
        t_by_config = collections.defaultdict(list)
        for t in targets[qid]:
            t_by_config[t['config_id']].append(t)
        clean = {k: v for k, v in result.items() if k not in ['work_id', 'scope_config_ids']}
        errors = schema_errors(clean, schema)
        declared_scope.update((qid, c) for c in result.get('scope_config_ids', []))
        if any(c not in t_by_config for c in result.get('scope_config_ids', [])):
            errors.append({'message': 'Unknown config_id in scope'})
        ev = {e['evidence_id']: e for e in result['evidence']}
        if len(ev) != len(result['evidence']):
            errors.append({'message': 'Duplicate evidence IDs in one result'})
        for f in result['findings']:
            ferr = []
            if f['position'] != q['position']:
                ferr.append('position_mismatch')
            if any(i not in ev for i in f['evidence_ids']):
                ferr.append('missing_evidence_reference')
            for cid in f['config_ids']:
                if cid not in t_by_config:
                    ferr.append('unknown_config:' + cid)
                else:
                    allowed = set(y for t in t_by_config[cid] for y in t['years'])
                    if set(f['years']) - allowed:
                        ferr.append('years_outside_config:' + cid)
            record = {**f, 'question_id': qid, 'result_file': filename,
                      'make': q['make'], 'model': q['model'], 'evidence': [ev[i] for i in f['evidence_ids'] if i in ev],
                      'validation_errors': ferr,
                      'evidence_truth_verified': False}
            findings.append(record)
            for cid in f['config_ids']:
                covered_configs.add((qid, cid))
                for t in t_by_config.get(cid, []):
                    for y in set(t['years']) & set(f['years']):
                        entries[(t['application_id'], f['position'], y)].append(record)
            errors.extend({'message': m, 'finding_id': f['finding_id']} for m in ferr)
        for u in result['unresolved']:
            unresolved.append({**u, 'question_id': qid, 'result_file': filename})
            for t in t_by_config.get(u['config_id'], []):
                unresolved_years[(t['application_id'], q['position'])].update(set(t['years']) & set(u['years']))
        validation.append({'file': filename, 'question_id': qid, 'valid': not errors, 'errors': errors})
    # Keep all provenance. Identical spreadsheet rows can belong to different configs.
    candidate_cases = collections.defaultdict(dict)
    cross_conflicts = []
    for (aid, pos, year), ff in entries.items():
        dbs = sorted(set(f['db'] for f in ff if f['decision'] == 'db_confirmed'))
        if len(dbs) > 1:
            cross_conflicts.append({'application_id': aid, 'position': pos, 'year': year, 'dbs': dbs})
        candidate_cases[(aid, pos)][year] = ff
    case_results = []
    for (old_id, pos), yy in candidate_cases.items():
        aid = merges.get(old_id, old_id)
        a = apps[aid]
        dbs = sorted(set(f['db'] for ff in yy.values() for f in ff if f['decision'] == 'db_confirmed'))
        scope_years = sorted(y for y in years[aid] if 2000 <= y <= 2026)
        full_years = sorted(years[aid])
        found_years = sorted(yy)
        ff = list({(f['result_file'], f['finding_id']): f for fs in yy.values() for f in fs}.values())
        current = sorted(set(f['db'] for f in fits[(aid, pos)] if f['fitment_status'] == 'published'))
        db = dbs[0] if len(dbs) == 1 else None
        product = by_db.get((db, pos), [])
        gaps = sorted(set(full_years) - set(found_years))
        previous_flags = audits.get(old_id + '|' + pos, {}).get('identity_flags', [])
        if any(f['validation_errors'] for f in ff):
            stage = 'result_structure_or_scope_error'
        elif len(dbs) != 1:
            stage = 'multiple_db_or_year_split'
        elif a['status'] != 'active':
            stage = 'inactive_application'
        elif current and current != [db]:
            stage = 'published_db_conflict'
        elif current == [db]:
            stage = 'same_db_already_published'
        elif gaps:
            stage = 'partial_years_do_not_publish_whole_application'
        elif len(product) != 1:
            stage = 'db_to_product_mapping_not_unique_or_missing'
        elif previous_flags:
            stage = 'identity_flag_requires_result_condition_check'
        else:
            stage = 'full_year_unique_db_await_condition_and_evidence_check'
        m = models[a['model_id']]
        case_results.append({'original_application_id': old_id, 'application_id': aid,
                             'position': pos, 'stage': stage, 'make': makes[m['make_id']]['name'],
                             'model': m['name'], 'series': series.get(a.get('series_id'), {}).get('code'),
                             'body': variants.get(a.get('variant_id'), {}).get('body_style'),
                             'drive': variants.get(a.get('variant_id'), {}).get('drive_type'),
                             'engine': engines.get(a.get('powertrain_id'), {}).get('display_name'),
                             'all_years': full_years, 'scope_years': scope_years, 'finding_years': found_years,
                             'missing_full_application_years': gaps, 'candidate_db': dbs,
                             'current_published_db': current, 'product_candidates': product,
                             'prior_identity_flags': previous_flags,
                             'unresolved_overlap_years': sorted(set(found_years) & unresolved_years[(old_id, pos)]),
                             'findings': ff, 'safe_to_import': False})
    target_pairs = {(t['application_id'], questions[qid]['position']) for qid, tt in targets.items() for t in tt}
    covered_pairs = set(candidate_cases)
    remaining_targets = []
    for qid, tt in targets.items():
        for t in tt:
            pos = questions[qid]['position']
            found = set(y for aid, pp, y in entries if aid == t['application_id'] and pp == pos)
            missing = sorted(set(t['years']) - found)
            if missing:
                remaining_targets.append({**t, 'question_id': qid, 'position': pos, 'missing_finding_years': missing})
    stats = {
        'source': str(SOURCE), 'source_sha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
        'production_changed': False, 'snapshot_at': snapshot.get('verified_at'),
        'archive_raw_results': len(raw), 'returned_shared_questions': len(questions),
        'original_question_count': len(list((BASE / 'questions').glob('*.json'))),
        'result_statuses': dict(collections.Counter(d['status'] for _, d in raw)),
        'schema_and_scope_valid_files': sum(v['valid'] for v in validation),
        'schema_and_scope_invalid_files': sum(not v['valid'] for v in validation),
        'findings': len(findings), 'configurations_with_findings': len(covered_configs),
        'finding_config_years_recomputed': len(set((f['question_id'], c, y) for f in findings for c in f['config_ids'] for y in f['years'])),
        'declared_scope_configurations': len(declared_scope),
        'local_target_configurations': len(set((qid, t['config_id']) for qid, tt in targets.items() for t in tt)),
        'target_application_positions': len(target_pairs),
        'application_positions_with_findings': len(covered_pairs),
        'application_positions_without_findings': len(target_pairs - covered_pairs),
        'finding_application_position_years': len(entries),
        'cross_result_db_conflicts_application_position_years': len(cross_conflicts),
        'stages_application_positions': dict(collections.Counter(r['stage'] for r in case_results)),
        'missing_year_target_rows': len(remaining_targets),
        'collector_summary_supplied_by_other_ai': collector_summary,
        'limitations': ['Schema validation does not verify evidence truth or semantic applicability.',
                       'Every result condition remains attached; no OE, PR, date or hardware restriction was dropped.',
                       'Stage full_year_unique_db is a staging candidate, NOT an approved import.',
                       'Current-state comparison uses the verified saved snapshot, not a fresh production read.',
                       'No coverage uplift is claimed until condition checks and a fresh production diff.'],
    }
    save('summary.json', stats)
    save('validation.json', validation)
    save('normalized-findings.json', findings)
    save('application-candidates.json', case_results)
    candidates = [r for r in case_results if r['stage'] == 'full_year_unique_db_await_condition_and_evidence_check']
    save('priority-candidates-awaiting-condition-check.json', candidates)
    save('remaining-targets.json', remaining_targets)
    save('cross-result-conflicts.json', cross_conflicts)
    save('unresolved-original.json', unresolved)
    assert sum(stats['stages_application_positions'].values()) == len(case_results)
    assert len(covered_pairs) + len(target_pairs - covered_pairs) == len(target_pairs)
    assert all(not r['safe_to_import'] for r in case_results)
    assert all(len(r['candidate_db']) == 1 and len(r['product_candidates']) == 1
               and not r['missing_full_application_years'] and not r['current_published_db'] for r in candidates)
    report = '\n'.join([
        '刹车片AI原始结果核对（2026-10-25）',
        '',
        '本次仅离线核对，不修改生产数据库，也不修改原始压缩包。',
        '对照快照核验时间：' + str(stats['snapshot_at']),
        '',
        f"原始结果文件：{len(raw)}；对应共享问题：{len(questions)} / {stats['original_question_count']}。",
        f"结果文件状态：已解决6份、部分解决57份、未解决22份。这是分批文件状态，不是application数量。",
        f"结构及原任务配置/年份范围校验：{stats['schema_and_scope_valid_files']}通过，{stats['schema_and_scope_invalid_files']}失败。",
        '结构校验不代表来源真实性和适用条件已经核实。',
        '',
        '161条finding覆盖183组配置，对应184个application×前后位置。',
        '全年唯一DB、已有唯一商品、待核对条件：97个位置。',
        '仅部分年份有结论，不能发布整条application：63个位置。',
        'DB对应商品缺失或不唯一：19个位置。',
        '现有快照中相同DB已发布：3个位置。',
        '不同年份出现不同DB，需按年份划分：2个位置。',
        '同一application同一位置同一年，返回结果之间DB冲突：0。',
        '',
        '73个问题的原目标共587个application×位置，其中403个位置尚无DB结论。',
        '已有结论不等于全问题解决；保留所有未确定项和附带条件。',
        '原包汇总的1032个条件配置年，与本次按question+config+year重算的1051不同，未沿用其汇总数。',
        '',
        'priority-candidates-awaiting-condition-check.json：97个优先核对候选及其完整条件和证据。',
        'application-candidates.json：184个位置的完整分类、application ID、商品、年份及原始结论。',
        'remaining-targets.json：没有结论或只有部分年份结论的原目标，不应重复查已解决年份。',
        'validation.json：逐文件结构与原任务范围检查。',
        '',
        '所有safe_to_import均为false；尚未批准录入。',
        '下一步核对97个候选的具体条件，抽查证据，然后在正式录入前重新读取现网做差异检查。',
        '未计算或宣称覆盖率提升。',
    ])
    (OUT / '核对说明.txt').write_text(report, encoding='utf-8-sig')
    print(json.dumps(stats, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
