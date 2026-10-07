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
READING_DIR = '/root/a68'
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


def load_empty_screen(day):
    """A70.8 — a day the legacy screen itself shows as empty (e.g. Friday, no deliveries).

    The manifest writer never writes an empty manifest (an empty reading must never empty a day in
    Fleetbase), so the guard reads the raw screen reading: fresh, no errors, "0 of 0 entries" and
    every driver filter empty. The sync then follows Partner; the guard only compares."""
    path = os.path.join(READING_DIR, f'legacy-ui-{day}.json')
    try:
        age_min = int((time.time() - os.path.getmtime(path)) / 60)
        with open(path) as fh:
            r = json.load(fh)
    except (OSError, ValueError):
        return None
    drivers = r.get('drivers') or []
    if (age_min > 360 or r.get('day') != day or r.get('errors') or r.get('total') != 0 or r.get('order_ids')
            or not r.get('ids_complete') or not str(r.get('table_info') or '').endswith(' of 0 entries')
            or not drivers or any(d.get('count') != 0 or d.get('order_ids') or not d.get('ids_complete') for d in drivers)):
        return None
    return {'order_numbers': [], 'drivers': {}, 'test_orders_excluded': [], '_age_min': age_min, '_empty_day': True,
            '_mtime': os.path.getmtime(path)}


def current_screen(day):
    """The newest valid reading of the screen for the day: the manifest, or an empty-day reading."""
    screen, empty = load_screen(day), load_empty_screen(day)
    if screen is not None and empty is not None:
        manifest = os.path.join(CONFIG_ROOT, f"legacy-screen-{day.replace('-', '')}.json")
        return empty if empty['_mtime'] > os.path.getmtime(manifest) else screen
    return screen if screen is not None else empty


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
    # A71: WhatsApp-system subscribers (ERPNext, order numbers WA-…) are not on the legacy screen by design.
    d['whatsapp_labels'] = sorted(n for n in labels if n.startswith(WA_PREFIX))
    labels -= set(d['whatsapp_labels'])
    d['legacy_labels'] = len(labels)
    d['no_label'] = sorted(numbers - labels)                     # on the screen, no label on the page
    d['extra_label'] = sorted(labels - numbers)                  # label on the page, not on the screen
    d['wrong_driver'] = sorted(n for n in numbers & labels if n in drivers and fb.get(n, {}).get('driver') != drivers[n])
    d['not_in_label_db'] = sorted(set(page['unmapped']) & numbers)
    d['no_driver_in_legacy'] = sorted(n for n in numbers if n not in drivers)
    # A70.12: an order the legacy admin itself has not given a driver cannot have a label (owner rule:
    # no order without a driver). That is a job for the legacy admin, not a difference to repair here.
    waiting = set(d['no_driver_in_legacy'])
    d['needs_driver'] = sorted(n for n in d['no_label'] if n in waiting)
    d['no_label'] = sorted(n for n in d['no_label'] if n not in waiting)
    d['diff'] = len(d['no_label']) + len(d['extra_label']) + len(d['wrong_driver'])
    return d


WA_PREFIX = 'WA-'
WA_SYNC = '/opt/fleetbase/integrations/whatsapp-subscribers/wa-labels-sync.sh'


def whatsapp_labels(day, log):
    """A71: put the day's WhatsApp-system subscribers on Batch Labels (driver = the area's driver that day)."""
    if not os.path.exists(WA_SYNC):
        return None
    out = sh([WA_SYNC, day, 'apply'], timeout=600)
    done = [json.loads(l) for l in out.splitlines() if l.startswith('{"event":"complete"')]
    fed = '"event":"wa_label_feed_complete"' in out and '"failures":0' in out.split('"event":"wa_label_feed_complete"')[-1]
    if not done or not fed:
        log.append('  WhatsApp subscribers: FAILED — their labels may be missing')
        return {'failed': True}
    log.append(f"  WhatsApp subscribers: {done[-1]['rows']} active, {done[-1]['with_driver']} with a driver")
    return done[-1]


UNITS = ['nutreeze-partner-daily.service', 'nutreeze-partner-sameday.service', 'nutreeze-partner-evening.service']


def sync_running():
    return any(state in ('active', 'activating', 'reloading') for state in sh(['systemctl', 'is-active'] + UNITS).split())


