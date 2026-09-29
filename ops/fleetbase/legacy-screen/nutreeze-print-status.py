#!/usr/bin/env python3
"""A70.6 — zero-difference guard for the 01:00 label print (owner: "نسبة الخطأ تكون zero").

Checks, with the Batch Labels page's own code, that the labels the page will offer for tomorrow are
exactly the orders on the legacy admin screen (order by order), and that every order has the
screen's driver in Fleetbase. On any difference it repairs automatically and checks again:
  - Fleetbase differs from the screen  → read the screen again and re-sync that day to it;
  - an order has no label record yet   → run the Partner label feed for that day.
Then one short email to it@nutreeze.com (Fleetbase Laravel mailer, hello@nutreeze.com).
Order numbers only; no customer data.
Usage: nutreeze-print-status.py [YYYY-MM-DD] [--no-send] [--no-fix]
"""
import datetime
import json
import os
import subprocess
import sys
import time
import zoneinfo

KW = zoneinfo.ZoneInfo('Asia/Kuwait')
TO = ['it@nutreeze.com']
INTEGRATION = '/opt/fleetbase/integrations/nutreeze-orders'
CONFIG_ROOT = '/opt/fleetbase/api/storage/app/integrations/config'
CONTAINER_CONFIG_ROOT = '/fleetbase/api/storage/app/integrations/config'
COMPANY = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c'
FIX_ROUNDS = 2


def sh(cmd, inp=None, timeout=300, env=None):
    return subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, **(env or {})}).stdout


