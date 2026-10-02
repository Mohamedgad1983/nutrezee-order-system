import base64
from concurrent.futures import ThreadPoolExecutor
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

from bulk_server import Invalid, Store, handler, numbers


class FakeTransport:
    def __init__(self):
        self.calls = []
        self.online = True
        self.failure = None

    def ready(self):
        return self.online

    def send(self, phone, message):
        self.calls.append((phone, message))
        if self.failure:
            raise self.failure
        return {'id': 'test-' + str(len(self.calls))}


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.clock = [1000.0]
        self.transport = FakeTransport()
        self.path = Path(self.temp.name) / 'queue.sqlite3'
        self.store = Store(self.path, self.transport, lambda: self.clock[0])

    def draft(self, phones='0096550000001\n+96550000000'):
        return self.store.create({'name': 'test', 'numbers': phones, 'message': 'hello'})

    def start(self, c):
        self.store.action(c, 'start', {'confirmed': True})

    def test_normalization_dedup_and_invalid(self):
        self.assertEqual(numbers('phone\n0096550000001\n+965 50000001\n٥٠٠٠٠٠٠١'), ['96550000001'])
        for text in ['abc', 'phone,name\n123,hello', '', '000000000000']:
            with self.assertRaises(Invalid):
                numbers(text)

    def test_no_send_before_explicit_start(self):
        c = self.draft()
        self.assertFalse(self.store.tick())
        with self.assertRaises(Invalid):
            self.store.action(c, 'start', {})
        self.assertEqual(self.transport.calls, [])

    def test_interval_and_duplicate_claim(self):
        c = self.draft()
        self.start(c)
        with ThreadPoolExecutor(2) as pool:
            self.assertEqual(sum(pool.map(lambda _: self.store.tick(), range(2))), 1)
        self.clock[0] += 59
        self.assertFalse(self.store.tick())
        self.clock[0] += 1
        self.assertTrue(self.store.tick())
        self.assertEqual(len(self.transport.calls), 2)
        self.store.tick()
        self.assertEqual(self.store.snapshot()['campaigns'][0]['state'], 'complete')

    def test_pause_and_resume(self):
        c = self.draft()
        self.start(c)
        self.store.tick()
        self.store.action(c, 'pause', {})
        self.clock[0] += 100
        self.assertFalse(self.store.tick())
        self.start(c)
        self.store.tick()
        self.assertEqual(len(self.transport.calls), 2)

    def test_global_interval_between_campaigns(self):
        first = self.draft('50000001')
        self.start(first)
        self.store.tick()
        self.store.tick()
        second = self.draft('50000000')
        self.start(second)
        self.assertFalse(self.store.tick())
        self.clock[0] += 60
        self.assertTrue(self.store.tick())

    def test_only_one_running_campaign(self):
        self.start(self.draft())
        with self.assertRaises(Invalid):
            self.start(self.draft())

    def test_offline_session_pauses_without_send(self):
        self.start(self.draft())
        self.transport.online = False
        self.assertFalse(self.store.tick())
        self.assertEqual(self.transport.calls, [])
        self.assertEqual(self.store.snapshot()['campaigns'][0]['state'], 'paused')

    def test_ambiguous_send_not_retried(self):
        c = self.draft()
        self.start(c)
        self.transport.failure = TimeoutError()
        self.store.tick()
        self.clock[0] += 100
        self.assertFalse(self.store.tick())
        with self.assertRaises(Invalid):
            self.start(c)
        self.assertEqual(len(self.transport.calls), 1)
        self.transport.failure = None
        self.store.action(c, 'resolve', {'decision': 'skipped'})
        self.start(c)
        self.store.tick()
        self.assertEqual(len(self.transport.calls), 2)
        self.assertEqual(self.transport.calls[1][0], '96550000000')

    def test_known_rejection_pauses_not_retries(self):
        c = self.draft()
        self.start(c)
        self.transport.failure = HTTPError('test', 400, 'invalid', {}, None)
        self.store.tick()
        self.assertEqual(self.store.snapshot()['campaigns'][0]['counts']['failed'], 1)
        self.transport.failure = None
        self.clock[0] += 60
        self.start(c)
        self.store.tick()
        self.assertEqual(self.transport.calls[1][0], '96550000000')

    def test_server_error_is_uncertain(self):
        self.start(self.draft())
        self.transport.failure = HTTPError('test', 502, 'upstream', {}, None)
        self.store.tick()
        self.assertEqual(self.store.snapshot()['campaigns'][0]['state'], 'uncertain')

    def test_restart_pauses_and_preserves_throttle(self):
        c = self.draft()
        self.start(c)
        self.store.tick()
        new = Store(self.path, self.transport, lambda: self.clock[0])
        self.assertEqual(new.snapshot()['campaigns'][0]['state'], 'paused')
        new.action(c, 'start', {'confirmed': True})
        self.assertFalse(new.tick())
        self.clock[0] += 60
        new.tick()
        self.assertEqual(len(self.transport.calls), 2)

    def test_crash_after_claim_preserves_uncertainty(self):
        c = self.draft()
        self.start(c)
        with self.store.db() as db:
            db.execute("UPDATE recipient SET state='sending' WHERE phone='96550000001'")
        new = Store(self.path, self.transport, lambda: self.clock[0])
        self.assertEqual(new.snapshot()['campaigns'][0]['state'], 'uncertain')
        self.assertFalse(new.tick())
        self.assertEqual(self.transport.calls, [])

    def test_missing_message_id_is_uncertain(self):
        self.start(self.draft())
        self.transport.send = lambda phone, message: {}
        self.store.tick()
        self.assertEqual(self.store.snapshot()['campaigns'][0]['state'], 'uncertain')
        self.assertFalse(self.store.tick())

    def test_slow_send_waits_full_minute_after_response(self):
        self.start(self.draft())
        original_send = self.transport.send
        def slow_send(phone, message):
            self.clock[0] += 20
            return original_send(phone, message)
        self.transport.send = slow_send
        self.store.tick()
        self.clock[0] += 59
        self.assertFalse(self.store.tick())
        self.clock[0] += 1
        self.assertTrue(self.store.tick())

    def test_http_auth_csrf_and_draft_only(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.store, 'tester', 'test-only-password', 'https://test.invalid'))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        auth = 'Basic ' + base64.b64encode(b'tester:test-only-password').decode()
        def request(method, path, data=None, headers=None):
            client = http.client.HTTPConnection('127.0.0.1', server.server_port)
            client.request(method, path, body=None if data is None else json.dumps(data), headers=headers or {})
            response = client.getresponse();body = response.read();client.close()
            return response.status, body
        self.assertEqual(request('GET', '/bulk/')[0], 401)
        self.assertEqual(request('GET', '/bulk/', headers={'Authorization': auth})[0], 200)
        self.assertEqual(request('POST', '/bulk/api/campaigns', {}, {'Authorization': auth, 'Content-Type': 'application/json', 'Origin': 'https://evil.invalid'})[0], 403)
        self.assertEqual(request('POST', '/bulk/api/campaigns', {}, {'Authorization': auth, 'Content-Type': 'application/json'})[0], 403)
        status, _ = request('POST', '/bulk/api/campaigns', {'name': 'HTTP test', 'message': 'hello', 'numbers': '50000001'}, {'Authorization': auth, 'Content-Type': 'application/json', 'Origin': 'https://test.invalid'})
        self.assertEqual(status, 201)
        self.assertEqual(self.transport.calls, [])
        status, body = request('POST', '/bulk/api/campaigns', {'name': '', 'message': 'hi', 'numbers': '50000001'}, {'Authorization': auth, 'Content-Type': 'application/json', 'Origin': 'https://test.invalid', 'Accept-Language': 'en'})
        self.assertEqual(status, 400)
        self.assertIn('campaign name', json.loads(body)['error'])


if __name__ == '__main__':
    unittest.main()
