#!/usr/bin/env python3
"""Pure offline W3 intake triage. Never queries a service or changes scope data."""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TASK = ROOT / 'outputs/brake-popular50-delegation-20261024'
GROUP_NAMES = ['Ford Ranger', 'Holden Commodore', 'Hyundai Santa Fe', 'Volkswagen Golf',
    'Kia Sportage', 'Ford Falcon', 'Tesla Model Y', 'Kia Seltos', 'Hyundai Tucson',
    'BMW 3 Series', 'BMW X5', 'MG ZS', 'Tesla Model 3', 'Ford Focus',
    'Audi A4 / S4 Avant', 'BYD Atto 3']

QUESTIONS = {
 'Volkswagen Golf': ('identity', '用一份实际可读的厂家/OEM车型代码表核实BC1、BC2与Golf VII掀背，BX5、BX6与Golf VII Variant的对应关系及起止年月；保留原码，不从目录提示建立别名桥。'),
 'BMW 3 Series': ('identity', '用一份厂家车型/底盘代码总表核实3系名下F25、G01、G08、F97、G45、I01、NA5各自车型归属及生产区间；E83已知为X3，复用首轮事实，不重新查询E83。'),
 'Ford Focus': ('identity', '用一份厂家/OEM车型目录核实DBW、DFW、DNW各自Focus代际及车身身份和起止年月；不得借已知DB_/DH/FCH三厢身份作替代，也不研究刹车规格。'),
 'Ford Ranger': ('identity', '核实2001–2002年T30VVEX 3L V6、AWD、Standard Cab Utility的Ranger市场及底盘身份；现有PJ/PK/PX/PY源表不能填补空series。'),
 'Holden Commodore': ('source_missing', '为ZB及跨2000年边界的VS取得按车身、发动机、前后轴位列出的制动源目录行；不能借VT–VF源或Insignia名称相似补齐。'),
 'Hyundai Santa Fe': ('source_missing', '补充TM/TMA/MX5代Santa Fe制动目录，明确市场、发动机、轴位与起止年月；现有SM/CM/DM源不跨代借用。'),
 'Kia Sportage': ('source_missing', '补充NQ5及NB/K00的Sportage制动目录，先明确市场/代际及对应年段；现有JE/KM、SL、QL源不代用。'),
 'Ford Falcon': ('source_missing', '补充AU/AUII/AUIII/BF各车身与发动机的Falcon制动目录，保留四种原始series；FORD AUSTRALIA仅是源检索提示。'),
 'Tesla Model Y': ('source_missing', '取得Model Y 2021–2026范围内按驱动、动力版本、轴位及生产日期区分的厂家/制动件厂家目录；先建来源，不凭整车名称推断。'),
 'Kia Seltos': ('year_boundary', '暂无本轮gap查询；后续若审部分轴位或2026延伸，先确认SP2/SP2I源中to=0的实际有效截止年月。'),
 'Hyundai Tucson': ('source_missing', '补充NX4A/NX4E的Tucson制动目录，区分市场、动力版本和日期；不能用JM或TL/TLE替代。'),
 'BMW X5': ('multi_candidate', '对现有E70、F15/F85源行做本地year/body/engine/drive/position交叉核对，给出导致10个gap的首个共享分歧；无确证单一候选前不查卡钳、不生成适配。'),
 'MG ZS': ('source_missing', '先取得涵盖AZS1/ZS32/ZS11/CSA7001及空码记录的MG ZS车型与制动目录，明确燃油/电动身份和适用日期，不能按ZS名称合并。'),
 'Tesla Model 3': ('source_missing', '取得Model 3按驱动、动力版本、前后轴位及改款生产日期分列的厂家/制动件厂家目录；空series保留，不能沿用Model Y。'),
 'Audi A4 / S4 Avant': ('source_missing', '复用8K2为B8 Saloon、8KH为Allroad的首轮事实，补实际8K2/8KH及B9 8W族制动源目录；保留原车身，不借8K5 Avant整族转移。'),
 'BYD Atto 3': ('source_missing', '取得Atto 3本地市场版本按前后轴位及生产日期列出的制动目录，并核对空series车型身份；当前索引无源。'),
}
PRIORITIES = ['Volkswagen Golf', 'BMW 3 Series', 'Ford Focus']
REUSE = {'Volkswagen Golf': ['LQ-01'], 'Ford Focus': ['LQ-03'],
         'Audi A4 / S4 Avant': ['LQ-07'], 'BMW 3 Series': ['LQ-10']}


