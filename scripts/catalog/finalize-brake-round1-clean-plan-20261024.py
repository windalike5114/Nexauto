"""Offline first-round reconciliation; no production writes or source-file edits."""
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

BASE=Path.cwd()
V4=BASE/'outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4'
OUT=BASE/'outputs/brake-popular50-delegation-20261024/first-round/clean-plan'
sys.path.insert(0,str(V4/'tools'))
import low_token as old

original_assess=old.assess_year


def bounded_assess(case,year,sources):
    """Unknown end is plausible, not year zero and not established applicability."""
    possible=[];unknown=set()
    for src in sources:
        start,end=src['years']
        if not isinstance(start,(int,float)) or start<=0:
            continue
        if not isinstance(end,(int,float)) or end<=0 or end<start:
            if year>=start:
                possible.append({**src,'years':[start,year]})
                unknown.add(src['source_id'])
        else:
            possible.append(src)
    result=original_assess(case,year,possible)
    surviving_unknown=sorted(unknown & set(result['source_ids']))
    result['source_end_unknown_ids']=surviving_unknown
    if surviving_unknown:
        result['scope_warning']+=' Some source ends are unknown; they are not silently discarded.'
        closed_ids=set(result['source_ids'])-unknown
        if result['recommendation']=='single_candidate_proposal' and not closed_ids:
            result['recommendation']='review_source_year_boundary_unknown'
            result['basis']+='; no closed-date source proves this target year'
    return result


def dump(name,obj):
    (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def jsonl(name,rows):
    (OUT/name).write_text(''.join(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n' for row in rows),encoding='utf-8')


def main():
    read=old.read_json
    manifest,cases,source,scope=old.load_inputs()
    answers=old.load_answers(V4/'results',manifest,scope)
    classifications=read(BASE/'outputs/brake-popular50-delegation-20261024/first-round/rules.classified.json')
    categories={(r['question_id'],r['rule_id']):r['category'] for r in classifications}
    retained=[]
    for answer in answers:
        cleaned=copy.deepcopy(answer)
        cleaned['rules']=[r for r in cleaned['rules'] if categories[(answer['question_id'],r['rule_id'])] in ['true_model_correction','identity_bridge']]
        for rule in cleaned['rules']:
            if rule['kind']=='catalog_correction':
                rule['correction']['series']=None # Preserve each original raw chassis code.
        retained.append(cleaned)
    old.assess_year=bounded_assess
    plans,correction_relations=old.plan_rows(cases,source,scope,retained)
    sku_map=read(V4/'local_data/db_sku.json')
    for plan in plans:
        choices=sku_map.get(plan['proposed_db'],[]) if plan['proposed_db'] else []
        plan['proposed_sku']=choices[0] if len(choices)==1 else None
        plan['review_gate']='offline proposal; review source evidence and current production diff before import'
        plan['normalization_version']='ROUND1_SEMANTIC_SPLIT_UNKNOWN_YEAR_END_20261024'
    proposals=read(BASE/'outputs/brake-popular50-delegation-20261024/first-round/normalized_model_correction_proposals.json')
    complete=[p for p in plans if p['plan_status']=='proposed_complete']
    partial=[p for p in plans if p['plan_status']=='proposed_partial_or_split']
    remaining=[p for p in plans if p['plan_status']!='proposed_complete']
    unknown=[p for p in plans if any(s.get('source_end_unknown_ids') for s in p['year_segments'])]
    original_plan=[json.loads(line) for line in (V4/'runs/round1/all_cases_plan.jsonl').read_text(encoding='utf-8').splitlines() if line]
    orig_by_id={p['review_id']:p for p in original_plan}
    changed=[{'review_id':p['review_id'],'application_id':p['application_id'],
              'old_plan_status':orig_by_id[p['review_id']]['plan_status'],'new_plan_status':p['plan_status'],
              'old_db':orig_by_id[p['review_id']]['proposed_db'],'new_db':p['proposed_db']} for p in plans
             if p['plan_status']!=orig_by_id[p['review_id']]['plan_status'] or p['proposed_db']!=orig_by_id[p['review_id']]['proposed_db']]
    assert len(plans)==len({p['review_id'] for p in plans})==5541
    for case,plan in zip(cases,plans):
        assert case['review_id']==plan['review_id'] and case['application_id']==plan['application_id']
        assert case['years']==plan['original_years']
        assert all(s['year'] in case['years'] for s in plan['year_segments'])
    OUT.mkdir(parents=True,exist_ok=True)
    jsonl('all-cases-plan.jsonl',plans)
    jsonl('complete-candidate-proposals.jsonl',complete)
    jsonl('partial-candidate-proposals.jsonl',partial)
    jsonl('remaining-review.jsonl',remaining)
    jsonl('unknown-source-year-boundary.jsonl',unknown)
    dump('plan-status-changes.json',changed)
    dump('true-model-correction-proposals.json',proposals)
    dump('normalized-rule-plan.json',{'transformed_by_script_not_an_ai_answer':True,
      'policy':'Only identity bridges and true model corrections affect this offline plan. Raw chassis preserved.',
      'answers':retained})
    summary={'cases':len(plans),'applications':len({p['application_id'] for p in plans}),
      'complete_candidate_proposals':len(complete),'complete_proposal_applications':len({p['application_id'] for p in complete}),
      'partial_candidate_proposals':len(partial),'remaining_review':len(remaining),
      'true_model_correction_applications':proposals['application_count'],
      'unknown_source_year_boundary_cases':len(unknown),'plan_status_changes':len(changed),
      'retained_identity_rule_count':sum(r['kind']=='identity_bridge' for a in retained for r in a['rules']),
      'retained_true_model_rule_count':sum(r['kind']=='catalog_correction' for a in retained for r in a['rules']),
      'source_scope':'Historical 5541 review rows only; not all popular50 gaps.',
      'evidence_truth_checked_by_script':False,'source_files_changed':False,'production_changed':False,
      'limitations':['yearTo=0 is unknown end until source semantics confirmed; not automatically 2026',
                     'No SQL, production import, application merge or fitment movement performed',
                     'Identity facts are not brake/caliper fitment evidence'],
      'input_hashes':{'original_v4_plan':hashlib.sha256((V4/'runs/round1/all_cases_plan.jsonl').read_bytes()).hexdigest()}}
    dump('summary.json',summary)
    (OUT/'README.txt').write_text('首轮清理后的离线候选计划。保留所有原ID/年份；不修改原V4结果或生产。\n'
      '不再把身份说明、市场别名或三个底盘代码合成文字当成车型纠错。\n'
      '源结束年0按未知潜在候选处理，不自动外推；完整/部分提案不代表已经发布。\n',encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))


if __name__=='__main__':
    main()
