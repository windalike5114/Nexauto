"""Checks packaging and synthetic fixtures only; never runs matching on real data."""
import copy
import hashlib
import json
import sys
from pathlib import Path

root=Path('outputs/brake-agent-v4-lowtoken-20261024/NexAuto_Brake_LowToken_V4').resolve()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
manifest=read(root/'manifest.json')
cases=read(root/'local_data/cases.json')
scope=read(root/'local_data/question_scope.json')
source=read(root/'local_data/source.json')
audit=read(Path('outputs/brake-pad-unique-first-audit-20261024/audit.json'))
original={r['review_id']:r for r in audit['rows'] if not r['keep']}
assert len(cases)==len({r['review_id'] for r in cases})==5541
assert set(original)=={r['review_id'] for r in cases}
for case in cases:
    old=original[case['review_id']]
    for key in ['application_id','position','years','make','model','series','body','drive','variant','engine','displacement_cc']:
        assert case[key]==old[key]
    assert case['fitment_status']=='review' and case['current_db']==old['db']
    assert set(map(str,case['platform_source_ids']))<=set(source['rows'])
for file,digest in manifest['local_data_sha256'].items():
    assert hashlib.sha256((root/file).read_bytes()).hexdigest()==digest
assert len(manifest['questions'])==len(list((root/'AI_ONLY/questions').glob('*.json')))==10
selected=[]
for entry in manifest['questions']:
    file=root/entry['question_file'];q=read(file)
    assert hashlib.sha256(file.read_bytes()).hexdigest()==entry['input_sha256']
    assert q['input_fingerprint']==scope[q['question_id']]['input_fingerprint']
    assert len(q['targets'])<=6 and len(q['source_options'])<=4
    assert file.stat().st_size<=7000
    assert q['limits']['max_search_queries']==q['limits']['max_opened_pages']==2
    assert 'review_id' not in file.read_text(encoding='utf-8') and 'engine' not in file.read_text(encoding='utf-8')
    for code in scope[q['question_id']]['code_ids'].values():
        selected.extend(code['review_ids'])
        assert all(original[r]['rule']=='no_exact_platform' for r in code['review_ids'])
    for option in scope[q['question_id']]['source_options'].values():
        assert set(map(str,option['row_ids']))<=set(source['rows'])
assert len(selected)==len(set(selected))==manifest['stats']['selected_cases']
for folder in ['results','runs']:
    assert not any(p.is_file() for p in (root/folder).rglob('*'))

sys.path.insert(0,str(root/'tools'))
import low_token as tool
schema=read(root/'AI_ONLY/result.schema.json')
question={'question_id':'LQ-01','input_fingerprint':'a'*64,'targets':[
 {'code_id':'C1','make':'TEST','models':['FIXTURE','ALIAS'],'series':'X','years':[2010,2011,2012]}]}
local={'input_fingerprint':'a'*64,'code_ids':{'C1':{'family':'TEST|FIXTURE','review_ids':['R1','R2']}},
 'source_options':{'S1':{'row_ids':[1],'family':'TEST|FIXTURE'}}}
evidence={'evidence_id':'E1','url':'https://example.test/synthetic-not-researched','publisher':'Synthetic fixture',
 'locator':'Test only','claim':'No actual evidence researched'}
rule={'rule_id':'F1','kind':'identity_bridge','code_ids':['C1'],'models':['FIXTURE'],
 'years':[2010,2011,2012],'source_option_id':'S1','correction':None,'evidence_ids':['E1'],'claim':'Synthetic only'}
answer={'question_id':'LQ-01','input_fingerprint':'a'*64,'status':'partial','reviewer':'synthetic_test',
 'reviewed_at':'2026-10-24T00:00:00Z','evidence':[evidence],'rules':[rule],'open_questions':['ALIAS remains unverified']}
tests=0
def valid(data,expected=True):
    global tests
    errors=tool.validate_answer(data,question,local,schema)
    assert (not errors)==expected,errors
    tests+=1
