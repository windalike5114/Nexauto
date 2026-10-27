"""NexAuto V4: local matching plans and ten sparse identity answers, no network/DB."""
import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime
from pathlib import Path

from schema_subset import read_json, check_schema

ROOT=Path(__file__).resolve().parents[1]


def canonical(value):
    return ' '.join(unicodedata.normalize('NFKC',str(value or '')).upper().split())


def compact(value):
    return re.sub('[^A-Z0-9]','',canonical(value))


def body_key(value):
    value=str(value or '').lower()
    patterns=[('cab_chassis',r'cab.?chassis|platform|底盘车'),('pickup',r'pickup|pick.up|utility|\bute\b|皮卡'),
      ('hatchback',r'hatch|liftback|sportback|spaceback|掀背|两厢'),('convertible',r'convertible|cabrio|roadster|敞篷'),
      ('coupe',r'coupe|coupé|轿跑'),('sedan',r'sedan|saloon|limousine|轿车'),('mpv',r'mpv|多用途'),
      ('suv',r'suv|off.road|越野'),('wagon',r'wagon|estate|avant|旅行'),('bus',r'bus|巴士'),('van',r'van|box|厢')]
    return next((key for key,pattern in patterns if re.search(pattern,value)),'')


def drive_key(value):
    value=canonical(value)
    for key,pattern in [('awd',r'AWD|4WD|4X4|四驱'),('fwd',r'FWD|前驱'),('rwd',r'RWD|后驱'),('2wd',r'2WD|4X2')]:
        if re.search(pattern,value):
            return key
    return ''


def drive_compatible(target,source):
    if not target or not source:
        return True
    if target=='2wd':
        return source!='awd'
    if source=='2wd':
        return target!='awd'
    return target==source


def engine_keys(value):
    return {compact(x) for x in re.split(r'[/,;|]+','—'.join(str(value or '').split('—')[1:])) if compact(x)}


def engine_match(case,source):
    codes=engine_keys(case.get('engine'))
    cc=case.get('displacement_cc') or 0
    sc=source.get('displacement_cc') or 0
    return bool(codes & {compact(c) for c in source.get('engine_codes',[])}) and cc>0 and sc>0 and abs(cc-sc)<=max(30,cc*.02)


def assess_year(case,year,sources):
    """Unique is relative to supplied catalogue, not exhaustive OEM uniqueness."""
    body=body_key(case.get('body'))
    drive=drive_key(case.get('drive') or case.get('variant'))
    eligible=[s for s in sources if s['position']==case['position'] and s['years'][0]<=year<=s['years'][1]
      and (not body or not body_key(s.get('body')) or body_key(s.get('body'))==body)
      and drive_compatible(drive,drive_key(s.get('drive')))]
    dbs=sorted({s['db'] for s in eligible})
    basis='supplied_platform_position_year_body_drive'
    if len(dbs)>1 and engine_keys(case.get('engine')) and (case.get('displacement_cc') or 0)>0:
        exact=[s for s in eligible if engine_match(case,s)]
        unknown=[s for s in eligible if not s.get('engine_codes') or not s.get('displacement_cc')]
        narrowed={s['source_id']:s for s in exact+unknown}
        narrowed_dbs=sorted({s['db'] for s in narrowed.values()})
        if exact and len(narrowed_dbs)==1:
            eligible=list(narrowed.values());dbs=narrowed_dbs;basis+=' + secondary_engine_discriminator'
    return {'year':year,'candidate_db':dbs,'source_ids':sorted({s['source_id'] for s in eligible}),
            'basis':basis,'recommendation':'single_candidate_proposal' if len(dbs)==1 else 'review_multiple_candidates' if dbs else 'review_no_supported_source',
            'scope_warning':'Uniqueness only in supplied supplier catalogue; no OEM/caliper completeness claim.'}


