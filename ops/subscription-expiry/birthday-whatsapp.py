#!/usr/bin/env python3
"""Birthday win-back WhatsApp message (Nutreeze).

Who: Partner customers whose birthday is today (Asia/Kuwait), who bought at least one subscription, whose last
subscription ended within the last BIRTHDAY_ENDED_DAYS days, and who have no current or upcoming subscription
(read from the ERPNext Partner mirror, see nutreeze_subscriptions). One message per customer per year.
How: same gentle rules as the renewal reminders — DAILY_CAP per day (most loyal first), random GAP_MIN..GAP_MAX
seconds between messages, nothing after SEND_UNTIL, opted-out numbers and numbers not on WhatsApp skipped,
halt for the day on the first send failure. Dry-run unless BIRTHDAY_LIVE=yes in birthday.env.
Reuses the sender/mailer helpers of whatsapp-reminder.py. Log: birthday.log (masked phones, no message text).
Ledger: table `birthday` in whatsapp-ledger.sqlite3 (shares the `optout` table with the reminders).

  birthday-whatsapp.py              daily run (systemd timer 11:00 Kuwait)
  birthday-whatsapp.py --test-to 9655XXXXXXX   send the message once to this number (name محمد)
  birthday-whatsapp.py --list      show today's queue only
"""
import datetime, importlib.util, json, os, random, sqlite3, subprocess, sys, time

DIR = '/opt/nutrezee/subscription-expiry'
OUT = '/var/log/nutrezee/subscription-expiry'
LOG = f'{OUT}/birthday.log'
LEDGER = f'{OUT}/whatsapp-ledger.sqlite3'
ENV = f'{DIR}/birthday.env'
TEMPLATE = f'{DIR}/birthday-message.txt'
DBQ = '/root/nzq.sh'  # read-only query helper for the ERPNext site DB
MAIL_TO = ['it@nutreeze.com']
MAIL_CC = ['callcenter@nutreeze.com']

spec = importlib.util.spec_from_file_location('reminder', f'{DIR}/whatsapp-reminder.py')
rem = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rem)
KW, SESSION = rem.KW, rem.SESSION


def now():
    return datetime.datetime.now(KW)


def log(msg):
    line = f"{now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with open(LOG, 'a') as fh:
        fh.write(line + '\n')


def conf():
    c = {'BIRTHDAY_LIVE': 'no', 'DAILY_CAP': '20', 'GAP_MIN': '240', 'GAP_MAX': '480', 'SEND_UNTIL': '20:00', 'BIRTHDAY_ENDED_DAYS': '365'}
    try:
        for line in open(ENV):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                c[k.strip()] = v.strip()
    except OSError:
        pass
    return c


def candidates(today, ended_days):
    """Birthday today, bought before, ended within `ended_days`, nothing current or upcoming; most loyal first."""
    sql = f"""
    SELECT c.name, c.customer_name, c.phone, c.paid_subscriptions, c.current_end_date, c.last_package,
        ROUND(c.lifetime_paid, 1), TIMESTAMPDIFF(YEAR, c.date_of_birth, '{today}')
    FROM `tabPartner Customer` c
    WHERE c.date_of_birth IS NOT NULL AND c.date_of_birth > '1920-01-01'
      AND DATE_FORMAT(c.date_of_birth, '%m-%d') = '{today:%m-%d}'
      AND c.paid_subscriptions > 0
      AND c.current_end_date IS NOT NULL AND c.current_end_date < '{today}'
      AND DATEDIFF('{today}', c.current_end_date) <= {int(ended_days)}
      AND NOT EXISTS (SELECT 1 FROM `tabPartner Subscription` s WHERE s.customer = c.name AND s.is_deleted = 0
                      AND s.status <> 'cancel' AND s.end_date >= '{today}')
    ORDER BY c.paid_subscriptions DESC, c.lifetime_paid DESC"""
    run = subprocess.run([DBQ, '-N', '-e', sql], capture_output=True, text=True, timeout=120)
    if run.returncode != 0:
        raise RuntimeError('ERPNext mirror query failed: ' + run.stderr.strip()[:200])
    rows = []
    for line in run.stdout.splitlines():
        p = line.split('\t')
        if len(p) < 8:
            continue
        rows.append({'customer_id': p[0], 'customer_name': p[1], 'mobile': p[2], 'paid_subscriptions': int(p[3] or 0),
                     'ended': p[4], 'package': p[5], 'lifetime_paid': p[6], 'age': p[7]})
    return rows


def compose(template, name):
    first = rem.first_name(name)
    return template.replace(' {name}', f' {first}' if first else '').replace('{name}', first)