valid(answer)
empty={**answer,'status':'unresolved','evidence':[],'rules':[],'open_questions':['Not researched synthetic fixture']}
valid(empty) # Sparse answers: no per-application return requirement.
for mutate in [
 lambda d:d.update(input_fingerprint='b'*64),
 lambda d:d['rules'][0].update(code_ids=['foreign']),
 lambda d:d['rules'][0].update(models=['foreign']),
 lambda d:d['rules'][0].update(source_option_id='foreign'),
 lambda d:d['rules'][0].update(evidence_ids=['foreign']),
 lambda d:d['rules'][0].update(db='DB123'),
 lambda d:d.update(status='confirmed'),
 lambda d:d['rules'][0].update(claim='x'*4000),
 lambda d:d.update(reviewed_at='2026-10-24'),
]:
    changed=copy.deepcopy(answer);mutate(changed);valid(changed,False)
complete=copy.deepcopy(answer);complete['rules'][0]['models']=['FIXTURE','ALIAS'];complete.update(status='confirmed',open_questions=[])
valid(complete)

base={'review_id':'R1','application_id':'AP1','position':'front','years':[2010,2012],'make':'TEST','model':'FIXTURE','series':'X',
 'body':'Sedan','drive':'FWD','variant':'Sedan FWD','engine':'2.0 Petrol — E1','displacement_cc':2000,
 'current_db':'DB999','current_sku':'NBP999','fitment_status':'review','issue':'no_exact_platform','platform_source_ids':[]}
other={**base,'review_id':'R2','application_id':'AP2','model':'ALIAS','years':[2011]}
src={'source_id':1,'make':'TEST','model':'FIXTURE','series':'SOURCE','years':[2010,2012],'position':'front','db':'DB123',
 'body':'轿车','drive':'fwd','engine_codes':['E1'],'displacement_cc':2000}
catalog={'rows':{'1':src}}
plans,corrections=tool.plan_rows([base,other],catalog,{'LQ-01':local},[])
assert all(p['plan_status']=='unchanged_review' and p['research_state']=='not_queried' for p in plans);tests+=1
plans,corrections=tool.plan_rows([base,other],catalog,{'LQ-01':local},[answer])
assert plans[0]['plan_status']=='proposed_complete' and plans[0]['proposed_db']=='DB123'
assert [s['year'] for s in plans[0]['year_segments']]==[2010,2012] # No gap filling.
assert plans[1]['plan_status']=='unchanged_review';tests+=1
partial=copy.deepcopy(answer);partial['rules'][0]['years']=[2010]
plans,_=tool.plan_rows([base,other],catalog,{'LQ-01':local},[partial])
assert plans[0]['plan_status']=='proposed_partial_or_split' and plans[0]['year_segments'][1]['candidate_db']==[];tests+=1
for source_change in [{'drive':'awd'},{'body':'SUV'},{'position':'rear'},{'years':[2013,2020]}]:
    assert not tool.assess_year(base,2010,[{**src,**source_change}])['candidate_db'];tests+=1
two={**src,'source_id':2,'db':'DB456','engine_codes':[]}
assert len(tool.assess_year(base,2010,[src,two])['candidate_db'])==2;tests+=1
assert tool.assess_year(base,2010,[src,{**two,'engine_codes':['E2']}])['candidate_db']==['DB123'];tests+=1
assert not tool.assess_year({**base,'drive':'2WD'},2010,[{**src,'drive':'AWD'}])['candidate_db'];tests+=1
correction=copy.deepcopy(answer)
correction['rules'][0].update(kind='catalog_correction',source_option_id=None,correction={'make':None,'model':'CORRECT','series':None})
valid(correction)
same_app={**other,'application_id':'AP1','issue':'published_db_mismatch','platform_source_ids':[1]}
plans,corr=tool.plan_rows([base,same_app],catalog,{'LQ-01':local},[correction])
assert len(corr)==1 and all(p['plan_status']=='unchanged_review' for p in plans)
assert all(p['database_action']=='none_offline_proposal_only' for p in plans);tests+=1
conflict=copy.deepcopy(answer);conflict['rules'].append({**rule,'rule_id':'F2','kind':'catalog_correction','source_option_id':None,'correction':{'make':None,'model':'CORRECT','series':None}})
valid(conflict,False)
report={'package_checks':'passed','synthetic_checks':tests,'snapshot_cases':len(cases),'first_round_questions':10,
 'selected_cases_potential_only':len(selected),'questions_bytes':manifest['stats']['first_round_input_bytes'],
 'actual_matching_not_executed':True,'actual_research_not_executed':True,'database_changed':False}
print(json.dumps(report,ensure_ascii=False))
