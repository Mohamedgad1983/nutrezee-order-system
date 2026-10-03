"""All queue integration evidence is synthetic, in temporary databases only."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
from concurrent.futures import ThreadPoolExecutor
import unittest

from bulk_server import Invalid, Store
from renewal import FileSource, Ledger, MESSAGE, SourceBlocked
from renewal_bulk import RenewalBulk

NOW = datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


def row(subscription='SYNTHETIC-1', phone='50000001'):
    return {'subscription_id': subscription, 'phone': phone, 'state': 'active',
            'updated_at': NOW.isoformat(), 'schedule_complete': True, 'renewals_complete': True,
            'payment_detail': 'paid', 'payment_list': 'paid', 'later_renewals': [],
            'schedule': [{'date': '2026-10-03', 'state': 'service'},
                         {'date': '2026-10-04', 'state': 'service'}]}


class FakeTransport:
    def __init__(self):
        self.readiness = 0
        self.calls = []
        self.failure = None

    def ready(self):
        self.readiness += 1
        return True

    def send(self, phone, message):
        self.calls.append((phone, message))
        if self.failure:
            raise self.failure
        return {'id': 'synthetic-' + str(len(self.calls))}


class RenewalBulkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.clock = [NOW.timestamp()]
        self.transport = FakeTransport()
        self.store = Store(self.root / 'bulk.sqlite3', self.transport, lambda: self.clock[0])
        self.ledger = Ledger(self.root / 'renewal.sqlite3', self.root / 'bulk.sqlite3')
        self.addCleanup(self.ledger.db.close)
        self.source_path = self.root / 'source.json'
        self.publish([row()])
        self.source = FileSource(self.source_path, 'SYNTHETIC', True)
        self.bridge = RenewalBulk(self.store, self.ledger, self.source,
                                  lambda: datetime.fromtimestamp(self.clock[0], timezone.utc))

    def publish(self, rows, **changes):
        snapshot = {'schema_version': 1, 'source_id': 'SYNTHETIC', 'complete': True,
                    'payment_authority': 'order_detail', 'captured_at': NOW.isoformat(),
                    'subscriptions': rows}
        snapshot.update(changes)
        self.source_path.write_text(json.dumps(snapshot))
        self.source_path.chmod(0o600)

    def prepare(self):
        result = self.bridge.prepare()
        self.assertFalse(result['live_enabled'])
        return result['campaign_id']

    def manual(self, phone='50000009', message='Synthetic manual message'):
        campaign = self.store.create({'name': 'Synthetic manual', 'numbers': phone, 'message': message})
        self.store.action(campaign, 'start', {'confirmed': True})
        return campaign

    def test_preparation_uses_shared_draft_writer_and_same_transaction_audit(self):
        campaign = self.prepare()
        snapshot = self.store.snapshot()
        self.assertEqual(snapshot['campaigns'][0]['state'], 'draft')
        self.assertEqual(snapshot['campaigns'][0]['counts'], {'pending': 1})
        self.assertEqual(snapshot['next_at'], 0)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM renewal_recipient').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT reason FROM renewal_review').fetchone()[0], 'eligible')
            kinds = [r[0] for r in db.execute('SELECT kind FROM event WHERE campaign_id=?', (campaign,))]
        self.assertIn('draft_created', kinds)
        self.assertIn('renewal_delivery_locked', kinds)
        self.assertIn('renewal_review_eligible', kinds)
        self.assertEqual(self.transport.calls, [])

    def test_no_start_unlock_and_tick_independently_blocks_even_erroneous_running_state(self):
        campaign = self.prepare()
        with self.assertRaisesRegex(Invalid, 'disabled'):
            self.store.action(campaign, 'start', {'confirmed': True, 'live_enabled': True})
        with self.store.db() as db:
            db.execute("UPDATE campaign SET state='running' WHERE id=?", (campaign,))
        self.assertFalse(self.store.tick())
        snapshot = self.store.snapshot()['campaigns'][0]
        self.assertEqual(snapshot['state'], 'paused')
        self.assertEqual(snapshot['error'], 'renewal_delivery_disabled')
        self.assertEqual(snapshot['counts'], {'pending': 1})
        self.assertEqual(self.transport.readiness, 0)
        self.assertEqual(self.transport.calls, [])
        with self.store.db() as db:
            self.assertIsNone(db.execute('SELECT attempted FROM recipient WHERE campaign_id=?', (campaign,)).fetchone()[0])

    def test_fresh_read_before_each_recipient_detects_new_renewal(self):
        real_read = self.source.read
        reads = []
        def read(now):
            reads.append(now)
            if len(reads) == 2:
                current = row()
                current['later_renewals'] = [{'state': 'active', 'payment_detail': 'paid', 'payment_list': 'paid'}]
                self.publish([current])
            return real_read(now)
        self.source.read = read
        result = self.bridge.prepare()
        self.assertEqual(len(reads), 2)
        self.assertIsNone(result['campaign_id'])
        self.assertEqual(result['held'], {'verified_renewal': 1})
        self.assertEqual(self.store.snapshot()['campaigns'], [])

    def test_optout_before_prepare_creates_no_queue_recipient(self):
        self.ledger.optout('50000001', 'Synthetic customer opt-out', NOW)
        result = self.bridge.prepare()
        self.assertEqual(result['held'], {'opted_out': 1})
        self.assertIsNone(result['campaign_id'])

    def test_optout_after_preparation_is_held_and_never_auto_restored(self):
        campaign = self.prepare()
        self.ledger.optout('50000001', 'Synthetic customer opt-out', NOW)
        review = self.bridge.review(campaign)
        self.assertEqual(review, {'counts': {'opted_out': 1}, 'live_enabled': False, 'claimed': 0})
        self.assertEqual(self.store.snapshot()['campaigns'][0]['counts'], {'held': 1})
        self.assertEqual(self.bridge.review(campaign)['counts'], {})
        self.assertEqual(self.bridge.prepare()['held'], {'opted_out': 1})
        self.assertEqual(self.transport.calls, [])

    def test_new_renewal_after_preparation_recheck_holds_without_claim(self):
        campaign = self.prepare()
        current = row()
        current['later_renewals'] = [{'state': 'active', 'payment_detail': 'pending', 'payment_list': 'pending'}]
        self.publish([current])
        self.assertEqual(self.bridge.review(campaign)['counts'], {'renewal_payment_review': 1})
        self.assertEqual(self.store.snapshot()['campaigns'][0]['counts'], {'held': 1})
        self.assertEqual(self.transport.calls, [])

    def test_durable_per_subscription_phone_reservation_blocks_reprepare_after_restart(self):
        campaign = self.prepare()
        reopened = Store(self.root / 'bulk.sqlite3', self.transport, lambda: self.clock[0])
        bridge = RenewalBulk(reopened, self.ledger, self.source, lambda: NOW)
        result = bridge.prepare()
        self.assertEqual(result['held'], {'renewal_already_prepared': 1})
        self.assertIsNone(result['campaign_id'])
        self.assertEqual(len(self.store.snapshot()['campaigns']), 1)
        self.assertEqual(self.store.snapshot()['campaigns'][0]['id'], campaign)

    def test_multiple_current_subscriptions_for_phone_hold_all(self):
        self.publish([row(), row('SYNTHETIC-2', '+96550000001')])
        result = self.bridge.prepare()
        self.assertEqual(result['held'], {'multiple_subscriptions_for_phone': 2})
        self.assertIsNone(result['campaign_id'])

    def test_same_message_manual_uncertain_is_suppressed_without_resend(self):
        manual = self.manual('50000001', MESSAGE)
        self.transport.failure = TimeoutError()
        self.assertTrue(self.store.tick())
        before = self.store.snapshot()['campaigns'][0]
        result = self.bridge.prepare()
        self.assertEqual(result['held'], {'same_message_in_manual_bulk': 1})
        self.assertIsNone(result['campaign_id'])
        self.assertEqual(self.store.snapshot()['campaigns'][0], before)
        self.clock[0] += 60
        self.assertFalse(self.store.tick())
        self.assertEqual(len(self.transport.calls), 1)
        with self.assertRaises(Invalid):
            self.store.action(manual, 'start', {'confirmed': True})

    def test_current_payment_unknown_and_conflict_are_held(self):
        current = row()
        current['payment_detail'] = None
        conflicting = row('SYNTHETIC-2', '50000002')
        conflicting['payment_detail'] = 'pending'
        self.publish([current, conflicting])
        result = self.bridge.prepare()
        self.assertEqual(result['held'], {'payment_unverified': 1, 'payment_conflict': 1})
        self.assertEqual(result['prepared'], 0)

    def test_broken_second_recheck_rolls_back_every_queue_row_review_and_event(self):
        self.publish([row(), row('SYNTHETIC-2', '50000002')])
        original = self.bridge._recheck
        def broken(subscription, phone):
            if subscription == 'SYNTHETIC-2':
                raise SourceBlocked('source_changed_during_recheck')
            return original(subscription, phone)
        self.bridge._recheck = broken
        with self.assertRaises(SourceBlocked):
            self.bridge.prepare()
        with self.store.db() as db:
            for table in ('campaign', 'recipient', 'event', 'renewal_campaign', 'renewal_recipient', 'renewal_review'):
                self.assertEqual(db.execute('SELECT count(*) FROM ' + table).fetchone()[0], 0)

    def test_stale_or_incomplete_source_blocks_before_queue_write(self):
        for changes in ({'complete': False}, {'captured_at': (NOW-timedelta(minutes=31)).isoformat()}):
            self.publish([row()], **changes)
            with self.assertRaises(SourceBlocked):
                self.bridge.prepare()
        self.assertEqual(self.store.snapshot()['campaigns'], [])

    def test_disabled_renewal_does_not_change_manual_global_pacing(self):
        self.prepare()
        first = self.manual()
        self.assertTrue(self.store.tick())
        self.assertFalse(self.store.tick())  # complete the manual campaign
        second = self.manual('50000008')
        self.assertFalse(self.store.tick())
        self.clock[0] += 59
        self.assertFalse(self.store.tick())
        self.clock[0] += 1
        self.assertTrue(self.store.tick())
        self.assertEqual(len(self.transport.calls), 2)
        self.assertEqual([m for _, m in self.transport.calls], ['Synthetic manual message'] * 2)
        with self.store.db() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM recipient WHERE state='sending'").fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT next_at FROM throttle').fetchone()[0], self.clock[0] + 60)

    def test_manual_running_campaign_untouched_by_renewal_preparation(self):
        campaign = self.manual()
        before = self.store.snapshot()['campaigns'][0]
        self.prepare()
        after = next(x for x in self.store.snapshot()['campaigns'] if x['id'] == campaign)
        self.assertEqual(before, after)
        self.assertTrue(self.store.tick())
        self.assertEqual(len(self.transport.calls), 1)
        self.assertNotEqual(self.transport.calls[0][1], MESSAGE)

    def test_concurrent_preparation_reserves_exactly_one_subscription_phone(self):
        # Separate connections/Store instances prove the SQLite transaction, not
        # merely one Python lock, prevents duplicate reservation.
        def prepare(_):
            ledger = Ledger(self.root / 'renewal.sqlite3', self.root / 'bulk.sqlite3')
            try:
                store = Store(self.root / 'bulk.sqlite3', self.transport, lambda: NOW.timestamp())
                return RenewalBulk(store, ledger, self.source, lambda: NOW).prepare()
            finally:
                ledger.db.close()
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(prepare, range(2)))
        self.assertEqual(sum(x['prepared'] for x in results), 1)
        self.assertEqual(sum(x['held'].get('renewal_already_prepared', 0) for x in results), 1)
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM campaign').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT count(*) FROM renewal_recipient').fetchone()[0], 1)
        self.assertEqual(self.transport.calls, [])

    def test_audit_failure_rolls_back_shared_draft_and_metadata(self):
        original = self.store.event
        def fail(db, campaign, kind):
            if kind == 'renewal_delivery_locked':
                raise RuntimeError('synthetic audit failure')
            return original(db, campaign, kind)
        self.store.event = fail
        with self.assertRaises(RuntimeError):
            self.bridge.prepare()
        with self.store.db() as db:
            for table in ('campaign', 'recipient', 'event', 'renewal_campaign', 'renewal_recipient', 'renewal_review'):
                self.assertEqual(db.execute('SELECT count(*) FROM ' + table).fetchone()[0], 0)

    def test_reason_callback_cannot_inject_untrusted_source_into_audit(self):
        with self.assertRaises(Invalid):
            self.store.prepare_renewals('Synthetic', MESSAGE, [('SYNTHETIC-1', '96550000001')],
                                        lambda *args: 'Raw customer or source content')
        with self.store.db() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM event').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
