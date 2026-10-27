"""Local-only NexAuto V3 task ownership, query reuse and result expansion.

No network calls or database operations. Requires only Python 3 standard library.
"""
import argparse
import copy
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from validator_v2 import read_json, check_schema, validate

ROOT = Path(__file__).resolve().parents[1]


def now():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, obj, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x' if exclusive else 'w', encoding='utf-8') as handle:
        json.dump(obj, handle, ensure_ascii=False, indent=2)


def owner_label(value):
    if not value or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', value):
        raise ValueError('owner must be 1-64 ASCII letters, digits, hyphens or underscores')
    return value


def group_data(group_id):
    manifest = read_json(ROOT/'manifest.json')
    group = next((g for g in manifest['groups'] if g['group_id'] == group_id), None)
    if group is None:
        raise ValueError('Unknown group ID')
    base = ROOT/'models'/group_id
    return group, base


def check_owner(group, owner):
    owner_label(owner)
    lock = ROOT/'progress/locks'/f'{group}.json'
    if not lock.exists() or read_json(lock)['owner'] != owner:
        raise ValueError('This group is not claimed by this owner')
    return lock


def query_key(query):
    return hashlib.sha256(' '.join(query.casefold().split()).encode()).hexdigest()


def query_log(group):
    path = ROOT/'progress/queries'/f'{group}.jsonl'
    return [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()] if path.exists() else []


def expand_result(data, targets, comparison, shared_schema, expanded_schema, source_catalog=None):
    errors = check_schema(data, shared_schema, shared_schema)
    if errors:
        return errors, None, None
    for field in ('schema_version', 'group_id', 'group_fingerprint'):
        if data[field] != targets[field]:
            errors.append(f'{field}: differs from source input')
    facts = {f['fact_id']: f for f in data['facts']}
    if len(facts) != len(data['facts']):
        errors.append('Duplicate fact IDs')
    if len({a['assignment_id'] for a in data['assignments']}) != len(data['assignments']):
        errors.append('Duplicate assignment IDs')
    platform_configs = {}
    for target in targets['targets'].values():
        platform_configs.setdefault(target['platform_id'], set()).add(target['config_id'])
    evidence_ids = {e['evidence_id'] for e in data['evidence']}
    evidence_by_id = {e['evidence_id']: e for e in data['evidence']}
    for evidence in data['evidence']:
        if evidence['source_type'] == 'supplied_catalog':
            if source_catalog is None or evidence['source_sha256'] != source_catalog.get('sha256'):
                errors.append(f"{evidence['evidence_id']}: supplied source SHA256 does not match catalogue")
            if source_catalog is None or set(map(str,evidence['source_row_ids'])) - set(source_catalog.get('rows',{})):
                errors.append(f"{evidence['evidence_id']}: unknown supplied source row IDs")
    for fact in facts.values():
        if fact['platform_id'] not in platform_configs:
            errors.append(f"{fact['fact_id']}: unknown platform ID")
        if set(fact['config_ids']) - platform_configs.get(fact['platform_id'], set()):
            errors.append(f"{fact['fact_id']}: config IDs do not belong to platform")
        if set(fact['evidence_ids']) - evidence_ids:
            errors.append(f"{fact['fact_id']}: unknown evidence IDs")
        sources = [evidence_by_id[eid] for eid in fact['evidence_ids'] if eid in evidence_by_id]
        local_only = sources and all(e['source_type']=='supplied_catalog' for e in sources)
        if local_only and fact['kind']=='identity':
            errors.append(f"{fact['fact_id']}: unresolved identity mapping needs external evidence, not just supplied fitment rows")
        if local_only and fact['kind']=='fitment' and source_catalog:
            rows = [source_catalog['rows'].get(str(sid),{}) for e in sources for sid in e['source_row_ids']]
            matching = [r for r in rows if r.get('db')==fact['db'] and r.get('position')==fact['position']]
            source_years=set()
            for row in matching:
                if isinstance(row.get('year_from'),int) and isinstance(row.get('year_to'),int):
                    source_years.update(range(row['year_from'],row['year_to']+1))
            if not matching or not set(fact['years']) <= source_years:
                errors.append(f"{fact['fact_id']}: local source alone cannot prove this DB/position or out-of-range years")
    results, used, seen = [], {}, set()
    for assignment in data['assignments']:
        for rid in assignment['review_ids']:
            if rid in seen:
                errors.append(f'{rid}: assigned more than once')
            seen.add(rid)
            if rid not in targets['targets']:
                errors.append(f'{rid}: unknown review ID')
                continue
            target = targets['targets'][rid]
            result = copy.deepcopy(assignment['result'])
            fact_ids = result.pop('fact_ids')
            for fid in fact_ids:
                if fid not in facts:
                    errors.append(f'{rid}: unknown fact {fid}')
                    continue
                fact = facts[fid]
                if fact['platform_id'] != target['platform_id'] or target['config_id'] not in fact['config_ids']:
                    errors.append(f'{rid}: outside {fid} explicit platform/config scope')
                if fact['kind'] == 'fitment' and fact['position'] != target['position']:
                    errors.append(f'{rid}: outside {fid} front/rear scope')
                if fact['kind']=='fitment':
                    local = [evidence_by_id[e] for e in fact['evidence_ids'] if e in evidence_by_id]
                    if local and all(e['source_type']=='supplied_catalog' for e in local):
                        identity_facts=[facts[f] for f in fact_ids if f in facts and facts[f]['kind']=='identity']
                        if not identity_facts:
                            errors.append(f'{rid}: reusing supplied fitment on pending target requires separate evidenced identity mapping')
                used.setdefault(fid, []).append(rid)
            for key in ('covered_years', 'unresolved_years'):
                if result[key] == '$TARGET_YEARS':
                    result[key] = list(target['years'])
            result.update(review_id=rid, finding_ids=fact_ids)
            results.append(result)
    if seen != set(targets['targets']):
        errors.append(f"Missing target IDs: {sorted(set(targets['targets'])-seen)}")
    batch = copy.deepcopy(targets)
    batch.update(schema_version='nexauto-brake-agent-v3-expanded', batch_id=targets['group_id'],
                 batch_fingerprint=targets['group_fingerprint'])
    expanded = {key: batch[key] for key in ('schema_version','batch_id','batch_fingerprint')}
    expanded.update(reviewer=data['reviewer'], evidence=data['evidence'], findings=[], results=results)
    for fid, review_ids in used.items():
        fact = copy.deepcopy(facts[fid])
        for key in ('fact_id', 'platform_id', 'config_ids'):
            fact.pop(key)
        fact.update(finding_id=fid, review_ids=review_ids)
        expanded['findings'].append(fact)
    if not errors:
        errors.extend(validate(expanded, batch, comparison, expanded_schema))
    return errors, expanded, batch


