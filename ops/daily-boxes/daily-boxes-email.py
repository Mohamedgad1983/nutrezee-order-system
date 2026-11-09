#!/usr/bin/env python3
"""A103 — daily 09:00 Kuwait email: Excel of the boxes whose labels were printed last night.

Owner 2026-11-09: every day at 9 AM send Ahmad Ibrahim (ahmad@) and a.mahran@ an Excel sheet with the
number of boxes actually printed. Labels are printed at 01:00 for the NEXT delivery day (A70), so at
09:00 on day X the printed set is delivery day X+1: the Fleet-Ops (Fleetbase) orders of that day that
are not cancelled — app (Partner) orders + WhatsApp subscribers. That is exactly what Batch Labels
offered and the 00:45 print check matched against the legacy screen.

Read-only. Order numbers, areas and drivers only — no customer phones or addresses in the sheet.
Usage: daily-boxes-email.py [YYYY-MM-DD] [--send] [--to a@x,b@y]
A run by hand never emails unless --send; the systemd unit passes --send.
"""
import datetime
import io
import json
import os
import subprocess
import sys
import zipfile
import zoneinfo
from collections import Counter, defaultdict
from xml.sax.saxutils import escape

KW = zoneinfo.ZoneInfo('Asia/Kuwait')
TO = ['ahmad@nutreeze.com', 'a.mahran@nutreeze.com']
DB_CONTAINER = 'fleetbase-database-1'
MAIL_CONTAINER = 'fleetbase-application-1'
OUT_DIR = '/var/log/nutrezee/daily-boxes'


def mysql(query):
    res = subprocess.run(['docker', 'exec', '-e', f'Q={query}', DB_CONTAINER, 'sh', '-c',
                          'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" fleetbase -N -B --default-character-set=utf8mb4 -e "$Q"'],
                         capture_output=True, text=True, timeout=120)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip()[-300:])
    return [line.split('\t') for line in res.stdout.splitlines() if line]


def orders(day):
    key = day.replace('-', '')
    rows = mysql(f"""
        SELECT IF(o.internal_id LIKE 'NUTREEZE-WA-%', 'WhatsApp', 'App'),
               COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.meta, '$.source_order_number')), o.internal_id),
               COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.meta, '$.area_en')), 'null'), ''),
               COALESCE(u.name, NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.meta, '$.partner_driver_name')), 'null'), ''),
               COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.meta, '$.meal_item_count')), 'null'), ''),
               COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(o.meta, '$.label_user_id')), 'null'), ''),
               o.status
          FROM orders o
          LEFT JOIN drivers d ON d.uuid = o.driver_assigned_uuid
          LEFT JOIN users u ON u.uuid = d.user_uuid
         WHERE (o.internal_id LIKE 'NUTREEZE-PARTNER-DAY-{key}-ORDER-%' OR o.internal_id LIKE 'NUTREEZE-WA-DAY-{key}-ORDER-%')
           AND o.deleted_at IS NULL AND o.status NOT LIKE '%cancel%'""")
    out = []
    for source, number, area, driver, meals, box, status in rows:
        out.append({'source': source, 'order': number.replace('NUTREEZE-WA-DAY-' + key + '-ORDER-', 'WA-'),
                    'area': (area or '(no area)').strip().title(), 'driver': driver.strip() or '(no driver)',
                    'meals': int(meals) if meals.isdigit() else None, 'kitchen': bool(box), 'status': status})
    return out


