#!/usr/bin/env python3
"""Read-only deployment checks; print no credentials or customer/session details."""
import base64
import json
from pathlib import Path
import urllib.error
import urllib.request

ENV = dict(line.split('=', 1) for line in Path('/opt/waha/.env').read_text().splitlines()
           if '=' in line and not line.startswith('#'))
BASE = ENV['WAHA_PUBLIC_URL']

def check(path, expected, headers=None):
    request = urllib.request.Request(BASE + path, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    assert status == expected, f'{path}: expected {expected}, got {status}'
    print(f'PASS {path} HTTP {status}')
    return body

check('/api/sessions', 401)
check('/api/sessions', 401, {'X-Api-Key': 'invalid-key'})
sessions = json.loads(check('/api/sessions', 200, {'X-Api-Key': ENV['WAHA_API_KEY_PLAIN']}))
assert isinstance(sessions, list) and len(sessions) == 0, 'Deployment must not create a session'
print('PASS no WhatsApp sessions created')
check('/dashboard/', 401)
credentials = base64.b64encode((ENV['WAHA_DASHBOARD_USERNAME'] + ':' +
                                ENV['WAHA_DASHBOARD_PASSWORD']).encode()).decode()
check('/dashboard/', 200, {'Authorization': 'Basic ' + credentials})
check('/', 401)
credentials = base64.b64encode((ENV['WHATSAPP_SWAGGER_USERNAME'] + ':' +
                                ENV['WHATSAPP_SWAGGER_PASSWORD']).encode()).decode()
check('/', 200, {'Authorization': 'Basic ' + credentials})
print('PASS trusted HTTPS certificate')
