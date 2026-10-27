#!/usr/bin/env python3
"""Classify the curated round-one identity rules offline; never import fitments.

Python standard library only. Source files are read-only; deterministic reports are
created in a separate directory. Existing identical reports are reusable, while
different existing content is refused. This does not execute the old planner.
"""
import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO / 'outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4'
DEFAULT_OUTPUT = REPO / 'outputs/brake-popular50-delegation-20261024/first-round'

# This is a reviewed semantic dispatch table, not a string-similarity classifier.
# A classification describes the proposed change, not evidence authenticity.
DISPATCH = {
    ('LQ-01', 'R1'): ('identity_note_source_missing',
        'GOLF车名未变；Golf V族说明应单存身份备注，不能替换1K5；题内没有可用的Golf V源目录。'),
    ('LQ-02', 'R1'): ('identity_note_source_missing',
        'L300/Delica III客车族说明未证明STARWAGON/DELICA为错车；P数字_W不可改写成合并标题，亦无WA目录桥。'),
    ('LQ-02', 'R2'): ('identity_note_source_missing',
        'L300 III Van为身份族说明；保留DELICA及各自P0_V/P1_V，不能借Space Gear目录。'),
    ('LQ-03', 'R1'): ('alias_or_variant_label',
        'FOCUS II Sedan是代际及车身细分，不是跨车型纠错；DB_, FCH, DH是目录集合标题，不能导入任一原series。'),
    ('LQ-03', 'R2'): ('true_model_correction',
        'DM2在普通FOCUS下，所引目录指向FOCUS C-MAX，属于不同车型身份的纠错候选；不转移制动适配。'),
    ('LQ-05', 'R1'): ('identity_bridge',
        'CX-5原车型不变；KF代码到S1的有限年份身份桥，不证明任何制动零件通用。'),
    ('LQ-05', 'R2'): ('identity_bridge',
        'CX-5原车型不变；短码前缀到KF目录族的有限年份桥，不能替换成完整OEM型号或扩大年份。'),
    ('LQ-06', 'R1'): ('identity_bridge',
        'CX-3原车型不变；DK短码前缀到S1的离散年份身份桥，不可补齐中间年份。'),
    ('LQ-07', 'R1'): ('identity_note_source_missing',
        'A4 B8 Saloon是8K2身份说明；原A4名称不属错车，题中8K5 Avant不能作为轿车源目录。'),
    ('LQ-07', 'R2'): ('alias_or_variant_label',
        'A4 Allroad是A4内版本细分；宜另存variant标签，不能因此把原A4应用或年份整体迁移。'),
    ('LQ-08', 'R1'): ('true_model_correction',
        'MAZDA 3名下DK2WS/DK4WS被来源指向CX-3，属于跨车型纠错候选；来源为拆车件目录，待OEM复核。'),
    ('LQ-08', 'R2'): ('true_model_correction',
        'MAZDA 3名下DK2W7/DK4W7/DK5AW被来源指向CX-3，属于跨车型纠错候选；不是CX-30。'),
    ('LQ-08', 'R3'): ('alias_or_variant_label',
        'Axela Hybrid是BYEFP的日本市场命名及动力版本细分，不应直接认作Mazda 3错车；保留BYEFP。'),
    ('LQ-09', 'R1'): ('identity_bridge',
        'SWIFT原车型不变；RS415/ZC21S到MZ/EZ目录的身份桥，悬挂目录不证明刹车通用。'),
    ('LQ-09', 'R2'): ('identity_bridge',
        'SWIFT原车型不变；ZA32S/ZC32S到FZ/NZ目录的身份桥，保留ZA32S拼写。'),
    ('LQ-10', 'R1'): ('true_model_correction',
        'BMW 3名下E83被厂家资料指向X3，属于跨车型纠错候选；本规则不覆盖2011。'),
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def load_json(path, manifest, root):
    raw = path.read_bytes()
    manifest[path.relative_to(root).as_posix()] = digest(raw)
    return json.loads(raw.decode('utf-8-sig'))


def write_report(path, content):
    data = content.encode('utf-8')
    if path.exists():
        if path.read_bytes() != data:
            raise FileExistsError(f'Refusing to replace different report: {path}')
        return
    with path.open('xb') as handle:
        handle.write(data)


def format_json(value):
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=DEFAULT_INPUT)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    root, output = args.input.resolve(), args.output.resolve()
    if output == root or root in output.parents:
        raise ValueError('Output must be outside the original input package')
    manifest = {}
    cases = load_json(root / 'local_data/cases.json', manifest, root)
    case_by_id = {c['review_id']: c for c in cases}
    if len(cases) != len(case_by_id):
        raise ValueError('Duplicate review_id in cases')
    corrections_path = root / 'runs/round1/catalog_corrections.jsonl'
    raw_corrections = corrections_path.read_bytes()
    manifest[corrections_path.relative_to(root).as_posix()] = digest(raw_corrections)
    original_rows = [json.loads(line) for line in raw_corrections.decode('utf-8-sig').splitlines() if line.strip()]
    original_by_rule = defaultdict(list)
    for line_number, row in enumerate(original_rows, 1):
        original_by_rule[(row['question_id'], row['rule_id'])].append((line_number, row))
    classified_rules, relations, unresolved_questions = [], [], []
    observed_rules = set()
    for n in range(1, 11):
        qid = f'LQ-{n:02d}'
        question_rel = f'AI_ONLY/questions/{qid}.json'
        answer_rel = f'results/{qid}.json'
        question = load_json(root / question_rel, manifest, root)
        answer = load_json(root / answer_rel, manifest, root)
        if answer['question_id'] != qid or question['question_id'] != qid:
            raise ValueError(f'{qid}: question ID mismatch')
        if answer['input_fingerprint'] != question['input_fingerprint']:
            raise ValueError(f'{qid}: input fingerprint mismatch')
        targets = {t['code_id']: t for t in question['targets']}
        evidence = {e['evidence_id']: e for e in answer['evidence']}
        options = {o['option_id']: o for o in question['source_options']}
        coverage = defaultdict(set)
        for rule in answer['rules']:
            key = qid, rule['rule_id']
            if key in observed_rules or key not in DISPATCH:
                raise ValueError(f'Unexpected/duplicate rule requiring semantic review: {key}')
            observed_rules.add(key)
            category, reason = DISPATCH[key]
            selected = [targets[cid] for cid in rule['code_ids']]
            cited = [evidence[eid] for eid in rule['evidence_ids']]
            if not cited or not rule['years']:
                raise ValueError(f'{key}: missing evidence reference or years')
            if (rule['kind'] == 'identity_bridge') != (category == 'identity_bridge'):
                raise ValueError(f'{key}: rule kind differs from reviewed dispatch')
            if category == 'identity_bridge' and rule['source_option_id'] not in options:
                raise ValueError(f'{key}: missing identity source option')
            matched = []
            for case in cases:
                possible = [t for t in selected if t['make'] == case['make'] and
                            t['series'] == case['series'] and case['model'] in t['models'] and
                            case['model'] in rule['models']]
                if not possible:
                    continue
                if len(possible) != 1:
                    raise ValueError(f'{key}: ambiguous original-code match')
                target = possible[0]
                years = sorted(set(case['years']) & set(rule['years']) & set(target['years']))
                if years:
                    matched.append((case, target, years))
            expected = original_by_rule.get(key, [])
            expected_index = {r['review_id']: (line, r) for line, r in expected}
            if len(expected_index) != len(expected):
                raise ValueError(f'{key}: duplicate original correction relation')
            if category != 'identity_bridge':
                if {c['review_id'] for c, _, _ in matched} != set(expected_index):
                    raise ValueError(f'{key}: exact original identity matching differs from correction rows')
            elif expected:
                raise ValueError(f'{key}: identity bridge unexpectedly generated correction rows')
            refs = []
            for case, target, years in matched:
                rid = case['review_id']
                original = {k: case[k] for k in ('make', 'model', 'series')}
                if rid in expected_index:
                    line, old = expected_index[rid]
                    if (old['application_id'] != case['application_id'] or old['current_vehicle'] != original or
                            old['years'] != years or old['proposed_changes'] != rule['correction']):
                        raise ValueError(f'{key}/{rid}: correction snapshot mismatch')
                    original_ref = {'line': line, 'row_canonical_sha256': digest(canonical(old))}
                else:
                    original_ref = None
                suggestion = dict(original)
                label = None
                action = 'retain_identity_add_note_only'
                if category == 'true_model_correction':
                    suggestion.update({k: v for k, v in rule['correction'].items() if v is not None and k != 'series'})
                    action = 'model_correction_candidate_on_scoped_years_only'
                elif category == 'alias_or_variant_label':
                    label = rule['correction'].get('model') or rule['correction'].get('series')
                    action = 'retain_identity_store_alias_or_variant_separately'
                elif category == 'identity_bridge':
                    action = 'retain_identity_record_scoped_identity_bridge_only'
                else:
                    label = rule['correction'].get('series')
                relation = {
                    'question_id': qid, 'rule_id': rule['rule_id'], 'category': category,
                    'code_id': target['code_id'], 'application_id': case['application_id'],
                    'review_id': rid, 'position': case['position'], 'original_vehicle': original,
                    'original_application_years': case['years'], 'scoped_years': years,
                    'uncovered_application_years': sorted(set(case['years']) - set(years)),
                    'normalization_suggestion': suggestion, 'identity_or_variant_label': label,
                    'suggestion_action': action, 'original_correction_reference': original_ref,
                    'source_option_id': rule['source_option_id'],
                    'evidence_urls': [e['url'] for e in cited],
                    'application_id_preserved': True, 'original_series_preserved': True,
                    'fitment_inference_allowed': False, 'import_ready': False,
                }
                relations.append(relation)
                refs.append(rid)
                coverage[(target['code_id'], case['model'])].update(years)
            classified_rules.append({
                'question_id': qid, 'rule_id': rule['rule_id'], 'category': category,
                'classification_reason': reason, 'original_rule': rule,
                'original_rule_canonical_sha256': digest(canonical(rule)),
                'original_input_hashes': {'question_file_sha256': manifest[question_rel],
                    'result_file_sha256': manifest[answer_rel],
                    'question_declared_input_fingerprint': question['input_fingerprint'],
                    'result_declared_input_fingerprint': answer['input_fingerprint']},
                'original_targets': selected,
                'influence': {'relations': len(matched),
                    'applications': len({c['application_id'] for c, _, _ in matched}),
                    'original_catalog_correction_relations': len(expected),
                    'review_ids': sorted(refs),
                    'application_ids': sorted({c['application_id'] for c, _, _ in matched})},
                'normalization_policy': 'Keep application_id and each original series; see per-relation suggestions. No automatic writes or fitment changes.',
                'evidence_as_reported': cited, 'evidence_truth_verified': False,
                'source_option_as_unverified_hint': options.get(rule['source_option_id']),
                'pending_confirmation': answer['open_questions'] + [
                    '来源URL、页面正文及主张本次未联网复核；结构验证通过不等于证据真实性验证。',
                    '精确市场、车身、生产月/登记年及范围边界仍需核实；不能把部分年份建议整体覆盖application。',
                    '车型身份不构成刹车DB/SKU、轴位、卡钳或整车型适配证据；适配须另行审查。'],
                'import_ready': False,
            })
        unresolved_questions.append({'question_id': qid, 'reported_open_questions': answer['open_questions'],
            'uncovered_target_model_years': [
                {'code_id': t['code_id'], 'make': t['make'], 'model': model, 'series': t['series'],
                 'years': sorted(set(t['years']) - coverage[(t['code_id'], model)])}
                for t in question['targets'] for model in t['models']
                if set(t['years']) - coverage[(t['code_id'], model)]]})
    if observed_rules != set(DISPATCH) or set(original_by_rule) - observed_rules:
        raise ValueError('Rule inventory differs from the curated round-one inventory')
    category_summary = {}
    for category in sorted({v[0] for v in DISPATCH.values()}):
        rows = [r for r in relations if r['category'] == category]
        category_summary[category] = {
            'rules': sum(r['category'] == category for r in classified_rules),
            'relations': len(rows), 'applications': len({r['application_id'] for r in rows}),
            'original_catalog_correction_relations': sum(r['original_correction_reference'] is not None for r in rows),
        }
    summary = {
        'mode': 'pure_offline_semantic_triage_no_database_no_network',
        'original_correction_relations': len(original_rows),
        'original_correction_applications': len({r['application_id'] for r in original_rows}),
        'rules': len(classified_rules), 'categories': category_summary,
        'all_classified_relations': len(relations),
        'all_classified_applications': len({r['application_id'] for r in relations}),
        'focus_combined_series_blocked_relations': sum(r['question_id'] == 'LQ-03' and r['rule_id'] == 'R1' for r in relations),
        'structural_checks_passed': ['question/result IDs and declared fingerprints agree',
            'all 16 rule IDs match curated dispatch', 'all referenced targets/evidence/source options exist',
            'all 263 correction rows match original cases, exact code, model, years and proposed fields',
            'all application IDs and original series preserved in every normalization suggestion'],
        'evidence_truth_verified': False, 'schema_validation_claim': 'Targeted structural checks only; not a full original JSON-schema validator.',
        'database_changed': False, 'source_files_changed': False, 'fitments_changed': False,
        'import_ready': False, 'input_sha256': manifest,
    }
    # Fail before writing if preservation invariants are violated.
    if any(r['normalization_suggestion']['series'] != r['original_vehicle']['series'] for r in relations):
        raise ValueError('Original series preservation invariant failed')
    # An identity correction and its date evidence are separate dimensions. Keep
    # the full original application year set, including an unresolved boundary
    # such as E83/2011, rather than assigning another model to that same chassis.
    true_by_application = defaultdict(list)
    for relation in relations:
        if relation['category'] == 'true_model_correction':
            true_by_application[relation['application_id']].append(relation)
    model_proposals = []
    preservation_fields = ('make', 'model', 'series', 'years', 'engine', 'body', 'drive',
                           'variant', 'displacement_cc')
    rule_index = {(r['question_id'], r['rule_id']): r for r in classified_rules}
    for app_id, app_relations in sorted(true_by_application.items()):
        original_cases = [case_by_id[r['review_id']] for r in app_relations]
        original_vehicle = {k: original_cases[0][k] for k in preservation_fields}
        if any({k: c[k] for k in preservation_fields} != original_vehicle for c in original_cases):
            raise ValueError(f'{app_id}: application identity differs between original case relations')
        proposed_models = {r['normalization_suggestion']['model'] for r in app_relations}
        if len(proposed_models) != 1:
            raise ValueError(f'{app_id}: conflicting normalized model candidates')
        preferred_model = next(iter(proposed_models))
        proposed_vehicle = {**original_vehicle, 'model': preferred_model}
        supported_years = sorted({y for r in app_relations for y in r['scoped_years']})
        boundary_years = sorted(set(original_vehicle['years']) - set(supported_years))
        refs = sorted({(r['question_id'], r['rule_id']) for r in app_relations})
        focus_naming_pending = preferred_model == 'FOCUS C-MAX'
        model_proposals.append({
            'proposal_id': f'round1-model-{app_id}', 'application_id': app_id,
            'review_ids': sorted(r['review_id'] for r in app_relations),
            'rule_references': [{'question_id': qid, 'rule_id': rid,
                'original_rule_canonical_sha256': rule_index[(qid, rid)]['original_rule_canonical_sha256']}
                for qid, rid in refs],
            'category': 'true_model_correction', 'original_vehicle': original_vehicle,
            'proposed_vehicle': proposed_vehicle,
            'normalized_model_selection': {
                'preferred_candidate': preferred_model,
                'alternative_catalogue_labels': ['C-MAX'] if focus_naming_pending else [],
                'status': 'catalogue_naming_convention_pending' if focus_naming_pending else 'offline_identity_candidate',
                'note': 'DM2可选FOCUS C-MAX或C-MAX，须核对目录命名规范；本次未查现网。' if focus_naming_pending else
                    '候选车型归属来自原规则；本次未重新核实来源或现网规范。'},
            'original_years_preserved': original_vehicle['years'],
            'rule_evidence_supported_years': supported_years,
            'boundary_years_pending_confirmation': boundary_years,
            'boundary_status': 'pending' if boundary_years else 'no_extra_application_years_but_dates_not_reverified',
            'year_policy': 'Preserve all original years. Evidence year limits do not assign a different model to the same chassis. Confirm production/model/registration-year boundaries separately.',
            'boundary_note': 'E83的2011待核登记年/车型年；不因年份边界把E83重新归到3系。' if original_vehicle['series'] == 'E83' else
                '规则证据年份单列；不裁剪application原year集合，不自动扩大证据支持范围。',
            'evidence_as_reported': [e for qid, rid in refs for e in rule_index[(qid, rid)]['evidence_as_reported']],
            'evidence_urls': sorted({u for r in app_relations for u in r['evidence_urls']}),
            'source_relation_count': len(app_relations),
            'preserved_fields': ['application_id', 'series', 'years', 'engine', 'body', 'drive', 'variant', 'displacement_cc'],
            'fitment_action': 'none_do_not_move_recalculate_or_relink_any_fitment',
            'evidence_truth_verified': False, 'offline_proposal_only': True, 'import_ready': False,
        })
    notes = ['首轮16条规则离线语义清理（2026-10-24快照）',
             f'原纠错关系 {len(original_rows)}，涉及 {summary["original_correction_applications"]} 个application。']
    for category, counts in category_summary.items():
        notes.append(f'{category}: {counts["rules"]}规则 / {counts["relations"]}关系 / {counts["applications"]} application；其中原纠错关系{counts["original_catalog_correction_relations"]}。')
    notes += ['true_model_correction是候选语义类别，绝非已核实或可导入的批准状态。',
        'Focus三厢27条关系禁止将DB_, FCH, DH合并字符串写回series；所有建议保留各自原码。',
        '203条仅series说明归identity_note_source_missing，不当作车型名纠错；32条命名细分归alias_or_variant_label。',
        '跨车型候选：DM2→FOCUS C-MAX；MAZDA 3名下DK码→CX-3；BMW 3名下E83→X3。',
        'application_id不变；建议仅限scoped_years，不能覆盖原application的未覆盖年份。',
        '结构验证不等于证据真实性验证。本次不联网，不查数据库，不复核来源正文，不推断制动适配，不运行旧plan，不发布。',
        '桥关系按原车型/原series/规则年份精确匹配cases重新计数；并非新增刹车适配，也没有使用source.json。',
        '规范化对象保留原车型作为默认；别名/版本另列identity_or_variant_label，待市场及OEM资料确认后再决定目录命名。',
        '原输入文件字节SHA256见summary.json；逐规则原JSON规范化SHA256、问题/答案文件hash、证据URL和待确认点见rules.classified.json。',
        'relations.classified.json保留逐关系原值、application ID、原纠错行号/hash及标准化建议；未覆盖目标年份见questions.unresolved.json。',
        '脚本只用Python标准库；重复运行允许已有同内容报告，拒绝覆盖不同内容。']
    reports = {'summary.json': format_json(summary),
        'rules.classified.json': format_json(classified_rules),
        'relations.classified.json': format_json(relations),
        'questions.unresolved.json': format_json(unresolved_questions),
        'normalized_model_correction_proposals.json': format_json({
            'schema_version': 1, 'mode': 'offline_proposals_only_no_fitment_changes',
            'application_count': len(model_proposals), 'source_rule_count': 4,
            'source_correction_relation_count': sum(len(rs) for rs in true_by_application.values()),
            'excluded_categories': ['identity_note_source_missing', 'alias_or_variant_label', 'identity_bridge'],
            'evidence_truth_verified': False, 'import_ready': False, 'proposals': model_proposals}),
        'README.txt': '\n'.join(notes) + '\n'}
    output.mkdir(parents=True, exist_ok=True)
    # Preflight the entire output set to prevent partial overwrites.
    for filename, content in reports.items():
        path = output / filename
        if path.exists() and path.read_bytes() != content.encode('utf-8'):
            raise FileExistsError(f'Refusing to replace different report: {path}')
    for filename, content in reports.items():
        write_report(output / filename, content)
    print(format_json({k: summary[k] for k in ('rules', 'original_correction_relations',
        'original_correction_applications', 'categories', 'all_classified_relations',
        'all_classified_applications', 'evidence_truth_verified', 'database_changed')}))


if __name__ == '__main__':
    main()
