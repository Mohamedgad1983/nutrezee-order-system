#!/usr/bin/env python3
"""Nutreeze renewal reminders over WhatsApp, sent as a campaign of the WAHA Bulk page.

Reads today's ACTION_REQUIRED list (subscription-expiry report), creates one campaign in the Bulk tool
(https://wa.13-140-159-201.sslip.io/dashboard/#bulk) and starts it, so the owner follows every message there.
The Bulk tool does the sending (session "nutreeze", 60 s between messages, stops on a failed/uncertain send).
When the campaign ends, a short email with an Excel sheet (date, customer name, phone) goes to the owner.

Safe by default:
  * DRY-RUN unless WHATSAPP_LIVE=yes in whatsapp.env (owner decision) — dry-run creates no campaign
  * refuses a report that is not from today (Asia/Kuwait) or that is empty/unreadable
  * one reminder per customer per subscription (ledger: phone + end date); skips customers already in any
    Bulk campaign of the last 10 days; skips numbers that are not on WhatsApp; hard cap per run
  * no message text and no full phone numbers in the log
Secrets never leave their containers: WAHA key (waha-api), Bulk login (waha-bulk), mailer (fleetbase).

Usage: whatsapp-reminder.py                         daily run
       whatsapp-reminder.py --test-to 9655XXXXXXX   send the message once to one number (owner test)
       whatsapp-reminder.py --email-only            send today's summary email again from the ledger
"""
import datetime, fcntl, io, json, os, re, sqlite3, subprocess, sys, time, zipfile, zoneinfo
from xml.sax.saxutils import escape

DIR = '/opt/nutrezee/subscription-expiry'
OUT = '/var/log/nutrezee/subscription-expiry'
REPORT = f'{OUT}/latest_action_required.json'
LEDGER = f'{OUT}/whatsapp-ledger.sqlite3'
LOG = f'{OUT}/whatsapp.log'
BULK_DB = '/opt/waha/bulk-data/campaigns.sqlite3'
SESSION = 'nutreeze'
MAIL_TO = ['it@nutreeze.com']  # sender is the server mailer's hello@nutreeze.com
MAIL_CONTAINER = 'fleetbase-application-1'
KW = zoneinfo.ZoneInfo('Asia/Kuwait')
DAY_PHRASE = {1: 'يوم واحد', 2: 'يومين', 3: '3 أيام'}

NODE = r"""
let b='';process.stdin.on('data',d=>b+=d).on('end',async()=>{const q=JSON.parse(b);
const r=await fetch('http://127.0.0.1:3000'+q.path,{method:q.body?'POST':'GET',signal:AbortSignal.timeout(45000),
headers:{'X-Api-Key':process.env.WAHA_API_KEY_PLAIN,'Content-Type':'application/json'},body:q.body?JSON.stringify(q.body):undefined});
let j=null;try{j=await r.json()}catch(e){}
console.log(JSON.stringify({status:r.status,id:j&&(j.id&&(j.id._serialized||j.id.id||j.id)||j.key&&j.key.id)||null,
exists:j&&j.numberExists,state:j&&j.status}))});
"""
BULK = r"""
import base64, json, os, sys, urllib.request, urllib.error
q = json.load(sys.stdin)
auth = base64.b64encode((os.environ['BULK_USERNAME'] + ':' + os.environ['BULK_PASSWORD']).encode()).decode()
req = urllib.request.Request('http://127.0.0.1:8080' + q['path'], method='POST' if q.get('body') is not None else 'GET',
    headers={'Authorization': 'Basic ' + auth, 'Origin': os.environ['BULK_ORIGIN'], 'Content-Type': 'application/json'},
    data=None if q.get('body') is None else json.dumps(q['body']).encode())
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.load(r)
        if 'campaigns' in out:
            out = {'campaigns': [{k: c[k] for k in ('id', 'state', 'error', 'counts', 'total')} for c in out['campaigns']]}
        print(json.dumps({'status': r.status, 'json': out}))
except urllib.error.HTTPError as e:
    print(json.dumps({'status': e.code, 'json': None}))
"""


