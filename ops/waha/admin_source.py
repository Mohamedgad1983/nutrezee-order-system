"""Read-only Admin acquisition and contract checks. No send capability."""
from datetime import date, datetime, timedelta
from html.parser import HTMLParser
import hashlib
import http.cookiejar
import json
from pathlib import Path
import re
import shlex
import stat
import os
import fcntl
import tempfile
from zoneinfo import ZoneInfo
from renewal import phone, KUWAIT, MAX_AGE, eligibility, SourceBlocked, FileSource
from collections import Counter
import urllib.parse
import urllib.request

ORIGIN = 'https://nutreeze.com'
MAX_RESPONSE = 64 * 1024 * 1024


class Blocked(ValueError):
    pass


def allowed(path, login=False):
    u = urllib.parse.urlsplit(path)
    if u.scheme or u.netloc or u.fragment:
        return False
    if login:
        return path == '/logincheck'
    if u.query:
        query = urllib.parse.parse_qs(u.query, keep_blank_values=True)
        if not re.fullmatch(r'/orders/ajaxlist/(?:Active|pending)', u.path) or set(query) != {'draw','start','length'}:
            return False
        if any(len(values) != 1 or not values[0].isdigit() for values in query.values()):
            return False
        if not 1 <= int(query['length'][0]) <= 10000:
            return False
    return bool(re.fullmatch(r'/(?:admin|dashboard|summary(?:/(?:0|off_day|meal_not_added|meal_added|suspend_day)/\d{4}-\d{2}-\d{2})?|orders/(?:list/(?:Active|pending)|ajaxlist/(?:Active|pending)|view/\d+|vieworderwiseoffdays/\d+|getMealsDateWiseFilter/(?:all|\d{4}-\d{2}-\d{2})/\d+))', u.path))


class Markup(HTMLParser):
    def __init__(self):
        super().__init__()
        self.csrf = None
        self.login = False
        self.tables = []
        self.table = self.row = self.cell = None
        self.select = self.option = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'input' and attrs.get('name') == '_csrf':
            self.csrf = attrs.get('value')
        if tag == 'input' and attrs.get('name') == 'password':
            self.login = True
        if tag == 'table':
            if self.table is not None:
                raise Blocked('nested_table_schema')
            self.table = []
        if tag == 'tr' and self.table is not None:
            self.row = []
        if tag == 'th' and self.table is not None and self.row is None:
            self.row = []
        if tag in ('td', 'th') and self.row is not None:
            self.cell = {'text': '', 'inputs': [], 'buttons': [], 'links': [], 'selects': []}
        if self.cell is not None:
            if tag == 'input':
                self.cell['inputs'].append(attrs)
            if tag == 'button':
                self.cell['buttons'].append(attrs)
            if tag == 'a':
                self.cell['links'].append(attrs.get('href', ''))
            if tag == 'select':
                if self.select is not None:
                    raise Blocked('nested_select_schema')
                self.select = {'attrs': attrs, 'options': [], 'closed': False}
                self.cell['selects'].append(self.select)
            if tag == 'option' and self.select is not None:
                if self.option is not None:
                    self.option['text'] = ' '.join(self.option['text'].split())
                self.option = {'attrs': attrs, 'text': ''}
                self.select['options'].append(self.option)

    def handle_data(self, data):
        if self.cell is not None:
            self.cell['text'] += data
        if self.option is not None:
            self.option['text'] += data

    def handle_endtag(self, tag):
        if tag in ('option', 'select') and self.option is not None:
            self.option['text'] = ' '.join(self.option['text'].split())
            self.option = None
        if tag == 'select' and self.select is not None:
            self.select['closed'] = True
            self.select = None
        if tag in ('td', 'th') and self.cell is not None:
            self.cell['text'] = ' '.join(self.cell['text'].split())
            self.row.append(self.cell)
            self.cell = None
            self.select = self.option = None
        if tag in ('tr', 'thead', 'tfoot') and self.row is not None:
            self.table.append(self.row)
            self.row = None
        if tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def parse(html):
    p = Markup()
    p.feed(html)
    if p.login:
        raise Blocked('admin_relogin_required')
    return p