def print_day_synced(day):
    """A70.9 — the running rolling sync has already finished the print day (it does that day first).

    The run then spends ~20 more minutes on the day after; the check must not wait for that."""
    if sh(['systemctl', 'is-active', 'nutreeze-partner-daily.service']).strip() not in ('active', 'activating'):
        return False
    started = sh(['systemctl', 'show', '-p', 'ExecMainStartTimestamp', '--value', 'nutreeze-partner-daily.service']).strip()
    if len(started.split(' ')) != 4:
        return False
    out = sh(['journalctl', '-u', 'nutreeze-partner-daily.service', '--since', started.rsplit(' ', 1)[0].split(' ', 1)[1],
              '--no-pager', '-o', 'cat'])
    return any('"event":"complete"' in l and '"dry_run":false' in l and f'"delivery_date":"{day}"' in l for l in out.splitlines())


def wait_for_scheduled_sync(limit_s=1200, day=None):
    """Never repair while a scheduled Partner sync is still writing. With a day: only wait for that day."""
    deadline = time.time() + limit_s
    while time.time() < deadline:
        if not sync_running() or (day and print_day_synced(day)):
            return
        time.sleep(15)


def report(day, screen, d, fix_log, started, note=None, wa=None):
    page = d['page']
    lines = [f'Checked {started}–{datetime.datetime.now(KW).strftime("%H:%M")} Kuwait with the Batch Labels page code.', '']
    if note:
        lines += [note, '']
    if screen is None or d['diff'] is None:
        subject = f'[CHECK] Labels {day}: could not compare — ' + ('no legacy screen reading' if screen is None else page.get('error', '?'))
        lines.append('The legacy screen could not be read or the page check failed; Fleetbase follows Partner only.')
    else:
        n_screen = len(screen['order_numbers'])
        zero = d['diff'] == 0
        n_labels, n_wa = d['legacy_labels'], len(d['whatsapp_labels'])
        n_wait = len(d.get('needs_driver') or [])
        subject = (f"[OK] Labels {day}: Batch Labels {n_labels} = legacy screen {n_screen - n_wait}"
                   + (f" — {n_wait} order(s) need a driver in legacy: {short(d['needs_driver'], 5)}" if n_wait else '')
                   if zero else
                   f"[CHECK] Labels {day}: Batch Labels {n_labels} vs legacy screen {n_screen} — {d['diff']} difference(s)")
        lines += [
            f"Legacy screen / شاشة السيستم القديم: {n_screen} orders (read {screen['_age_min']} min ago)",
            f"Batch Labels page / صفحة الطباعة: {n_labels} labels",
            f"Difference / الفرق: {d['diff']}",
        ]
        if wa is not None or n_wa:
            expected = None if not wa or wa.get('failed') else wa['with_driver']
            wa_ok = wa is None or (expected is not None and expected == n_wa)  # wa is None: check-only run
            subject += f" + WhatsApp {n_wa}" if wa_ok else ' + WhatsApp CHECK'
            lines.append(f"WhatsApp subscribers / مشتركين الواتساب: {n_wa} labels"
                         + ('' if wa_ok else f" — expected {expected if expected is not None else '?'} / المتوقع {expected if expected is not None else '?'}"))
            if wa and wa.get('no_driver'):
                lines.append(f"WhatsApp subscribers without a label (no address or unknown area) / مشتركين واتساب من غير ملصق: "
                             f"{wa['no_driver']} — areas: {', '.join(wa.get('no_driver_areas') or [])}")
        if screen.get('_empty_day'):
            lines.append('No deliveries on this day in the legacy admin / مفيش توصيل اليوم ده في السيستم القديم')
        if screen.get('test_orders_excluded'):
            lines.append(f"Test orders removed / طلبات تجربة اتشالت: {short(screen['test_orders_excluded'])}")
        if n_wait:
            lines.append(f"{n_screen} on the screen, {n_wait} of them without a driver in the legacy admin: no label until a "
                         f"driver is set there, then it appears with the next sync. / {n_wait} طلب على الشاشة من غير سواق في "
                         f"السيستم القديم: حدد له سواق هناك وملصقه يظهر مع المزامنة الجاية: {short(d['needs_driver'])}")
        for title, key in (('On the screen, no label / على الشاشة ومالهاش ملصق', 'no_label'),
                           ('Label but not on the screen / ملصق ومش على الشاشة', 'extra_label'),
                           ('Different driver / سواق مختلف', 'wrong_driver'),
                           ('No driver in the legacy admin itself / مالوش سواق في السيستم القديم نفسه', 'no_driver_in_legacy')):
            if key == 'no_driver_in_legacy' and n_wait:
                continue
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


