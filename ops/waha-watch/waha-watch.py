#!/usr/bin/env python3
"""A106 (owner 2026-11-16): alert it@nutreeze.com when the WAHA WhatsApp session 'nutreeze' stops, and again when it is back.

Every 5 minutes: read the session status. Not WORKING twice in a row -> one restart attempt, then one email
(WhatsApp itself cannot carry the alert). No repeat emails while it stays down; one 'back' email when WORKING again.
"""
import json
import os
import subprocess
import sys
import time

STATE = '/opt/waha/watch/state.json'
TO = ['it@nutreeze.com']
MAIL_CONTAINER = 'fleetbase-application-1'
NUMBER = '+965 56617146'


def key():
    env = subprocess.run(['docker', 'inspect', 'waha-api', '--format', '{{range .Config.Env}}{{println .}}{{end}}'],
                         capture_output=True, text=True, timeout=30).stdout
    return next((l.split('=', 1)[1] for l in env.splitlines() if l.startswith('WAHA_API_KEY_PLAIN=')), '')


def api(path, method='GET'):
    js = ("fetch('http://localhost:3000" + path + "',{method:'" + method + "',headers:{'X-Api-Key':process.argv[1]}})"
          ".then(async r=>console.log(r.status+' '+(await r.text())))")
    out = subprocess.run(['docker', 'exec', 'waha-api', 'node', '-e', js, key()], capture_output=True, text=True, timeout=60).stdout.strip()
    code, _, body = out.partition(' ')
    return code, body


def status():
    try:
        code, body = api('/api/sessions/nutreeze')
        if code != '200':
            return f'HTTP {code or "no answer"}'
        return json.loads(body).get('status', '?')
    except Exception as e:  # container down, timeout, ...
        return f'unreachable ({type(e).__name__})'


def mail(subject, body):
    tmp = {'/tmp/wawatch-body.txt': body, '/tmp/wawatch-subject.txt': subject}
    try:
        for path, content in tmp.items():
            subprocess.run(['docker', 'exec', '-i', MAIL_CONTAINER, 'sh', '-c', f'cat > {path}'], input=content.encode(), check=True, timeout=60)
        php = ("$b = file_get_contents('/tmp/wawatch-body.txt'); $s = file_get_contents('/tmp/wawatch-subject.txt');"
               "Illuminate\\Support\\Facades\\Mail::raw($b, function ($m) use ($s) { $m->to(" + json.dumps(TO) + ")->subject($s); });"
               "echo 'MAIL_SENT', PHP_EOL;")
        res = subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'php', '-d', 'error_reporting=0', 'artisan', 'tinker', '--execute', php],
                             capture_output=True, text=True, timeout=180).stdout
        return 'MAIL_SENT' in res
    finally:
        subprocess.run(['docker', 'exec', MAIL_CONTAINER, 'rm', '-f', *tmp.keys()], capture_output=True, timeout=60)


def main():
    st = json.load(open(STATE)) if os.path.isfile(STATE) else {'bad': 0, 'alerted': False}
    now = time.strftime('%Y-%m-%d %H:%M', time.localtime())
    s = status()
    out = {'at': now, 'status': s}
    if s == 'WORKING':
        if st.get('alerted'):
            ok = mail('WhatsApp is working again / الواتساب رجع يشتغل',
                      f'The Nutreeze WhatsApp ({NUMBER}) is connected again at {now} Kuwait.\n'
                      f'واتساب Nutreeze ({NUMBER}) رجع يشتغل.\n')
            out['mail'] = 'back: ' + ('sent' if ok else 'FAILED')
        st = {'bad': 0, 'alerted': False}
    else:
        st['bad'] = st.get('bad', 0) + 1
        if st['bad'] == 2:
            # One restart attempt: a dropped connection (e.g. 2026-11-16 'Connection dropped') can come back by itself.
            api('/api/sessions/nutreeze/restart', 'POST')
            time.sleep(20)
            s = status()
            out['after_restart'] = s
            if s == 'WORKING':
                st = {'bad': 0, 'alerted': False}
        if st.get('bad', 0) >= 2 and not st.get('alerted'):
            link = ('It needs to be linked again: ask Claude for a "link with phone number" code, or scan the QR on '
                    'https://wa.13-140-159-201.sslip.io/dashboard/ (session nutreeze).') if s in ('SCAN_QR_CODE', 'FAILED') else \
                   'An automatic restart did not fix it.'
            ok = mail('WhatsApp stopped / الواتساب وقف',
                      f'The Nutreeze WhatsApp ({NUMBER}) stopped at {now} Kuwait. Status: {s}.\n{link}\n\n'
                      f'واتساب Nutreeze ({NUMBER}) وقف. الحالة: {s}. محتاج يتربط تاني (كود بالرقم أو QR).\n'
                      'Driver login codes and WhatsApp messages do not go out until it is back.\n')
            out['mail'] = 'down: ' + ('sent' if ok else 'FAILED')
            st['alerted'] = ok
    json.dump(st, open(STATE, 'w'))
    print(json.dumps(out))


if __name__ == '__main__':
    sys.exit(main())
