#!/usr/bin/env python3
"""Explicitly started WhatsApp campaigns, paced durably. Python standard library."""
import base64
import csv
from contextlib import contextmanager
import hmac
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

INTERVAL = 60
MAX_RECIPIENTS = 10000
MAX_BODY = 1024 * 1024
STATIC = Path(__file__).parent


class Invalid(ValueError):
    pass


def numbers(text):
    if not isinstance(text, str):
        raise Invalid('أدخل الأرقام كنص أو ملف CSV بعمود واحد.')
    result, seen = [], set()
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error:
        raise Invalid('ملف الأرقام غير صالح. استخدم CSV بعمود واحد.') from None
    if len(rows) > MAX_RECIPIENTS + 1:
        raise Invalid('الحد التقني 10000 رقم للحملة الواحدة.')
    for index, row in enumerate(rows, 1):
        if not row or all(not cell.strip() for cell in row):
            continue
        if len(row) != 1:
            raise Invalid(f'السطر {index}: استخدم عمود أرقام واحد فقط.')
        value = row[0].strip().lstrip('\ufeff')
        if index == 1 and value.lower() in ('phone', 'number', 'mobile', 'رقم', 'هاتف'):
            continue
        value = value.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
        if not re.fullmatch(r'\+?[0-9 ()\-]+', value):
            raise Invalid(f'السطر {index}: رقم غير صالح.')
        international = value.startswith('+') or value.startswith('00')
        value = re.sub(r'[ ()\-]', '', value)
        value = value[1:] if value.startswith('+') else value[2:] if value.startswith('00') else value
        if len(value) == 8 and not international:
            value = '965' + value
        if not re.fullmatch(r'[1-9][0-9]{7,14}', value):
            raise Invalid(f'السطر {index}: أدخل 8 أرقام للكويت أو رقمًا دوليًا صحيحًا.')
        if value not in seen:
            result.append(value)
            seen.add(value)
            if len(result) > MAX_RECIPIENTS:
                raise Invalid('الحد التقني 10000 رقم للحملة الواحدة.')
    if not result:
        raise Invalid('أضف رقمًا واحدًا على الأقل.')
    return result


class Transport:
    def __init__(self, base, key):
        self.base, self.key = base.rstrip('/'), key

    def request(self, path, payload=None):
        request = Request(self.base + path, headers={'X-Api-Key': self.key, 'Content-Type': 'application/json'},
                          data=None if payload is None else json.dumps(payload, ensure_ascii=False).encode())
        with urlopen(request, timeout=20) as response:
            return json.load(response)

    def ready(self):
        return self.request('/api/sessions/nutreeze').get('status') == 'WORKING'

    def send(self, phone, message):
        # No retries here: a timeout may occur AFTER WAHA sent the message.
        return self.request('/api/sendText', {'session': 'nutreeze', 'chatId': phone + '@c.us', 'text': message})