def now():
    return datetime.datetime.now(KW)


def log(msg):
    line = f"{now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with open(LOG, 'a') as fh:
        fh.write(line + '\n')


def fail(msg):
    log(f'ERROR {msg}')
    return 2


def mask(phone):
    return phone[:5] + '***' + phone[-2:]


def waha(path, body=None):
    run = subprocess.run(['docker', 'exec', '-i', 'waha-api', 'node', '-e', NODE], input=json.dumps({'path': path, 'body': body}),
                         capture_output=True, text=True, timeout=75)
    return json.loads(run.stdout.strip().splitlines()[-1])


def bulk(path, body=None):
    run = subprocess.run(['docker', 'exec', '-i', 'waha-bulk', 'python', '-c', BULK], input=json.dumps({'path': path, 'body': body}),
                         capture_output=True, text=True, timeout=60)
    return json.loads(run.stdout.strip().splitlines()[-1])


def bulk_db():
    return sqlite3.connect(f'file:{BULK_DB}?mode=ro', uri=True)


def settings():
    conf = {'WHATSAPP_LIVE': 'no', 'REMIND_DAYS': '3', 'MAX_PER_RUN': '150'}
    try:
        for line in open(f'{DIR}/whatsapp.env'):
            if '=' in line and not line.lstrip().startswith('#'):
                k, v = line.strip().split('=', 1)
                conf[k] = v
    except FileNotFoundError:
        pass
    return conf


def normalize(mobile):
    digits = re.sub(r'\D', '', mobile or '')
    if re.fullmatch(r'[4569]\d{7}', digits):
        return '965' + digits
    if re.fullmatch(r'965[4569]\d{7}', digits):
        return digits
    return None


def xlsx(rows):
    """Minimal .xlsx (one sheet, text cells) with the standard library only."""
    def cell(v):
        return f'<c t="inlineStr"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'
    sheet = ''.join('<row>' + ''.join(cell(v) for v in row) + '</row>' for row in rows)
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reminders" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="34" customWidth="1"/><col min="3" max="3" width="18" customWidth="1"/></cols><sheetData>' + sheet + '</sheetData></worksheet>',
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content)
    return buf.getvalue()


def send_email(today, note=''):
    """Short summary + Excel sheet of today's sent reminders (date, customer name, phone)."""
    db = sqlite3.connect(LEDGER)
    rows = db.execute("SELECT phone,state FROM reminder WHERE substr(at,1,10)=? ORDER BY at", (today,)).fetchall()
    names = {}
    try:
        for c in json.load(open(f'{OUT}/{today}.json', encoding='utf-8'))['customers']:
            names[normalize(c.get('mobile'))] = c.get('customer_name', '')
    except (OSError, ValueError):
        pass
    sent = [(today, names.get(p, ''), '+' + p) for p, s in rows if s == 'sent']
    other = {}
    for _, s in rows:
        if s != 'sent':
            other[s] = other.get(s, 0) + 1
    subject = f'Nutreeze WhatsApp renewal reminders {today}: {len(sent)} sent'
    body = (f'تذكير تجديد الاشتراك — {today}\n'
            f'عدد العملاء اللي اتبعتلهم رسالة واتساب: {len(sent)}\n'
            + (f"لم تُرسل: {json.dumps(other, ensure_ascii=False)}\n" if other else '')
            + (note + '\n' if note else '')
            + '\nالتفاصيل في ملف الإكسيل المرفق (التاريخ، اسم العميل، رقم التليفون).\n'
            f'\nRenewal reminders {today}: {len(sent)} customers received the WhatsApp message. Details in the attached sheet.\n'
            'Follow the campaign: https://wa.13-140-159-201.sslip.io/dashboard/#bulk\n')
    name = f'renewal-reminders-{today}.xlsx'
    tmp = {'/tmp/nzrem-body.txt': body.encode(), '/tmp/nzrem-subject.txt': subject.encode(),
           f'/tmp/{name}': xlsx([('Date', 'Customer name', 'Phone')] + sent)}
    try:
        for path, content in tmp.items():
            subprocess.run(['docker', 'exec', '-i', MAIL_CONTAINER, 'sh', '-c', f'cat > {path}'], input=content, check=True, timeout=60)
        php = ("$b = file_get_contents('/tmp/nzrem-body.txt'); $s = file_get_contents('/tmp/nzrem-subject.txt');"
               "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(MAIL_TO) + ")->subject($s)"
               "->attach('/tmp/" + name + "', ['as' => '" + name + "', 'mime' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']); });"
               "echo 'MAIL_SENT', PHP_EOL;")
        res = subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php],
                             capture_output=True, text=True, timeout=180).stdout
        ok = 'MAIL_SENT' in res
    except Exception:
        ok = False
    finally:
        subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'rm', '-f', *tmp.keys()], capture_output=True, timeout=60)
    log(f"Summary email to {', '.join(MAIL_TO)} ({len(sent)} rows in the sheet): {'sent' if ok else 'FAILED'}")
    return ok


