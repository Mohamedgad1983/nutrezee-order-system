"""WP-OPS-A73 — driver login codes: Fleetbase → this relay → WAHA.

Fleetbase's custom HTTP SMS provider can only template the recipient as it stores it ("+965…"),
and WAHA never answers a chat id that carries the plus sign. This relay accepts {to, text} with a
shared secret, keeps the digits of the number and forwards one text to the fixed WAHA session.
Internal network only, no host port. It stores nothing and logs no number and no message text.
"""
import hmac
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WAHA_URL = os.environ.get('WAHA_URL', 'http://waha-api:3000').rstrip('/')
WAHA_KEY = os.environ['WAHA_API_KEY']
SESSION = os.environ.get('WAHA_SESSION', 'nutreeze')
TOKEN = os.environ['RELAY_TOKEN']
HOURLY_LIMIT = int(os.environ.get('RELAY_HOURLY_LIMIT', '40'))
MAX_TEXT = 500
_sent = []
_lock = threading.Lock()


def digits_of(value):
    text = str(value or '').strip()
    digits = re.sub(r'\D', '', text)
    if digits.startswith('00'):
        digits = digits[2:]
    return digits if 8 <= len(digits) <= 15 else None


def allow(now=None):
    """A hard ceiling on messages per hour, so a login loop can never flood the WhatsApp number."""
    now = time.time() if now is None else now
    with _lock:
        _sent[:] = [t for t in _sent if now - t < 3600]
        if len(_sent) >= HOURLY_LIMIT:
            return False
        _sent.append(now)
        return True


def forward(digits, text, opener=urllib.request.urlopen):
    body = json.dumps({'session': SESSION, 'chatId': f'{digits}@c.us', 'text': text}).encode()
    request = urllib.request.Request(f'{WAHA_URL}/api/sendText', data=body, method='POST', headers={
        'Content-Type': 'application/json', 'X-Api-Key': WAHA_KEY})
    with opener(request, timeout=20) as response:
        payload = json.loads(response.read() or b'{}')
    message_id = payload.get('id') if isinstance(payload, dict) else None
    return message_id if isinstance(message_id, str) and message_id else None


class Handler(BaseHTTPRequestHandler):
    server_version = 'nz-otp-relay'

    def log_message(self, *_args):  # default access log would be noise; outcomes are logged below
        return

    def answer(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.answer(200, {'status': 'ok'}) if self.path == '/health' else self.answer(404, {'error': 'not_found'})

    def do_POST(self):
        if self.path != '/send':
            return self.answer(404, {'error': 'not_found'})
        if not hmac.compare_digest(self.headers.get('X-Relay-Token', ''), TOKEN):
            return self.answer(401, {'error': 'unauthorized'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 4096:
                raise ValueError
            body = json.loads(self.rfile.read(length))
            digits, text = digits_of(body.get('to')), str(body.get('text') or '').strip()
        except (ValueError, AttributeError):
            return self.answer(400, {'error': 'invalid_request'})
        if not digits or not text or len(text) > MAX_TEXT:
            return self.answer(400, {'error': 'invalid_request'})
        if not allow():
            print(json.dumps({'event': 'refused', 'reason': 'hourly_limit'}), flush=True)
            return self.answer(429, {'error': 'hourly_limit'})
        try:
            message_id = forward(digits, text)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
            print(json.dumps({'event': 'failed', 'reason': type(error).__name__}), flush=True)
            return self.answer(502, {'error': 'gateway_failed'})
        if not message_id:
            print(json.dumps({'event': 'failed', 'reason': 'no_message_id'}), flush=True)
            return self.answer(502, {'error': 'gateway_failed'})
        print(json.dumps({'event': 'sent'}), flush=True)
        self.answer(200, {'status': 'sent', 'message_id': message_id})


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