class Store:
    def __init__(self, path, transport, clock=time.time, actor='admin'):
        self.path, self.transport, self.clock, self.actor = str(path), transport, clock, actor
        self.lock = threading.Lock()
        with self.db() as db:
            db.executescript('''
              CREATE TABLE IF NOT EXISTS campaign (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, message TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'draft', created REAL NOT NULL, error TEXT);
              CREATE TABLE IF NOT EXISTS recipient (
                id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaign(id),
                phone TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
                attempted REAL, message_id TEXT, error TEXT,
                UNIQUE(campaign_id, phone));
              CREATE TABLE IF NOT EXISTS event (
                id INTEGER PRIMARY KEY, campaign_id INTEGER, kind TEXT NOT NULL, at REAL NOT NULL, actor TEXT NOT NULL DEFAULT 'admin');
              CREATE TABLE IF NOT EXISTS throttle (
                id INTEGER PRIMARY KEY CHECK(id=1), next_at REAL NOT NULL);
              INSERT OR IGNORE INTO throttle VALUES(1,0);
            ''')
            if 'actor' not in {r['name'] for r in db.execute('PRAGMA table_info(event)')}:
                db.execute("ALTER TABLE event ADD COLUMN actor TEXT NOT NULL DEFAULT 'admin'")
            recovery = [r[0] for r in db.execute("SELECT id FROM campaign WHERE state='running' OR id IN (SELECT campaign_id FROM recipient WHERE state='sending')")]
            db.execute("UPDATE recipient SET state='uncertain',error='interrupted_send' WHERE state='sending'")
            # Restart never resumes unattended sending.
            db.execute("UPDATE campaign SET state='paused',error='server_restart' WHERE state='running'")
            db.execute("UPDATE campaign SET state='uncertain',error='interrupted_send' WHERE id IN (SELECT campaign_id FROM recipient WHERE state='uncertain') AND state NOT IN ('draft','complete')")
            for campaign in recovery:
                self.event(db, campaign, 'server_recovery')
        os.chmod(self.path, 0o600)

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA journal_mode=WAL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def event(self, db, campaign, kind):
        db.execute('INSERT INTO event(campaign_id,kind,at,actor) VALUES(?,?,?,?)', (campaign, kind, self.clock(), self.actor))

    def create(self, data):
        phones = numbers(data.get('numbers'))
        message = data.get('message')
        name = data.get('name', '').strip() if isinstance(data.get('name', ''), str) else ''
        if not name or len(name) > 100:
            raise Invalid('أدخل اسم حملة من 1 إلى 100 حرف.')
        if not isinstance(message, str) or not message.strip() or len(message) > 4000:
            raise Invalid('أدخل نص الرسالة من 1 إلى 4000 حرف.')
        with self.db() as db:
            db.execute('BEGIN IMMEDIATE')
            campaign = db.execute('INSERT INTO campaign(name,message,created) VALUES(?,?,?)',
                                  (name, message.strip(), self.clock())).lastrowid
            db.executemany('INSERT INTO recipient(campaign_id,phone) VALUES(?,?)', [(campaign, p) for p in phones])
            self.event(db, campaign, 'draft_created')
        return campaign

    def snapshot(self):
        with self.db() as db:
            result = []
            for row in db.execute('SELECT * FROM campaign ORDER BY id DESC'):
                item = dict(row)
                item['counts'] = {r['state']: r['n'] for r in db.execute(
                    'SELECT state,count(*) n FROM recipient WHERE campaign_id=? GROUP BY state', (row['id'],))}
                item['recipients'] = [dict(r) for r in db.execute(
                    'SELECT id,phone,state,error FROM recipient WHERE campaign_id=? ORDER BY id LIMIT 100', (row['id'],))]
                item['total'] = sum(item['counts'].values())
                result.append(item)
            return {'campaigns': result, 'interval': INTERVAL,
                    'next_at': db.execute('SELECT next_at FROM throttle WHERE id=1').fetchone()[0]}

    def action(self, campaign, action, data):
        if action not in ('start', 'pause', 'resolve'):
            raise Invalid('عملية غير صالحة.')
        # Prevent a pause from racing a new transport send.
        with self.lock:
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT * FROM campaign WHERE id=?', (campaign,)).fetchone()
                if not row:
                    raise Invalid('الحملة غير موجودة.')
                if action == 'start':
                    if data.get('confirmed') is not True:
                        raise Invalid('راجع الرسالة والأرقام وأكد موافقة المستلمين قبل البدء.')
                    if row['state'] not in ('draft', 'paused'):
                        raise Invalid('لا يمكن بدء الحملة في حالتها الحالية.')
                    if db.execute("SELECT 1 FROM campaign WHERE state='running'").fetchone():
                        raise Invalid('هناك حملة أخرى تعمل. أوقفها أولًا.')
                    if not db.execute("SELECT 1 FROM recipient WHERE campaign_id=? AND state='pending'", (campaign,)).fetchone():
                        raise Invalid('لا توجد أرقام معلّقة للإرسال.')
                    db.execute("UPDATE campaign SET state='running',error=NULL WHERE id=?", (campaign,))
                elif action == 'pause':
                    if row['state'] != 'running':
                        raise Invalid('الحملة ليست قيد التشغيل.')
                    db.execute("UPDATE campaign SET state='paused' WHERE id=?", (campaign,))
                else:
                    if row['state'] != 'uncertain':
                        raise Invalid('لا توجد محاولة إرسال غير مؤكدة.')
                    # Only acknowledge/skip; uncertain messages are never automatically retried.
                    if data.get('decision') not in ('sent', 'skipped'):
                        raise Invalid('اختر تم إرسالها بعد التحقق، أو تخطيها بدون إعادة إرسال.')
                    db.execute('UPDATE recipient SET state=?,error=NULL WHERE campaign_id=? AND state=\'uncertain\'',
                               (data['decision'], campaign))
                    pending = db.execute("SELECT 1 FROM recipient WHERE campaign_id=? AND state='pending'", (campaign,)).fetchone()
                    db.execute("UPDATE campaign SET state=?,error=NULL WHERE id=?", ('paused' if pending else 'complete', campaign))
                self.event(db, campaign, action)

    def tick(self):
        with self.lock:
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                campaign = db.execute("SELECT * FROM campaign WHERE state='running' ORDER BY id LIMIT 1").fetchone()
                if not campaign:
                    return False
                recipient = db.execute("SELECT * FROM recipient WHERE campaign_id=? AND state='pending' ORDER BY id LIMIT 1", (campaign['id'],)).fetchone()
                if not recipient:
                    db.execute("UPDATE campaign SET state='complete' WHERE id=?", (campaign['id'],))
                    self.event(db, campaign['id'], 'complete')
                    return False
                now = self.clock()
                if now < db.execute('SELECT next_at FROM throttle WHERE id=1').fetchone()[0]:
                    return False
                # Check connection BEFORE claiming; no send attempt on readiness failure.
                try:
                    ready = self.transport.ready()
                except HTTPError as exc:
                    exc.close()
                    ready = False
                except Exception:
                    ready = False
                if not ready:
                    db.execute("UPDATE campaign SET state='paused',error='session_unavailable' WHERE id=?", (campaign['id'],))
                    self.event(db, campaign['id'], 'session_unavailable')
                    return False
                db.execute("UPDATE recipient SET state='sending',attempted=? WHERE id=?", (now, recipient['id']))
                db.execute('UPDATE throttle SET next_at=? WHERE id=1', (now + INTERVAL,))
                self.event(db, campaign['id'], 'send_claimed')
            # Claimed state is committed before issuing the external send request.
            state, error, message_id = 'sent', None, None
            try:
                result = self.transport.send(recipient['phone'], campaign['message'])
                message_id = result.get('id') if isinstance(result, dict) else None
                if not isinstance(message_id, str) or not message_id:
                    state, error = 'uncertain', 'missing_message_id'
            except HTTPError as exc:
                # Validation/auth failures are definite rejections; upstream/server failures ambiguous.
                state = 'failed' if exc.code in (400, 401, 403, 404, 422, 429) else 'uncertain'
                error = 'http_' + str(exc.code)
                exc.close()
            except Exception:
                state, error = 'uncertain', 'ambiguous_response'
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE')
                db.execute('UPDATE recipient SET state=?,error=?,message_id=? WHERE id=?',
                           (state, error, message_id, recipient['id']))
                # Wait a full minute after completion as well, including slow sends.
                db.execute('UPDATE throttle SET next_at=max(next_at,?) WHERE id=1', (self.clock() + INTERVAL,))
                if state != 'sent':
                    db.execute('UPDATE campaign SET state=?,error=? WHERE id=?',
                               ('uncertain' if state == 'uncertain' else 'paused', error, campaign['id']))
                self.event(db, campaign['id'], state)
            return True


