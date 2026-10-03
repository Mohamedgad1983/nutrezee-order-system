"""Protected Admin snapshot publication tests; synthetic fixtures only."""
import copy
from datetime import datetime, timedelta
import fcntl
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from admin_source import Blocked, publish_snapshot
from renewal import FileSource, KUWAIT, Ledger, SourceBlocked


SOURCE_ID = 'nutreeze-admin-ui-v1'


class AdminSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.parent = Path(self.directory.name)
        self.parent.chmod(0o700)
        self.path = self.parent / 'admin-source.json'
        self.now = datetime(2026, 10, 2, 13, 0, tzinfo=KUWAIT)

    def snapshot(self):
        return {
            'schema_version': 1,
            'source_id': SOURCE_ID,
            'complete': True,
            'payment_authority': 'order_detail',
            'captured_at': self.now.isoformat(),
            'subscriptions': [{
                'subscription_id': 'synthetic-subscription',
                'phone': '96555550000',
                'state': 'active',
                'payment_detail': 'paid',
                'payment_list': 'paid',
                'schedule_complete': True,
                'renewals_complete': True,
                'updated_at': self.now.isoformat(),
                'schedule': [
                    {'date': '2026-10-03', 'state': 'service'},
                    {'date': '2026-10-04', 'state': 'service'},
                ],
                'later_renewals': [],
            }],
        }

    def old_snapshot(self):
        self.path.write_text(json.dumps(self.snapshot()))
        self.path.chmod(0o600)

    def publish(self, value=None):
        if value is None:
            value = self.snapshot()
        return publish_snapshot(lambda: copy.deepcopy(value), self.path, now=self.now)

    def test_published_source_evaluates_without_sending(self):
        result = self.publish()
        self.assertTrue(result['source_certified'])
        self.assertTrue(result['complete'])
        self.assertFalse(result['live_enabled'])
        self.assertEqual(result['subscriptions'], 1)
        self.assertEqual(result['counts'], {'eligible': 1})
        info = self.path.stat()
        self.assertEqual(info.st_mode & 0o777, 0o600)
        self.assertEqual(info.st_uid, os.getuid())
        source = FileSource(str(self.path), SOURCE_ID, True)
        self.assertEqual(len(source.read(self.now)), 1)
        ledger = Ledger(self.parent / 'renewal.sqlite3')
        self.addCleanup(ledger.db.close)
        evaluation = ledger.evaluate(source, self.now)
        self.assertEqual(evaluation['state'], 'complete')
        self.assertEqual(evaluation['counts'], {'eligible': 1})
        self.assertEqual(evaluation['sent'], 0)
        self.assertFalse(evaluation['live_enabled'])

    def test_collection_failure_invalidates_previous_snapshot(self):
        self.old_snapshot()

        def failed_collection():
            self.assertFalse(self.path.exists())
            raise Blocked('synthetic_collection_failure')

        with self.assertRaisesRegex(Blocked, 'synthetic_collection_failure'):
            publish_snapshot(failed_collection, self.path, now=self.now)
        self.assertFalse(self.path.exists())

    def test_incomplete_sample_is_never_published(self):
        self.old_snapshot()
        value = self.snapshot()
        value['complete'] = False
        with self.assertRaises(SourceBlocked):
            self.publish(value)
        self.assertFalse(self.path.exists())

    def test_stale_or_future_collection_timestamp_is_rejected(self):
        for timestamp in (self.now - timedelta(minutes=31), self.now + timedelta(seconds=1)):
            with self.subTest(timestamp=timestamp.isoformat()):
                self.old_snapshot()
                value = self.snapshot()
                value['captured_at'] = timestamp.isoformat()
                with self.assertRaises(SourceBlocked):
                    self.publish(value)
                self.assertFalse(self.path.exists())

    def test_public_parent_is_rejected_before_producer_runs(self):
        self.parent.chmod(0o755)
        with self.assertRaises(Blocked):
            publish_snapshot(lambda: self.fail('Unsafe parent reached producer'), self.path, now=self.now)
        self.assertFalse(self.path.exists())

    def test_existing_unsafe_output_permissions_are_rejected(self):
        self.old_snapshot()
        self.path.chmod(0o640)
        with self.assertRaises(Blocked):
            publish_snapshot(lambda: self.fail('Unsafe output reached producer'), self.path, now=self.now)

    def test_symlink_output_is_rejected_without_changing_target(self):
        target = self.parent / 'protected-existing.json'
        target.write_text('synthetic-existing-content')
        target.chmod(0o600)
        self.path.symlink_to(target)
        with self.assertRaises(Blocked):
            publish_snapshot(lambda: self.fail('Symlink output reached producer'), self.path, now=self.now)
        self.assertTrue(self.path.is_symlink())
        self.assertEqual(target.read_text(), 'synthetic-existing-content')

    def test_lock_contention_does_not_invalidate_existing_snapshot(self):
        self.old_snapshot()
        original = self.path.read_bytes()
        lock_path = Path(str(self.path) + '.lock')
        descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(Blocked):
                publish_snapshot(lambda: self.fail('Contended lock reached producer'), self.path, now=self.now)
            self.assertEqual(self.path.read_bytes(), original)
        finally:
            os.close(descriptor)
        self.assertTrue(lock_path.exists())

    def test_failed_atomic_replace_leaves_no_snapshot(self):
        self.old_snapshot()
        with patch('admin_source.os.replace', side_effect=OSError('synthetic_atomic_failure')):
            with self.assertRaises((OSError, Blocked)):
                self.publish()
        self.assertFalse(self.path.exists())

    def test_failed_directory_fsync_removes_published_snapshot(self):
        self.old_snapshot()
        with patch('admin_source.os.fsync', side_effect=[None, OSError('synthetic_directory_sync_failure')]) as sync:
            with self.assertRaises((OSError, Blocked)):
                self.publish()
        self.assertEqual(sync.call_count, 2)
        self.assertFalse(self.path.exists())


if __name__ == '__main__':
    unittest.main()
