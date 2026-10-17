#!/usr/bin/env python3
"""WP-OPS-A95 — the kitchen's own WhatsApp-subscriber stickers (a Publisher file) on Batch Labels.

The kitchen keeps a Publisher file of stickers for WhatsApp subscribers with their own diet
instructions (notes, protein/carb grams, meals a day, box number). Most of them are not active
subscribers in ERPNext, so the file itself is the list:

    wa_manual_stickers.py import <stickers.pub> <list.json> <first-day YYYY-MM-DD>
        read the file into a root-only list, used from that day on until the next file replaces it
    wa_manual_stickers.py merge <export.json> <list.json> <YYYY-MM-DD>
        add the list to the day's ERPNext export (wa_subscribers_export.py); a subscriber already
        in the export by phone keeps ERPNext's row and gets the sticker's notes, grams and box

No Fridays. Output lines carry counts only, never customer data.
"""
import json
import os
import re
import sys
from datetime import date, timedelta

NUMBERS_ON_EVERY_STICKER = {'65111171', '67710777', '52224939'}  # the kitchen's own lines
TEMPLATE_BOX = '8585'  # the empty sticker at the end of the file


def text_runs(data):
    """Publisher keeps the sticker text as UTF-16LE runs (Latin and Arabic)."""
    unit = rb'(?:[\x09\x0a\x0d\x20-\x7e]\x00|[\x00-\xff]\x06)'
    text = '\n'.join(m.group().decode('utf-16le') for m in re.finditer(unit + b'{6,}', data))
    return text.replace('\r\n', '\n').replace('\r', '\n')


def grab(pattern, text, flags=re.S):
    match = re.search(pattern, text, flags)
    return match.group(1).strip() if match else ''


