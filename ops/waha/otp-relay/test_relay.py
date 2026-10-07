"""WP-OPS-A73 — relay rules, no network and no WhatsApp."""
import io
import json
import os
import unittest

os.environ.setdefault('WAHA_API_KEY', 'test-key')
os.environ.setdefault('RELAY_TOKEN', 'test-token')
import relay  # noqa: E402


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class RelayTest(unittest.TestCase):
    def test_number_loses_the_plus_and_other_marks(self):
        self.assertEqual(relay.digits_of('+96555123456'), '96555123456')
        self.assertEqual(relay.digits_of('00965 5512-3456'), '96555123456')
        self.assertEqual(relay.digits_of('96555123456'), '96555123456')
        self.assertIsNone(relay.digits_of('12345'))
        self.assertIsNone(relay.digits_of(''))
        self.assertIsNone(relay.digits_of('+1234567890123456'))

    def test_forward_builds_the_waha_request_without_a_plus(self):
        seen = {}

        def opener(request, timeout):
            seen.update(url=request.full_url, body=json.loads(request.data), key=request.get_header('X-api-key'), timeout=timeout)
            return FakeResponse(json.dumps({'id': 'true_96555123456@c.us_ABC'}).encode())

        self.assertEqual(relay.forward('96555123456', 'code 123456', opener), 'true_96555123456@c.us_ABC')
        self.assertEqual(seen['url'], 'http://waha-api:3000/api/sendText')
        self.assertEqual(seen['body'], {'session': 'nutreeze', 'chatId': '96555123456@c.us', 'text': 'code 123456'})
        self.assertEqual(seen['key'], 'test-key')
        self.assertEqual(seen['timeout'], 20)

    def test_an_answer_without_a_message_id_is_not_a_send(self):
        self.assertIsNone(relay.forward('96555123456', 'x', lambda r, timeout: FakeResponse(b'{}')))

    def test_hourly_ceiling(self):
        relay._sent.clear()
        now = 1_000_000.0
        for i in range(relay.HOURLY_LIMIT):
            self.assertTrue(relay.allow(now + i))
        self.assertFalse(relay.allow(now + relay.HOURLY_LIMIT))
        self.assertTrue(relay.allow(now + 3601))  # the oldest sends have aged out
        relay._sent.clear()


if __name__ == '__main__':
    unittest.main()
