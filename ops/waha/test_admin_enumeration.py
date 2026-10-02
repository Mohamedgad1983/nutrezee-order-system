"""Complete-list membership tests with synthetic responses and no network."""
import json
import unittest
import urllib.parse

from admin_enumeration import complete_list
from renewal import SourceBlocked


def row(identity):
    return [''] * 16 + ['<a href="/orders/view/' + str(identity) + '">View</a>']


def response(total, rows, filtered=None):
    return json.dumps({'recordsTotal': total, 'recordsFiltered': total if filtered is None else filtered, 'data': rows})


class CompleteListTests(unittest.TestCase):
    def replies(self, values):
        self.calls = []
        values = iter(values)

        def get(path):
            self.calls.append(path)
            return next(values)

        return get

    def test_complete_read_has_empty_terminal_and_aggregate_proof(self):
        result = complete_list(self.replies([response(2, [row(1), row(2)]), response(2, [])]), cap=10)
        self.assertEqual(len(result), 2)
        self.assertEqual(result.reported_total, 2)
        self.assertEqual(result.attempts, 1)
        self.assertTrue(result.proof['terminal_empty'])
        self.assertEqual(result.proof['physical_rows'], 2)
        self.assertEqual([urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)['start'][0] for path in self.calls], ['0', '2'])

    def test_count_drift_restarts_entire_response(self):
        get = self.replies([
            response(2, [row(1), row(2)]), response(3, [row(3)]),
            response(3, [row(1), row(2), row(3)]), response(3, []),
        ])
        result = complete_list(get, cap=10)
        self.assertEqual(result, [row(1), row(2), row(3)])
        self.assertEqual(result.attempts, 2)
        self.assertEqual([urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)['start'][0] for path in self.calls], ['0', '2', '0', '3'])

    def test_membership_drift_restarts_without_stitching(self):
        get = self.replies([
            response(1, [row(1)]), response(1, [row(2)]),
            response(1, [row(3)]), response(1, []),
        ])
        result = complete_list(get, cap=10)
        self.assertEqual(result, [row(3)])
        self.assertEqual(result.attempts, 2)

    def test_repeated_drift_blocks_after_three_attempts(self):
        get = self.replies([response(1, [row(1)]), response(2, [row(2)])] * 3)
        with self.assertRaisesRegex(SourceBlocked, 'bounded_retries'):
            complete_list(get, cap=10)
        self.assertEqual(len(self.calls), 6)

    def test_underreported_physical_membership_retains_every_row(self):
        result = complete_list(self.replies([response(2, [row(1), row(2), row(3)]), response(2, [])]), status='pending', cap=10)
        self.assertEqual(len(result), 3)
        self.assertEqual(result.reported_total, 2)
        self.assertTrue(all('/pending?' in path for path in self.calls))

    def test_duplicate_internal_ids_are_rejected(self):
        for rows in ([row(1), row(1)], [row('01'), row(1)]):
            with self.subTest(rows=rows):
                with self.assertRaisesRegex(SourceBlocked, 'duplicate_identity'):
                    complete_list(self.replies([response(2, rows)]), cap=10)

    def test_html_quote_style_does_not_change_internal_identity(self):
        single_quoted = [''] * 16 + ["<a href='/orders/view/123'>View</a>"]
        result = complete_list(self.replies([response(1, [single_quoted]), response(1, [])]), cap=10)
        self.assertEqual(result, [single_quoted])

    def test_malformed_rows_or_missing_and_ambiguous_identity_are_rejected(self):
        for rows in ([[''] * 16], [[''] * 17], [row('12suffix')], [row(1)[:-1] + ['/orders/view/1 /orders/view/2']]):
            with self.subTest(rows=rows):
                with self.assertRaises(SourceBlocked):
                    complete_list(self.replies([response(1, rows)]), cap=10)

    def test_undercoverage_is_never_returned_as_complete(self):
        with self.assertRaisesRegex(SourceBlocked, 'undercoverage'):
            complete_list(self.replies([response(3, [row(1), row(2)])]), cap=10)

    def test_cap_boundary_requires_an_empty_terminal(self):
        result = complete_list(self.replies([response(2, [row(1), row(2)]), response(2, [])]), cap=2)
        self.assertEqual(len(result), 2)
        with self.assertRaisesRegex(SourceBlocked, 'bounded_retries'):
            complete_list(self.replies([response(2, [row(1), row(2)]), response(2, [row(3)])] * 3), cap=2)

    def test_rows_or_reported_total_above_cap_are_rejected(self):
        for value in (response(3, [row(1), row(2), row(3)]), response(2, [row(1), row(2), row(3)])):
            with self.subTest(response=value):
                with self.assertRaises(SourceBlocked):
                    complete_list(self.replies([value]), cap=2)

    def test_malformed_response_and_filtered_count_are_rejected(self):
        for value in ('<input name="password">', '[]', response(True, []), response(1, [row(1)], filtered=0), json.dumps({'recordsTotal': 0, 'recordsFiltered': 0, 'data': {}})):
            with self.subTest(response=value):
                with self.assertRaises(SourceBlocked):
                    complete_list(self.replies([value]), cap=10)

    def test_empty_source_still_requires_terminal_proof(self):
        result = complete_list(self.replies([response(0, []), response(0, [])]), cap=10)
        self.assertEqual(result, [])
        self.assertEqual(len(self.calls), 2)

    def test_unsafe_bounds_and_status_are_rejected_before_reads(self):
        for kwargs in ({'status': 'closed'}, {'cap': 0}, {'cap': 10001}, {'cap': True}, {'attempts': 0}, {'attempts': 4}, {'attempts': True}):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(SourceBlocked):
                    complete_list(lambda _: self.fail('Invalid request was executed'), **kwargs)


if __name__ == '__main__':
    unittest.main()
