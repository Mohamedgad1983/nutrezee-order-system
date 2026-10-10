#!/usr/bin/env python3
"""A70.6 — zero-difference guard for the 01:00 label print (owner: "نسبة الخطأ تكون zero").

Checks, with the Batch Labels page's own code, that the labels the page will offer for tomorrow are
exactly the orders on the legacy admin screen (order by order), and that every order has the
screen's driver in Fleetbase. On any difference it repairs automatically and checks again:
  - Fleetbase differs from the screen  → read the screen again and re-sync that day to it;
  - an order has no label record yet   → run the Partner label feed for that day.
Then one short email to it@nutreeze.com (Fleetbase Laravel mailer, hello@nutreeze.com).
Order numbers only; no customer data.
Usage: nutreeze-print-status.py [YYYY-MM-DD] [--no-send] [--no-fix] [--follow-up]

A81 (owner, 2026-10-08): drivers are often completed in the legacy admin around 01:00, after the
00:45 check. `--follow-up` (timer every 15 min) repeats the same check and repair so those labels
appear the same night, and emails only when the result changed.
A84 (2026-10-09): the follow-up runs from 18:00 to 02:45 Kuwait, because drivers are assigned in
legacy through the evening and the page showed a driver with 36 labels while legacy had 48.
"""
import datetime
import collections
import fcntl
import json
import os
import subprocess
import uuid
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
FOLLOW_UP = '--follow-up' in sys.argv
STATE_DIR = '/root/a70'
LOCK_FILE = '/run/lock/nutreeze-print-status.lock'
STARTED_UTC = datetime.datetime.now(datetime.timezone.utc).isoformat()


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
        # A77: while a manager's area move covers an order, the legacy driver is kept in
        # legacy_partner_driver_id — that is the one to compare with the legacy screen.
        "coalesce(nullif(json_unquote(json_extract(meta,'$.legacy_partner_driver_id')),'null'),"
        "json_unquote(json_extract(meta,'$.partner_driver_id')),''), driver_assigned_uuid is not null, "
        "coalesce(nullif(json_unquote(json_extract(meta,'$.area_move_id')),'null'),''), "
        "coalesce(json_unquote(json_extract(meta,'$.routing_area')),'') "
        f"from fleetbase.orders where company_uuid='{COMPANY}' and deleted_at is null "
        f"and internal_id like 'NUTREEZE-PARTNER-DAY-{day.replace('-', '')}-ORDER-%'")
    return {r[0]: {'status': r[1], 'driver': r[2], 'assigned': r[3] == '1',
                   'move': r[4] if len(r) > 4 else '', 'area': r[5] if len(r) > 5 else ''} for r in rows}


