#!/usr/bin/env python3
"""Nutreeze renewal reminders over WhatsApp (WAHA session "nutreeze"), gentle mode.

After the 24 h WhatsApp block of 2026-10-03 the owner chose to keep this channel but make it far less
spam-like: a personal message (customer first name, no link, no promo code, opt-out line), a daily cap,
long random gaps, and a full stop for the day on the first problem.

  * DRY-RUN unless WHATSAPP_LIVE=yes in whatsapp.env (owner decision)
  * only today's ACTION_REQUIRED customers with REMIND_DAYS days left; one reminder per subscription
  * at most DAILY_CAP messages per day; GAP_MIN..GAP_MAX seconds between messages; nothing after SEND_UNTIL
  * skips opted-out numbers (reply "إيقاف"/"stop", or --optout), numbers not on WhatsApp, anyone messaged
    in the last 7 days (ledger) or in a Bulk-page campaign of the last 10 days
  * first failed/uncertain send, or a disconnected session, halts sending for the rest of the day
  * customers not reached stay "not sent" in the next morning's call list for customer service
  * summary email + Excel sheet when the run ends; no message text or full phone numbers in the log

Usage: whatsapp-reminder.py                         daily run
       whatsapp-reminder.py --days 1,2                one-off run for other days-remaining values
       whatsapp-reminder.py --optout 9655XXXXXXX     never message this number again
       whatsapp-reminder.py --test-to 9655XXXXXXX   send the message once to one number (owner test)
       whatsapp-reminder.py --report-email          email today's follow-up list to customer service
       whatsapp-reminder.py --email-only            send today's summary email again from the ledger
"""
import datetime, fcntl, io, json, os, random, re, sqlite3, subprocess, sys, time, zipfile, zoneinfo
from xml.sax.saxutils import escape

DIR = '/opt/nutrezee/subscription-expiry'
OUT = '/var/log/nutrezee/subscription-expiry'
REPORT = f'{OUT}/latest_action_required.json'
LEDGER = f'{OUT}/whatsapp-ledger.sqlite3'
LOG = f'{OUT}/whatsapp.log'
BULK_DB = '/opt/waha/bulk-data/campaigns.sqlite3'
SESSION = 'nutreeze'
MAIL_TO = ['it@nutreeze.com']  # sender is the server mailer's hello@nutreeze.com
MAIL_CC = ['callcenter@nutreeze.com']
REPORT_TO = ['callcenter@nutreeze.com']  # daily call list
REPORT_CC = ['it@nutreeze.com']
MAIL_CONTAINER = 'fleetbase-application-1'
KW = zoneinfo.ZoneInfo('Asia/Kuwait')
DAY_PHRASE = {1: 'يوم واحد', 2: 'يومين', 3: '3 أيام'}