def xlsx(sheets):
    """Small multi-sheet .xlsx with the standard library only (numbers stay numbers)."""
    def cell(v, bold=False):
        style = ' s="1"' if bold else ''
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return f'<c{style}><v>{v}</v></c>'
        return f'<c t="inlineStr"{style}><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'

    def sheet_xml(rows, widths):
        cols = ''.join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths, 1))
        body = ''.join('<row>' + ''.join(cell(v, bold=(r == 0 or (row and str(row[0]).startswith('Total'))))
                                          for v in row) + '</row>' for r, row in enumerate(rows))
        return ('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                f'<cols>{cols}</cols><sheetData>{body}</sheetData></worksheet>')

    ns = 'http://schemas.openxmlformats.org'
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="' + ns + '/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                  for i in range(1, len(sheets) + 1)) + '</Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="' + ns + '/package/2006/relationships">'
        '<Relationship Id="rId1" Type="' + ns + '/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="' + ns + '/spreadsheetml/2006/main" xmlns:r="' + ns + '/officeDocument/2006/relationships"><sheets>'
        + ''.join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, (name, _, _) in enumerate(sheets, 1)) + '</sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="' + ns + '/package/2006/relationships">'
        + ''.join(f'<Relationship Id="rId{i}" Type="{ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                  for i in range(1, len(sheets) + 1))
        + f'<Relationship Id="rId{len(sheets) + 1}" Type="{ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="' + ns + '/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
    }
    for i, (_, rows, widths) in enumerate(sheets, 1):
        files[f'xl/worksheets/sheet{i}.xml'] = sheet_xml(rows, widths)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def build(day, rows):
    app = [r for r in rows if r['source'] == 'App']
    wa = [r for r in rows if r['source'] == 'WhatsApp']
    kitchen = sum(r['kitchen'] for r in wa)
    weekday = datetime.date.fromisoformat(day).strftime('%A')
    summary = [
        ['Item / البند', 'Boxes / بوكسات'],
        ['Delivery day / يوم التوصيل', f'{day} ({weekday})'],
        ['App orders / طلبات التطبيق', len(app)],
        ['WhatsApp subscribers / مشتركين الواتساب', len(wa)],
        ['  of which kitchen stickers / منهم ستيكرات المطبخ', kitchen],
        ['Total printed / إجمالي المطبوع', len(rows)],
        ['App meals / وجبات التطبيق', sum(r['meals'] or 0 for r in app)],
        [],
        ['Source: Fleet-Ops orders of the day that are not cancelled, read at 09:00 Kuwait (labels printed at 01:00).'],
    ]
    by_area = defaultdict(Counter)
    for r in rows:
        by_area[r['area']][r['source']] += 1
    area_rows = [['Area / المنطقة', 'App / التطبيق', 'WhatsApp / واتساب', 'Total / الإجمالي']]
    for area, c in sorted(by_area.items(), key=lambda kv: (-sum(kv[1].values()), kv[0])):
        area_rows.append([area, c['App'], c['WhatsApp'], c['App'] + c['WhatsApp']])
    area_rows.append(['Total / الإجمالي', len(app), len(wa), len(rows)])
    by_driver = defaultdict(lambda: [Counter(), set()])
    for r in rows:
        by_driver[r['driver']][0][r['source']] += 1
        by_driver[r['driver']][1].add(r['area'])
    driver_rows = [['Driver / السواق', 'App / التطبيق', 'WhatsApp / واتساب', 'Total / الإجمالي', 'Areas / المناطق']]
    for driver, (c, areas) in sorted(by_driver.items(), key=lambda kv: (-sum(kv[1][0].values()), kv[0])):
        driver_rows.append([driver, c['App'], c['WhatsApp'], c['App'] + c['WhatsApp'], ', '.join(sorted(areas))])
    driver_rows.append(['Total / الإجمالي', len(app), len(wa), len(rows), ''])
    order_rows = [['Order / الطلب', 'Source / المصدر', 'Area / المنطقة', 'Driver / السواق', 'Meals / وجبات', 'Kitchen sticker / ستيكر مطبخ']]
    for r in sorted(rows, key=lambda r: (r['driver'], r['area'], r['order'])):
        order_rows.append([r['order'], r['source'], r['area'], r['driver'], r['meals'] if r['meals'] is not None else '', 'Yes' if r['kitchen'] else ''])
    return xlsx([('Summary', summary, [48, 26]), ('By area', area_rows, [30, 14, 16, 14]),
                 ('By driver', driver_rows, [30, 14, 16, 14, 60]), ('Orders', order_rows, [16, 12, 26, 28, 10, 16])]), len(app), len(wa), kitchen


def mail(subject, body, name, data, to):
    tmp = {'/tmp/nzbox-body.txt': body.encode(), '/tmp/nzbox-subject.txt': subject.encode(), f'/tmp/{name}': data}
    try:
        for path, content in tmp.items():
            subprocess.run(['docker', 'exec', '-i', MAIL_CONTAINER, 'sh', '-c', f'cat > {path}'], input=content, check=True, timeout=60)
        php = ("$b = file_get_contents('/tmp/nzbox-body.txt'); $s = file_get_contents('/tmp/nzbox-subject.txt');"
               "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(to) + ")->subject($s)"
               "->attach('/tmp/" + name + "', ['as' => '" + name + "', 'mime' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']); });"
               "echo 'MAIL_SENT', PHP_EOL;")
        res = subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php],
                             capture_output=True, text=True, timeout=180).stdout
        return 'MAIL_SENT' in res
    finally:
        subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'rm', '-f', *tmp.keys()], capture_output=True, timeout=60)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    to = TO
    if '--to' in sys.argv:
        to = sys.argv[sys.argv.index('--to') + 1].split(',')
        args = [a for a in args if a != sys.argv[sys.argv.index('--to') + 1]]
    now = datetime.datetime.now(KW)
    day = args[0] if args else (now.date() + datetime.timedelta(days=1)).isoformat()
    rows = orders(day)
    stamp = {'event': 'daily_boxes', 'delivery_date': day, 'at': now.isoformat(timespec='seconds')}
    if not rows:
        # Friday (no delivery) or nothing printed: no empty email.
        print(json.dumps({**stamp, 'total': 0, 'mail': 'skipped (no printed boxes)'}))
        return 0
    data, n_app, n_wa, kitchen = build(day, rows)
    os.makedirs(OUT_DIR, exist_ok=True)
    name = f'boxes-printed-{day}.xlsx'
    with open(os.path.join(OUT_DIR, name), 'wb') as fh:
        fh.write(data)
    weekday = datetime.date.fromisoformat(day).strftime('%A')
    subject = f'Boxes printed for {weekday} {day}: {len(rows)} / البوكسات المطبوعة'
    body = (f'Boxes printed last night for delivery on {weekday} {day}:\n'
            f'  App orders: {n_app}\n  WhatsApp subscribers: {n_wa} (kitchen stickers {kitchen})\n  Total: {len(rows)}\n\n'
            f'البوكسات اللي اتطبعت امبارح بالليل لتوصيل يوم {day}:\n'
            f'  التطبيق: {n_app}\n  الواتساب: {n_wa} (منهم ستيكرات المطبخ {kitchen})\n  الإجمالي: {len(rows)}\n\n'
            'Details by area, by driver and per order in the attached sheet. / التفاصيل بالمنطقة والسواق والطلب في الشيت المرفق.\n')
    sent = 'skipped (manual run; add --send to email)'
    if '--send' in sys.argv:
        sent = 'sent' if mail(subject, body, name, data, to) else 'FAILED'
    print(json.dumps({**stamp, 'app': n_app, 'whatsapp': n_wa, 'kitchen': kitchen, 'total': len(rows), 'to': to, 'mail': sent}))
    return 0 if sent != 'FAILED' else 1


if __name__ == '__main__':
    sys.exit(main())