def resync(day, log):
    """Read the legacy screen again and re-sync the day to it (same two-step flow as daily-sync.sh)."""
    compact = day.replace('-', '')
    fresh = load_screen(day)
    if fresh is not None and fresh['_age_min'] < 5:
        log.append('  screen reading is under 5 min old: used as is')  # A70.10: saves ~90 s before 01:00
    else:
        out = sh([f'{INTEGRATION}/legacy-screen-manifest.py', day], timeout=900)
        log.append('  screen read again: ' + (out.strip().splitlines() or ['?'])[-1][:160])
    manifest = f"--legacy-screen-manifest={CONTAINER_CONFIG_ROOT}/legacy-screen-{compact}.json"
    if not os.path.exists(os.path.join(CONFIG_ROOT, f"legacy-screen-{compact}.json")):
        manifest = None
        # Same fallback as daily-sync.sh when there is no screen manifest.
        membership = os.path.join(CONFIG_ROOT, f'driver-orders-{compact}.json')
        if os.path.isfile(membership) and not os.path.islink(membership):
            manifest = f'--driver-orders-manifest={CONTAINER_CONFIG_ROOT}/driver-orders-{compact}.json'
    base = [f'{INTEGRATION}/run.sh', f'--delivery-date={day}', '--limit=1000']
    dry = sh(base + ['--dry-run'] + ([manifest] if manifest else []), timeout=1800)
    summary = [json.loads(l) for l in dry.splitlines() if '"event":"daily_source_summary"' in l]
    if not summary:
        log.append('  re-sync dry-run failed')
        return False
    s = summary[-1]
    write = sh(base + [f"--expected-count={s['daily_orders']}", f"--expected-digest={s['source_digest']}", '--verify',
                       f'--confirm-daily-sync={day}', f'--confirm-address-call-dispatch={day}'] + ([manifest] if manifest else [])
               + ([f'--confirm-zero-day={day}'] if s['daily_orders'] == 0 else []),  # A70.8: same as daily-sync.sh
               timeout=3000)
    ok = '"event":"complete"' in write and '"verified":true' in write
    log.append(f"  Fleetbase re-synced to the screen: {'done' if ok else 'FAILED'}")
    return ok


def feed_labels(day, log):
    for attempt in range(3):  # A70.8: Partner sometimes answers one call with 400 "window"; the next call works
        if attempt:
            time.sleep(30)
        out = sh(['/opt/nutrezee/sync/run-partner-daily-feed.sh'], timeout=900,
                 env={'FEED_MODE': 'apply', 'ALLOW_APPLY': 'yes', 'FEED_DATES': day})
        events = [json.loads(l[l.index('{'):]) for l in out.splitlines() if '"event":"partner_daily_' in l]
        applied = [e for e in events if e.get('event') == 'partner_daily_applied']
        done = [e for e in events if e.get('event') == 'partner_daily_complete']
        ok = bool(done) and done[-1].get('failures') == 0
        if ok:
            break
    # "applied" appears only when something was created/updated; a complete run with nothing to add is success.
    log.append('  label database: ' + ('FAILED' if not ok else
               (f"filled {json.dumps(applied[-1].get('counts'))}" if applied else 'already complete')))
    return ok


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
    fix_log = []
    if fix:
        wait_for_scheduled_sync(day=day)
        # A70.9: read the screen again now, so a change made in legacy after the sync started is seen before the print.
        out = sh([f'{INTEGRATION}/legacy-screen-manifest.py', day], timeout=900)
        fix_log.append('  screen read now: ' + ('done' if 'legacy_screen_manifest_written' in out or 'screen_empty_day' in out
                                                else 'FAILED — using the reading from the sync'))
    screen = current_screen(day)
    if fix:
        feed_labels(day, fix_log)  # A70.7: always complete the label database first (≈15 s)
    wa = whatsapp_labels(day, fix_log) if fix else None
    if fix and screen is None:
        fix_log.append('No screen reading found → reading the legacy screen now')
        resync(day, fix_log)
        screen = current_screen(day)
    d = evaluate(day, screen)
    for round_no in range(1, FIX_ROUNDS + 1):
        if not fix or (d['diff'] is None and screen is not None):
            break
        if d['diff'] == 0 and not d.get('not_in_label_db'):
            break
        if round_no == 1 and d['diff']:
            # A70.9: tell the owner before 01:00 exactly which orders differ; the repair needs ~20 min.
            report(day, screen, d, fix_log, started,
                   'Repair is running now; a second email follows. / التصليح شغال دلوقتي وهيوصلك إيميل تاني بالنتيجة.', wa=wa)
        wait_for_scheduled_sync()  # the re-sync needs the lock the scheduled run holds
        fix_log.append(f'Repair round {round_no}:')
        if d['diff'] is None or d['diff'] > 0:
            resync(day, fix_log)
            screen = current_screen(day)
        feed_labels(day, fix_log)
        wa = whatsapp_labels(day, fix_log)  # a repair can change an area's driver
        d = evaluate(day, screen)

    report(day, screen, d, fix_log, started, wa=wa)
    return 0


if __name__ == '__main__':
    sys.exit(main())
