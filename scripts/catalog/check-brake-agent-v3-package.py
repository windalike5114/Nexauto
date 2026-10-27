"""Mechanical coverage and synthetic behavior tests. Never researches vehicles."""
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

root=Path('outputs/brake-agent-v3-minquery-20261024/NexAuto_Brake_Agent_V3').resolve()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
manifest=read(root/'manifest.json')
old=read(Path('outputs/brake-agent-v2-20261024/prepared.json'))
old_ids={r['review_id'] for r in old['mapping']}
audit=read(Path('outputs/brake-pad-unique-first-audit-20261024/audit.json'))
originals={r['review_id']:r for r in audit['rows'] if not r['keep']}
all_ids=[]
all_platforms=set()
source=read(root/'reference/source_catalog.json')
for group in manifest['groups']:
    file=root/group['target_file']
    assert hashlib.sha256(file.read_bytes()).hexdigest()==group['target_sha256']
    data=read(file)
    assert data['group_id']==group['group_id']
    assert data['group_fingerprint']==group['group_fingerprint']
    assert len(data['targets'])==group['cases']
    all_ids.extend(data['targets'])
    all_platforms.update(t['platform_id'] for t in data['targets'].values())
    platforms=read(file.parent/'platforms.json')['platforms']
    assert set(r for p in platforms for r in p['review_ids'])==set(data['targets'])
    assert len(platforms)==group['platforms']
    assert len({p['platform_id'] for p in platforms})==len(platforms)
    assert set(read(file.parent/'comparison.json')['comparisons'])==set(data['targets'])
    for rid,target in data['targets'].items():
        assert target['config_id'] in data['configs']
        original=originals[rid]
        assert target['years']==original['years'] and target['position']==original['position']
        assert target['application_id']==original['application_id']
        cfg=data['configs'][target['config_id']]
        for key in ['make','model','series','body','drive','variant','engine','displacement_cc']:
            assert (cfg.get(key) or None)==(original.get(key) or None),(rid,key)
        assert set(str(s) for ids in target['source_links'].values() for s in ids)<=set(source['rows'])
        assert 'current_db' not in target and 'current_sku' not in target
assert len(all_ids)==len(set(all_ids))==5541 and set(all_ids)==old_ids
assert len(all_platforms)==2411
assert len({(g['make'],g['model']) for g in manifest['groups']})==len(manifest['groups'])==217
assert sum(len(g['model_names']) for g in manifest['groups'])==222
for folder in ['results','expanded','progress']:
    assert not any(p.is_file() for p in (root/folder).rglob('*'))

sys.path.insert(0,str(root/'tools'))
import work
schema=read(root/'schema/shared-result.schema.json')
expanded_schema=read(root/'schema/expanded-result.schema.json')
vehicle={'make':'TEST','model':'FIXTURE','series':'X','body':'Sedan','drive':'FWD'}
targets={'schema_version':'nexauto-brake-agent-v3','group_id':'FIXTURE','group_fingerprint':'a'*64,
 'configs':{'C1':{**vehicle,'engine':'E1'},'C2':{**vehicle,'engine':'E2'}},
 'targets':{'R1':{'application_id':'AP1','config_id':'C1','platform_id':'PL1','position':'front','years':[2010,2012]},
            'R2':{'application_id':'AP2','config_id':'C2','platform_id':'PL1','position':'front','years':[2011]}}}
comparison={'comparisons':{'R1':{'current_db':'DB123'},'R2':{'current_db':'DB123'}}}
evidence={'evidence_id':'E1','url':'https://example.test/synthetic-fixture','publisher':'Synthetic',
          'title':'Synthetic only, not researched','source_type':'other','locator':'test',
          'accessed_at':'2026-10-24T00:00:00Z','supports_claim':'Synthetic mechanical check, no vehicle facts'}
fact={'fact_id':'F1','kind':'fitment','platform_id':'PL1','config_ids':['C1','C2'],
      'vehicle':vehicle,'position':'front','years':[2010,2011,2012],'engine_codes':[], 'db':'DB123',
      'conditions':[],'evidence_ids':['E1'],'summary':'Synthetic scope test only'}
assignment={'assignment_id':'A1','review_ids':['R1','R2'],'result':{
 'fact_ids':['F1'],'identity_status':'confirmed_as_is','fitment_status':'supported','decision':'keep_current',
 'confirmed_db':'DB123','covered_years':'$TARGET_YEARS','unresolved_years':[], 'conditions':[],
 'proposed_vehicle':None,'confidence':'high','reason':'Synthetic shared reason','unresolved_questions':[]}}
result={k:targets[k] for k in ('schema_version','group_id','group_fingerprint')}
result.update(reviewer={'agent':'synthetic_unit_test','reviewed_at':'2026-10-24T00:00:00Z'},evidence=[evidence],facts=[fact],assignments=[assignment])
tests=0
def check(data,valid,catalog=None):
    global tests
    errors,expanded,batch=work.expand_result(data,targets,comparison,schema,expanded_schema,catalog)
    assert (not errors)==valid,errors
    tests+=1
    return expanded