def main():
    hashes = {}
    def read(relative, jsonl=False):
        raw = (TASK / relative).read_bytes()
        hashes[relative] = hashlib.sha256(raw).hexdigest()
        text = raw.decode('utf-8-sig')
        return [json.loads(line) for line in text.splitlines() if line.strip()] if jsonl else json.loads(text)
    groups = read('scope/groups.json')
    gaps = read('scope/gap-applications.jsonl', True)
    source = read('scope/source-reuse-index.json')
    rules = read('first-round/rules.classified.json')
    model_proposals = read('first-round/normalized_model_correction_proposals.json')['proposals']
    groups = [g for g in groups if g['group'] in GROUP_NAMES]
    if len(groups) != 16 or len({g['group'] for g in groups}) != 16:
        raise ValueError('Expected exactly the 16 W3 groups')
    source_index = {s['group']: s for s in source}
    triaged = []
    for group in groups:
        name = group['group']
        apps = [a for a in gaps if a['group'] == name]
        if len(apps) != group['gap_applications']:
            raise ValueError(f'{name}: gap count differs from immutable scope')
        src = source_index[name]['source_rows']
        app_ids = {a['application_id'] for a in apps}
        reuse = []
        for rule in rules:
            if rule['question_id'] not in REUSE.get(name, []):
                continue
            target_codes = {t['series'] for t in rule['original_targets']}
            exact_ids = app_ids & set(rule['influence']['application_ids'])
            same_code = [a for a in apps if a['series'] in target_codes]
            reuse.append({'question_id': rule['question_id'], 'rule_id': rule['rule_id'],
                'category': rule['category'], 'existing_claim_as_reported': rule['original_rule']['claim'],
                'original_rule_hash': rule['original_rule_canonical_sha256'],
                'existing_evidence_urls': [e['url'] for e in rule['evidence_as_reported']],
                'exact_round1_application_ids_in_current_gaps': sorted(exact_ids),
                'same_chassis_gap_application_ids': sorted(a['application_id'] for a in same_code),
                'rule_supported_years_only': rule['original_rule']['years'],
                'reuse_policy': 'Reuse reported identity fact and unresolved boundaries. New same-code applications require original market/body/year checks; no new fitment bridge or date extension.',
                'evidence_truth_reverified': False})
        # These are retrieval indicators, not successful source compatibility.
        src_token_text = ' '.join(str(r.get('series_tokens', '')) for r in src).upper()
        chassis_counts = Counter(a['series'] for a in apps)
        blocker, question = QUESTIONS[name]
        triaged.append({
            'rank': group['rank'], 'group': name,
            'intake_status': 'initial_triage_complete_research_not_started',
            'research_queue_status': 'priority_query_proposed_not_executed' if name in PRIORITIES else
                ('queued_no_current_gap' if not apps else 'queued'),
            'gap_applications': len(apps), 'gap_application_years': group['gap_application_years'],
            'gap_applications_outside_old_v4': sum(not a['v4_review_ids'] for a in apps),
            'gap_applications_in_old_v4': sum(bool(a['v4_review_ids']) for a in apps),
            'all_scope_applications': group['applications'],
            'partial_position_applications_separate_from_gap': group['partial_position_applications'],
            'full_scope_policy': '2000–2026, all body/engine variants; full scope remains assigned. This intake analyzes gap-applications only and does not mark partial-position or covered applications audited.',
            'source_exists_in_supplied_index': bool(src), 'source_model_rows': len(src),
            'source_file_as_reported': source_index[name].get('source_file'),
            'source_distinct_series': sorted({r['series'] for r in src}),
            'source_open_ended_to_zero_rows': sum(r['to'] == 0 for r in src),
            'source_status_caveat': 'Presence is model-level retrieval evidence only. No source row has been proven to fit a gap application by this intake.',
            'known_identity_facts_reusable': bool(reuse), 'existing_identity_reuse': reuse,
            'existing_model_correction_proposal_application_ids': sorted(p['application_id'] for p in model_proposals if p['application_id'] in app_ids),
            'main_blocker': blocker,
            'main_blocker_certainty': 'triage_hypothesis_not_diagnostic_proof' if blocker == 'multi_candidate' else 'offline_scope_indicator',
            'secondary_blockers': ['year_boundary'] if src else ['identity', 'year_boundary'],
            'next_minimum_shared_question': question,
            'next_action_mode': 'local_shared_discriminator_audit' if name == 'BMW X5' else 'research_not_started_low_token_staging',
            'gap_chassis_summary': [{'series': code, 'applications': count,
                'literal_token_mentioned_in_source_index': bool(code) and code.upper() in src_token_text,
                'token_match_is_identity_proof': False}
                for code, count in sorted(chassis_counts.items(), key=lambda pair: (-pair[1], pair[0]))],
            'gap_application_refs': [{k: a[k] for k in ('application_id', 'series', 'series_id', 'model',
                'body', 'drive', 'engine', 'years', 'v4_review_ids')} for a in apps],
            'research_complete': False, 'fitment_proposals_created': 0, 'database_action': 'none',
        })
    payload = {'schema_version': 1, 'agent_group': 'W3', 'mode': 'pure_offline_initial_intake',
        'scope_years': [2000, 2026], 'scope_body_engine': 'all',
        'assignment_file_status': 'awaiting_assignments/W3.json_at_intake',
        'summary': {'formal_groups': len(triaged),
            'gap_applications': sum(t['gap_applications'] for t in triaged),
            'outside_old_v4_gap_applications': sum(t['gap_applications_outside_old_v4'] for t in triaged),
            'groups_with_model_source_rows': sum(t['source_exists_in_supplied_index'] for t in triaged),
            'groups_without_model_source_rows': sum(not t['source_exists_in_supplied_index'] for t in triaged),
            'priority_shared_questions': len(PRIORITIES),
            'queued_groups': sum(t['group'] not in PRIORITIES for t in triaged)},
        'priority_shared_questions': [{'priority': i + 1, 'group': name,
            'question': QUESTIONS[name][1], 'status': 'proposed_not_queried'} for i, name in enumerate(PRIORITIES)],
        'groups': triaged, 'input_sha256': hashes,
        'limits': ['No network or database accessed; immutable scope inputs untouched.',
            'Source index presence and string tokens are retrieval hints, not identity or brake-fitment proof.',
            'Round-one identity facts reused without new browsing; original evidence reliability and date limits retained.',
            'No caliper research, no candidate approval, no fitment moves or publication.',
            '2000–2026 is the assignment scope; listed gap years reflect the supplied snapshot, not fabricated missing-year applications.',
            'Only three future shared questions prioritized; every remaining group is explicitly queued.'],
        'application_ids_preserved': True, 'original_chassis_preserved': True,
        'evidence_truth_verified': False, 'database_changed': False, 'research_complete': False}
    output = TASK / 'agents/W3_initial_triage.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
    mode = 'x'
    if output.exists() and output.read_text(encoding='utf-8') != text:
        previous = json.loads(output.read_text(encoding='utf-8'))
        for group in previous.get('groups', []):
            if group.get('next_action_mode') == 'future_shared_source_query_not_yet_authorized_for_execution':
                group['next_action_mode'] = 'research_not_started_low_token_staging'
        if previous != payload:
            raise FileExistsError(f'Refusing to overwrite unrelated differences in W3 intake: {output}')
        mode = 'w'  # Explicitly requested, narrowly checked status-wording migration.
    if not output.exists() or mode == 'w':
        with output.open(mode, encoding='utf-8', newline='\n') as handle:
            handle.write(text)
    for relative, sha in hashes.items():
        if hashlib.sha256((TASK / relative).read_bytes()).hexdigest() != sha:
            raise ValueError(f'Input changed during intake: {relative}')
    print(json.dumps(payload['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