def validate_answer(data,question,scope,schema):
    errors=check_schema(data,schema,schema)
    if errors:
        return errors
    if data['question_id']!=question['question_id'] or data['input_fingerprint']!=question['input_fingerprint']:
        errors.append('Question ID/fingerprint differs from input')
    if len(json.dumps(data,ensure_ascii=False,separators=(',',':')))>3500:
        errors.append('Answer exceeds 3500 Unicode characters; shorten shared claims, do not emit per-case rows')
    if len(data['rules'])>6 or len(data['evidence'])>2:
        errors.append('At most six rules and two evidence records per question')
    evidence={e['evidence_id']:e for e in data['evidence']}
    if len(evidence)!=len(data['evidence']) or len({r['rule_id'] for r in data['rules']})!=len(data['rules']):
        errors.append('Duplicate evidence or rule IDs')
    if data['status']=='unresolved' and data['rules']:
        errors.append('Use partial/budget_stop when some rules are supported')
    if data['status']=='confirmed' and data['open_questions']:
        errors.append('confirmed cannot contain unanswered questions; use partial')
    by_code={c['code_id']:c for c in question['targets']}
    seen={}
    for rule in data['rules']:
        if set(rule['code_ids'])-set(by_code):
            errors.append(f"{rule['rule_id']}: unknown code IDs")
        known_models={model for code in by_code.values() for model in code['models']}
        if set(rule['models'])-known_models:
            errors.append(f"{rule['rule_id']}: unknown original model labels")
        if set(rule['evidence_ids'])-set(evidence):
            errors.append(f"{rule['rule_id']}: unknown evidence IDs")
        if rule['kind']=='identity_bridge':
            option=scope['source_options'].get(rule['source_option_id'])
            if not option or rule['correction'] is not None:
                errors.append(f"{rule['rule_id']}: identity bridge needs a valid option and null correction")
            elif any(scope['code_ids'].get(cid,{}).get('family')!=option['family'] for cid in rule['code_ids']):
                errors.append(f"{rule['rule_id']}: cross-model source cannot be used without catalog correction")
        else:
            correction=rule['correction']
            if rule['source_option_id'] is not None or not correction or not any(correction.values()):
                errors.append(f"{rule['rule_id']}: correction requires changed vehicle fields and null source option")
            elif any(v is not None and not v.strip() for v in correction.values()):
                errors.append(f"{rule['rule_id']}: correction fields must be nonempty or null")
        for cid in rule['code_ids']:
            if cid not in by_code:
                continue
            models=set(rule['models']) & set(by_code[cid]['models'])
            if not models:
                errors.append(f"{rule['rule_id']}: no selected models belong to {cid}")
            if not set(rule['years']) & set(by_code[cid]['years']):
                errors.append(f"{rule['rule_id']}: no queried target years overlap {cid}")
            for model in models:
                for year in set(rule['years']) & set(by_code[cid]['years']):
                    key=(cid,model,year)
                    value=(rule['kind'],rule['source_option_id'],json.dumps(rule['correction'],sort_keys=True))
                    if key in seen and seen[key]!=value:
                        errors.append(f'{cid}/{model}/{year}: conflicting rules; leave unresolved rather than choose')
                    seen[key]=value
    if data['status']=='confirmed' and any((cid,model,y) not in seen for cid,c in by_code.items() for model in c['models'] for y in c['years']):
        errors.append('confirmed must cover all queried code/year pairs; otherwise use partial')
    return errors


def load_inputs():
    manifest=read_json(ROOT/'manifest.json')
    for file,digest in manifest['local_data_sha256'].items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest()!=digest:
            raise ValueError(f'Local input modified: {file}')
    return manifest,read_json(ROOT/'local_data/cases.json'),read_json(ROOT/'local_data/source.json'),read_json(ROOT/'local_data/question_scope.json')


def load_question(entry,scope):
    file=ROOT/entry['question_file']
    if hashlib.sha256(file.read_bytes()).hexdigest()!=entry['input_sha256']:
        raise ValueError('Question input modified')
    question=read_json(file)
    if question['input_fingerprint']!=scope[question['question_id']]['input_fingerprint']:
        raise ValueError('Question scope fingerprint differs')
    return question


