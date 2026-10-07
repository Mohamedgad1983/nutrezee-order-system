#!/usr/bin/env python3
"""WP-OPS-A73 — point Fleetbase's driver login code at the WAHA relay (settings rows only; originals kept in /root/a73).
Usage: otp-switch.py apply|rollback|show. Prints no secret."""
import json, os, subprocess, sys, time
BK = '/root/a73'; os.makedirs(BK, mode=0o700, exist_ok=True)
KEYS = ('system.services.sms.providers', 'system.sms.default_provider')
def mysql(q, inp=None):
    return subprocess.run(['docker', 'exec', '-i', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', '--raw', 'fleetbase', '-e', q],
                          capture_output=True, text=True, input=inp, stdin=None if inp else subprocess.DEVNULL)
def rows():
    out = mysql("select `key`, value from settings where `key` in ('%s','%s')" % KEYS).stdout
    return {l.split('\t', 1)[0]: l.split('\t', 1)[1] for l in out.splitlines() if '\t' in l}
def setv(key, value):
    hexv = value.encode().hex()
    r = mysql(f"update settings set value=cast(unhex('{hexv}') as char character set utf8mb4) where `key`='{key}'")
    if r.returncode: sys.exit('update failed: ' + r.stderr[:200])
def reload():
    r = subprocess.run(['docker', 'exec', 'fleetbase-application-1', 'php', '/fleetbase/api/artisan', 'octane:reload'], capture_output=True, text=True, stdin=subprocess.DEVNULL)
    print('octane:reload', 'ok' if r.returncode == 0 else 'FAILED ' + (r.stdout + r.stderr)[-200:])
def show():
    for k, v in rows().items():
        d = json.loads(v)
        if isinstance(d, dict):
            c = d.get('custom_http', {})
            print(k, {'url': c.get('url'), 'body': c.get('body'), 'auth_header': c.get('auth_header'), 'token_len': len(c.get('auth_token') or ''), 'enabled': c.get('enabled')})
        else: print(k, d)
mode = sys.argv[1] if len(sys.argv) > 1 else 'show'
if mode == 'apply':
    cur = rows()
    path = f'{BK}/sms-settings-before-{time.strftime("%Y%m%dT%H%M%S")}.json'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, json.dumps(cur).encode()); os.close(fd)
    if not os.path.exists(f'{BK}/sms-settings-original.json'):
        fd = os.open(f'{BK}/sms-settings-original.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600); os.write(fd, json.dumps(cur).encode()); os.close(fd)
    token = next(l.split('=', 1)[1].strip() for l in open('/opt/waha/otp-relay/.env') if l.startswith('RELAY_TOKEN='))
    providers = json.loads(cur[KEYS[0]])
    providers['custom_http'] = {'url': 'http://waha-otp-relay:8080/send', 'method': 'POST', 'enabled': True, 'from': '',
                                'body': {'to': '{{to}}', 'text': '{{text}}'},
                                'auth_header': 'X-Relay-Token', 'auth_token': token, 'headers': [], 'query_params': [],
                                'message_id_path': 'message_id', 'status_path': 'status', 'error_path': 'error'}
    setv(KEYS[0], json.dumps(providers)); setv(KEYS[1], json.dumps('custom_http')); reload(); show()
elif mode == 'rollback':
    orig = json.load(open(f'{BK}/sms-settings-original.json'))
    for k in KEYS: setv(k, orig[k])
    reload(); show()
else: show()
