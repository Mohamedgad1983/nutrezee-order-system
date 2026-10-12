#!/usr/bin/env python3
"""Daily subscription-expiry report from the Partner integration API (replaces the admin-screen reading).

Writes the same files the WhatsApp reminder and the call-centre email expect:
  latest.json/.csv (all expiring, audit), latest_action_required.*, latest_already_renewed.* and dated copies.
Source: GET /integration/subscriptions (+ /customers for name/phone, /customer-addresses for the area).
The API end_date already includes frozen days and days added, which the admin screen showed late.
READ-ONLY: GET requests only. Exit codes: 0 ok, 11 API/network failure, 13 implausibly empty answer.
"""
import csv, datetime, io, json, os, re, sys, time, urllib.parse, urllib.request, zoneinfo

OUT = os.environ.get('EXPIRY_OUT_DIR', '/var/log/nutrezee/subscription-expiry')
ENV = '/opt/nutrezee/.env'
BASE = 'https://nutreeze.com/integration'
KW = zoneinfo.ZoneInfo('Asia/Kuwait')
WINDOW = int(os.environ.get('EXPIRY_DAYS_AHEAD', '3'))
TEST_NAME = re.compile(r'\btest(ing)?\b|do not deliver', re.I)
COLS = ['customer_id', 'customer_name', 'mobile', 'package', 'sub_package', 'start_date', 'end_date', 'days_remaining',
        'status', 'area', 'order_no', 'order_type', 'payment_status', 'classification', 'customer_row',
        'active_orders_count', 'later_active_order_no', 'later_active_order_end', 'detail_check', 'frozen_days',
        'order_internal_id', 'other_expiring_orders']


def now():
    return datetime.datetime.now(KW)


def log(msg):
    line = f"{now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with open(f'{OUT}/run.log', 'a') as fh:
        fh.write(line + '\n')


def api_key():
    text = open(ENV).read()
    for name in ('NUTREEZE_PARTNER_DAILY_API_KEY', 'NUTREEZE_PARTNER_LABEL_API_KEY'):
        m = re.search(rf'^{name}=(.+)$', text, re.M)
        if m:
            return m.group(1).strip().strip('"').strip("'")
    raise RuntimeError('Partner API key not found in ' + ENV)


def fetch_all(endpoint, key):
    rows, cursor, pages = [], None, 0
    while True:
        q = {'limit': 500}
        if cursor is not None:
            q['cursor'] = cursor
        req = urllib.request.Request(f'{BASE}/{endpoint}?{urllib.parse.urlencode(q)}',
                                     headers={'X-Api-Key': key, 'Accept': 'application/json'})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    payload = json.load(resp)
                break
            except Exception as exc:  # network hiccup: retry the page
                if attempt == 2:
                    raise RuntimeError(f'{endpoint}: {type(exc).__name__}: {exc}') from exc
                time.sleep(15)
        data = payload.get('data')
        if not isinstance(data, list):
            raise RuntimeError(f'{endpoint}: unexpected envelope')
        rows.extend(data)
        pages += 1
        cursor = payload.get('next_cursor')
        if cursor is None or pages > 400:
            return rows


def phone_digits(raw):
    d = re.sub(r'\D', '', str(raw or ''))
    if d.startswith('00'):
        d = d[2:]
    if d.startswith('965') and len(d) == 11:
        d = d[3:]
    return d


def write_atomic(path, text):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8-sig' if path.endswith('.csv') else 'utf-8') as fh:
        fh.write(text)
    os.replace(tmp, path)