def validate_file(group_id, result_path):
    group, base = group_data(group_id)
    raw = (base/'targets.json').read_bytes()
    if hashlib.sha256(raw).hexdigest() != group['target_sha256']:
        raise ValueError('Input target file hash differs from manifest')
    targets = read_json(base/'targets.json')
    return expand_result(read_json(result_path), targets, read_json(base/'comparison.json'),
                         read_json(ROOT/'schema/shared-result.schema.json'),
                         read_json(ROOT/'schema/expanded-result.schema.json'),
                         read_json(ROOT/'reference/source_catalog.json'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['status','claim','release','view','query-check','log-query','check','expand','finish'])
    parser.add_argument('--group')
    parser.add_argument('--owner')
    parser.add_argument('--section', choices=['brief','platforms','cases','comparison','sources','checkpoint'], default='brief')
    parser.add_argument('--platform')
    parser.add_argument('--offset', type=int, default=0)
    parser.add_argument('--limit', type=int, default=30)
    parser.add_argument('--source-ids')
    parser.add_argument('--query')
    parser.add_argument('--outcome', choices=['found','no_result','blocked'])
    parser.add_argument('--urls', default='')
    parser.add_argument('--platform-ids', default='')
    parser.add_argument('--note', default='')
    parser.add_argument('--result', type=Path)
    parser.add_argument('--output-dir', type=Path)
    args = parser.parse_args()
    if args.command == 'status':
        manifest = read_json(ROOT/'manifest.json')
        rows=[]
        for g in manifest['groups']:
            lock=ROOT/'progress/locks'/f"{g['group_id']}.json"
            done=ROOT/'progress/completed'/f"{g['group_id']}.json"
            rows.append({**g, 'state':'completed_research' if done.exists() else 'claimed' if lock.exists() else 'unclaimed',
                         'owner':read_json(lock)['owner'] if lock.exists() else None})
        return {'groups':rows,'notice':'Completed research may still contain unresolved cases.'}
    group, base = group_data(args.group)
    if args.command == 'claim':
        owner_label(args.owner)
        lock=ROOT/'progress/locks'/f'{args.group}.json'
        if (ROOT/'progress/completed'/f'{args.group}.json').exists():
            raise ValueError('Research already completed; reuse saved results, do not requery whole model')
        if lock.exists():
            current=read_json(lock)
            if current['owner']==args.owner:
                return {'state':'already_owned_resume_from_cache','lock':current}
            raise ValueError(f"Already claimed by {current['owner']}; do not duplicate research")
        obj={'group_id':args.group,'owner':args.owner,'claimed_at':now()}
        write_json(lock,obj,exclusive=True)
        return obj
    if args.command == 'release':
        lock=check_owner(args.group,args.owner)
        lock.unlink()
        return {'released':args.group,'results_and_cache_preserved':True}
    if args.command == 'view':
        if args.offset<0 or not 1<=args.limit<=100:
            raise ValueError('offset must be nonnegative and limit between 1 and 100')
        if args.section=='brief':
            return read_json(base/'brief.json')
        if args.section=='sources':
            if not args.source_ids:
                raise ValueError('Specify --source-ids from brief/platform record; do not load full catalogue')
            catalog=read_json(ROOT/'reference/source_catalog.json')
            ids=[s.strip() for s in args.source_ids.split(',')]
            return {'provenance':{k:v for k,v in catalog.items() if k!='rows'},'rows':{i:catalog['rows'][i] for i in ids}}
        if args.section=='checkpoint':
            paths=list((ROOT/'progress/checkpoints').glob(f'*/{args.group}.json'))
            return {'query_log':query_log(args.group),'checkpoints':[read_json(p) for p in paths],
                    'saved_results':[str(p.relative_to(ROOT)) for p in (ROOT/'results').glob(f'*/{args.group}.json')]}
        if args.section=='platforms':
            rows=read_json(base/'platforms.json')['platforms']
            if args.platform:
                rows=[r for r in rows if r['platform_id']==args.platform]
            return {'total':len(rows),'offset':args.offset,'rows':rows[args.offset:args.offset+args.limit]}
        data=read_json(base/'targets.json')
        items=[(rid,t) for rid,t in data['targets'].items() if not args.platform or t['platform_id']==args.platform]
        selected=dict(items[args.offset:args.offset+args.limit])
        if args.section=='comparison':
            comp=read_json(base/'comparison.json')['comparisons']
            return {'warning':'Read only after independent facts; not evidence','total':len(items),'comparisons':{rid:comp[rid] for rid in selected}}
        return {'total':len(items),'offset':args.offset,'targets':selected,
                'configs':{t['config_id']:data['configs'][t['config_id']] for t in selected.values()}}
    if args.command in ('query-check','log-query'):
        if not args.query or not args.query.strip():
            raise ValueError('--query is required')
        key=query_key(args.query)
        existing=[row for row in query_log(args.group) if row['query_key']==key]
        if args.command=='query-check' or existing:
            return {'already_tried':bool(existing),'existing':existing,'query_key':key,
                    'action':'reuse saved scope; supplement only missing differences' if existing else 'not logged; inspect facts/URLs before searching'}
        check_owner(args.group,args.owner)
        if not args.outcome:
            raise ValueError('--outcome is required for logging actual completed query')
        platform_ids=[s.strip() for s in args.platform_ids.split(',') if s.strip()]
        known={p['platform_id'] for p in read_json(base/'platforms.json')['platforms']}
        if set(platform_ids)-known:
            raise ValueError('Unknown platform IDs in query log')
        row={'query_key':key,'query':args.query,'owner':args.owner,'at':now(),'outcome':args.outcome,
             'urls_opened':[s.strip() for s in args.urls.split(',') if s.strip()],
             'coverage_platform_ids':platform_ids,'note':args.note}
        log=ROOT/'progress/queries'/f'{args.group}.jsonl'
        log.parent.mkdir(parents=True,exist_ok=True)
        with log.open('a',encoding='utf-8') as handle:
            handle.write(json.dumps(row,ensure_ascii=False)+'\n')
        return {'logged':True,'query_key':key}
    if args.result is None:
        raise ValueError('--result is required')
    errors, expanded, batch=validate_file(args.group,args.result)
    report={'valid':not errors,'group_id':args.group,'target_count':group['cases'],'errors':errors,
            'notice':'Only structure, explicit scope and ID/year consistency; evidence truth not verified; no publishing.'}
    if errors:
        print(json.dumps(report,ensure_ascii=False,indent=2))
        raise SystemExit(1)
    if args.command=='expand':
        if args.output_dir is None:
            raise ValueError('--output-dir is required; choose a new folder under expanded/')
        output=args.output_dir.resolve()
        if not output.is_relative_to((ROOT/'expanded').resolve()):
            raise ValueError('Output directory must be inside this package expanded/')
        output.mkdir(parents=True,exist_ok=False)
        write_json(output/'expanded_result.json',expanded)
        write_json(output/'expanded_input.json',batch)
        report['output_dir']=str(output)
    if args.command=='finish':
        check_owner(args.group,args.owner)
        if not args.result.resolve().is_relative_to((ROOT/'results'/args.owner).resolve()):
            raise ValueError('Save result inside results/<owner>/ before finish')
        counts={}
        for result in expanded['results']:
            counts[result['decision']]=counts.get(result['decision'],0)+1
        state={'group_id':args.group,'owner':args.owner,'finished_at':now(),
               'result_file':str(args.result.resolve().relative_to(ROOT)),
               'result_sha256':hashlib.sha256(args.result.read_bytes()).hexdigest(),
               'decision_counts':counts,'research_complete_not_necessarily_resolved':True}
        write_json(ROOT/'progress/completed'/f'{args.group}.json',state,exclusive=True)
        report['decision_counts']=counts
    return report


if __name__=='__main__':
    try:
        print(json.dumps(main(),ensure_ascii=False,indent=2))
    except (ValueError,KeyError,OSError,TypeError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False))
        sys.exit(2)
