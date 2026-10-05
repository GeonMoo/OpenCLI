import csv
import io
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
commands = ('login', 'whoami', 'list', 'redeem', 'adjust', 'put', 'pre', 'delisted')
report = []
for command in commands:
    path = root / 'exports' / f'jisilu-{command}.csv'
    payload = path.read_bytes()
    assert payload.startswith(b'\xef\xbb\xbf'), f'{command}: missing UTF-8 BOM'
    text = payload[3:].decode('utf-8', errors='strict')
    assert '\ufeff' not in text and '\ufffd' not in text, f'{command}: duplicate BOM or replacement character'
    reader = csv.DictReader(io.StringIO(text, newline=''), strict=True)
    rows = list(reader)
    assert rows and reader.fieldnames, f'{command}: empty CSV'
    assert all(None not in row and None not in row.values() for row in rows), f'{command}: mismatched CSV columns'
    if command in ('login', 'whoami'):
        assert rows[0]['logged_in'] == 'true', f'{command}: not logged in'
        assert rows[0]['username'] and rows[0]['profileUrl'].startswith('https://www.jisilu.cn/people/')
    else:
        identity = 'stock' if command == 'pre' else 'bond'
        assert all(re.fullmatch(r'\d{6}', row[f'{identity}Code']) for row in rows), f'{command}: invalid codes'
        assert all(re.search(r'[\u3400-\u9fff]', row[f'{identity}Name']) for row in rows), f'{command}: Chinese name missing'
    # Re-serialize and parse again, including quoted commas and multiline progress/clauses.
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=reader.fieldnames)
    writer.writeheader()
    writer.writerows(rows)
    assert list(csv.DictReader(io.StringIO(output.getvalue(), newline=''), strict=True)) == rows
    report.append({'command': command, 'file': str(path.relative_to(root)), 'rows': len(rows), 'columns': len(reader.fieldnames), 'bytes': len(payload), 'encoding': 'UTF-8 BOM', 'csvRoundtrip': True, 'multilineCells': sum('\n' in value or '\r' in value for row in rows for value in row.values()), 'firstRow': rows[0]})
    print(f'{command}: PASS, {len(rows)} rows, UTF-8 BOM, CSV roundtrip')
assert (root / 'test.csv').read_bytes() == (root / 'exports' / 'jisilu-list.csv').read_bytes(), 'test.csv differs from list export'
(root / 'exports' / 'jisilu-csv-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')