NODE = r"""
let b='';process.stdin.on('data',d=>b+=d).on('end',async()=>{const q=JSON.parse(b);
const r=await fetch('http://127.0.0.1:3000'+q.path,{method:q.body?'POST':'GET',signal:AbortSignal.timeout(45000),
headers:{'X-Api-Key':process.env.WAHA_API_KEY_PLAIN,'Content-Type':'application/json'},body:q.body?JSON.stringify(q.body):undefined});
let j=null;try{j=await r.json()}catch(e){}
console.log(JSON.stringify({status:r.status,id:j&&(j.id&&(j.id._serialized||j.id.id||j.id)||j.key&&j.key.id)||null,
exists:j&&j.numberExists,state:j&&j.status,
texts:Array.isArray(j)?j.filter(m=>!m.fromMe).map(m=>String(m.body||'').slice(0,40)):undefined}))});
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


def bulk_db():
    return sqlite3.connect(f'file:{BULK_DB}?mode=ro', uri=True)


def settings():
    conf = {'WHATSAPP_LIVE': 'no', 'REMIND_DAYS': '3', 'DAILY_CAP': '40', 'GAP_MIN': '240', 'GAP_MAX': '480', 'SEND_UNTIL': '20:00'}
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


def first_name(name):
    """Greeting name: the first word of the legacy customer name, only when it looks like a real name."""
    word = (name or '').strip().split(' ')[0].strip('.,-_')
    return word if re.fullmatch(r"[^\W\d_]{2,20}", word) else ''


def compose(template, name, days):
    text = template.replace('{days}', DAY_PHRASE.get(days, f'{days} أيام'))
    name = first_name(name)
    return re.sub(r' ?\{name\}', ' ' + name if name else '', text)


OPT_OUT = re.compile(r'إيقاف|ايقاف|أوقف|اوقف|\bstop\b|unsubscribe', re.I)


def collect_optouts(db):
    """Best effort: a customer we reminded in the last 14 days who replied "إيقاف"/"stop" is never messaged again."""
    since = (now() - datetime.timedelta(days=14)).isoformat()
    found = 0
    for (phone,) in db.execute("SELECT DISTINCT phone FROM reminder WHERE state='sent' AND at>? AND phone NOT IN (SELECT phone FROM optout)", (since,)).fetchall():
        try:
            texts = waha(f'/api/{SESSION}/chats/{phone}@c.us/messages?limit=10&downloadMedia=false').get('texts') or []
        except Exception:
            continue
        if any(OPT_OUT.search(t) for t in texts):
            db.execute('INSERT OR IGNORE INTO optout VALUES(?,?,?)', (phone, now().isoformat(), 'reply'))
            found += 1
    db.commit()
    return found


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


def mail(subject, body, name, sheet, to, cc):
    """Send through the server mailer (hello@nutreeze.com) with one .xlsx attached."""
    tmp = {'/tmp/nzrem-body.txt': body.encode(), '/tmp/nzrem-subject.txt': subject.encode(), f'/tmp/{name}': sheet}
    try:
        for path, content in tmp.items():
            subprocess.run(['docker', 'exec', '-i', MAIL_CONTAINER, 'sh', '-c', f'cat > {path}'], input=content, check=True, timeout=60)
        php = ("$b = file_get_contents('/tmp/nzrem-body.txt'); $s = file_get_contents('/tmp/nzrem-subject.txt');"
               "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(to) + ")->cc(" + json.dumps(cc) + ")->subject($s)"
               "->attach('/tmp/" + name + "', ['as' => '" + name + "', 'mime' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']); });"
               "echo 'MAIL_SENT', PHP_EOL;")
        res = subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php],
                             capture_output=True, text=True, timeout=180).stdout
        return 'MAIL_SENT' in res
    except Exception:
        return False
    finally:
        subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'rm', '-f', *tmp.keys()], capture_output=True, timeout=60)


def report_email(today):
    """Daily call list for customer service: today's ACTION_REQUIRED customers as an Excel sheet."""
    try:
        report = json.load(open(REPORT, encoding='utf-8'))
    except (OSError, ValueError):
        return fail('action-required report missing or unreadable — call list not emailed')
    if report.get('today') != today or report.get('report') != 'ACTION_REQUIRED' or not report.get('active_orders_read'):
        return fail('action-required report is not from today — call list not emailed')
    reminded = {}
    try:
        for phone, state in sqlite3.connect(LEDGER).execute("SELECT phone,state FROM reminder WHERE at>?", ((now() - datetime.timedelta(days=7)).isoformat(),)):
            reminded[phone] = state
    except sqlite3.Error:
        pass
    rows = [('Date', 'Customer name', 'Phone', 'Package', 'End date', 'Days left', 'Area', 'WhatsApp reminder')]
    for c in report['customers']:
        phone = normalize(c.get('mobile'))
        rows.append((today, c.get('customer_name', ''), '+' + phone if phone else c.get('mobile', ''), c.get('package', ''), c.get('end_date', ''),
                     c.get('days_remaining', ''), c.get('area', ''), 'sent' if reminded.get(phone) == 'sent' else 'not sent'))
    n = len(rows) - 1
    by = {}
    for c in report['customers']:
        by[c['days_remaining']] = by.get(c['days_remaining'], 0) + 1
    subject = f'Nutreeze subscriptions ending within 3 days — {today}: {n} customers to follow up'
    body = (f'قائمة متابعة التجديد — {today}\n'
            f'عدد العملاء اللي اشتراكهم هينتهي خلال 3 أيام ومحتاجين متابعة: {n}\n'
            f"باقي يوم: {by.get(1, 0)} — باقي يومين: {by.get(2, 0)} — باقي 3 أيام: {by.get(3, 0)}\n"
            'العملاء اللي جددوا فعلاً مش في القائمة.\n'
            '\nالتفاصيل في ملف الإكسيل المرفق.\n'
            f'\nRenewal follow-up list {today}: {n} customers whose subscription ends within 3 days and who have not renewed. Details in the attached sheet.\n')
    ok = mail(subject, body, f'renewal-follow-up-{today}.xlsx', xlsx(rows), REPORT_TO, REPORT_CC)
    log(f"Call-list email to {', '.join(REPORT_TO)} cc {', '.join(REPORT_CC)} ({n} customers): {'sent' if ok else 'FAILED'}")
    return 0 if ok else 2


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
            '')
    ok = mail(subject, body, f'renewal-reminders-{today}.xlsx', xlsx([('Date', 'Customer name', 'Phone')] + sent), MAIL_TO, MAIL_CC)
    log(f"Summary email to {', '.join(MAIL_TO)} cc {', '.join(MAIL_CC)} ({len(sent)} rows in the sheet): {'sent' if ok else 'FAILED'}")
    return ok