def main():
    c = conf()
    live = c['BIRTHDAY_LIVE'].lower() == 'yes'
    template = open(TEMPLATE, encoding='utf-8').read().strip()
    today = now().date()
    db = sqlite3.connect(LEDGER)
    db.execute('CREATE TABLE IF NOT EXISTS birthday(phone TEXT, year INTEGER, customer_id TEXT, state TEXT, message_id TEXT, at TEXT, PRIMARY KEY(phone, year))')
    db.execute('CREATE TABLE IF NOT EXISTS optout(phone TEXT PRIMARY KEY, at TEXT, source TEXT)')
    if '--test-to' in sys.argv:
        phone = rem.normalize(sys.argv[sys.argv.index('--test-to') + 1])
        res = rem.waha('/api/sendText', {'session': SESSION, 'chatId': phone + '@c.us', 'text': compose(template, 'محمد')})
        log(f"TEST message to {rem.mask(phone)}: status {res.get('status')} id {res.get('id')}")
        return 0 if res.get('status') in (200, 201) else 2
    log(f"Starting birthday messages ({'LIVE' if live else 'DRY-RUN — nothing is sent'}; cap {c['DAILY_CAP']})")
    try:
        rows = candidates(today, c['BIRTHDAY_ENDED_DAYS'])
    except RuntimeError as exc:
        log(f'ERROR {exc}')
        return 2
    queue, skipped = [], {'already_this_year': 0, 'opted_out': 0, 'bad_phone': 0}
    for r in rows:
        phone = rem.normalize(r['mobile'])
        if not phone:
            skipped['bad_phone'] += 1
            continue
        if db.execute('SELECT 1 FROM birthday WHERE phone=? AND year=?', (phone, today.year)).fetchone():
            skipped['already_this_year'] += 1
            continue
        if db.execute('SELECT 1 FROM optout WHERE phone=?', (phone,)).fetchone():
            skipped['opted_out'] += 1
            continue
        queue.append((phone, r))
    cap = int(c['DAILY_CAP'])
    over = max(len(queue) - cap, 0)
    queue = queue[:cap]
    log(f"Birthdays today: {len(rows)}; to message now: {len(queue)} (cap {cap}, beyond cap {over}); skipped: {json.dumps(skipped)}")
    if '--list' in sys.argv or not live:
        for phone, r in queue:
            log(f"  {rem.mask(phone)} subs {r['paid_subscriptions']} ended {r['ended']} age {r['age']} name usable: {bool(rem.first_name(r['customer_name']))}")
        return 0
    if not queue:
        return 0
    if not rem.waha(f'/api/sessions/{SESSION}').get('state') == 'WORKING':
        log('ERROR WhatsApp session is not WORKING — nothing sent')
        return 2
    gap_min, gap_max = max(120, int(c['GAP_MIN'])), max(180, int(c['GAP_MAX']))
    until = datetime.datetime.combine(today, datetime.time.fromisoformat(c['SEND_UNTIL']), KW)
    sent, no_whatsapp, failed, sent_rows = 0, 0, 0, []
    for i, (phone, r) in enumerate(queue):
        if now() >= until:
            log(f"stopped at {c['SEND_UNTIL']} with {len(queue) - i} customer(s) left (they get no message this year)")
            break
        stamp = now().isoformat()
        try:
            if not rem.waha(f'/api/contacts/check-exists?session={SESSION}&phone={phone}').get('exists'):
                no_whatsapp += 1
                db.execute('INSERT OR IGNORE INTO birthday VALUES(?,?,?,?,?,?)', (phone, today.year, r['customer_id'], 'no_whatsapp', '', stamp))
                db.commit()
                continue
            db.execute('INSERT OR IGNORE INTO birthday VALUES(?,?,?,?,?,?)', (phone, today.year, r['customer_id'], 'uncertain', '', stamp))
            db.commit()
            res = rem.waha('/api/sendText', {'session': SESSION, 'chatId': phone + '@c.us', 'text': compose(template, r['customer_name'])})
            if res.get('status') not in (200, 201) or not res.get('id'):
                raise RuntimeError(f"send returned status {res.get('status')}")
            db.execute("UPDATE birthday SET state='sent', message_id=? WHERE phone=? AND year=?", (str(res['id']), phone, today.year))
            db.commit()
            sent += 1
            sent_rows.append((today.isoformat(), r['customer_name'], '+' + phone, r['package'], r['ended'], r['paid_subscriptions']))
            log(f"sent {sent}/{len(queue)} to {rem.mask(phone)}")
        except Exception as exc:
            failed += 1
            log(f"ERROR sending to {rem.mask(phone)}: {exc} — halting for today")
            break
        if i < len(queue) - 1:
            time.sleep(random.randint(gap_min, gap_max))
    log(f"Done: sent {sent}, not on WhatsApp {no_whatsapp}, failed {failed}, beyond cap {over}")
    if sent or failed:
        sheet = rem.xlsx([('Date', 'Customer name', 'Phone', 'Last package', 'Subscription ended', 'Subscriptions')] + sent_rows)
        body = (f"Birthday win-back messages — {today}\n\nSent: {sent}\nNot on WhatsApp: {no_whatsapp}\nFailed: {failed}\n"
                f"Birthdays today beyond the daily cap ({cap}): {over}\n\nSheet attached: customers messaged today.\n")
        ok = rem.mail(f'Nutreeze birthday messages {today}: {sent} sent', body, f'birthday-messages-{today}.xlsx', sheet, MAIL_TO, MAIL_CC)
        log(f"Summary email to {', '.join(MAIL_TO)}: {'sent' if ok else 'FAILED'}")
    return 0 if not failed else 2


if __name__ == '__main__':
    sys.exit(main())