def table(p, headers):
    matches = [t for t in p.tables if t and [c['text'] for c in t[0]] == headers]
    if len(matches) != 1:
        raise Blocked('admin_table_schema_changed')
    return matches[0][1:]


def calendar(html, start, end, today=None):
    rows = table(parse(html), ['No', 'Date', 'Day', 'Off Day', 'Freeze Day'])
    out = []
    for row in rows:
        if len(row) != 5:
            raise Blocked('calendar_row_schema')
        try:
            day = date.fromisoformat(row[1]['text'])
        except ValueError:
            raise Blocked('calendar_date_schema') from None
        if today is not None and day <= date.fromisoformat(today):
            continue
        flags = []
        for cell in row[3:]:
            inputs = cell['inputs']
            if len(inputs) == 1 and inputs[0].get('type') == 'checkbox':
                flags.append('checked' in inputs[0])
            elif len(cell['buttons']) == 1 and cell['buttons'][0].get('value') == 'Enable':
                flags.append(True)
            elif cell['text'] == '-' and not inputs and not cell['buttons']:
                flags.append(None)
            else:
                raise Blocked('calendar_flag_schema')
        off, frozen = flags
        if off is None or (not off and frozen is None):
            raise Blocked('calendar_flag_ambiguous')
        out.append({'date': day.isoformat(), 'state': 'off' if off else 'paused' if frozen else 'service'})
    expected = []
    current = date.fromisoformat(start)
    final = date.fromisoformat(end)
    if final < current or (final-current).days > 10000:
        raise Blocked('calendar_range_invalid')
    if today is not None:
        current = max(current, date.fromisoformat(today)+timedelta(days=1))
    while current <= final:
        expected.append(current.isoformat())
        current += timedelta(days=1)
    if sorted(r['date'] for r in out) != expected:
        raise Blocked('calendar_incomplete_or_duplicate')
    return out


def payment(html):
    p = parse(html)
    matches = [t for t in p.tables if t and 'Payment Status' in [c['text'] for c in t[0]] and 'Order Status' in [c['text'] for c in t[0]]]
    if len(matches) != 1 or len(matches[0]) != 2:
        raise Blocked('payment_detail_schema')
    t = matches[0]
    headers = [c['text'] for c in t[0]]
    if len(t[1]) != len(headers):
        raise Blocked('payment_detail_partial')
    value = t[1][headers.index('Payment Status')]['text'].lower()
    if value not in ('success', 'pending', 'failed', 'refunded'):
        raise Blocked('payment_detail_blank_or_unknown')
    return {'success': 'paid'}.get(value, value)


class PageRows(list):
    reported_total = None


def paged(get, size=1000, status="Active"):
    if status not in ("Active", "pending"):
        raise Blocked("order_status_not_allowed")
    all_rows = PageRows()
    total = None
    identities = set()
    # Admin pending counter is verified to undercount by seven. Prove physical
    # UI membership by bounded empty-terminated scans, not by that counter.
    for start in range(0, 10001, size):
        data = get('/orders/ajaxlist/'+status+'?' + urllib.parse.urlencode({'draw': 1, 'start': start, 'length': size}))
        try:
            page = json.loads(data)
        except ValueError:
            raise Blocked('active_page_not_json') from None
        count = page.get('recordsTotal')
        if type(count) is not int or count < 0 or count > 10000 or page.get('recordsFiltered') != count:
            raise Blocked('active_total_invalid')
        if total is not None and count != total:
            raise Blocked('active_count_changed')
        total = count
        rows = page.get('data')
        if not isinstance(rows, list) or len(rows) > size:
            raise Blocked('active_page_partial')
        if not rows:
            all_rows.reported_total = total
            if len(all_rows) < total:
                raise Blocked('order_source_below_reported_count')
            return all_rows
        if len(all_rows)+len(rows) > 10000:
            raise Blocked('order_source_too_large')
        for row in rows:
            if not isinstance(row, list) or len(row) != 17:
                raise Blocked('active_row_schema')
            ids = set(re.findall(r'/orders/view/(\d+)', str(row)))
            if len(ids) != 1 or next(iter(ids)) in identities:
                raise Blocked('active_duplicate_or_missing_identity')
            identities.update(ids)
            all_rows.append(row)
        if len(rows) < size:
            # Confirm immediately after the short physical page, not beyond a gap.
            # Re-querying offsets with a changed stride is unsafe; short-page
            # termination is verified explicitly with offset equal to rows seen.
            terminal = json.loads(get('/orders/ajaxlist/'+status+'?' + urllib.parse.urlencode({'draw':1,'start':len(all_rows),'length':1000})))
            if terminal.get('recordsTotal') != total or terminal.get('recordsFiltered') != total or terminal.get('data') != [] or len(all_rows) < total:
                raise Blocked('order_short_page_not_terminal_'+status+'_physical_'+str(len(all_rows))+'_reported_'+str(total)+'_terminal_rows_'+str(len(terminal.get('data', [])))+'_terminal_reported_'+str(terminal.get('recordsTotal')))
            all_rows.reported_total = total
            return all_rows
    raise Blocked('order_no_empty_terminal_page')


