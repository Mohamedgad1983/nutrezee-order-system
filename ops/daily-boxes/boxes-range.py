#!/usr/bin/env python3
"""A103/A105: boxes for several delivery days in ONE sheet; --around = Monday/Thursday report (3 days before to 3 days after), --active-only = no cancelled boxes."""
import datetime
import importlib.util
import json
import os
import sys

spec = importlib.util.spec_from_file_location('boxes', '/opt/nutrezee/daily-boxes/daily-boxes-email.py')
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

if sys.argv[1] == '--around':
    # A105 (owner 2026-11-10): Monday/Thursday email = 3 days before the send day, the day itself, 3 days after.
    _t = datetime.datetime.now(B.KW).date()
    FIRST, LAST = (_t - datetime.timedelta(days=3)).isoformat(), (_t + datetime.timedelta(days=3)).isoformat()
else:
    FIRST, LAST = sys.argv[1], sys.argv[2]
ACTIVE = '--active-only' in sys.argv
now = datetime.datetime.now(B.KW)
overview = [['Delivery day', 'Subscription boxes', 'WhatsApp boxes', 'Total printed',
             'Cancelled after printing', 'Salad dishes', 'Fruit dishes', 'Status']]
day_sheets, not_printed, totals = [], [], [0] * 6
d = datetime.date.fromisoformat(FIRST)
while d <= datetime.date.fromisoformat(LAST):
    day = d.isoformat()
    label = d.strftime('%a %d %b')
    d += datetime.timedelta(days=1)
    every = B.orders(day)
    rows = [r for r in every if not r['cancelled']]
    if not rows:
        overview.append([label, 0, 0, 0, 0, 0, 0, 'No delivery (Friday)'])
        continue
    removed = [r for r in every if r['cancelled'] and r['changed'] >= B.print_time(day)]
    if ACTIVE:
        removed = []  # owner 2026-11-10: no non-active boxes in this report
    salads, fruits = B.dishes(day, {r['order'] for r in rows + removed if r['source'] == 'App'})
    printed = B.printed_at_night(day) or (
        sum(r['source'] == 'App' for r in rows + removed), sum(r['source'] == 'WhatsApp' for r in rows + removed), B.print_time(day))
    p_app, p_wa, p_at = printed
    if ACTIVE:
        p_app, p_wa = sum(r['source'] == 'App' for r in rows), sum(r['source'] == 'WhatsApp' for r in rows)
    done = now.strftime('%Y-%m-%d %H:%M') >= B.print_time(day)
    if ACTIVE:
        status = 'Active boxes' if done else 'NOT printed yet: active bookings so far (may change)'
    else:
        status = f'Printed {p_at} Kuwait' if done else f'NOT printed yet (prints {B.print_time(day)} Kuwait); figures from the check at {p_at}'
    if not done:
        not_printed.append((label, p_app, p_wa, p_at, day))
    vals = [p_app, p_wa, p_app + p_wa, len(removed), sum(salads.values()), sum(fruits.values())]
    totals = [a + b for a, b in zip(totals, vals)]
    overview.append([label] + vals + [status])
    sheet = [['Item', 'Count'], ['Delivery day', f'{day} ({label[:3]})'], ['Status', status],
             ['Subscription boxes (app)', p_app], ['WhatsApp boxes', p_wa], ['Total printed', p_app + p_wa],
             ['Cancelled after printing (pull these labels)', len(removed)], [],
             ['Salad dish', 'Count']] + [[n, c] for n, c in salads.most_common()] + [['Total salad dishes', sum(salads.values())], [],
             ['Fruit dish', 'Count']] + [[n, c] for n, c in fruits.most_common()] + [['Total fruit dishes', sum(fruits.values())], []]
    sheet += [['Pull these labels: order', 'Source', 'Driver', 'Cancelled at (Kuwait)']] + [
        [r['order'], r['source'], r['driver'], r['changed']] for r in sorted(removed, key=lambda r: (r['driver'], r['order']))]
    day_sheets.append((label, sheet, [48, 14, 28, 22]))
