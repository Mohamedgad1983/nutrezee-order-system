"""Synthetic reader protocol tests; never invoke Docker or a live database."""
import json
import subprocess
from types import SimpleNamespace
import unittest
import tempfile
from pathlib import Path

from bulk_history import ContainerHistory, HistoryUnavailable, QUERY
from renewal import Ledger


class BulkHistoryTests(unittest.TestCase):
    def test_fixed_read_only_command_and_stdin_only_customer_data(self):
        calls = []
        def run(args, **kwargs):
            calls.append((args, kwargs))
            return SimpleNamespace(returncode=0, stdout='{"exists":true}')
        self.assertTrue(ContainerHistory(run).contains('synthetic-phone', 'synthetic-message'))
        args, options = calls[0]
        self.assertEqual(args[:8], ['/usr/bin/docker','--host','unix:///var/run/docker.sock','exec','-i','--user','10001:10001','waha-bulk'])
        self.assertNotIn('synthetic-phone', ' '.join(args))
        self.assertEqual(json.loads(options['input']), {'phone':'synthetic-phone','message':'synthetic-message'})
        self.assertIn('mode=ro', QUERY)
        self.assertIn('query_only=ON', QUERY)
        self.assertNotIn('Store(', QUERY)

    def test_absence_is_false(self):
        reader=ContainerHistory(lambda *a,**k:SimpleNamespace(returncode=0,stdout='{"exists":false}'))
        self.assertFalse(reader.contains('synthetic','synthetic'))

    def test_unavailable_or_malformed_never_means_absent(self):
        for code, output in [(1,''),(0,''),(0,'{}'),(0,'{"exists":0}'),(0,'{"exists":false,"extra":1}'),(0,'x'*101)]:
            with self.subTest(code=code,output=output),self.assertRaises(HistoryUnavailable):
                ContainerHistory(lambda *a,**k:SimpleNamespace(returncode=code,stdout=output)).contains('synthetic','synthetic')
        def timeout(*a,**k):raise subprocess.TimeoutExpired('docker',10)
        with self.assertRaises(HistoryUnavailable):ContainerHistory(timeout).contains('synthetic','synthetic')

    def test_ledger_uses_reader_and_preserves_dependency_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            reader=ContainerHistory(lambda *a,**k:SimpleNamespace(returncode=0,stdout='{"exists":true}'))
            ledger=Ledger(Path(directory)/'ledger.sqlite3',history_reader=reader)
            try:
                self.assertEqual(ledger.blocked('synthetic','synthetic-phone'),'same_message_in_manual_bulk')
                reader.run=lambda *a,**k:SimpleNamespace(returncode=1,stdout='')
                self.assertEqual(ledger.blocked('synthetic','synthetic-phone'),'bulk_ledger_unavailable')
            finally:ledger.db.close()


if __name__ == '__main__':unittest.main()
