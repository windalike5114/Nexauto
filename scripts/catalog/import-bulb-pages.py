"""Import the supplied bulb catalogue and images; never creates vehicle fitments."""
import argparse
import csv
import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--csv', type=Path, required=True)
parser.add_argument('--images', type=Path, required=True)
parser.add_argument('--workbook', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
with args.csv.open(encoding='utf-8-sig', newline='') as stream:
    source = list(csv.DictReader(stream))
catalog = []
seen = set()
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(args.workbook) as workbook:
    strings = []
    if 'xl/sharedStrings.xml' in workbook.namelist():
        strings = [''.join(t.text or '' for t in item.findall('.//m:t', ns))
                   for item in ET.fromstring(workbook.read('xl/sharedStrings.xml')).findall('m:si', ns)]
    workbook_rows = {}
    for row in ET.fromstring(workbook.read('xl/worksheets/sheet1.xml')).findall('m:sheetData/m:row', ns)[1:]:
        fields = {}
        for cell in row.findall('m:c', ns):
            value = cell.find('m:v', ns)
            text = value.text if value is not None else ''
            if cell.get('t') == 's':
                text = strings[int(text)] if text else ''
            elif cell.get('t') == 'inlineStr':
                text = ''.join(t.text or '' for t in cell.findall('.//m:t', ns))
            fields[re.sub(r'\d', '', cell.get('r'))] = text or ''
        workbook_rows[fields.get('A')] = fields
with zipfile.ZipFile(args.images) as archive:
    for row in source:
        sku = row['nbl_sku'].strip()
        if not re.fullmatch(r'NBL\d{4}', sku) or sku in seen:
            raise ValueError(f'Invalid or duplicate SKU: {sku}')
        seen.add(sku)
        workbook_row = workbook_rows.get(sku)
        if not workbook_row or any(workbook_row.get(column, '') != row[key] for column, key in
                                   [('C', 'title'), ('D', 'subtitle'), ('E', 'supplier_sku'), ('AH', 'key_features')]):
            raise ValueError(f'Workbook and CSV disagree for {sku}')
        images = sorted((name for name in archive.namelist()
                         if re.fullmatch(rf'topstar/{sku}-\d+\.jpg', name)),
                        key=lambda name: int(re.search(r'-(\d+)\.jpg$', name)[1]))
        if not images:
            raise ValueError(f'Missing images: {sku}')
        price = float(row['price'])
        if price <= 0:
            raise ValueError(f'Invalid price: {sku}')
        features = [value.strip() for value in row['key_features'].split('||') if value.strip()]
        if sku == 'NBL5003':
            row['watt'] = '42W'
            features = [value.replace('32W', '42W') for value in features]
        specs = [(label, row.get(key, '').strip()) for label, key in [
            ('Bulb model', 'model'), ('Technology', 'tech'), ('Voltage', 'volt'),
            ('Power', 'watt'), ('Colour temperature', 'kelvin'), ('Emitted colour', 'color'),
            ('Luminous flux', 'flux'), ('Socket / base', 'base'),
            ('Part references', 'ref'), ('Cross references', 'cross'), ('Application', 'subtitle')]]
        specs += [(label, workbook_row.get(column, '').strip()) for label, column in [
            ('Glass finish', 'N'), ('Beam function', 'O'), ('Installation type', 'P'),
            ('Base pin configuration', 'Q'), ('Bottom contact points', 'R'),
            ('Base contact type', 'S'), ('Dimensions', 'T'), ('Dual beam application', 'X')]]
        catalog.append({
            'sku': sku, 'supplierRef': row['supplier_sku'], 'title': row['title'],
            'subtitle': row['subtitle'], 'priceNzd': price,
            'features': features,
            'specifications': [{'label': label, 'value': value} for label, value in specs if value],
            'images': [f'/products/bulbs/catalog/{Path(name).name}' for name in images],
            'sourceImageUrl': row['image'], 'sourceUrl': row['url'],
            'packLabel': 'Pair (2 bulbs)' if re.search(r'\bpair\b', row['title'], re.I)
                         else '1 bulb' if re.search(r'\b1x\s+Globe\b', row['title'], re.I) else None,
            'orderingEnabled': True, 'inventoryQuantity': None,
            'vehicleFitmentStatus': 'not_available',
        })
    # Validate the complete catalogue before writing any assets.
    dest = root / 'public/products/bulbs/catalog'
    dest.mkdir(parents=True, exist_ok=True)
    for product in catalog:
        for image in product['images']:
            name = Path(image).name
            (dest / name).write_bytes(archive.read(f'topstar/{name}'))
target = root / 'data/bulbs/catalog.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'products': len(catalog), 'images': sum(len(p['images']) for p in catalog),
                  'vehicle_fitments_created': 0, 'inventory_quantity': None}))
