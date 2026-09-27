#!/usr/bin/env python3
"""A68 night check: is tomorrow (Kuwait) complete for the 01:00 label print?
Read-only against Fleetbase MySQL, the Nutrezee Postgres, and systemd journals.
Sends one plain-text report from hello@nutreeze.com through the Fleetbase Laravel
mailer (credentials stay in the API's protected .env). Usage: night-check.py [--no-send]
"""
import json, subprocess, sys, datetime, zoneinfo, collections
sys.path.insert(0, '/root/a68')
import partner_reconcile

KW = zoneinfo.ZoneInfo('Asia/Kuwait')
COMPANY = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c'
TO = ['callcenter@nutreeze.com', 'it@nutreeze.com']
now_kw = datetime.datetime.now(KW)
import os
day = os.environ.get('NIGHT_DAY') or (now_kw.date() + datetime.timedelta(days=1)).isoformat()   # labels printed at 01:00 for tomorrow
since_utc = (now_kw.replace(hour=0, minute=0, second=0, microsecond=0)
             .astimezone(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC'))

def sh(cmd, inp=None):
    return subprocess.run(cmd, input=inp, capture_output=True, text=True, timeout=300).stdout

def mysql(q):
    out = sh(['docker', 'exec', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', '-e', q])
    return [l.split('\t') for l in out.splitlines() if l]

# 1) Fleetbase: tomorrow's set and driver distribution
rows = mysql(f"""select o.public_id, coalesce(json_unquote(json_extract(o.meta,'$.source_order_number')),''),
  coalesce(json_unquote(json_extract(o.meta,'$.external_ref')),''), coalesce(o.internal_id,''), o.status,
  coalesce(u.name,'(no driver)'), date_format(convert_tz(o.updated_at,'+00:00','+03:00'),'%H:%i')
  from fleetbase.orders o left join fleetbase.drivers d on d.uuid=o.driver_assigned_uuid
  left join fleetbase.users u on u.uuid=d.user_uuid
  where o.company_uuid='{COMPANY}' and o.deleted_at is null and date(o.scheduled_at)='{day}'""")
fb_total = len(rows)
by_driver = collections.Counter(r[5] for r in rows)
by_status = collections.Counter(r[4] for r in rows)
last_update = max((r[6] for r in rows), default='-')

# 2) label DB: Fleetbase orders with no single customer_order match (same rule as Batch Labels)
tsv = ''.join(f"{r[0]}\t{r[1] or 'NULL'}\t{r[2] or 'NULL'}\t{r[3] or 'NULL'}\n" for r in rows)
q = ("create temp table fb(pid text, son text, ext text, iid text); copy fb from stdin with (format text);"
     "select f.pid||' '||coalesce(f.son,f.ext,f.iid) from fb f where "
     "(select count(*) from customer_order c where c.order_number=f.son)<>1 and "
     "(select count(*) from customer_order c where c.order_number=f.ext)<>1 and "
     "(select count(*) from customer_order c where c.order_number=f.iid)<>1;")
unmapped = [l for l in sh(['docker', 'exec', '-i', 'nutrezee-postgres-1', 'psql', '-U', 'nutrezee', '-d',
                           'nutrezee', '-Atc', q], tsv).splitlines() if l and not l.startswith(('CREATE', 'COPY'))]

# 3) tonight's Partner -> Fleetbase sync runs for that day (journal JSON events)
def events(unit):
    """Journal JSON events; undated events are attributed to the last delivery_date seen."""
    out = sh(['journalctl', '-u', unit, '--since', since_utc, '--utc', '-o', 'short-iso', '--no-pager'])
    evs, cur = [], None
    for line in out.splitlines():
        try:
            ts = datetime.datetime.fromisoformat(line.split(' ', 1)[0]).astimezone(KW).strftime('%H:%M')
        except ValueError:
            continue
        i = line.find('{"')
        if 'integration_lock_busy' in line or 'Deadlock' in line or 'Failed with result' in line:
            evs.append((ts, cur, {'event': 'FAILED', 'detail': (line[i:] if i >= 0 else line[25:])[:160]}))
        if i < 0:
            continue
        try:
            e = json.loads(line[i:])
        except ValueError:
            continue
        cur = e.get('delivery_date', e.get('date', cur))
        evs.append((ts, cur, e))
    return evs

sync = [(t, e) for t, d, e in events('nutreeze-partner-daily.service') if d == day or e.get('event') == 'FAILED']
verif = [e for _, e in sync if e.get('event') == 'daily_verification']
src = [e for _, e in sync if e.get('event') == 'daily_source_summary']
done = [t for t, e in sync if e.get('event') == 'complete']
fails = [f"{t} {e.get('detail', e.get('error_code', ''))}" for t, e in sync
         if e.get('event') in ('FAILED', 'failed', 'fatal')]
partner = verif[-1].get('source_orders') if verif else (src[-1].get('source_declared_distinct_orders') if src else None)
assigned = verif[-1].get('assigned_orders') if verif else None
held = (verif[-1].get('held_unroutable', 0) + verif[-1].get('held_unscheduled_orders', 0)) if verif else None

feed = [e for _, d, e in events('nutrezee-partner-daily-feed.service')
        if e.get('date') == day and e.get('event', '').startswith('partner_daily_')]
feed_last = feed[-1] if feed else {}

try:
    rec = partner_reconcile.reconcile(day)
    rec_err = None
except Exception as e:  # Partner API unavailable etc. -> never silently OK
    rec, rec_err = None, f"{type(e).__name__}: {str(e)[:160]}"

# method 2: legacy admin screen (uploaded by the owner's Mac, tools/e2e-staging/legacy/legacy-driver-orders.mjs)
legacy, legacy_note = None, None
try:
    lg = json.load(open(f'/root/a68/legacy-ui-{day}.json'))
    age_h = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.datetime.fromisoformat(lg['captured_at'].replace('Z', '+00:00'))).total_seconds() / 3600
    hard = [e for e in lg.get('errors', []) if 'ids_incomplete' not in e]
    if hard:
        legacy_note = 'legacy screen check reported errors: ' + '; '.join(hard)
    elif age_h > 4:
        legacy_note = f'legacy screen data is {age_h:.1f} h old (older than 4 h) — not used'
    else:
        legacy = lg
        legacy['age_h'] = age_h
except FileNotFoundError:
    legacy_note = 'legacy screen check did not run (Mac asleep/off or not scheduled)'
except Exception as e:
    legacy_note = f'legacy screen file unreadable: {type(e).__name__}'

legacy_ok = False
if legacy is not None and rec is not None:
    p_nums = set(partner_reconcile.partner_numbers_cache)
    l_nums = set(str(x) for x in legacy.get('order_ids', [])) if legacy.get('ids_complete') else set()
    legacy['missing_vs_partner'] = sorted(p_nums - l_nums) if l_nums else []
    legacy['extra_vs_partner'] = sorted(l_nums - p_nums) if l_nums else []
    p_by_name = {name: pc for name, pc, _ in rec['per_driver']}
    legacy['driver_diffs'] = [(d['name'], d['count'], p_by_name.get(d['name'])) for d in legacy['drivers']
                              if p_by_name.get(d['name']) != d['count']]
    legacy_ok = (legacy.get('total') == rec['partner_active'] + rec['partner_on_hold'] + rec['partner_cancelled']
                 or legacy.get('total') == rec['partner_active']) \
        and not legacy['missing_vs_partner'] and not legacy['extra_vs_partner'] and not legacy['driver_diffs']

ok = rec is not None and rec['ok'] and bool(done) and not unmapped and legacy_ok and fb_total > 0 and (assigned is None or fb_total >= assigned)
verdict = 'READY / جاهز للطباعة' if ok else 'NOT READY / غير جاهز — لا تطبع قبل المراجعة'

lines = [
    f"Nutreeze night check for delivery day {day} — {now_kw:%Y-%m-%d %H:%M} Kuwait",
    f"فحص الليل لطلبات يوم {day}",
    '',
    f"VERDICT / النتيجة: {verdict}",
    '',
    f"Partner (legacy) orders for {day}:        {partner if partner is not None else 'unknown'}",
    f"Assigned by tonight's sync (Partner):     {assigned if assigned is not None else 'unknown'}   held: {held if held is not None else '-'}",
    f"Fleetbase orders for {day}:               {fb_total}   (last change {last_update} Kuwait)",
    f"Status: " + ', '.join(f"{k} {v}" for k, v in sorted(by_status.items())),
    f"Label DB: orders not yet in the label database: {len(unmapped)}"
    + (('  -> ' + ', '.join(unmapped[:15])) if unmapped else ''),
    f"Label feed for {day}: {feed_last.get('event', 'no run yet')} {json.dumps(feed_last.get('counts', {}))}",
    f"Tonight's Fleetbase sync for {day}: " + (f"completed at {', '.join(done)} Kuwait" if done else 'NOT completed'),
]
if fails:
    lines += ['Sync failures tonight:'] + [f"  {f}" for f in fails[-5:]]
lines += ['', f"ORDER-BY-ORDER CHECK Partner vs Fleetbase / مطابقة كل طلب بين Partner و Fleetbase ({day}):"]
if rec is None:
    lines += [f"  Partner API check FAILED: {rec_err}"]
else:
    lines += [
        f"  Partner rows {rec['partner_rows']}: active {rec['partner_active']}, cancelled {rec['partner_cancelled']}, on hold {rec['partner_on_hold']}",
        f"  Fleetbase active orders: {rec['fleetbase_active']}",
        f"  Missing in Fleetbase / طلبات ناقصة: {len(rec['missing'])}" + (('  -> ' + ', '.join(rec['missing'][:40])) if rec['missing'] else ''),
        f"     of which no driver in Partner / بدون سائق في Partner: {len(rec['no_driver'])}" + (('  -> ' + ', '.join(rec['no_driver'][:40])) if rec['no_driver'] else ''),
        f"     of which Partner driver not mapped to Fleetbase: {len(rec['unmapped_driver'])}" + (('  -> ' + ', '.join(rec['unmapped_driver'][:40])) if rec['unmapped_driver'] else ''),
        f"  Extra in Fleetbase (not active in Partner) / طلبات زيادة: {len(rec['extra'])}" + (('  -> ' + ', '.join(rec['extra'][:40])) if rec['extra'] else ''),
        f"  Wrong driver / سائق مختلف: {len(rec['wrong_driver'])}",
    ]
    lines += [f"     order {n}: Partner={pn} | Fleetbase={fn}" for n, pn, fn in rec['wrong_driver'][:40]]
    lines += ['', f"  Per driver / لكل سائق:   Partner  Fleetbase"]
    lines += [f"  {'OK ' if p == f else '!! '}{name[:28]:<28} {p:>6} {f:>9}" for name, p, f in rec['per_driver']]
lines += ['', f"LEGACY ADMIN SCREEN CHECK (Orders Driver Wise) / فحص شاشة السيستم القديم ({day}):"]
if legacy is None:
    lines += [f"  NOT AVAILABLE: {legacy_note}"]
else:
    lines += [
        f"  Screen total: {legacy.get('total')}   (captured {legacy['age_h']:.1f} h ago; Partner API active {rec['partner_active'] if rec else '?'})",
        f"  Order numbers read from screen: {len(legacy.get('order_ids', []))}" + ('' if legacy.get('ids_complete') else '  (incomplete — number-by-number comparison skipped, counts only)'),
        f"  On screen but not in Partner API: {len(legacy['extra_vs_partner'])}" + (('  -> ' + ', '.join(legacy['extra_vs_partner'][:40])) if legacy['extra_vs_partner'] else ''),
        f"  In Partner API but not on screen: {len(legacy['missing_vs_partner'])}" + (('  -> ' + ', '.join(legacy['missing_vs_partner'][:40])) if legacy['missing_vs_partner'] else ''),
        "  Per driver on screen vs Partner API:",
    ]
    lines += [f"  {'OK ' if (p == d['count']) else '!! '}{d['name'][:28]:<28} screen {d['count']!s:>5}  api {p!s:>5}"
              for d in legacy['drivers'] for p in [({n: pc for n, pc, _ in rec['per_driver']} if rec else {}).get(d['name'])]]
lines += ['', f"Driver distribution in Fleetbase for {day} (driver accounts) / توزيع الطلبات على السواقين:"]
lines += [f"  {n:>4}  {name}" for name, n in by_driver.most_common()]
lines += ['', 'Automatic read-only check (A68). Source: Fleetbase + Nutrezee label DB + sync logs.',
          'If NOT READY: do not print partial labels. Missing orders with no Partner driver need a driver assigned in the legacy admin, then the next sync picks them up.']
body = '\n'.join(lines)
subject = f"[{'OK' if ok else 'ACTION'}] Nutreeze labels {day}: Partner {rec['partner_active'] if rec else '?'} / Fleetbase {fb_total}" + (f" / missing {len(rec['missing'])} / wrong driver {len(rec['wrong_driver'])}" if rec else " / Partner check failed") + (f" / screen {legacy.get('total')}" if legacy else " / screen check missing")

open('/root/a68/last-night-check.txt', 'w').write(subject + '\n\n' + body + '\n')
print(subject); print(body)
if '--no-send' in sys.argv:
    sys.exit(0)

php = ("$b = file_get_contents('/tmp/a68-body.txt'); $s = file_get_contents('/tmp/a68-subject.txt');"
       "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(TO) + ")->subject($s); });"
       "echo 'MAIL_SENT', PHP_EOL;")
for name, content in (('/tmp/a68-body.txt', body), ('/tmp/a68-subject.txt', subject)):
    subprocess.run(['docker', 'exec', '-i', 'fleetbase-application-1', 'sh', '-c', f'cat > {name}'], input=content, text=True, check=True)
res = sh(['docker', 'exec', 'fleetbase-application-1', 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php])
print('mail:', 'MAIL_SENT' in res and 'sent' or res[-300:])
sh(['docker', 'exec', 'fleetbase-application-1', 'rm', '-f', '/tmp/a68-body.txt', '/tmp/a68-subject.txt'])