def sheet_date(value):
    match = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', value.strip())
    if not match:
        return None
    day, month, year = (int(g) for g in match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def split_address(text):
    """'Rumaithiya blk 7 street 74 h no 32' -> area + block / street / house, the rest as direction."""
    area = re.split(r'(?i)\s*(?:,|\bblk\b|\bblock\b|\bbl\b|\bb\s*\d|\bst\b|\bstreet\b)', text, maxsplit=1)[0].strip(' ,')
    block = grab(r'(?i)\b(?:blk|block|bl|b)\s*:?\s*(\d+[a-z]?)', text, 0)
    street = grab(r'(?i)\b(?:street|st|s)\s*:?\s*(\d+[a-z]?)', text, 0)
    house = grab(r'(?i)\b(?:h\s*no|hs|house|h)\s*:?\s*([0-9][0-9a-z/-]*)', text, 0)
    return area, block, street, house


def parse(data):
    body = text_runs(data)
    body = body[body.find('Start date:'):]
    stickers = []
    for chunk in body.split('Start date:')[1:]:
        box = grab(r'BOX:\s*\n\s*(\d+)', chunk)
        mobile = next((m for m in re.findall(r'MOBILE\s*\n\s*(\d{8})', chunk) if m not in NUMBERS_ON_EVERY_STICKER), '')
        name = grab(r'NAME:\s*([^\n]*)', chunk)
        if not mobile or not name or box == TEMPLATE_BOX:
            continue
        address = grab(r'52224939\s*\n\s*([^\n]*)\n', chunk)
        area, block, street, house = split_address(address)
        plan = grab(r'MEAL PLAN:\s*\(([^)]*)\)', chunk)
        stickers.append({
            'name': name, 'mobile': mobile, 'box': box,
            'end': grab(r'End date:\s*([^\n]*)', chunk),
            'notes': re.sub(r'\s+', ' ', grab(r'NOTES:(.*?)\n\s*Protein', chunk)).strip(' -'),
            'protein': grab(r'Protein\s*(\d+)\s*g', chunk), 'carb': grab(r'Carb\s*(\d+)\s*g', chunk),
            'meals': grab(r'(\d+)\s*Meals', plan), 'snacks': grab(r'(\d+)\s*Snack', plan),
            'breakfast': grab(r'\n\s*(\d)\s*Breakfast', chunk),
            'address': address, 'area': area, 'block': block, 'street': street, 'house': house,
        })
    return stickers


def write_private(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(value, handle, ensure_ascii=False)


def number(value):
    return int(value) if str(value).isdigit() else None


def package(sticker, plan=''):
    grams = ' / '.join(part for part in (
        f"Protein {sticker['protein']}g" if sticker['protein'] else '',
        f"Carb {sticker['carb']}g" if sticker['carb'] else '') if part)
    breakfast = f"Breakfast {sticker['breakfast']}" if sticker['breakfast'] not in ('', '0') else ''
    return ' · '.join(part for part in (plan, grams, breakfast) if part)


def merge(export_path, list_path, day_text):
    day = date.fromisoformat(day_text)
    export = json.load(open(export_path))
    if not os.path.exists(list_path):
        print(json.dumps({'event': 'manual_stickers', 'delivery_date': day_text, 'list': 'none'}))
        return
    stickers = json.load(open(list_path))
    if day.weekday() == 4 or day_text < stickers['first_day']:
        print(json.dumps({'event': 'manual_stickers', 'delivery_date': day_text, 'applied': 0,
                          'reason': 'friday' if day.weekday() == 4 else 'before_first_day'}))
        return
    rows = export['rows']
    by_phone = {row['ref'][-8:]: row for row in rows}
    added = enriched = 0
    for sticker in stickers['rows']:
        extra = {
            'notes': sticker['notes'], 'box': sticker['box'],
            'meals_per_day': number(sticker['meals']), 'snacks_per_day': number(sticker['snacks']),
        }
        row = by_phone.get(sticker['mobile'])
        if row is not None:
            row.update(extra)
            row['plan'] = package(sticker, row.get('plan', ''))
            if not row.get('has_address'):
                row.update(area=sticker['area'], block=sticker['block'], street=sticker['street'],
                           house=sticker['house'], details=sticker['address'], address_text=sticker['address'],
                           has_address=bool(sticker['address']))
            enriched += 1
            continue
        end = sheet_date(sticker['end'])
        rows.append({
            'ref': sticker['mobile'], 'order_number': f"WA-{sticker['mobile']}",
            'customer_name': sticker['name'], 'customer_phone': f"+965{sticker['mobile']}",
            'area': sticker['area'], 'address_text': sticker['address'], 'plan': package(sticker),
            'block': sticker['block'], 'street': sticker['street'], 'house': sticker['house'],
            'details': sticker['address'],
            # the sheet's own end date when it is a real one still ahead; otherwise left blank
            'days_remaining': sum((day + timedelta(days=i)).weekday() != 4 for i in range((end - day).days + 1))
            if end and end >= day else None,
            'has_address': bool(sticker['address']), **extra,
        })
        added += 1
    write_private(export_path, export)
    print(json.dumps({'event': 'manual_stickers', 'delivery_date': day_text, 'added': added, 'enriched': enriched,
                      'rows': len(rows), 'list_first_day': stickers['first_day']}))


def main(argv):
    if len(argv) == 5 and argv[1] == 'import':
        date.fromisoformat(argv[4])
        stickers = parse(open(argv[2], 'rb').read())
        if not stickers:
            print(json.dumps({'event': 'manual_stickers_import', 'refused': 'no_stickers_found'}))
            return 3
        write_private(argv[3], {'first_day': argv[4], 'source_file': os.path.basename(argv[2]), 'rows': stickers})
        print(json.dumps({'event': 'manual_stickers_import', 'stickers': len(stickers), 'first_day': argv[4],
                          'without_area': sum(not s['area'] for s in stickers),
                          'without_notes': sum(not s['notes'] for s in stickers)}))
        return 0
    if len(argv) == 5 and argv[1] == 'merge':
        merge(argv[2], argv[3], argv[4])
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
