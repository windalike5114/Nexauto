"""Mechanical package checks only: no research, evidence lookup or DB writes."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path

root = Path('outputs/brake-agent-v2-20261024/NexAuto_Brake_Agent_V2')
load = lambda p: json.loads(p.read_text(encoding='utf-8'))
m = load(root/'manifest.json')
old = load(Path('outputs/brake-pad-ai-batch-20261024/prepared.json'))
old_ids = {r['review_id'] for r in old['mapping']}
all_ids = []
for b in m['batches']:
    file = root/b['input_file']
    raw = file.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == b['input_sha256']
    data = json.loads(raw)
    limits = m['stats'][b['queue']]
    assert len(raw) <= limits['max_bytes']
    assert len(data['tasks']) <= limits['max_tasks']
    assert len(data['targets']) <= limits['max_cases']
    assert data['batch_fingerprint'] == b['batch_fingerprint']
    assert len(data['targets']) == b['cases']
    all_ids.extend(data['targets'])
    assert set(r for t in data['tasks'] for r in t['review_ids']) == set(data['targets'])
    comparisons = load(root/data['comparison_file'])['comparisons']
    assert set(comparisons) == set(data['targets'])
    for r in data['targets'].values():
        assert r['config_id'] in data['configs']
        assert 'current_db' not in r and 'current_sku' not in r
        assert set(str(i) for ids in r['source_links'].values() for i in ids) <= set(data['source_rows'])
    assert 'original_notes' not in raw.decode() and 'historical_candidates' not in raw.decode()
assert len(all_ids) == len(set(all_ids)) == 5541
assert set(all_ids) == old_ids
assert not list((root/'results').rglob('*.json'))

# Synthetic local fixtures test the validator, not vehicle data or evidence truth.
spec = importlib.util.spec_from_file_location('validator', root/'validate_result.py')
v = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v)
batch = {'schema_version': 'nexauto-brake-agent-v2', 'batch_id': 'fixture',
         'batch_fingerprint': 'a'*64, 'targets': {'test': {'position':'front', 'years':[2010], 'config_id':'cfg'}},
         'configs': {'cfg': {'make':'Test','model':'Fixture','series':'X','body':None,'drive':None}}}
comp = {'comparisons': {'test': {'current_db':'DB123'}}}
schema = load(root/'result.schema.json')
result = {k:batch[k] for k in ('schema_version','batch_id','batch_fingerprint')}
result.update(reviewer={'agent':'synthetic_unit_test','reviewed_at':'2026-10-24T00:00:00Z'}, evidence=[], findings=[], results=[
    {'review_id':'test','finding_ids':[],'identity_status':'unresolved','fitment_status':'unresolved',
     'decision':'unable_to_determine','confirmed_db':None,'covered_years':[], 'unresolved_years':[2010],
     'conditions':[],'proposed_vehicle':None,'confidence':'unknown','reason':'Synthetic test only',
     'unresolved_questions':['Unverified fixture']}])
assert not v.validate(result,batch,comp,schema)
invalid = copy.deepcopy(result);invalid['results'] = []
assert v.validate(invalid,batch,comp,schema)
invalid = copy.deepcopy(result);invalid['results'][0]['unresolved_years'] = []
assert v.validate(invalid,batch,comp,schema)
result['evidence'] = [{'evidence_id':'E1','url':'https://example.test/fixture','publisher':'Synthetic',
    'title':'Synthetic fixture','source_type':'other','locator':'test','accessed_at':'2026-10-24T00:00:00Z',
    'supports_claim':'Synthetic validator test; not actual evidence'}]
result['findings'] = [{'finding_id':'F1','kind':'fitment','review_ids':['test'],
    'vehicle':batch['configs']['cfg'], 'position':'front','years':[2010],'engine_codes':[], 'db':'DB123',
    'conditions':[], 'evidence_ids':['E1'],'summary':'Synthetic fixture'}]
r = result['results'][0]
r.update(finding_ids=['F1'],identity_status='confirmed_as_is', fitment_status='supported', decision='keep_current',
         confirmed_db='DB123',covered_years=[2010],unresolved_years=[],confidence='high',unresolved_questions=[])
assert not v.validate(result,batch,comp,schema)
invalid = copy.deepcopy(result);invalid['results'][0]['decision']='replace_db'
assert v.validate(invalid,batch,comp,schema)
invalid = copy.deepcopy(result);invalid['findings'][0]['evidence_ids']=['missing']
assert v.validate(invalid,batch,comp,schema)
invalid = copy.deepcopy(result);invalid['findings'][0]['position']='rear'
assert v.validate(invalid,batch,comp,schema)
invalid = copy.deepcopy(result);invalid['findings'][0]['vehicle']['drive']='4WD'
invalid['results'][0]['covered_years']=[2010,2011]
assert v.validate(invalid,batch,comp,schema)
assert v.check_schema(load(root/'reference'/f"{m['batches'][0]['batch_id']}.blank_result.json"),schema,schema)
print(json.dumps({'package_checks':'passed','cases':len(all_ids),'batches':len(m['batches']),
                  'validator_synthetic_tests':9,'research_executed':False,'database_changed':False}))