def handler(store, username, password, origin):
    expected = base64.b64encode((username + ':' + password).encode()).decode()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log authorization, recipient numbers, messages or bodies.

        def reply(self, code, value, content_type='application/json; charset=utf-8'):
            if isinstance(value, dict) and 'error' in value and self.headers.get('Accept-Language', '').startswith('en'):
                english = {
                    'تسجيل الدخول مطلوب.':'Sign-in required.',
                    'استخدم لوحة الإرسال على نفس الموقع.':'Use the batch dashboard on the same origin.',
                    'أدخل الأرقام كنص أو ملف CSV بعمود واحد.':'Enter numbers as text or a one-column CSV.',
                    'الحد التقني 10000 رقم للحملة الواحدة.':'Technical limit: 10,000 rows per campaign.',
                    'ملف الأرقام غير صالح. استخدم CSV بعمود واحد.':'Invalid recipient file. Use a one-column CSV.',
                    'أضف رقمًا واحدًا على الأقل.':'Add at least one recipient.',
                    'أدخل اسم حملة من 1 إلى 100 حرف.':'Enter a campaign name of 1–100 characters.',
                    'أدخل نص الرسالة من 1 إلى 4000 حرف.':'Enter a message of 1–4000 characters.',
                    'عملية غير صالحة.':'Invalid action.',
                    'الحملة غير موجودة.':'Campaign not found.',
                    'راجع الرسالة والأرقام وأكد موافقة المستلمين قبل البدء.':'Review the message and numbers, and confirm recipient consent before starting.',
                    'لا يمكن بدء الحملة في حالتها الحالية.':'This campaign cannot start in its current state.',
                    'هناك حملة أخرى تعمل. أوقفها أولًا.':'Another campaign is running. Pause it first.',
                    'لا توجد أرقام معلّقة للإرسال.':'No pending recipients.',
                    'الحملة ليست قيد التشغيل.':'The campaign is not running.',
                    'لا توجد محاولة إرسال غير مؤكدة.':'No uncertain send to resolve.',
                    'اختر تم إرسالها بعد التحقق، أو تخطيها بدون إعادة إرسال.':'Verify it was sent, or skip without resending.',
                    'حجم الطلب غير صالح.':'Invalid request size.',
                    'طلب غير صالح.':'Invalid request.',
                    'غير موجود.':'Not found.',
                    'تعذر تنفيذ الطلب. حاول مرة أخرى بعد التحقق.':'Unable to complete the request. Check before trying again.',
                }
                text = value['error']
                match = re.match(r'السطر ([0-9]+): (.+)', text)
                if match:
                    detail = {'استخدم عمود أرقام واحد فقط.':'Use only one number column.',
                              'رقم غير صالح.':'Invalid number.',
                              'أدخل 8 أرقام للكويت أو رقمًا دوليًا صحيحًا.':'Enter 8 Kuwait digits or a valid international number.'}
                    value = {'error': 'Row ' + match[1] + ': ' + detail.get(match[2], 'Invalid input.')}
                else:
                    value = {'error': english.get(text, 'Unable to complete request. Check input and campaign status.')}
            body = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if code == 401:
                self.send_header('WWW-Authenticate', 'Basic realm="Nutreeze batch sender", charset="UTF-8"')
            self.end_headers()
            self.wfile.write(body)

        def auth(self):
            supplied = self.headers.get('Authorization', '')
            if not hmac.compare_digest(supplied.encode(), ('Basic ' + expected).encode()):
                self.reply(401, {'error': 'تسجيل الدخول مطلوب.'})
                return False
            return True

        def do_GET(self):
            if self.path == '/health':
                self.reply(200, {'status': 'ok'})
                return
            if not self.auth():
                return
            if self.path == '/bulk/api/campaigns':
                self.reply(200, store.snapshot())
                return
            files = {'/bulk/': ('bulk.html', 'text/html; charset=utf-8'),
                     '/bulk/app.js': ('bulk.js', 'text/javascript; charset=utf-8'),
                     '/bulk/style.css': ('bulk.css', 'text/css; charset=utf-8')}
            if self.path in files:
                filename, content_type = files[self.path]
                self.reply(200, (STATIC / filename).read_bytes(), content_type)
            else:
                self.reply(404, {'error': 'غير موجود.'})

        def do_POST(self):
            if not self.auth():
                return
            # Strict origin plus JSON prevents Basic-auth CSRF from third-party forms/pages.
            if self.headers.get('Origin') != origin or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.reply(403, {'error': 'استخدم لوحة الإرسال على نفس الموقع.'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_BODY:
                    raise Invalid('حجم الطلب غير صالح.')
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise Invalid('طلب غير صالح.')
                if self.path == '/bulk/api/campaigns':
                    self.reply(201, {'id': store.create(data)})
                    return
                match = re.fullmatch(r'/bulk/api/campaigns/([1-9][0-9]*)/(start|pause|resolve)', self.path)
                if not match:
                    self.reply(404, {'error': 'غير موجود.'})
                    return
                store.action(int(match[1]), match[2], data)
                self.reply(200, {'ok': True})
            except (Invalid, ValueError, TypeError, KeyError):
                # Business errors contain only line numbers and fixed messages, not raw recipient data.
                import sys
                exc = sys.exc_info()[1]
                self.reply(400, {'error': str(exc) if isinstance(exc, Invalid) else 'طلب غير صالح.'})
            except Exception:
                self.reply(500, {'error': 'تعذر تنفيذ الطلب. حاول مرة أخرى بعد التحقق.'})

    return Handler


def main():
    os.umask(0o077)
    path = Path(os.environ.get('BULK_DB', '/data/campaigns.sqlite3'))
    path.parent.mkdir(parents=True, exist_ok=True)
    transport = Transport(os.environ['WAHA_URL'], os.environ['WAHA_API_KEY'])
    store = Store(path, transport, actor=os.environ['BULK_USERNAME'])
    stop = threading.Event()

    def work():
        while not stop.wait(1):
            try:
                store.tick()
            except Exception:
                # A claimed send remains recoverable/uncertain on startup; never loop and resend it.
                with store.db() as db:
                    recovery = [r[0] for r in db.execute("SELECT id FROM campaign WHERE state='running'")]
                    db.execute("UPDATE recipient SET state='uncertain',error='worker_failure' WHERE state='sending'")
                    db.execute("UPDATE campaign SET state='uncertain',error='worker_failure' WHERE state='running'")
                    for campaign in recovery:
                        store.event(db, campaign, 'worker_failure')

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    server = ThreadingHTTPServer(('0.0.0.0', 8080), handler(store, os.environ['BULK_USERNAME'],
                               os.environ['BULK_PASSWORD'], os.environ['BULK_ORIGIN']))
    try:
        server.serve_forever()
    finally:
        stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
