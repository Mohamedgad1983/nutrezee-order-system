#!/usr/bin/env python3
"""A85 — serve the print page's own requests for a fresh check (recorded automatically when the page is
opened on a stale result; nobody presses anything). Runs every minute: one cheap query, and only when a
request is waiting does it run the normal check for that day. The check itself closes the request.
"""
import subprocess
import sys

CHECK = '/opt/fleetbase/integrations/nutreeze-orders/print-status.py'
QUERY = ("select distinct delivery_date::text from label_print_check where status='requested' "
         "and requested_at > now() - interval '20 minutes' "
         "and delivery_date >= (now() at time zone 'Asia/Kuwait')::date order by 1 limit 3")


def main():
    res = subprocess.run(['docker', 'exec', 'nutrezee-postgres-1', 'psql', '-U', 'nutrezee', '-d', 'nutrezee', '-At', '-c', QUERY],
                         capture_output=True, text=True, timeout=30)
    if res.returncode != 0:
        print('request query failed:', res.stderr.strip()[:160])
        return 0
    for day in [line.strip() for line in res.stdout.splitlines() if line.strip()]:
        out = subprocess.run([CHECK, day, '--follow-up'], capture_output=True, text=True, timeout=3000).stdout
        lines = [l for l in out.splitlines() if l.startswith('[') or l.startswith('page status') or 'another check' in l]
        print(day, '|', ' | '.join(lines)[:300])
    return 0


if __name__ == '__main__':
    sys.exit(main())
