#!/usr/bin/env python3
"""A70.3 — short night status for the 01:00 label print, to it@nutreeze.com only.

Compares tomorrow's Fleetbase orders with the legacy admin screen reading the sync followed,
and reports what the sync changed to follow the screen. Read-only (Fleetbase MySQL, Nutrezee
Postgres, journal). Mail goes through the Fleetbase Laravel mailer (hello@nutreeze.com).
Order numbers only; no customer data. Usage: nutreeze-print-status.py [YYYY-MM-DD] [--no-send]
"""
import datetime
import json
import os
import subprocess
import sys
import zoneinfo

KW = zoneinfo.ZoneInfo('Asia/Kuwait')
TO = ['it@nutreeze.com']
CONFIG_ROOT = '/opt/fleetbase/api/storage/app/integrations/config'
COMPANY = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c'


def sh(cmd, inp=None):
    return subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=300).stdout


def mysql(query):
    out = sh(['docker', 'exec', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', '-e', query])
    return [line.split('\t') for line in out.splitlines() if line]


def short(numbers, limit=30):
    numbers = sorted(numbers, key=lambda n: (len(n), n))
    return ', '.join(numbers[:limit]) + (f' … (+{len(numbers) - limit})' if len(numbers) > limit else '')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    now = datetime.datetime.now(KW)
    day = args[0] if args else (now.date() + datetime.timedelta(days=1)).isoformat()
    compact = day.replace('-', '')

    screen = None
    path = os.path.join(CONFIG_ROOT, f'legacy-screen-{compact}.json')
    if os.path.exists(path):
        with open(path) as fh:
            screen = json.load(fh)
        age_min = int((now.timestamp() - os.path.getmtime(path)) / 60)

    rows = mysql(
        "select coalesce(json_unquote(json_extract(meta,'$.source_order_number')),''), status, "
        "coalesce(json_unquote(json_extract(meta,'$.partner_driver_id')),''), driver_assigned_uuid is not null, "
        "coalesce(json_unquote(json_extract(meta,'$.hold_reason')),'') from fleetbase.orders "
        f"where company_uuid='{COMPANY}' and deleted_at is null "
        f"and internal_id like 'NUTREEZE-PARTNER-DAY-{compact}-ORDER-%'")
    fb = {r[0]: {'status': r[1], 'driver': r[2], 'assigned': r[3] == '1', 'hold': r[4]} for r in rows}
    dispatched = {n for n, r in fb.items() if r['status'] == 'dispatched' and r['assigned']}

    since = now.replace(hour=0, minute=0, second=0, microsecond=0) - datetime.timedelta(hours=4)
    journal = sh(['journalctl', '-u', 'nutreeze-partner-*', '--since',
                  since.astimezone(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'),
                  '--no-pager', '-o', 'cat'])
    applied, complete_ok, fatals = None, False, []
    current = None
    for line in journal.splitlines():
        try:
            event = json.loads(line[line.index('{'):])
        except ValueError:
            continue
        if event.get('delivery_date'):
            current = event['delivery_date']
        if event.get('event') == 'legacy_screen_applied' and event.get('delivery_date') == day:
            applied = event
        if event.get('event') == 'complete' and event.get('delivery_date') == day and not event.get('dry_run'):
            complete_ok = True
        if event.get('event') == 'fatal' and current == day:
            fatals.append(event.get('error_code', '?'))

    problems = []
    lines = []
    if screen is None:
        problems.append('no legacy screen reading tonight (sync used Partner only)')
        lines.append('Legacy screen / شاشة السيستم القديم: NOT READ — Fleetbase follows Partner only')
        wrong, missing, extra, waiting = [], [], sorted(dispatched), []
    else:
        numbers = set(screen['order_numbers'])
        drivers = screen['drivers']
        waiting = sorted(n for n in numbers if n not in drivers)
        missing = sorted(n for n in numbers if n in drivers and n not in dispatched)
        wrong = sorted(n for n in numbers if n in drivers and n in dispatched and fb[n]['driver'] != drivers[n])
        extra = sorted(n for n in dispatched if n not in numbers)
        lines.append(f"Legacy screen / شاشة السيستم القديم: {len(numbers)} orders, {len(drivers)} with driver, "
                     f"{len(waiting)} without driver (read {age_min} min ago)")
        if waiting:
            problems.append(f'{len(waiting)} orders have no driver on the legacy screen')
        if missing:
            problems.append(f'{len(missing)} screen orders not dispatched in Fleetbase')
        if wrong:
            problems.append(f'{len(wrong)} orders with a different driver')
        if extra:
            problems.append(f'{len(extra)} Fleetbase orders not on the screen')
    lines.append(f'Fleetbase: {len(dispatched)} orders with a driver (of {len(fb)} rows for the day)')
    lines.append('Sync tonight / المزامنة: ' + ('completed' if complete_ok else 'NOT completed')
                 + (f" — errors: {', '.join(sorted(set(fatals)))}" if fatals else ''))
    if not complete_ok:
        problems.append('sync did not complete')

    tsv = ''.join(f'{n}\n' for n in sorted(dispatched))
    unmapped = [l for l in sh(['docker', 'exec', '-i', 'nutrezee-postgres-1', 'psql', '-U', 'nutrezee', '-d', 'nutrezee', '-Atc',
                               'create temp table f(n text); copy f from stdin; '
                               'select f.n from f where (select count(*) from customer_order c where c.order_number=f.n)<>1;'],
                              tsv).splitlines() if l and not l.startswith(('CREATE', 'COPY'))]
    lines.append(f'Label database / قاعدة الملصقات: {len(dispatched) - len(unmapped)} ready, {len(unmapped)} not yet')
    if unmapped:
        problems.append(f'{len(unmapped)} orders not yet in the label database')

    if applied:
        lines += ['', 'Changed tonight to follow the legacy screen / اتعدّل ليطابق السيستم القديم:']
        for key, label in (('drivers_changed_to_screen', 'driver changed to screen'),
                           ('on_hold_released_by_screen', 'on hold in Partner, on screen → delivered'),
                           ('cancel_released_by_screen', 'cancelled in Partner, on screen → delivered'),
                           ('partner_only_held', 'in Partner, not on screen → held'),
                           ('screen_only_not_in_partner', 'on screen, not in Partner → cannot create')):
            if applied.get(key):
                lines.append(f'  {label}: {short(applied[key])}')
        if applied.get('screen_only_not_in_partner'):
            problems.append(f"{len(applied['screen_only_not_in_partner'])} screen orders missing from Partner")
    for title, numbers in (('No driver on screen yet', waiting), ('Not dispatched', missing),
                           ('Different driver', wrong), ('Not on screen', extra), ('Not in label DB', unmapped)):
        if numbers:
            lines.append(f'{title}: {short(numbers)}')

    matches = screen is not None and not (missing or wrong or extra)
    ok = matches and complete_ok and not unmapped
    if screen is not None:
        head = (f"Fleetbase {'matches' if matches else 'differs from'} legacy screen — "
                f"{len(screen['order_numbers'])} orders ({len(dispatched)} with driver, {len(waiting)} no driver yet)")
    else:
        head = f'no legacy screen reading — {len(dispatched)} orders with driver'
    extras = [p for p in problems if 'no driver on the legacy screen' not in p]
    subject = f"[{'OK' if ok else 'CHECK'}] Labels {day}: {head}" + (f"; {'; '.join(extras)}" if extras else '')
    note = os.environ.get('PRINT_STATUS_NOTE')
    if note:
        lines = [note, ''] + lines
    body = '\n'.join(lines) + '\n'
    with open('/root/a70/last-print-status.txt', 'w') as fh:
        fh.write(subject + '\n\n' + body)
    print(subject)
    print(body)
    if '--no-send' in sys.argv:
        return 0
    for name, content in (('/tmp/a70-body.txt', body), ('/tmp/a70-subject.txt', subject)):
        subprocess.run(['docker', 'exec', '-i', 'fleetbase-application-1', 'sh', '-c', f'cat > {name}'],
                       input=content, text=True, check=True)
    php = ("$b = file_get_contents('/tmp/a70-body.txt'); $s = file_get_contents('/tmp/a70-subject.txt');"
           "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(TO) + ")->subject($s); });"
           "echo 'MAIL_SENT', PHP_EOL;")
    res = sh(['docker', 'exec', 'fleetbase-application-1', 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php])
    sh(['docker', 'exec', 'fleetbase-application-1', 'rm', '-f', '/tmp/a70-body.txt', '/tmp/a70-subject.txt'])
    print('mail:', 'sent' if 'MAIL_SENT' in res else res[-300:])
    return 0


if __name__ == '__main__':
    sys.exit(main())
