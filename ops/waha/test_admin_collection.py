"""Synthetic bounded-observation tests; no credentials or HTTP access."""
from datetime import datetime
import json
from types import SimpleNamespace
import unittest
import urllib.parse

import admin_source
from admin_collection import collect_cohort
from renewal import eligibility, KUWAIT


NOW = datetime(2026, 10, 2, 13, 0, tzinfo=KUWAIT)


class Clock:
    @classmethod
    def now(cls, zone=None):
        return NOW if zone is None else NOW.astimezone(zone)


def listing(identity='12', number='100', contact='55667788', start='01-10-2026', end='04-10-2026', payment='success'):
    row = [''] * 17
    row[1], row[2], row[5], row[6], row[10], row[16] = number, 'Synthetic [' + contact + ']', start, end, payment, '/orders/view/' + identity
    return row


def calendar(days):
    head = ''.join('<th>' + value + '</th>' for value in ['No', 'Date', 'Day', 'Off Day', 'Freeze Day'])
    body = ''.join('<tr><td>1</td><td>' + day + '</td><td>Day</td><td><input type="checkbox"></td><td><input type="checkbox"></td></tr>' for day in days)
    return '<table><tr>' + head + '</tr>' + body + '</table>'


def detail(identity='12', uid='1', payment='success', start='01-10-2026', end='04-10-2026', state='Active'):
    headers = ['Order start date', 'Order end date', 'Payment Status', 'Order Status']
    values = [start, end, payment, state]
    return '<script>var user_id = ' + uid + ';</script><table><tr>' + ''.join('<th>' + value + '</th>' for value in headers) + '</tr><tr>' + ''.join('<td>' + value + '</td>' for value in values) + '</tr></table>'


def workflow(selected='success'):
    return '<select id="order_status" disabled>' + ''.join(
        '<option value="' + value + '"' + (' selected' if value == selected else '') + '>'
        + label + '</option>' for value, label in (
            ('pending', 'Pending'), ('accept', 'Accept'), ('reject', 'Reject'),
            ('cancel', 'Cancel'), ('success', 'Success'), ('ongoing', 'Ongoing'),
        )) + '</select>'