def main():
    os.umask(0o077)
    conf = settings()
    if '--days' in sys.argv:  # one-off catch-up, e.g. --days 1,2
        conf['REMIND_DAYS'] = sys.argv[sys.argv.index('--days') + 1]
    today = now().date().isoformat()
    template = open(f'{DIR}/whatsapp-message.txt', encoding='utf-8').read().strip()
    if not template:
        return fail('message file is empty')
    if '--optout' in sys.argv:
        phone = normalize(sys.argv[sys.argv.index('--optout') + 1]) or re.sub(r'\D', '', sys.argv[sys.argv.index('--optout') + 1])
        db = sqlite3.connect(LEDGER)
        db.execute('CREATE TABLE IF NOT EXISTS optout(phone TEXT PRIMARY KEY, at TEXT, source TEXT)')
        db.execute('INSERT OR IGNORE INTO optout VALUES(?,?,?)', (phone, now().isoformat(), 'manual'))
        db.commit()
        log(f'opt-out recorded for {mask(phone)}')
        return 0
    if '--report-email' in sys.argv:
        return report_email(today)
    if '--email-only' in sys.argv:
        return 0 if send_email(today) else 2
    if '--test-to' in sys.argv:
        phone = re.sub(r'\D', '', sys.argv[sys.argv.index('--test-to') + 1])
        if waha(f'/api/sessions/{SESSION}').get('state') != 'WORKING':
            return fail('WhatsApp session is not connected')
        res = waha('/api/sendText', {'session': SESSION, 'chatId': phone + '@c.us', 'text': compose(template, 'محمد', 3)})
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
    cap, gap_min, gap_max = int(conf['DAILY_CAP']), max(120, int(conf['GAP_MIN'])), max(180, int(conf['GAP_MAX']))
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
    db.execute('CREATE TABLE IF NOT EXISTS optout(phone TEXT PRIMARY KEY, at TEXT, source TEXT)')
    db.commit()
    try:
        recent = {p[-8:] for (p,) in bulk_db().execute(
            "SELECT r.phone FROM recipient r JOIN campaign c ON c.id=r.campaign_id WHERE r.state IN ('sending','sent','uncertain') AND c.created>?",
            (time.time() - 10 * 86400,))}
    except sqlite3.Error as exc:
        return fail(f'cannot read the Bulk history ({exc.__class__.__name__}) — refusing to send')
    queue, skipped = [], {}

    def skip(reason):
        skipped[reason] = skipped.get(reason, 0) + 1

    for c in report['customers']:
        if c.get('classification') != 'ACTION_REQUIRED' or c['days_remaining'] not in days_ok:
            skip('not_in_reminder_days'); continue
        phone = normalize(c.get('mobile'))
        if not phone:
            skip('phone_not_kuwait_mobile'); continue
        if db.execute('SELECT 1 FROM optout WHERE phone=?', (phone,)).fetchone():
            skip('opted_out'); continue
        if db.execute('SELECT 1 FROM reminder WHERE phone=? AND end_date=?', (phone, c['end_date'])).fetchone():
            skip('already_reminded'); continue
        if phone[-8:] in recent or db.execute('SELECT 1 FROM reminder WHERE phone=? AND at>?', (phone, (now() - datetime.timedelta(days=7)).isoformat())).fetchone():
            skip('reminded_recently'); continue
        queue.append((phone, c))
    halt = f'{OUT}/.whatsapp-halt-{today}'
    done_today = db.execute("SELECT count(*) FROM reminder WHERE state='sent' AND substr(at,1,10)=?", (today,)).fetchone()[0]
    room = max(0, cap - done_today)
    over = max(0, len(queue) - room)
    queue = queue[:room]
    log(f"Customers in report: {len(report['customers'])}; to remind now: {len(queue)} (daily cap {cap}, already sent today {done_today}, left for the call centre: {over}); skipped: {json.dumps(skipped, ensure_ascii=False)}")
    if not live:
        if queue:
            log(f"DRY-RUN sample text length {len(compose(template, queue[0][1].get('customer_name'), queue[0][1]['days_remaining']))} chars; names usable: {sum(1 for _, c in queue if first_name(c.get('customer_name')))}/{len(queue)}")
        log(f'DRY-RUN complete: {len(queue)} message(s) would be sent over about {len(queue) * (gap_min + gap_max) // 120} minutes. Job completed successfully')
        return 0
    if os.path.exists(halt):
        return fail('sending was halted earlier today after a problem — nothing sent (remove the halt file only on the owner\'s word)')
    if not queue:
        log('Nothing to send. Job completed successfully')
        return 0
    if waha(f'/api/sessions/{SESSION}').get('state') != 'WORKING':
        open(halt, 'w').close()
        send_email(today, 'الواتساب غير متصل — لم تُرسل أي رسالة اليوم. / WhatsApp session not connected: nothing sent.')
        return fail('WhatsApp session is not connected — nothing sent')
    new_optouts = collect_optouts(db)
    if new_optouts:
        log(f'New opt-outs from replies: {new_optouts}')
    until = datetime.datetime.combine(now().date(), datetime.time.fromisoformat(conf['SEND_UNTIL']), KW)
    sent = no_whatsapp = 0
    problem = ''
    for i, (phone, c) in enumerate(queue):
        if now() >= until:
            problem = f'stopped at {conf["SEND_UNTIL"]} with {len(queue) - i} customer(s) left for the call centre'
            break
        if db.execute('SELECT 1 FROM optout WHERE phone=?', (phone,)).fetchone():
            continue
        stamp = now().isoformat()
        try:
            if not waha(f'/api/contacts/check-exists?session={SESSION}&phone={phone}').get('exists'):
                no_whatsapp += 1
                db.execute('INSERT INTO reminder VALUES(?,?,?,?,?,?,?)', (phone, c['end_date'], c['order_no'], c.get('customer_id', ''), 'no_whatsapp', '', stamp))
                db.commit()
                continue
            # ledger first: an interrupted send is recorded as uncertain and never repeated
            db.execute('INSERT INTO reminder VALUES(?,?,?,?,?,?,?)', (phone, c['end_date'], c['order_no'], c.get('customer_id', ''), 'uncertain', '', stamp))
            db.commit()
            res = waha('/api/sendText', {'session': SESSION, 'chatId': phone + '@c.us', 'text': compose(template, c.get('customer_name'), c['days_remaining'])})
        except Exception as exc:
            problem = f'send to {mask(phone)} uncertain ({exc.__class__.__name__}); sending halted for today after {sent} sent'
            break
        if res['status'] not in (200, 201) or not res.get('id'):
            problem = f"send to {mask(phone)} failed (http {res['status']}); sending halted for today after {sent} sent"
            break
        db.execute("UPDATE reminder SET state='sent', message_id=? WHERE phone=? AND end_date=?", (str(res['id']), phone, c['end_date']))
        db.commit()
        sent += 1
        if i < len(queue) - 1:
            time.sleep(random.uniform(gap_min, gap_max))
    if problem and 'halted' in problem:
        open(halt, 'w').close()
    log(f'Sent: {sent}; not on WhatsApp: {no_whatsapp}' + (f'; WARNING {problem}' if problem else ''))
    mailed = send_email(today, ('تنبيه: ' + problem) if problem else '')
    log('Job completed successfully' if not problem and mailed else 'Job completed with warnings')
    return 0 if not problem and mailed else 2


if __name__ == '__main__':
    sys.exit(main())
