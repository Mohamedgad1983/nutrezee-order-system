#!/usr/bin/env python3
"""WP-OPS-A77 — apply a manager's area move quickly.

Run every minute by nutreeze-area-moves.timer. When the moves of a delivery day changed since the last
successful run (a new move or an undo), the day is re-synced right away through the normal Fleetbase
sync — the only code that assigns drivers — instead of waiting for the next scheduled run. The sync
reads the active moves itself, so this script changes nothing on its own. If the sync is busy the day
is retried on the next minute. Then the WhatsApp subscribers of the day follow their area.
"""
import datetime, fcntl, importlib.util, json, os, subprocess, sys

WORK = '/root/a77'
PS = '/opt/fleetbase/integrations/nutreeze-orders/print-status.py'
KW = datetime.timezone(datetime.timedelta(hours=3))


def log(event, **fields):
    print(json.dumps({'t': datetime.datetime.now(KW).isoformat(timespec='seconds'), 'event': event, **fields}), flush=True)


def changed_days(today):
    query = ("select to_regclass('public.delivery_area_move') is not null")
    exists = subprocess.run(['docker', 'exec', 'nutrezee-postgres-1', 'psql', '-U', 'nutrezee', '-d', 'nutrezee', '-Atc', query],
                            capture_output=True, text=True, stdin=subprocess.DEVNULL).stdout.strip()
    if exists != 't':
        return {}
    query = ("select delivery_date, count(*) filter (where cancelled_at is null), "
             "to_char(max(greatest(created_at, coalesce(cancelled_at, created_at))) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US') "
             f"from delivery_area_move where delivery_date >= date '{today}' group by 1 order by 1")
    out = subprocess.run(['docker', 'exec', 'nutrezee-postgres-1', 'psql', '-U', 'nutrezee', '-d', 'nutrezee', '-At', '-F', '\t', '-c', query],
                         capture_output=True, text=True, stdin=subprocess.DEVNULL)
    if out.returncode != 0:
        raise RuntimeError('moves query failed')
    return {l.split('\t')[0]: f"{l.split(chr(9))[1]}@{l.split(chr(9))[2]}" for l in out.stdout.splitlines() if l.count('\t') == 2}


def quick_sync(ps, day):
    """The scheduled sync's two steps, with the screen reading already on disk (no new legacy read)."""
    compact = day.replace('-', '')
    manifest = None
    for name, flag in ((f'legacy-screen-{compact}.json', '--legacy-screen-manifest'), (f'driver-orders-{compact}.json', '--driver-orders-manifest')):
        if os.path.isfile(os.path.join(ps.CONFIG_ROOT, name)):
            manifest = f'{flag}={ps.CONTAINER_CONFIG_ROOT}/{name}'
            break
    if manifest is None:
        return ps.resync(day, [])  # no reading yet for that day: take one, as the scheduler would
    base = [f'{ps.INTEGRATION}/run.sh', f'--delivery-date={day}', '--limit=1000']
    dry = ps.sh(base + ['--dry-run', manifest], timeout=1800)
    summary = [json.loads(l) for l in dry.splitlines() if '"event":"daily_source_summary"' in l]
    if not summary:
        return False
    s = summary[-1]
    write = ps.sh(base + [f"--expected-count={s['daily_orders']}", f"--expected-digest={s['source_digest']}", '--verify',
                          f'--confirm-daily-sync={day}', f'--confirm-address-call-dispatch={day}', manifest]
                  + ([f'--confirm-zero-day={day}'] if s['daily_orders'] == 0 else []), timeout=3000)
    applied = [json.loads(l) for l in write.splitlines() if '"event":"area_moves_applied"' in l or '"event":"area_moves_ignored"' in l]
    for line in applied:
        log('sync_area_moves', day=day, **{k: v for k, v in line.items() if k != 'event'})
    return '"event":"complete"' in write and '"verified":true' in write


def main():
    os.makedirs(WORK, mode=0o700, exist_ok=True)
    lock = open(os.path.join(WORK, '.apply.lock'), 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0
    today = datetime.datetime.now(KW).date().isoformat()
    days = changed_days(today)
    pending = []
    for day, stamp in days.items():
        marker = os.path.join(WORK, f'applied-{day}')
        if not (os.path.exists(marker) and open(marker).read().strip() == stamp):
            pending.append((day, stamp, marker))
    if not pending:
        return 0
    spec = importlib.util.spec_from_file_location('print_status', PS)
    ps = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ps)
    failures = 0
    for day, stamp, marker in pending:
        if ps.sync_running():
            log('waiting_for_scheduled_sync', day=day)
            failures += 1
            continue
        ok = quick_sync(ps, day)
        if ok:
            ps.whatsapp_labels(day, [])
            with open(marker, 'w') as fh:
                fh.write(stamp)
        else:
            failures += 1
        log('day_applied' if ok else 'day_failed_will_retry', day=day, state=stamp)
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