def to_csv(rows):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLS, extrasaction='ignore')
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def main():
    os.umask(0o077)
    os.makedirs(OUT, exist_ok=True)
    today = datetime.date.fromisoformat(os.environ['EXPIRY_TODAY']) if os.environ.get('EXPIRY_TODAY') else now().date()
    log(f'API expiry report: today {today} (Asia/Kuwait), window {WINDOW} day(s)')
    key = api_key()
    t0 = time.time()
    try:
        subs = fetch_all('subscriptions', key)
        customers = {str(c['customer_ref']): c for c in fetch_all('customers', key) if c.get('customer_ref') is not None}
        addresses = {str(a['address_id']): a for a in fetch_all('customer-addresses', key) if a.get('address_id') is not None}
    except RuntimeError as exc:
        log(f'ERROR Partner API failed: {exc}; previous reports left untouched')
        return 11
    log(f'Partner API read in {time.time() - t0:.0f}s: {len(subs)} subscriptions, {len(customers)} customers, {len(addresses)} addresses')

    # current = not cancelled, not deleted, end date today or later
    def date(v):
        try:
            return datetime.date.fromisoformat(str(v)[:10])
        except ValueError:
            return None

    live = []
    unreadable = 0
    for s in subs:
        if s.get('deleted') or s.get('status') == 'cancel':
            continue
        end = date(s.get('end_date'))
        if end is None:
            unreadable += 1
            continue
        if end >= today:
            s['_end'] = end
            s['_start'] = date(s.get('start_date'))
            live.append(s)
    if len(live) < 100:
        log(f'ERROR only {len(live)} current subscriptions in the API answer — implausible, previous reports left untouched')
        return 13

    # one group per customer (same phone on two accounts = one customer)
    by_customer = {}
    first_start = {}
    for s in subs:
        ref = str(s.get('customer_ref'))
        st = date(s.get('start_date'))
        if st and s.get('status') != 'cancel' and (ref not in first_start or st < first_start[ref]):
            first_start[ref] = st
    for s in live:
        ref = str(s.get('customer_ref'))
        c = customers.get(ref, {})
        phone = phone_digits(c.get('phone'))
        by_customer.setdefault(phone or f'ref:{ref}', []).append(s)

    def row(s, cls, later=None, others=''):
        ref = str(s.get('customer_ref'))
        c = customers.get(ref, {})
        addr = addresses.get(str((s.get('delivery') or {}).get('delivery_address_id')), {})
        pkg = s.get('package') or {}
        dur = s.get('duration') or {}
        return {
            'customer_id': ref,
            'customer_name': (c.get('full_name') or '').strip(),
            'mobile': phone_digits(c.get('phone')) or (c.get('phone') or ''),
            'package': (pkg.get('name_en') or '').strip(),
            'sub_package': (dur.get('name') or '').strip(),
            'start_date': s.get('start_date'),
            'end_date': s['_end'].isoformat(),
            'days_remaining': (s['_end'] - today).days,
            'status': 'Active',
            'area': (addr.get('area_en') or '').strip(),
            'order_no': str(s.get('order_number') or ''),
            'order_type': 'Order Renew' if first_start.get(ref) and s['_start'] and first_start[ref] < s['_start'] else 'Order New',
            'payment_status': s.get('status') or '',
            'classification': cls,
            'customer_row': True,
            'active_orders_count': len(by_customer.get(phone_digits(c.get('phone')) or f'ref:{ref}', [])),
            'later_active_order_no': str(later.get('order_number') or '') if later else '',
            'later_active_order_end': later['_end'].isoformat() if later else '',
            'detail_check': 'api',
            'frozen_days': s.get('frozen_days') or 0,
            'order_internal_id': str(s.get('subscription_id') or ''),
            'other_expiring_orders': others,
        }

    action, renewed, tests = [], [], 0
    for group in by_customer.values():
        group.sort(key=lambda s: (s['_end'], s['_start'] or today))
        latest = group[-1]
        in_window = [s for s in group if 1 <= (s['_end'] - today).days <= WINDOW]
        if not in_window:
            continue
        name = (customers.get(str(latest.get('customer_ref')), {}).get('full_name') or '')
        if TEST_NAME.search(name):
            tests += 1
            continue
        others = ', '.join(str(s.get('order_number')) for s in in_window[:-1])
        if 1 <= (latest['_end'] - today).days <= WINDOW:
            action.append(row(latest, 'ACTION_REQUIRED', others=others))
        else:
            expiring = in_window[-1]
            renewed.append(row(expiring, 'ALREADY_RENEWED', later=latest, others=', '.join(str(s.get('order_number')) for s in in_window[:-1])))
    for lst in (action, renewed):
        lst.sort(key=lambda r: (r['days_remaining'], r['customer_name'].lower()))
    all_rows = action + renewed

    # cross-check against the admin-screen reading of the same day, when one exists
    try:
        screen = json.load(open(f'{OUT}/latest_action_required.json', encoding='utf-8'))
        if screen.get('today') == today.isoformat() and screen.get('detail_check', '') != 'api' and (screen.get('customers') or [{}])[0].get('detail_check') != 'api':
            a = {r['order_no'] for r in action}
            b = {c['order_no'] for c in screen['customers']}
            log(f"Cross-check vs admin screen ({len(b)} action required): API only {sorted(a - b)}, screen only {sorted(b - a)}")
    except (OSError, ValueError, KeyError, IndexError):
        pass

    def count(rows):
        out = {}
        for r in rows:
            out[r['end_date']] = out.get(r['end_date'], 0) + 1
        return dict(sorted(out.items()))

    head = {
        'generated_at_kuwait': now().strftime('%Y-%m-%d %H:%M:%S'), 'today': today.isoformat(), 'timezone': 'Asia/Kuwait',
        'window_days': WINDOW, 'source_page': f'{BASE}/subscriptions', 'active_orders_read': len(live),
        'customers_checked': len(by_customer), 'expiring_orders': len(all_rows), 'expiring_customers': len(all_rows),
        'action_required': len(action), 'already_renewed': len(renewed), 'duplicate_rows_removed': 0,
        'test_customers_excluded': tests, 'unreadable_end_dates': unreadable, 'detail_check': 'api',
    }
    for suffix, rows, extra in (('', all_rows, {'report': 'ALL'}),
                                ('_action_required', action, {'report': 'ACTION_REQUIRED', 'by_end_date': count(action)}),
                                ('_already_renewed', renewed, {'report': 'ALREADY_RENEWED', 'by_end_date': count(renewed)})):
        doc = {**head, **extra, 'customers': rows}
        text = json.dumps(doc, ensure_ascii=False, indent=1)
        for name in (today.isoformat(), 'latest'):
            write_atomic(f'{OUT}/{name}{suffix}.json', text)
            write_atomic(f'{OUT}/{name}{suffix}.csv', to_csv(rows))
    log(f'Current subscriptions: {len(live)}; expiring in 1-{WINDOW} days: {len(all_rows)} customers; ACTION_REQUIRED: {len(action)} {count(action)}; ALREADY_RENEWED: {len(renewed)}; test excluded: {tests}')
    log('Reports generated from the Partner API: latest_action_required, latest_already_renewed, latest — .json/.csv, plus dated copies')
    log('Job completed successfully')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:  # never leave a half-written report
        log(f'ERROR {type(exc).__name__}: {exc}')
        sys.exit(11)
