#!/usr/bin/env python3
"""A70.3 — the legacy admin screen is the reference for the night label print.

Reads "Orders Driver Wise" for one delivery day with the owner-installed Playwright runner
(read-only; credentials stay in /root/a68/legacy-admin.cred) and writes the root-only manifest
that nutreeze-orders.php --legacy-screen-manifest follows: every order number on the screen and
the legacy driver id the screen shows for it. No customer names, phones or addresses.

A manifest is written only from a complete, error-free reading; otherwise the previous file is
removed so the sync falls back to Partner alone (never a partial screen).
Usage: nutreeze-legacy-screen-manifest.py YYYY-MM-DD
"""
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import zoneinfo

RUNNER = os.environ.get('LEGACY_SCREEN_RUNNER', '/root/a68/run-legacy-check.sh')
READING_DIR = os.environ.get('LEGACY_SCREEN_READING_DIR', '/root/a68')
CONFIG_ROOT = os.environ.get('LEGACY_SCREEN_CONFIG_ROOT', '/opt/fleetbase/api/storage/app/integrations/config')
KW = zoneinfo.ZoneInfo('Asia/Kuwait')
NUMBER = re.compile(r'^[A-Za-z0-9._-]{1,255}$')


def log(event, **fields):
    print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)


def build_manifest(day, reading):
    problems = []
    if reading.get('errors'):
        problems.append('reading_errors')
    numbers = [str(n).strip() for n in reading.get('order_ids') or []]
    if not numbers or not reading.get('ids_complete') or reading.get('total') != len(numbers):
        problems.append('screen_total_incomplete')
    if len(set(numbers)) != len(numbers) or not all(NUMBER.match(n) for n in numbers):
        problems.append('screen_order_numbers_invalid')
    on_screen = set(numbers)
    drivers, names, seen_twice = {}, {}, set()
    for d in reading.get('drivers') or []:
        driver_id = str(d.get('id') or '').strip()
        ids = [str(n).strip() for n in d.get('order_ids') or []]
        if not driver_id or not NUMBER.match(driver_id) or not d.get('ids_complete') or d.get('count') != len(ids):
            problems.append('driver_list_incomplete')
            continue
        names[driver_id] = str(d.get('name') or '')[:255]
        for n in ids:
            if n not in on_screen:
                problems.append('driver_order_not_on_screen')
            elif n in drivers:
                seen_twice.add(n)
            else:
                drivers[n] = driver_id
    for n in seen_twice:  # listed under two drivers: follow Partner for that order
        drivers.pop(n, None)
    # A70.4: an order under no driver filter takes the driver printed on its own legacy Delivery Sticker.
    from_sticker = []
    for n, code in (reading.get('sticker_drivers') or {}).items():
        n = str(n).strip()
        if n in on_screen and n not in drivers and isinstance(code, str) and NUMBER.match(code):
            drivers[n] = code
            from_sticker.append(n)
    if problems:
        return None, sorted(set(problems))
    ordered = sorted(on_screen)
    return {
        'schema_version': 2,
        'source': 'legacy_driver_orders_screen_v2',
        'delivery_date': day,
        'captured_at': reading.get('captured_at'),
        'expected_count': len(ordered),
        'order_numbers': ordered,
        'order_number_digest': hashlib.sha256(('\n'.join(ordered) + '\n').encode()).hexdigest(),
        'drivers': dict(sorted(drivers.items())),
        'driver_names': names,
        'drivers_from_sticker': sorted(from_sticker),
        'no_driver_in_legacy': sorted(on_screen - set(drivers)),
    }, []


def main():
    day = sys.argv[1] if len(sys.argv) > 1 else (datetime.datetime.now(KW).date() + datetime.timedelta(days=1)).isoformat()
    datetime.date.fromisoformat(day)
    target = os.path.join(CONFIG_ROOT, f"legacy-screen-{day.replace('-', '')}.json")
    reading_file = os.path.join(READING_DIR, f'legacy-ui-{day}.json')
    started = datetime.datetime.now(datetime.timezone.utc).timestamp()
    run = subprocess.run([RUNNER, day], capture_output=True, text=True, timeout=900)
    reading = None
    try:
        if os.path.getmtime(reading_file) >= started - 5:
            with open(reading_file) as fh:
                reading = json.load(fh)
    except (OSError, ValueError):
        reading = None
    manifest, problems = (None, ['no_fresh_reading']) if reading is None else build_manifest(day, reading)
    if manifest is None:
        if os.path.exists(target):
            os.remove(target)
        log('legacy_screen_manifest_skipped', delivery_date=day, runner_exit=run.returncode, problems=problems)
        return 3
    tmp = target + '.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as fh:
        json.dump(manifest, fh, separators=(',', ':'))
    os.chmod(tmp, 0o600)
    os.replace(tmp, target)
    log('legacy_screen_manifest_written', delivery_date=day, screen_orders=manifest['expected_count'],
        with_driver=len(manifest['drivers']), from_sticker=manifest['drivers_from_sticker'],
        no_driver_in_legacy=manifest['no_driver_in_legacy'], bytes=os.path.getsize(target))
    return 0


if __name__ == '__main__':
    sys.exit(main())