def load_answers(folder,manifest,scope):
    answers=[]
    if folder is None:
        return answers
    folder=folder.resolve()
    if not folder.is_relative_to((ROOT/'results').resolve()) or not folder.is_dir():
        raise ValueError('--answers must be a directory inside this package results/')
    seen=set();schema=read_json(ROOT/'AI_ONLY/result.schema.json')
    questions={q['question_id']:q for q in manifest['questions']}
    for file in sorted(folder.glob('*.json')):
        data=read_json(file);qid=data.get('question_id')
        if qid not in questions or qid in seen:
            raise ValueError(f'Unknown or duplicate answer question: {file.name}')
        q=load_question(questions[qid],scope)
        errors=validate_answer(data,q,scope[qid],schema)
        if errors:
            raise ValueError(f'{file.name}: {errors}')
        seen.add(qid);answers.append(data)
    return answers


def plan_rows(cases,source_catalog,scope,answers):
    rules_by_review={};answered=set();corrections=[];corrected_apps=set()
    source=source_catalog['rows'];case_by_id={case['review_id']:case for case in cases}
    for answer in answers:
        qid=answer['question_id'];local=scope[qid]
        answered.update(rid for c in local['code_ids'].values() for rid in c['review_ids'])
        for rule in answer['rules']:
            for cid in rule['code_ids']:
                for rid in local['code_ids'][cid]['review_ids']:
                    if case_by_id[rid]['model'] in rule['models']:
                        rules_by_review.setdefault(rid,[]).append({**rule,'question_id':qid})
    for case in cases:
        for rule in rules_by_review.get(case['review_id'],[]):
            if rule['kind']=='catalog_correction' and set(rule['years']) & set(case['years']):
                corrections.append({'application_id':case['application_id'],'review_id':case['review_id'],
                  'question_id':rule['question_id'],'rule_id':rule['rule_id'],'years':sorted(set(rule['years']) & set(case['years'])),
                  'current_vehicle':{k:case[k] for k in ['make','model','series']},'proposed_changes':rule['correction'],
                  'action':'proposal_only_keep_application_id_do_not_move_fitments'})
                corrected_apps.add(case['application_id'])
    plans=[]
    for case in cases:
        rid=case['review_id'];segments=[];links=[]
        if case['application_id'] in corrected_apps:
            segments=[{'year':y,'candidate_db':[],'source_ids':[],'recommendation':'review_catalog_correction',
                       'basis':'identity correction proposal; no automatic fitment migration'} for y in case['years']]
        else:
            for year in case['years']:
                base=case['platform_source_ids'] if case['issue']!='no_exact_platform' else []
                ids=set(base)
                for rule in rules_by_review.get(rid,[]):
                    if rule['kind']=='identity_bridge' and year in rule['years']:
                        ids.update(scope[rule['question_id']]['source_options'][rule['source_option_id']]['row_ids'])
                        links.append({'question_id':rule['question_id'],'rule_id':rule['rule_id']})
                sources=[source[str(sid)] for sid in sorted(ids) if str(sid) in source]
                segment=assess_year(case,year,sources)
                if not sources:
                    segment['basis']='no proven platform mapping; not an AI failure'
                segments.append(segment)
        single=[s for s in segments if s['recommendation']=='single_candidate_proposal']
        dbs=sorted({s['candidate_db'][0] for s in single})
        complete=bool(segments) and len(single)==len(segments) and len(dbs)==1
        status='proposed_complete' if complete else 'proposed_partial_or_split' if single else 'unchanged_review'
        plans.append({'review_id':rid,'application_id':case['application_id'],'position':case['position'],
          'original_years':case['years'],'original_fitment_status':case['fitment_status'],
          'current_db':case['current_db'],'current_sku':case['current_sku'],'plan_status':status,
          'proposed_db':dbs[0] if complete else None,'year_segments':segments,
          'identity_rule_refs':[dict(t) for t in sorted({tuple(sorted(x.items())) for x in links})],
          'research_state':'rule_supported' if links or rid in rules_by_review else 'question_answered_no_applicable_rule' if rid in answered else 'not_queried',
          'database_action':'none_offline_proposal_only','evidence_truth_verified_by_script':False})
    return plans,corrections