def batch_labels(day):
    """What the Batch Labels page offers for the day, computed with its compiled code in nutrezee-api."""
    query = ('select json_object("id",public_id,"internal_id",internal_id,"status",status,'
             '"scheduled_at",if(scheduled_at is null,null,date_format(scheduled_at,"%Y-%m-%dT%H:%i:%sZ")),"meta",meta) '
             f'from fleetbase.orders where company_uuid="{COMPANY}" and deleted_at is null '
             'and ((scheduled_at >= date_sub("DAY", interval 1 day) and scheduled_at < date_add("DAY", interval 1 day)) '
             # A82: orders only waiting for a driver are kept unscheduled; the page reads them by status.
             'or (scheduled_at is null and status="created" and json_unquote(json_extract(meta,"$.delivery_date"))="DAY" '
             'and json_unquote(json_extract(meta,"$.hold_reason"))="no_partner_driver"))'
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
    moved = collections.Counter(v['area'] for n, v in fb.items() if v.get('move') and n in labels)
    d['area_moves'] = sorted(moved.items())
    # A70.12: an order the legacy admin itself has not given a driver cannot have a label (owner rule:
    # no order without a driver). That is a job for the legacy admin, not a difference to repair here.
    waiting = set(d['no_driver_in_legacy'])
    # A82 (owner, 2026-10-08): such an order now prints without a driver; listed for information only.
    d['printed_without_driver'] = sorted(n for n in labels if n in waiting)
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


def record_result(day, screen, d):
    """A85: store the result so the print page itself shows whether the labels match the legacy admin
    now, and close the page's requests made before this check started. Order numbers only."""
    try:
        compared = screen is not None and d.get('diff') is not None
        status = 'failed' if not compared else ('ok' if d['diff'] == 0 else 'differences')
        detail = {} if not compared else {key: d.get(key, [])[:200] for key in ('no_label', 'extra_label', 'wrong_driver')}
        value = lambda v: '' if v is None else str(v)  # noqa: E731
        sql = """
INSERT INTO label_print_check (id, delivery_date, status, requested_at, finished_at, screen_orders, labels, differences,
                               without_driver, whatsapp_labels, detail)
VALUES (:'id', :'day', :'status', now(), now(), NULLIF(:'screen','')::int, NULLIF(:'labels','')::int,
        NULLIF(:'diff','')::int, NULLIF(:'nodriver','')::int, NULLIF(:'wa','')::int, :'detail'::jsonb);
UPDATE label_print_check
   SET status = :'status', finished_at = now(), screen_orders = NULLIF(:'screen','')::int, labels = NULLIF(:'labels','')::int,
       differences = NULLIF(:'diff','')::int, without_driver = NULLIF(:'nodriver','')::int,
       whatsapp_labels = NULLIF(:'wa','')::int, detail = :'detail'::jsonb
 WHERE delivery_date = :'day' AND status = 'requested' AND requested_at <= :'started'::timestamptz;
"""
        variables = {
            'id': 'chk-' + uuid.uuid4().hex, 'day': day, 'status': status, 'started': STARTED_UTC,
            'screen': value(len(screen['order_numbers']) if compared else None),
            'labels': value(d.get('legacy_labels') if compared else None),
            'diff': value(d.get('diff') if compared else None),
            'nodriver': value(len(d.get('printed_without_driver') or []) if compared else None),
            'wa': value(len(d.get('whatsapp_labels') or []) if compared else None),
            'detail': json.dumps(detail),
        }
        cmd = ['docker', 'exec', '-i', 'nutrezee-postgres-1', 'psql', '-U', 'nutrezee', '-d', 'nutrezee', '-q', '-v', 'ON_ERROR_STOP=1']
        for name, val in variables.items():
            cmd += ['-v', f'{name}={val}']
        res = subprocess.run(cmd + ['-f', '-'], input=sql, capture_output=True, text=True, timeout=60)
        print('page status:', 'recorded ' + status if res.returncode == 0 else 'NOT recorded: ' + res.stderr.strip()[:160])
    except Exception as error:  # the email and the repair never depend on this
        print('page status: NOT recorded:', str(error)[:160])


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
                   + (f" ({len(d['printed_without_driver'])} without a driver yet)" if d.get('printed_without_driver') else '')
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
        if d.get('area_moves'):
            lines.append("Areas moved to another driver by the drivers' manager for this day (not a difference) / "
                         "مناطق منقولة لسواق تاني من مدير السواقين لليوم ده (مش فرق): "
                         + ', '.join(f'{area} ({count})' for area, count in d['area_moves']))
        if d.get('printed_without_driver'):
            lines.append(f"Labels without a driver (not set in the legacy admin yet; they print with an empty driver box, "
                         f"under Area or Delivery time) / ملصقات من غير سواق (لسه مش متحدد في السيستم القديم، بتتطبع وخانة "
                         f"السواق فاضية من فلتر المنطقة أو وقت التوصيل): {len(d['printed_without_driver'])} — "
                         f"{short(d['printed_without_driver'])}")
        if n_wait:
            lines.append(f"{n_screen} on the screen, {n_wait} of them without a driver in the legacy admin: no label until a "
                         f"driver is set there, then it appears with the next sync. / {n_wait} طلب على الشاشة من غير سواق في "
                         f"السيستم القديم: حدد له سواق هناك وملصقه يظهر مع المزامنة الجاية: {short(d['needs_driver'])}")
        for title, key in (('On the screen, no label / على الشاشة ومالهاش ملصق', 'no_label'),
                           ('Label but not on the screen / ملصق ومش على الشاشة', 'extra_label'),
                           ('Different driver / سواق مختلف', 'wrong_driver'),
                           ('No driver in the legacy admin itself / مالوش سواق في السيستم القديم نفسه', 'no_driver_in_legacy')):
            if key == 'no_driver_in_legacy' and (n_wait or d.get('printed_without_driver')):
                continue  # already listed above
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
    if '--no-send' in sys.argv:
        return
    sent_file = os.path.join(STATE_DIR, f'print-status-sent-{day}.txt')
    if FOLLOW_UP:
        # A81: a follow-up run is silent unless the result differs from the last email of that day.
        last = open(sent_file).read().strip() if os.path.isfile(sent_file) else None
        if last is None:
            # A84: evening runs keep the page in step with legacy; the first email of a day is the 00:45 one.
            print('mail: skipped (before the 00:45 email of this day)')
            return
        if note or last == subject:
            print('mail: skipped (no change since the last email)')
            return
        subject_out = f'{subject} (update {datetime.datetime.now(KW).strftime("%H:%M")})'
    else:
        subject_out = subject
    ok = send(subject_out, body)
    print('mail:', 'sent' if ok else 'FAILED')
    if ok and not note:
        with open(sent_file, 'w') as fh:
            fh.write(subject + '\n')


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


def api_vs_screen(day):
    """A85: measure, at the moment of a fresh screen reading, whether Partner's live API says the same
    (orders + driver). One log line per check; never affects the check itself."""
    try:
        manifest = os.path.join(CONFIG_ROOT, f"legacy-screen-{day.replace('-', '')}.json")
        if not os.path.isfile(manifest):
            return
        sh(['docker', 'cp', manifest, 'nutrezee-api-1:/tmp/screen.json'])
        sh(['docker', 'cp', f'{INTEGRATION}/api-vs-screen.mjs', 'nutrezee-api-1:/srv/api-vs-screen.mjs'])
        out = sh(['docker', 'exec', '-u', '0', '-w', '/srv', 'nutrezee-api-1', 'node', 'api-vs-screen.mjs', day], timeout=120)
        sh(['docker', 'exec', '-u', '0', 'nutrezee-api-1', 'rm', '-f', '/srv/api-vs-screen.mjs', '/tmp/screen.json'])
        line = next((l for l in out.splitlines() if l.startswith('{')), None)
        if line:
            os.makedirs('/root/a85', exist_ok=True)
            with open('/root/a85/api-vs-screen.log', 'a') as fh:
                fh.write(line + '\n')
    except Exception as error:  # measurement only
        print('api-vs-screen skipped:', str(error)[:120])


def main():
    # A81: one check at a time. A follow-up never queues behind a running check; the others wait.
    lock = open(LOCK_FILE, 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | (fcntl.LOCK_NB if FOLLOW_UP else 0))
    except BlockingIOError:
        print('another check is running; this follow-up is skipped')
        return 0
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    now = datetime.datetime.now(KW)
    tomorrow = now.date() + datetime.timedelta(days=1)
    if FOLLOW_UP and now.hour >= 12:
        # A88: labels are printed at 01:00 for the NEXT day, so in the evening the day being prepared
        # is the day after tomorrow (Friday evening -> Sunday). On 2026-10-09 the evening runs watched
        # Saturday, already printed, while Sunday's drivers were being set in legacy.
        tomorrow += datetime.timedelta(days=1)
    if FOLLOW_UP and tomorrow.weekday() == 4:
        # A84: no deliveries on Friday; prepare the next delivery day instead.
        tomorrow += datetime.timedelta(days=1)
    day = args[0] if args else tomorrow.isoformat()
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
        api_vs_screen(day)
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

    if fix:
        record_result(day, screen, d)  # a check-only run (--no-fix) may read an old screen: not a result
    report(day, screen, d, fix_log, started, wa=wa)
    return 0


if __name__ == '__main__':
    sys.exit(main())