expanded=check(result,True)
assert expanded['results'][0]['covered_years']==[2010,2012] # No filling in missing year.
assert expanded['results'][1]['covered_years']==[2011]
for mutate in [
 lambda r:r['assignments'].append(copy.deepcopy(r['assignments'][0])),
 lambda r:r['assignments'][0].update(review_ids=['R1']),
 lambda r:r['facts'][0].update(config_ids=['C1']),
 lambda r:r['facts'][0].update(position='rear'),
 lambda r:r['facts'][0].update(years=[2010]),
 lambda r:r['assignments'][0]['result'].update(decision='replace_db'),
 lambda r:r['facts'][0].update(platform_id='foreign'),
 lambda r:r.update(group_fingerprint='b'*64),
 lambda r:r['facts'][0].update(evidence_ids=['unknown']),
 lambda r:r['assignments'][0]['result'].update(covered_years=[2010],unresolved_years=[]),
]:
    changed=copy.deepcopy(result);mutate(changed);check(changed,False)
unresolved=copy.deepcopy(result)
unresolved.update(facts=[],evidence=[])
unresolved['assignments'][0]['result'].update(fact_ids=[],identity_status='unresolved',fitment_status='unresolved',
 decision='unable_to_determine',confirmed_db=None,covered_years=[],unresolved_years='$TARGET_YEARS',confidence='unknown',unresolved_questions=['Not researched synthetic fixture'])
check(unresolved,True)
local=copy.deepcopy(result)
local['evidence'].append({'evidence_id':'E2','source_type':'supplied_catalog','source_catalog_ref':'reference/source_catalog.json',
 'source_row_ids':[1],'source_sha256':'c'*64,'publisher':'Synthetic supplied catalogue','title':'Fixture only',
 'locator':'row 1','accessed_at':'2026-10-24T00:00:00Z','supports_claim':'Fixture only'})
local['facts'][0]['evidence_ids']=['E2']
identity=copy.deepcopy(fact);identity.update(fact_id='I1',kind='identity',position=None,db=None,evidence_ids=['E1'])
local['facts'].append(identity);local['assignments'][0]['result']['fact_ids'].append('I1')
catalog={'sha256':'c'*64,'rows':{'1':{'db':'DB123','position':'front','year_from':2010,'year_to':2012}}}
check(local,True,catalog)
bad=copy.deepcopy(local);bad['evidence'][1]['source_sha256']='d'*64;check(bad,False,catalog)
bad=copy.deepcopy(local);bad['facts'][0]['years'].append(2013);check(bad,False,catalog)
bad=copy.deepcopy(local);bad['facts'][1]['evidence_ids']=['E2'];check(bad,False,catalog)
bad=copy.deepcopy(local);bad['assignments'][0]['result']['fact_ids']=['F1'];check(bad,False,catalog)
bad=copy.deepcopy(local);bad['evidence'][1]['source_row_ids']=[2];check(bad,False,catalog)

# Exercise local ownership/query-cache mechanics only in a synthetic workspace.
fixture=Path('tmp/brake-v3-mechanical-fixture').resolve()
assert fixture.is_relative_to(Path.cwd().resolve()/'tmp')
fixture.mkdir(parents=True,exist_ok=True)
work.ROOT=fixture
model=fixture/'models/FIXTURE'
work.write_json(model/'platforms.json',{'platforms':[{'platform_id':'PL1'}]})
work.write_json(fixture/'manifest.json',{'groups':[{'group_id':'FIXTURE','cases':2}]})
def command(*args):
    sys.argv=['work.py',*args]
    return work.main()
lock=fixture/'progress/locks/FIXTURE.json'
if lock.exists():
    assert work.read_json(lock)['owner']=='fixture_owner'
claimed=command('claim','--group','FIXTURE','--owner','fixture_owner')
assert claimed.get('owner',claimed.get('lock',{}).get('owner'))=='fixture_owner'
tests+=1
try:
    command('claim','--group','FIXTURE','--owner','different_owner')
    raise AssertionError('Duplicate owner was accepted')
except ValueError:
    tests+=1
command('log-query','--group','FIXTURE','--owner','fixture_owner','--query','Synthetic Cache Test','--outcome','no_result','--platform-ids','PL1')
assert command('query-check','--group','FIXTURE','--query',' synthetic   CACHE test ')['already_tried']
tests+=1
report={'package_checks':'passed','synthetic_checks':tests,'cases':len(all_ids),'shared_model_jobs':217,
        'platform_subitems':len(all_platforms),'research_executed':False,'production_database_changed':False,
        'actual_results_and_progress_empty':True}
work.ROOT=root
print(json.dumps(report,ensure_ascii=False))