SUMMARY_HEADERS = ['UserID', 'Order', 'User name', 'Phone No', 'Days Left', 'Meal', 'Notification', 'Driver']


def summaries(get, today):
    cohorts = {}
    for cohort in ('0', 'off_day', 'meal_not_added', 'meal_added', 'suspend_day'):
        rows = table(parse(get('/summary/'+cohort+'/'+today)), SUMMARY_HEADERS)
        data = [r for r in rows if [c['text'] for c in r] != SUMMARY_HEADERS]
        if len(data) == 1 and len(data[0]) == 1 and data[0][0]['text'] == 'No Records Found':
            data = []
        seen = set()
        for row in data:
            if len(row) != 8 or not row[0]['text'].isdigit() or not row[1]['text'].isdigit():
                raise Blocked('summary_row_schema')
            identity = (row[0]['text'], row[1]['text'])
            if identity in seen:
                raise Blocked('summary_duplicate_identity')
            seen.add(identity)
        if len(data) > 10000:
            raise Blocked('summary_too_large')
        cohorts[cohort] = data
    return cohorts


class Session:
    def __init__(self, email, password):
        class Guard(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, url):
                u = urllib.parse.urlsplit(url)
                path = u.path + ('?'+u.query if u.query else '') + ('#'+u.fragment if u.fragment else '')
                if u.scheme != 'https' or u.netloc != 'nutreeze.com' or not allowed(path):
                    raise Blocked('admin_redirect_blocked')
                return super().redirect_request(req, fp, code, msg, headers, url)
        self.opener = urllib.request.build_opener(Guard(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.opener.addheaders = [('User-Agent', 'Mozilla/5.0')]
        p = Markup()
        p.feed(self.get('/admin', signing_in=True))
        if not p.csrf:
            raise Blocked('admin_csrf_missing')
        data = urllib.parse.urlencode({'_csrf': p.csrf, 'email_address': email, 'password': password}).encode()
        req = urllib.request.Request(ORIGIN+'/logincheck', data=data, headers={'Referer': ORIGIN+'/admin', 'Origin': ORIGIN})
        parse(self.read(req))
        parse(self.get('/dashboard'))

    def read(self, req):
        u = urllib.parse.urlsplit(req.full_url)
        method = req.get_method()
        path = u.path + ('?'+u.query if u.query else '')
        if u.scheme != 'https' or u.netloc != 'nutreeze.com' or method not in ('GET','POST') or not allowed(path, login=method=='POST'):
            raise Blocked('admin_transport_request_blocked')
        try:
            with self.opener.open(req, timeout=20) as response:
                value = response.read(MAX_RESPONSE+1)
            if len(value) > MAX_RESPONSE:
                raise Blocked('admin_response_too_large_path_'+u.path.replace('/','_'))
            return value.decode('utf-8')
        except Blocked:
            raise
        except Exception:
            raise Blocked('admin_read_failed') from None

    def get(self, path, signing_in=False):
        if not allowed(path):
            raise Blocked('admin_path_blocked')
        html = self.read(urllib.request.Request(ORIGIN+path))
        if not signing_in:
            auth = Markup()
            for tag in re.findall(r'<input\b[^>]*>', html, re.I):
                auth.feed(tag)
            if auth.login:
                raise Blocked('admin_relogin_required')
        return html


def credentials():
    p = Path('/opt/nutrezee/legacy-migration.env')
    if p.is_symlink():
        raise Blocked('admin_config_symlink')
    info = p.stat()
    if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
        raise Blocked('admin_config_permissions')
    config = {}
    for line in p.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            key, value = line.split('=', 1)
            parts = shlex.split(value)
            if len(parts) != 1 or key in config:
                raise Blocked('admin_config_schema')
            config[key] = parts[0]
    if config.get('LEGACY_BASE_URL', '').rstrip('/') != ORIGIN:
        raise Blocked('admin_config_origin')
    return config['LEGACY_ADMIN_EMAIL'], config['LEGACY_ADMIN_PASSWORD']


def text(value):
    rows = parse('<table><tr><td>'+str(value)+'</td></tr></table>').tables
    return rows[0][0][0]['text']


def iso(value):
    value = text(value)
    for pattern in ('%d-%m-%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            pass
    raise Blocked('order_date_schema')


def index(rows, min_start=None, irrelevant_invalid=None, target_phones=None, identity_key=False):
    result = {}
    seen = set()
    for row in rows:
        number = text(row[1])
        identities = set(re.findall(r'/orders/view/(\d+)', str(row)))
        if len(identities) != 1:
            raise Blocked('order_identity_schema')
        identity = next(iter(identities))
        key = identity if identity_key else number
        if (not identity_key and not number.isdigit()) or key in seen:
            raise Blocked('order_number_duplicate_or_schema')
        seen.add(key)
        match = re.search(r'\[([+0-9٠-٩ ()-]+)\]', text(row[2]))
        try:
            if not match:
                raise SourceBlocked('invalid_phone')
            normalized = phone(match[1])
        except SourceBlocked:
            if irrelevant_invalid is not None and irrelevant_invalid(identity):
                continue
            raise Blocked('order_contact_review_required_order_'+identity) from None
        # Later renewals are matched by exact normalized contact. This skips no
        # candidate match; malformed contacts require independent customer-ID proof.
        if target_phones is not None and normalized not in target_phones:
            continue
        payment_list = {'success':'paid','pending':'pending','failed':'failed','refunded':'refunded'}.get(text(row[10]).lower(),'unverified')
        try:
            start = iso(row[5])
            end = iso(row[6])
        except Blocked:
            if target_phones is not None:
                result[key] = {'id':identity,'phone':normalized,'start':None,'end':None,'payment_list':payment_list,'chronology_unverified':True}
                continue
            if irrelevant_invalid is not None and irrelevant_invalid(identity):
                continue
            raise Blocked('order_date_review_required_order_'+identity) from None
        if min_start is not None and start < min_start:
            continue
        result[key] = {'id':identity,'phone':normalized,'start':start,'end':end,'payment_list':payment_list}
    return result


def detail(session, order):
    html = session.get('/orders/view/'+order['id'])
    p = parse(html)
    matches = [t for t in p.tables if t and 'Payment Status' in [c['text'] for c in t[0]] and 'Order Status' in [c['text'] for c in t[0]]]
    if len(matches) != 1 or len(matches[0]) != 2:
        raise Blocked('payment_detail_schema')
    t = matches[0]; headers = [c['text'] for c in t[0]]
    if len(t[1]) != len(headers):
        raise Blocked('payment_detail_partial')
    for key, header in [('start','Order start date'),('end','Order end date')]:
        if header not in headers or iso(t[1][headers.index(header)]['text']) != order[key]:
            raise Blocked('order_dates_conflict')
    value = t[1][headers.index('Payment Status')]['text'].lower()
    return {'success':'paid','pending':'pending','failed':'failed','refunded':'refunded'}.get(value)


def collect(session, limit=None):
    import sys
    from admin_collection import collect_cohort
    return collect_cohort(session, limit, api=sys.modules[__name__])


def publish_snapshot(producer, path, now=None):
    """Publish only a complete protected export; never retain a failed predecessor."""
    path = Path(path)
    parent = path.parent
    if parent.is_symlink() or not parent.is_dir():
        raise Blocked('snapshot_parent_permissions')
    info = parent.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise Blocked('snapshot_parent_permissions')
    def protected(info):
        return stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600
    lock_path = Path(str(path)+'.lock')
    try:
        lock = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    except OSError:
        raise Blocked('snapshot_lock_permissions') from None
    temporary = None
    published = False
    try:
        if not protected(os.fstat(lock)):
            raise Blocked('snapshot_lock_permissions')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Blocked('source_collection_already_running') from None
        if path.exists() or path.is_symlink():
            if not protected(path.lstat()):
                raise Blocked('snapshot_output_permissions')
            path.unlink()
        data = producer()
        encoded = json.dumps(data, ensure_ascii=False).encode('utf-8')
        if len(encoded) > 10 * 1024 * 1024:
            raise SourceBlocked('source_too_large')
        fd, temporary = tempfile.mkstemp(prefix='.admin-source-', dir=parent)
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        instant = now or datetime.now(KUWAIT)
        rows = FileSource(temporary, 'nutreeze-admin-ui-v1', True).read(instant)
        counts = Counter(eligibility(row, instant) for row in rows)
        os.replace(temporary, path)
        temporary = None
        published = True
        directory = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
        return {'mode':'dry-run','source_certified':True,'complete':True,'live_enabled':False,
                'scope':'current_day_summary_cohorts','subscriptions':len(rows),'counts':dict(counts),
                'captured_at':data['captured_at'],'acquisition':data.get('acquisition',{}),
                'review_counts':data.get('review_counts',{})}
    except BaseException:
        if published:
            path.unlink(missing_ok=True)
        raise
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)
        os.close(lock)


def probe():
    session = Session(*credentials())
    first = paged(session.get)
    second = paged(session.get)
    digest = lambda rows: hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).digest()
    if digest(first) != digest(second):
        raise Blocked('active_snapshot_changed')
    from datetime import datetime
    from zoneinfo import ZoneInfo
    today = datetime.now(ZoneInfo('Asia/Kuwait')).date().isoformat()
    cohorts = summaries(session.get, today)
    if digest(cohorts) != digest(summaries(session.get, today)):
        raise Blocked('summary_snapshot_changed')
    return {'authenticated': True, 'summary_cohort_counts': {k: len(v) for k, v in cohorts.items()}, 'summary_complete_stable': True, 'active_records': len(first), 'active_complete_stable': True,
            'source_certified': False, 'live_enabled': False,
            'remaining': 'full_summary_calendar_payment_renewal_join_validation'}


if __name__ == '__main__':
    try:
        import argparse
        parser = argparse.ArgumentParser()
        parser.add_argument('--collect',action='store_true')
        parser.add_argument('--sample',type=int)
        parser.add_argument('--write-snapshot',action='store_true')
        args = parser.parse_args()
        if args.write_snapshot:
            if args.collect or args.sample:
                raise Blocked('snapshot_mode_conflict')
            result = publish_snapshot(lambda: collect(Session(*credentials())), '/opt/waha/renewal-data/admin-source.json')
            print(json.dumps(result))
        elif args.collect or args.sample:
            result = collect(Session(*credentials()), args.sample)
            print(json.dumps({'mode':'dry-run','live_enabled':False,'source_certified':result['complete'],'scope':'current_day_summary_cohorts','complete':result['complete'],'subscriptions':len(result['subscriptions']), 'counts':dict(Counter(eligibility(row, datetime.now(KUWAIT)) for row in result['subscriptions'])), 'review_counts':result.get('review_counts',{}), 'acquisition':result.get('acquisition',{})}))
        else:
            print(json.dumps(probe()))
    except (Blocked, SourceBlocked, KeyError, ValueError, OSError) as exc:
        print(json.dumps({'source_certified': False, 'live_enabled': False, 'state': 'blocked', 'error': str(exc) if isinstance(exc, (Blocked, SourceBlocked)) else 'admin_configuration_error'}))
        raise SystemExit(1)