class Fixture:
    def __init__(self):
        self.summary_round = 0
        self.summary_calls = 0
        self.export_round = {'Active': 0, 'pending': 0}
        self.export_data = {}
        self.calendar_calls = 0
        self.detail_calls = {}
        self.calls = []
        self.active = lambda round: [listing()]
        self.pending = lambda round: []
        self.summary_uid = lambda round: '1'
        self.days = lambda round: ['2026-10-03', '2026-10-04']
        self.payment = lambda identity, round: 'success'
        self.customer = lambda identity, round: '1'
        self.order_state = lambda identity, round: 'Pending' if identity in ('13', '14') else 'Active'
        self.missing_detail = False

    def get(self, path):
        self.calls.append(path)
        if '/ajaxlist/' in path:
            parsed = urllib.parse.urlsplit(path)
            status = parsed.path.rsplit('/', 1)[1]
            query = urllib.parse.parse_qs(parsed.query)
            if query['start'] == ['0'] and query['length'] != ['1']:
                self.export_round[status] += 1
                rows = self.active(self.export_round[status]) if status == 'Active' else self.pending(self.export_round[status])
                self.export_data[status] = rows
            rows = self.export_data[status]
            result = rows if query['start'] == ['0'] and query['length'] != ['1'] else []
            return json.dumps({'recordsTotal': len(rows), 'recordsFiltered': len(rows), 'data': result})
        if path.startswith('/summary/'):
            round = self.summary_calls // 5
            self.summary_calls += 1
            headers = ''.join('<th>' + value + '</th>' for value in admin_source.SUMMARY_HEADERS)
            values = [self.summary_uid(round), '100', 'Synthetic', '55667788', '2', '', '', '']
            body = '<tr>' + ''.join('<td>' + value + '</td>' for value in values) + '</tr>' if '/off_day/' in path else '<tr><td>No Records Found</td></tr>'
            return '<table><thead>' + headers + '</thead>' + body + '</table>'
        if '/vieworderwiseoffdays/' in path:
            self.calendar_calls += 1
            return calendar(self.days(self.calendar_calls))
        if '/orders/view/' in path:
            identity = path.rsplit('/', 1)[1]
            self.detail_calls[identity] = self.detail_calls.get(identity, 0) + 1
            round = self.detail_calls[identity]
            if self.missing_detail:
                return '<script>var user_id = 1;</script>'
            return detail(identity, self.customer(identity, round), self.payment(identity, round),
                          '05-10-2026' if identity == '13' else '01-10-2026',
                          '08-10-2026' if identity == '13' else '04-10-2026',
                          self.order_state(identity, round))
        raise AssertionError('Unexpected read: ' + path)


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.api = SimpleNamespace(**vars(admin_source))
        self.api.datetime = Clock
        self.fixture = Fixture()

    def collect(self, limit=None):
        return collect_cohort(self.fixture, limit, api=self.api)

    def test_stable_candidate_uses_two_independent_authoritative_observations(self):
        result = self.collect()
        self.assertTrue(result['complete'])
        self.assertEqual(result['acquisition']['consistency'], 'bounded_two_observations')
        self.assertEqual(len(result['acquisition']['complete_exports']), 3)
        self.assertEqual(result['captured_at'], NOW.isoformat())
        self.assertEqual(self.fixture.calendar_calls, 2)
        self.assertEqual(self.fixture.detail_calls['12'], 2)
        self.assertEqual(eligibility(result['subscriptions'][0], NOW), 'eligible')
        self.assertFalse(any('getMealsDateWiseFilter' in path for path in self.fixture.calls))

    def test_unrelated_complete_export_count_drift_is_accepted(self):
        self.fixture.active = lambda round: [listing()] + [listing('90', '900', '55443322')] * (round % 2)
        result = self.collect()
        self.assertTrue(result['complete'])
        self.assertEqual(eligibility(result['subscriptions'][0], NOW), 'eligible')
        self.assertNotIn('90', self.fixture.detail_calls)

    def test_payment_change_holds_candidate(self):
        self.fixture.payment = lambda identity, round: 'success' if round == 1 else 'pending'
        row = self.collect()['subscriptions'][0]
        self.assertEqual(row['review_reason'], 'payment_or_renewal_changed')
        self.assertFalse(row['renewals_complete'])
        self.assertNotEqual(eligibility(row, NOW), 'eligible')

    def test_calendar_change_retains_previously_excluded_candidate(self):
        self.fixture.active = lambda round: [listing(end='05-10-2026')]
        self.fixture.days = lambda round: ['2026-10-03', '2026-10-04', '2026-10-05'] if round == 1 else ['2026-10-03', '2026-10-04', '2026-10-05']
        original = self.fixture.get

        def get(path):
            html = original(path)
            if '/vieworderwiseoffdays/' in path and self.fixture.calendar_calls == 2:
                html = html.replace('<td>2026-10-05</td><td>Day</td><td><input type="checkbox">', '<td>2026-10-05</td><td>Day</td><td><input type="checkbox" checked>')
            if '/orders/view/' in path:
                html = html.replace('<td>04-10-2026</td>', '<td>05-10-2026</td>')
            return html

        self.fixture.get = get
        row = self.collect()['subscriptions'][0]
        self.assertEqual(row['review_reason'], 'calendar_changed')
        self.assertFalse(row['schedule_complete'])
        self.assertEqual(self.fixture.calendar_calls, 2)

    def test_relevant_new_pending_renewal_is_retained_as_review(self):
        self.fixture.pending = lambda round: [] if round == 1 else [listing('13', '101', start='05-10-2026', end='08-10-2026', payment='pending')]
        self.fixture.payment = lambda identity, round: 'pending' if identity == '13' else 'success'
        row = self.collect()['subscriptions'][0]
        self.assertEqual(row['review_reason'], 'payment_or_renewal_changed')
        self.assertFalse(row['renewals_complete'])

    def test_summary_identity_change_retries_whole_attempt(self):
        self.fixture.summary_uid = lambda round: '2' if round == 1 else '1'
        result = self.collect()
        self.assertEqual(result['acquisition']['attempt'], 2)
        self.assertEqual(eligibility(result['subscriptions'][0], NOW), 'eligible')

    def test_membership_transition_between_summary_categories_is_irrelevant(self):
        original = self.fixture.get

        def get(path):
            if path.startswith('/summary/') and self.fixture.summary_calls // 5 >= 1:
                if '/off_day/' in path:
                    path = path.replace('/off_day/', '/meal_added/')
                elif '/meal_added/' in path:
                    path = path.replace('/meal_added/', '/off_day/')
            return original(path)

        self.fixture.get = get
        result = self.collect()
        self.assertEqual(result['acquisition']['attempt'], 1)
        self.assertEqual(eligibility(result['subscriptions'][0], NOW), 'eligible')

    def test_repeated_summary_identity_change_blocks_after_two_attempts(self):
        self.fixture.summary_uid = lambda round: '1' if round % 2 == 0 else '2'
        with self.assertRaisesRegex(admin_source.Blocked, 'bounded_attempts'):
            self.collect()
        self.assertEqual(self.fixture.summary_calls, 20)

    def test_missing_current_order_retries_but_never_silently_excludes(self):
        self.fixture.active = lambda round: [] if round == 2 else [listing()]
        result = self.collect()
        self.assertEqual(result['acquisition']['attempt'], 2)
        self.assertEqual(len(result['subscriptions']), 1)

    def test_missing_detail_is_an_explicit_review_hold(self):
        self.fixture.missing_detail = True
        row = self.collect()['subscriptions'][0]
        self.assertEqual(row['review_reason'], 'payment_review')
        self.assertFalse(row['renewals_complete'])

    def test_same_start_subscription_and_unknown_chronology_are_held(self):
        for start, end in [('01-10-2026', '04-10-2026'), ('', '')]:
            with self.subTest(start=start):
                fixture = Fixture()
                fixture.pending = lambda round: [listing('14', '101', start=start, end=end, payment='pending')]
                fixture.payment = lambda identity, round: 'pending' if identity == '14' else 'success'
                row = collect_cohort(fixture, api=self.api)['subscriptions'][0]
                self.assertEqual(row['review_reason'], 'renewal_chronology_unknown')
                self.assertFalse(row['renewals_complete'])

    def test_shared_phone_with_another_customer_is_held(self):
        self.fixture.pending = lambda round: [listing('13', '101', start='05-10-2026', end='08-10-2026')]
        self.fixture.customer = lambda identity, round: '2' if identity == '13' else '1'
        row = self.collect()['subscriptions'][0]
        self.assertEqual(row['review_reason'], 'customer_identity_ambiguous')
        self.assertFalse(row['renewals_complete'])

    def test_unknown_or_cancelled_current_detail_state_is_held(self):
        for state in ('Cancelled', 'Unknown', 'Pending'):
            with self.subTest(state=state):
                self.fixture = Fixture()
                self.fixture.order_state = lambda identity, round: state
                row = self.collect()['subscriptions'][0]
                self.assertEqual(row['review_reason'], 'order_state_changed')
                self.assertNotEqual(eligibility(row, NOW), 'eligible')

    def test_cancelled_later_detail_is_held_instead_of_paid_renewal_exclusion(self):
        self.fixture.pending = lambda round: [listing('13', '101', start='05-10-2026', end='08-10-2026')]
        self.fixture.order_state = lambda identity, round: 'Cancelled' if identity == '13' else 'Active'
        row = self.collect()['subscriptions'][0]
        self.assertEqual(row['review_reason'], 'order_state_changed')
        self.assertNotEqual(eligibility(row, NOW), 'verified_renewal')

    def selected_status(self, html):
        original = self.fixture.get
        self.fixture.get = lambda path: original(path).replace('<td>Active</td>', '<td>' + html + '</td>') if '/orders/view/' in path else original(path)

    def test_observed_selected_success_ignores_unselected_workflow_labels(self):
        self.selected_status(workflow())
        row = self.collect()['subscriptions'][0]
        self.assertNotIn('review_reason', row)
        self.assertEqual(eligibility(row, NOW), 'eligible')

    def test_selected_pending_is_valid_for_pending_renewal(self):
        self.fixture.pending = lambda round: [listing('13', '101', start='05-10-2026', end='08-10-2026', payment='pending')]
        self.fixture.payment = lambda identity, round: 'pending' if identity == '13' else 'success'
        original = self.fixture.get
        self.fixture.get = lambda path: original(path).replace('<td>Pending</td>', '<td>' + workflow('pending') + '</td>') if '/orders/view/' in path else original(path)
        row = self.collect()['subscriptions'][0]
        self.assertNotIn('review_reason', row)
        self.assertEqual(eligibility(row, NOW), 'renewal_payment_review')

    def test_unverified_or_ambiguous_selected_state_is_held(self):
        invalid = [
            workflow(None),
            workflow().replace('value="pending"', 'value="pending" selected'),
            workflow().replace('id="order_status"', 'id="unrelated_setting"'),
            workflow().replace('value="success" selected>Success', 'value="success" selected>Pending'),
            workflow() + workflow(),
            workflow().replace('</select>', ''),
        ] + [workflow(state) for state in ('accept', 'ongoing', 'reject', 'cancel', 'pending')]
        for html in invalid:
            with self.subTest(status=html):
                self.fixture = Fixture()
                self.selected_status(html)
                row = self.collect()['subscriptions'][0]
                self.assertEqual(row['review_reason'], 'order_state_changed')
                self.assertNotEqual(eligibility(row, NOW), 'eligible')

    def test_sample_never_claims_complete(self):
        self.assertFalse(self.collect(1)['complete'])

    def test_authentication_failure_is_global_not_an_individual_hold(self):
        original = self.fixture.get
        self.fixture.get = lambda path: '<input name="password">' if '/orders/view/' in path else original(path)
        with self.assertRaisesRegex(admin_source.Blocked, 'admin_relogin_required'):
            self.collect()


if __name__ == '__main__':
    unittest.main()