def main():
    os.umask(0o077)
    conf = settings()
    today = now().date().isoformat()
    template = open(f'{DIR}/whatsapp-message.txt', encoding='utf-8').read().strip()
    if not template:
        return fail('message file is empty')
    if '--email-only' in sys.argv:
        return 0 if send_email(today) else 2
    if '--test-to' in sys.argv:
        phone = re.sub(r'\D', '', sys.argv[sys.argv.index('--test-to') + 1])
        if waha(f'/api/sessions/{SESSION}').get('state') != 'WORKING':
            return fail('WhatsApp session is not connected')
        res = waha('/api/sendText', {'session': SESSION, 'chatId': phone + '@c.us', 'text': template.replace('{days}', DAY_PHRASE[3])})
        log(f"TEST message to {mask(phone)}: http {res['status']} id={'yes' if res.get('id') else 'no'}")
        return 0 if res['status'] in (200, 201) and res.get('id') else 2

    lock = open(f'{OUT}/.whatsapp.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log('another reminder run is in progress — skipped')
        return 75
    live = conf['WHATSAPP_LIVE'] == 'yes'
    days_ok = {int(d) for d in conf['REMIND_DAYS'].split(',')}
    cap = int(conf['MAX_PER_RUN'])
    log(f"Starting WhatsApp renewal reminders ({'LIVE' if live else 'DRY-RUN — nothing is sent'}; days {sorted(days_ok)})")
    try:
        report = json.load(open(REPORT, encoding='utf-8'))
    except (OSError, ValueError):
        return fail('action-required report missing or unreadable')
    if report.get('today') != today or report.get('report') != 'ACTION_REQUIRED':
        return fail(f"report is not from today ({report.get('today')}) — refusing to send from a stale list")
    if not report.get('active_orders_read'):
        return fail('report has no reading behind it')
    db = sqlite3.connect(LEDGER)
    db.execute('CREATE TABLE IF NOT EXISTS reminder(phone TEXT, end_date TEXT, order_no TEXT, customer_id TEXT, state TEXT, message_id TEXT, at TEXT, PRIMARY KEY(phone,end_date))')
    db.commit()
    try:
        recent = {p[-8:] for (p,) in bulk_db().execute(
            "SELECT r.phone FROM recipient r JOIN campaign c ON c.id=r.campaign_id WHERE r.state IN ('sending','sent','uncertain') AND c.created>?",
            (time.time() - 10 * 86400,))}
    except sqlite3.Error as exc:
        return fail(f'cannot read the Bulk history ({exc.__class__.__name__}) — refusing to send')
    groups, skipped = {}, {}

    def skip(reason):
        skipped[reason] = skipped.get(reason, 0) + 1

    for c in report['customers']:
        if c.get('classification') != 'ACTION_REQUIRED' or c['days_remaining'] not in days_ok:
            skip('not_in_reminder_days'); continue
        phone = normalize(c.get('mobile'))
        if not phone:
            skip('phone_not_kuwait_mobile'); continue
        if db.execute('SELECT 1 FROM reminder WHERE phone=? AND end_date=?', (phone, c['end_date'])).fetchone():
            skip('already_reminded'); continue
        if phone[-8:] in recent or db.execute('SELECT 1 FROM reminder WHERE phone=? AND at>?', (phone, (now() - datetime.timedelta(days=7)).isoformat())).fetchone():
            skip('reminded_recently'); continue
        groups.setdefault(c['days_remaining'], []).append((phone, c))
    total = sum(len(g) for g in groups.values())
    log(f"Customers in report: {len(report['customers'])}; to remind: {total}; skipped: {json.dumps(skipped, ensure_ascii=False)}")
    if total > cap:
        return fail(f'{total} recipients is above the safety cap of {cap} — nothing sent')
    if not live:
        log(f'DRY-RUN complete: {total} message(s) would be sent. Job completed successfully')
        return 0
    if total and waha(f'/api/sessions/{SESSION}').get('state') != 'WORKING':
        send_email(today, 'الواتساب غير متصل — لم تُرسل أي رسالة اليوم. / WhatsApp session not connected: nothing sent.')
        return fail('WhatsApp session is not connected — nothing sent')
    problems = []
    for days, group in sorted(groups.items(), reverse=True):
        stamp = now().isoformat()
        on_whatsapp = []
        for phone, c in group:
            ok = waha(f'/api/contacts/check-exists?session={SESSION}&phone={phone}').get('exists')
            db.execute('INSERT INTO reminder VALUES(?,?,?,?,?,?,?)', (phone, c['end_date'], c['order_no'], c.get('customer_id', ''), 'pending' if ok else 'no_whatsapp', '', stamp))
            if ok:
                on_whatsapp.append(phone)
        db.commit()
        if not on_whatsapp:
            continue
        name = f"Renewal {today} — {days} day{'s' if days != 1 else ''} — auto"
        made = bulk('/bulk/api/campaigns', {'name': name, 'message': template.replace('{days}', DAY_PHRASE.get(days, f'{days} أيام')), 'numbers': '\n'.join(on_whatsapp)})
        campaign = (made.get('json') or {}).get('id')
        if made['status'] != 201 or not campaign:
            db.execute("DELETE FROM reminder WHERE at=? AND state='pending'", (stamp,)); db.commit()
            problems.append(f'campaign for {days} day(s) could not be created (http {made["status"]})')
            continue
        started = bulk(f'/bulk/api/campaigns/{campaign}/start', {'confirmed': True})
        if started['status'] != 200:
            db.execute("DELETE FROM reminder WHERE at=? AND state='pending'", (stamp,)); db.commit()
            problems.append(f'campaign {campaign} could not start (http {started["status"]}) — it stays as a draft on the Bulk page')
            continue
        log(f'Bulk campaign {campaign} started: "{name}", {len(on_whatsapp)} recipient(s)')
        deadline = time.time() + len(on_whatsapp) * 150 + 900
        state = 'running'
        while state == 'running' and time.time() < deadline:
            time.sleep(20)
            state = bulk_db().execute('SELECT state FROM campaign WHERE id=?', (campaign,)).fetchone()[0]
        counts = {}
        for phone, rstate, mid in bulk_db().execute('SELECT phone,state,message_id FROM recipient WHERE campaign_id=?', (campaign,)):
            counts[rstate] = counts.get(rstate, 0) + 1
            if rstate == 'pending':  # never attempted: free it so a later run may remind this customer
                db.execute("DELETE FROM reminder WHERE phone=? AND at=?", (phone, stamp))
            else:
                db.execute('UPDATE reminder SET state=?, message_id=? WHERE phone=? AND at=?', (rstate, mid or '', phone, stamp))
        db.commit()
        log(f'Bulk campaign {campaign} ended: state {state}, {json.dumps(counts)}')
        if state != 'complete':
            problems.append(f'campaign {campaign} stopped in state "{state}" — open the Bulk page to review/resume')
    for p in problems:
        log(f'WARNING {p}')
    note = ('تنبيه: ' + ' | '.join(problems)) if problems else ''
    mailed = send_email(today, note)
    log('Job completed successfully' if not problems and mailed else 'Job completed with warnings')
    return 0 if not problems and mailed else 2


if __name__ == '__main__':
    sys.exit(main())
