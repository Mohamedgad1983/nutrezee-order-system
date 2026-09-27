"""A68 method 1: order-by-order Partner (legacy) vs Fleetbase reconciliation for one delivery day.
Read-only. Partner rows come from https://nutreeze.com/integration/daily-deliveries with the
protected vendor key (/root/nutreeze-vendor.key, never printed). Fleetbase rows from MySQL.
Checks: every active Partner order exists in Fleetbase, nothing extra is dispatched, and each
order sits with the same driver in both systems (Partner driver.id -> Fleetbase driver via the
protected Partner-driver map). Returns a dict consumed by night-check.py.
"""
import json, subprocess, urllib.parse, urllib.request, collections

VENDOR = 'https://nutreeze.com/integration/daily-deliveries'
KEY_FILE = '/root/nutreeze-vendor.key'
MAP_FILE = '/opt/fleetbase/api/storage/app/integrations/config/nutreeze-partner-driver-map.json'
COMPANY = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c'
partner_numbers_cache = []


def partner_rows(day):
    key = open(KEY_FILE).read().strip()
    rows, cursor, pages = [], None, 0
    while True:
        pages += 1
        if pages > 50:
            raise RuntimeError('partner_page_guard')
        q = {'delivery_date': day, 'limit': 1000}
        if cursor:
            q['cursor'] = cursor
        req = urllib.request.Request(VENDOR + '?' + urllib.parse.urlencode(q),
                                     headers={'X-Api-Key': key, 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = json.load(r)
        rows += payload['data']
        cursor = payload.get('next_cursor')
        if not cursor:
            return rows


def fleetbase_rows(day):
    q = f"""select coalesce(json_unquote(json_extract(o.meta,'$.source_order_number')),''),
      coalesce(json_unquote(json_extract(o.meta,'$.partner_driver_id')),''),
      coalesce(d.public_id,''), coalesce(u.name,''), o.status
      from fleetbase.orders o left join fleetbase.drivers d on d.uuid=o.driver_assigned_uuid
      left join fleetbase.users u on u.uuid=d.user_uuid
      where o.company_uuid='{COMPANY}' and o.deleted_at is null and date(o.scheduled_at)='{day}'
        and o.status not in ('canceled','cancelled')"""
    out = subprocess.run(['docker', 'exec', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', '-e', q],
                         capture_output=True, text=True, timeout=120).stdout
    return [l.split('\t') for l in out.splitlines() if l]


def reconcile(day):
    dmap = {str(e['partner_driver_id']): e['driver_public_id']
            for e in json.load(open(MAP_FILE))['drivers']}
    p_all = partner_rows(day)
    partner, p_names, cancelled, on_hold = {}, {}, 0, 0
    for r in p_all:
        num = str(r['order_number']).strip()
        if r.get('is_cancelled') or r.get('order_status') == 'cancel':
            cancelled += 1
            continue
        if r.get('is_on_hold'):
            on_hold += 1
            continue
        drv = r.get('driver') or {}
        pid = None if drv.get('id') is None else str(drv['id'])
        partner[num] = pid
        if pid:
            p_names[pid] = drv.get('name') or pid

    fb = {}
    fb_driver_name = {}
    for num, pdid, fb_pub, fb_name, status in fleetbase_rows(day):
        fb[num] = (pdid or None, fb_pub or None)
        if fb_pub:
            fb_driver_name[fb_pub] = fb_name

    global partner_numbers_cache
    partner_numbers_cache = list(partner)
    missing = sorted(n for n in partner if n not in fb)
    extra = sorted(n for n in fb if n not in partner)
    wrong_driver = []
    for n, pid in partner.items():
        if n not in fb:
            continue
        fb_pid, fb_pub = fb[n]
        expected_pub = dmap.get(pid) if pid else None
        if (pid or None) != fb_pid or (expected_pub and expected_pub != fb_pub):
            wrong_driver.append((n, p_names.get(pid, pid or 'no driver'), fb_driver_name.get(fb_pub, fb_pub or 'no driver')))
    no_driver = sorted(n for n, pid in partner.items() if not pid)
    unmapped_driver = sorted(n for n, pid in partner.items() if pid and pid not in dmap)

    per_driver = []
    p_count = collections.Counter(pid for pid in partner.values())
    f_count = collections.Counter(fb_pid for fb_pid, _ in fb.values())
    for pid in sorted(set(p_count) | set(f_count), key=lambda k: -(p_count.get(k, 0))):
        name = p_names.get(pid) or ('(no driver)' if not pid else pid)
        per_driver.append((name, p_count.get(pid, 0), f_count.get(pid, 0)))

    return {
        'partner_rows': len(p_all), 'partner_active': len(partner), 'partner_cancelled': cancelled,
        'partner_on_hold': on_hold, 'fleetbase_active': len(fb), 'missing': missing, 'extra': extra,
        'wrong_driver': wrong_driver, 'no_driver': no_driver, 'unmapped_driver': unmapped_driver,
        'per_driver': per_driver,
        'ok': not missing and not extra and not wrong_driver,
    }


if __name__ == '__main__':
    import sys
    res = reconcile(sys.argv[1])
    print(json.dumps({k: (v if not isinstance(v, list) or len(v) < 20 else v[:20] + ['…']) for k, v in res.items()}, ensure_ascii=False, indent=1))