def mysql(query):
    out = sh(['docker', 'exec', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', '--raw', '-e', query])
    return [line.split('\t') for line in out.splitlines() if line]


def short(numbers, limit=30):
    numbers = sorted(numbers, key=lambda n: (len(n), n))
    return ', '.join(numbers[:limit]) + (f' … (+{len(numbers) - limit})' if len(numbers) > limit else '')


def load_screen(day):
    path = os.path.join(CONFIG_ROOT, f"legacy-screen-{day.replace('-', '')}.json")
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        screen = json.load(fh)
    screen['_age_min'] = int((time.time() - os.path.getmtime(path)) / 60)
    return screen


def fleetbase_state(day):
    rows = mysql(
        "select coalesce(json_unquote(json_extract(meta,'$.source_order_number')),''), status, "
        "coalesce(json_unquote(json_extract(meta,'$.partner_driver_id')),''), driver_assigned_uuid is not null "
        f"from fleetbase.orders where company_uuid='{COMPANY}' and deleted_at is null "
        f"and internal_id like 'NUTREEZE-PARTNER-DAY-{day.replace('-', '')}-ORDER-%'")
    return {r[0]: {'status': r[1], 'driver': r[2], 'assigned': r[3] == '1'} for r in rows}


def batch_labels(day):
    """What the Batch Labels page offers for the day, computed with its compiled code in nutrezee-api."""
    query = ('select json_object("id",public_id,"internal_id",internal_id,"status",status,'
             '"scheduled_at",if(scheduled_at is null,null,date_format(scheduled_at,"%Y-%m-%dT%H:%i:%sZ")),"meta",meta) '
             f'from fleetbase.orders where company_uuid="{COMPANY}" and deleted_at is null '
             'and scheduled_at >= date_sub("DAY", interval 1 day) and scheduled_at < date_add("DAY", interval 1 day)'
             ).replace('DAY', day)
    out = sh(['docker', 'exec', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', '--raw', '-e', query])
    rows = []
    for line in out.splitlines():
        if line:
            row = json.loads(line)
            if isinstance(row.get('meta'), str):
                row['meta'] = json.loads(row['meta'])
            rows.append(row)
    sh(['docker', 'cp', f'{INTEGRATION}/batch-labels-count.js', 'nutrezee-api-1:/tmp/batch-labels-count.js'])
    res = sh(['docker', 'exec', '-i', 'nutrezee-api-1', 'node', '/tmp/batch-labels-count.js', day], json.dumps(rows))
    try:
        return json.loads(res)
    except ValueError:
        return {'error': 'batch_labels_check_failed'}


def evaluate(day, screen):
    fb = fleetbase_state(day)
    page = batch_labels(day)
    d = {'fb': fb, 'page': page}
    if screen is None or 'error' in page:
        d['diff'] = None
        return d
    numbers = set(screen['order_numbers'])
    drivers = screen['drivers']
    labels = set(page['label_numbers'])
    d['no_label'] = sorted(numbers - labels)                     # on the screen, no label on the page
    d['extra_label'] = sorted(labels - numbers)                  # label on the page, not on the screen
    d['wrong_driver'] = sorted(n for n in numbers & labels if n in drivers and fb.get(n, {}).get('driver') != drivers[n])
    d['not_in_label_db'] = sorted(set(page['unmapped']) & numbers)
    d['no_driver_in_legacy'] = sorted(n for n in numbers if n not in drivers)
    d['diff'] = len(d['no_label']) + len(d['extra_label']) + len(d['wrong_driver'])
    return d


def wait_for_scheduled_sync(limit_s=1200):
    """Never repair while a scheduled Partner sync is still writing."""
    units = ['nutreeze-partner-daily.service', 'nutreeze-partner-sameday.service', 'nutreeze-partner-evening.service']
    deadline = time.time() + limit_s
    while time.time() < deadline:
        states = sh(['systemctl', 'is-active'] + units).split()
        if not any(state in ('active', 'activating', 'reloading') for state in states):
            return
        time.sleep(20)


def resync(day, log):
    """Read the legacy screen again and re-sync the day to it (same two-step flow as daily-sync.sh)."""
    out = sh([f'{INTEGRATION}/legacy-screen-manifest.py', day], timeout=900)
    log.append('  screen read again: ' + (out.strip().splitlines() or ['?'])[-1][:160])
    manifest = f"--legacy-screen-manifest={CONTAINER_CONFIG_ROOT}/legacy-screen-{day.replace('-', '')}.json"
    if not os.path.exists(os.path.join(CONFIG_ROOT, f"legacy-screen-{day.replace('-', '')}.json")):
        manifest = None
    base = [f'{INTEGRATION}/run.sh', f'--delivery-date={day}', '--limit=1000']
    dry = sh(base + ['--dry-run'] + ([manifest] if manifest else []), timeout=1800)
    summary = [json.loads(l) for l in dry.splitlines() if '"event":"daily_source_summary"' in l]
    if not summary:
        log.append('  re-sync dry-run failed')
        return False
    s = summary[-1]
    write = sh(base + [f"--expected-count={s['daily_orders']}", f"--expected-digest={s['source_digest']}", '--verify',
                       f'--confirm-daily-sync={day}', f'--confirm-address-call-dispatch={day}'] + ([manifest] if manifest else []),
               timeout=3000)
    ok = '"event":"complete"' in write and '"verified":true' in write
    log.append(f"  Fleetbase re-synced to the screen: {'done' if ok else 'FAILED'}")
    return ok


def feed_labels(day, log):
    out = sh(['/opt/nutrezee/sync/run-partner-daily-feed.sh'], timeout=900,
             env={'FEED_MODE': 'apply', 'ALLOW_APPLY': 'yes', 'FEED_DATES': day})
    applied = [json.loads(l[l.index('{'):]) for l in out.splitlines() if '"partner_daily_applied"' in l]
    log.append('  label database filled: ' + (json.dumps(applied[-1].get('counts')) if applied else 'FAILED'))


def send(subject, body):
    for name, content in (('/tmp/a70-body.txt', body), ('/tmp/a70-subject.txt', subject)):
        subprocess.run(['docker', 'exec', '-i', 'fleetbase-application-1', 'sh', '-c', f'cat > {name}'],
                       input=content, text=True, check=True)
    php = ("$b = file_get_contents('/tmp/a70-body.txt'); $s = file_get_contents('/tmp/a70-subject.txt');"
           "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(TO) + ")->subject($s); });"
           "echo 'MAIL_SENT', PHP_EOL;")
    res = sh(['docker', 'exec', 'fleetbase-application-1', 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php])
    sh(['docker', 'exec', 'fleetbase-application-1', 'rm', '-f', '/tmp/a70-body.txt', '/tmp/a70-subject.txt'])
    return 'MAIL_SENT' in res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    day = args[0] if args else (datetime.datetime.now(KW).date() + datetime.timedelta(days=1)).isoformat()
    fix = '--no-fix' not in sys.argv
    started = datetime.datetime.now(KW).strftime('%H:%M')
    if fix:
        wait_for_scheduled_sync()

    screen = load_screen(day)
    fix_log = []
    if fix and screen is None:
        fix_log.append('No screen reading found → reading the legacy screen now')
        resync(day, fix_log)
        screen = load_screen(day)
    d = evaluate(day, screen)
    for round_no in range(1, FIX_ROUNDS + 1):
        if not fix or (d['diff'] is None and screen is not None):
            break
        if d['diff'] == 0 and not d.get('not_in_label_db'):
            break
        fix_log.append(f'Repair round {round_no}:')
        if d['diff'] is None or d['diff'] > 0:
            resync(day, fix_log)
            screen = load_screen(day)
        feed_labels(day, fix_log)
        d = evaluate(day, screen)

    page = d['page']
    lines = [f'Checked {started}–{datetime.datetime.now(KW).strftime("%H:%M")} Kuwait with the Batch Labels page code.', '']
    if screen is None or d['diff'] is None:
        subject = f'[CHECK] Labels {day}: could not compare — ' + ('no legacy screen reading' if screen is None else page.get('error', '?'))
        lines.append('The legacy screen could not be read or the page check failed; Fleetbase follows Partner only.')
    else:
        n_screen = len(screen['order_numbers'])
        zero = d['diff'] == 0
        subject = (f"[{'OK' if zero else 'CHECK'}] Labels {day}: Batch Labels {page['labels']} = legacy screen {n_screen}"
                   if zero else
                   f"[CHECK] Labels {day}: Batch Labels {page['labels']} vs legacy screen {n_screen} — {d['diff']} difference(s)")
        lines += [
            f"Legacy screen / شاشة السيستم القديم: {n_screen} orders (read {screen['_age_min']} min ago)",
            f"Batch Labels page / صفحة الطباعة: {page['labels']} labels",
            f"Difference / الفرق: {d['diff']}",
        ]
        if screen.get('test_orders_excluded'):
            lines.append(f"Test orders removed / طلبات تجربة اتشالت: {short(screen['test_orders_excluded'])}")
        for title, key in (('On the screen, no label / على الشاشة ومالهاش ملصق', 'no_label'),
                           ('Label but not on the screen / ملصق ومش على الشاشة', 'extra_label'),
                           ('Different driver / سواق مختلف', 'wrong_driver'),
                           ('No driver in the legacy admin itself / مالوش سواق في السيستم القديم نفسه', 'no_driver_in_legacy')):
            if d.get(key):
                lines.append(f'{title}: {short(d[key])}')
    if fix_log:
        lines += ['', 'Automatic repair / تصليح تلقائي:'] + fix_log
    body = '\n'.join(lines) + '\n'
    os.makedirs('/root/a70', exist_ok=True)
    with open('/root/a70/last-print-status.txt', 'w') as fh:
        fh.write(subject + '\n\n' + body)
    print(subject)
    print(body)
    if '--no-send' not in sys.argv:
        print('mail:', 'sent' if send(subject, body) else 'FAILED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
