import csv, hashlib, json, pathlib, re

root = pathlib.Path('outputs/filter-year-expansion-20261025')
book = json.loads(pathlib.Path('outputs/oilfilter-workbook-assessment-20261025/source.json').read_text(encoding='utf-8'))
original = pathlib.Path(book['file'])
assert hashlib.sha256(original.read_bytes()).hexdigest() == book['sha256'], 'Workbook changed; extract again'
detail = next(s['rows'] for s in book['sheets'] if s['sheet'] == '适配明细')
norm = lambda x: re.sub(r'\s+', ' ', str(x or '')).strip().replace('–', '-').replace('—', '-')
key = lambda part, ref, raw: (re.sub('[^A-Z0-9]', '', str(part).upper()), str(ref).strip().upper(), norm(raw))
addresses = {}
for number, row in enumerate(detail[1:], 2):
    addresses.setdefault(key(row[0], row[1], row[10]), []).append(number)
clean_file = pathlib.Path('C:/Users/Sanli/repco_nexauto/clean/data/filter_crossref_clean.csv')
rows = []
with clean_file.open(encoding='utf-8-sig', newline='') as stream:
    for number, row in enumerate(list(csv.reader(stream))[1:], 2):
        source_rows = addresses.get(key(row[0], row[1], row[11]), [])
        if not source_rows:
            continue
        rows.append(dict(zip(['supplier', 'reference', 'make', 'model', 'series', 'body', 'engine_codes', 'displacement', 'drive', 'year_from', 'year_to', 'raw'], row), cleaned_row=number, workbook_rows=source_rows))
result = {'file': str(original), 'sha256': book['sha256'], 'sheet': '适配明细', 'source_date': '2026-10-09', 'cleaned_file': str(clean_file), 'cleaned_sha256': hashlib.sha256(clean_file.read_bytes()).hexdigest(), 'rows': rows}
(root / 'secondary-source.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
print(json.dumps({'traceable_secondary_rows': len(rows), 'distinct_original_rows': len(set(n for r in rows for n in r['workbook_rows']))}))