overview += [['Total'] + totals + [''], [],
             ['Printed = labels on Batch Labels at the last print check of the night (01:00 print).'],
             ['Cancelled after printing = cancelled after the 01:00 print; labels exist and must be removed (counted in Total printed).'],
             ['Dishes = Partner order items of the printed subscription boxes; WhatsApp boxes have no dish list.']]
if ACTIVE:
    overview = [r[:4] + r[5:] if len(r) >= 8 else r for r in overview if not (len(r) == 1 and 'ancelled' in r[0])]
    overview[0][3] = 'Total boxes'
    overview = [r for r in overview if not (len(r) == 1 and r[0].startswith('Printed ='))]
    overview.append(['Boxes = active orders of the day (subscription app + WhatsApp); cancelled / non-active boxes are not counted.'])
    for _, sh, _ in day_sheets:
        cut = next((i for i, r in enumerate(sh) if r and str(r[0]).startswith('Pull these labels')), len(sh))
        del sh[cut:]
        sh[:] = [r for r in sh if not (r and str(r[0]).startswith('Cancelled after printing'))]
        for r in sh:
            if r and r[0] == 'Total printed':
                r[0] = 'Total boxes'
data = B.xlsx([('Overview', overview, [16, 18, 15, 13, 22, 13, 12, 70])] + day_sheets)
name = f'boxes-printed-{FIRST}-to-{LAST}.xlsx'
with open(os.path.join(B.OUT_DIR, name), 'wb') as fh:
    fh.write(data)

def nice(day):
    return datetime.date.fromisoformat(day).strftime('%A %d/%m')

first_lbl = datetime.date.fromisoformat(FIRST).strftime('%d %B')
last_lbl = datetime.date.fromisoformat(LAST).strftime('%d %B %Y')
lines = []
for row in overview[1:]:
    if not row or row[0] == 'Total' or len(row) < 7:
        continue
    r = row if len(row) == 8 else row[:4] + [0] + row[4:]
    if r[3] == 0:
        lines.append(f'- {r[0]}: no delivery')
    else:
        star = ' *' if r[7].startswith('NOT') else ''
        mid = '' if ACTIVE else f'{r[4]} cancelled after printing, '
        lines.append(f'- {r[0]}: {r[3]} boxes ({r[1]} subscription, {r[2]} WhatsApp), '
                     f'{mid}{r[5]} salad, {r[6]} fruit{star}')
note = ''
if ACTIVE and not_printed:
    note = ('\n* Not printed yet: ' + ', '.join(nice(x[4]) for x in not_printed)
            + '. These are the active bookings so far and may change; each day is printed at 1:00 AM the night before.\n')
for label, a, w, at, day in ([] if ACTIVE else not_printed):
    note += (f'\n* {nice(day)} has not been printed yet. It will be printed tomorrow night at 1:00 AM. '
             f'These figures come from today\'s check at {str(at)[11:16]} and may change. '
             f'The final figure will be in tomorrow\'s 9:00 AM email.\n')
subject = f'Box Report – {first_lbl} to {last_lbl}'
body = ('Good morning,\n\n' +
        ('Please find attached the active boxes (subscription and WhatsApp) for delivery from' if ACTIVE else 'Please find attached the boxes printed for delivery from') + f' {first_lbl} to {last_lbl} (all days in one file):\n\n'
        + '\n'.join(lines) + '\n' + note +
        '\nThe details for each day are in the attached sheet.\n\nKind regards,\nNutreeze Operations\n')
to = B.TO
if '--to' in sys.argv:
    to = sys.argv[sys.argv.index('--to') + 1].split(',')
print(subject); print(body)
sent = 'not sent (add --send)'
if '--send' in sys.argv:
    sent = 'sent' if B.mail(subject, body, name, data, to) else 'FAILED'
print(json.dumps({'file': name, 'to': to, 'mail': sent}))