def write_json(path,data):
    with path.open('x',encoding='utf-8') as handle:
        json.dump(data,handle,ensure_ascii=False,indent=2)


def write_jsonl(path,rows):
    with path.open('x',encoding='utf-8') as handle:
        for row in rows:
            handle.write(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['check','plan','questions'])
    parser.add_argument('--answer',type=Path)
    parser.add_argument('--answers',type=Path)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    manifest,cases,source,scope=load_inputs()
    if args.command=='questions':
        return {'questions':[{'question_id':q['question_id'],'input':q['question_file']} for q in manifest['questions']],
                'stop_after':10,'do_not_read_local_data_into_model':True}
    if args.command=='check':
        if args.answer is None:
            raise ValueError('--answer is required')
        data=read_json(args.answer);qid=data.get('question_id')
        entry=next((q for q in manifest['questions'] if q['question_id']==qid),None)
        if entry is None:
            raise ValueError('Not one of the ten permitted questions')
        errors=validate_answer(data,load_question(entry,scope),scope[qid],read_json(ROOT/'AI_ONLY/result.schema.json'))
        report={'valid':not errors,'question_id':qid,'errors':errors,'evidence_truth_checked':False,'database_changed':False}
        if errors:
            print(json.dumps(report,ensure_ascii=False));raise SystemExit(1)
        return report
    if args.output is None:
        raise ValueError('--output is required; choose a new directory inside runs/')
    output=args.output.resolve()
    if not output.is_relative_to((ROOT/'runs').resolve()):
        raise ValueError('Output must stay inside this package runs/')
    if output.exists():
        raise ValueError('Output exists; choose a new name to preserve previous plans')
    answers=load_answers(args.answers,manifest,scope)
    plans,corrections=plan_rows(cases,source,scope,answers)
    sku_map=read_json(ROOT/'local_data/db_sku.json')
    for plan in plans:
        skus=sku_map.get(plan['proposed_db'],[]) if plan['proposed_db'] else []
        plan['proposed_sku']=skus[0] if len(skus)==1 else None
        plan['sku_note']='unique existing SKU' if len(skus)==1 else 'do not create or guess SKU'
    complete=[p for p in plans if p['plan_status']=='proposed_complete']
    partial=[p for p in plans if p['plan_status']=='proposed_partial_or_split']
    remaining=[p for p in plans if p['plan_status']!='proposed_complete']
    summary={'snapshot_cases':len(cases),'plan_cases':len(plans),'answered_questions':len(answers),
      'complete_single_candidate_proposals':len(complete),'partial_or_split_proposals':len(partial),
      'remaining_review_cases':len(remaining),'catalog_correction_proposals':len(corrections),
      'database_changed':False,'evidence_truth_checked':False,
      'warning':'Static 2026-10-24 snapshot. Plans are not published; recheck live state and evidence before import.'}
    output.mkdir(parents=True,exist_ok=False)
    write_jsonl(output/'all_cases_plan.jsonl',plans)
    write_jsonl(output/'single_candidate_proposals.jsonl',complete)
    write_jsonl(output/'partial_proposals.jsonl',partial)
    write_jsonl(output/'remaining_review.jsonl',remaining)
    write_jsonl(output/'catalog_corrections.jsonl',corrections)
    write_json(output/'summary.json',summary)
    write_json(output/'answer_snapshot.json',answers)
    return summary


if __name__=='__main__':
    try:
        print(json.dumps(main(),ensure_ascii=False,indent=2))
    except (ValueError,KeyError,OSError,TypeError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False));sys.exit(2)
