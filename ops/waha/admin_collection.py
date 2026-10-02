"""Bounded observations of Summary members; no transaction-snapshot claim or sends."""
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from html.parser import HTMLParser
import json
import re

from admin_enumeration import complete_list


class IdentityDrift(ValueError):
    pass


class PlainText(HTMLParser):
    def __init__(self, value):
        super().__init__()
        self.parts = []
        self.feed(str(value))

    def handle_data(self, data):
        self.parts.append(data)

    @property
    def value(self):
        return ' '.join(''.join(self.parts).split())


def _scope(cohorts, api):
    members = {}
    semantic = set()
    for cohort, rows in sorted(cohorts.items()):
        for row in rows:
            uid, number = row[0]['text'], row[1]['text']
            try:
                contact = api.phone(row[3]['text'])
            except ValueError:
                raise IdentityDrift('summary_contact') from None
            identity = (uid, number, contact)
            if number in members and members[number] != identity:
                raise IdentityDrift('summary_identity')
            members[number] = identity
            semantic.add(identity)
    return members, sorted(semantic)


def _log(**value):
    print(json.dumps({'mode': 'source-read-only', 'live_enabled': False, **value}), flush=True)


def _customer_ids(html):
    return set(re.findall(r'var\s+user_id\s*=\s*(\d+)\s*;', html))


def _indexed(session, active, pending, members, api):
    users = {value[0] for value in members.values()}
    contacts = {value[2] for value in members.values()}
    by_number = {}
    for row in active:
        number = PlainText(row[1]).value
        if number in members:
            if number in by_number:
                raise IdentityDrift('current_order_duplicate')
            by_number[number] = row
    if set(by_number) != set(members):
        raise IdentityDrift('current_order_missing')
    try:
        current = api.index(list(by_number.values()), target_phones=contacts)
    except api.Blocked as exc:
        if str(exc).startswith('order_contact_review_required'):
            raise IdentityDrift('current_order_contact') from None
        raise
    if set(current) != set(members):
        raise IdentityDrift('current_order_contact')
    for number, order in current.items():
        if order['phone'] != members[number][2]:
            raise IdentityDrift('current_order_contact')

    def irrelevant_invalid(identity):
        ids = _customer_ids(session.get('/orders/view/' + identity))
        if len(ids) != 1:
            raise api.Blocked('invalid_contact_customer_reference_unverified')
        if next(iter(ids)) in users:
            raise IdentityDrift('relevant_order_contact')
        return True

    history = []
    for state, rows in (('active', active), ('pending', pending)):
        entries = api.index(rows, target_phones=contacts, identity_key=True,
                            irrelevant_invalid=irrelevant_invalid)
        history.extend(dict(entry, source_state=state) for entry in entries.values())
    earliest = {}
    for order in current.values():
        if order['start'] is not None:
            earliest[order['phone']] = min(earliest.get(order['phone'], order['start']), order['start'])
    history = [order for order in history if order['start'] is None
               or order['phone'] not in earliest or order['start'] >= earliest[order['phone']]]
    return current, history


def _later(current, history):
    return sorted((order for order in history if order['id'] != current['id']
                   and order['phone'] == current['phone']
                   and (order['start'] is None or current['start'] is None
                        or order['start'] >= current['start'])),
                  key=lambda order: (order['id'], order['source_state']))


def _projection(current, history):
    def value(order):
        return (order['id'], order['phone'], order['start'], order['end'],
                order['payment_list'], order.get('source_state', 'active'))
    return value(current), tuple(value(order) for order in _later(current, history)), tuple(
        value(order) for order in history if order['id'] == current['id'])


def _detail(session, order, uid, api):
    class Reader:
        html = None

        def get(self, path):
            self.html = session.get(path)
            return self.html

    reader = Reader()
    try:
        payment = api.detail(reader, order)
    except api.Blocked as exc:
        if str(exc) in ('payment_detail_schema', 'payment_detail_partial',
                        'order_dates_conflict', 'order_date_schema'):
            return None, None, 'payment_review'
        raise
    ids = _customer_ids(reader.html or '')
    if len(ids) != 1:
        return payment, None, 'customer_identity_ambiguous'
    customer = next(iter(ids))
    tables = [table for table in api.parse(reader.html).tables if table
              and 'Payment Status' in [cell['text'] for cell in table[0]]
              and 'Order Status' in [cell['text'] for cell in table[0]]]
    headers = [cell['text'] for cell in tables[0][0]]
    state = tables[0][1][headers.index('Order Status')]['text'].lower()
    expected = order.get('source_state', 'active')
    if state not in ('active', 'pending') or state != expected:
        return payment, customer, 'order_state_changed'
    return payment, customer, None if payment is not None else 'payment_review'


def _observe(session, current, history, members, today, check, api, phase):
    def read(number):
        check()
        order = current[number]
        result = {'schedule': [], 'payment_detail': None, 'later_renewals': [],
                  'payment_facts': [], 'review': None}
        if order['start'] is None or order['end'] is None:
            result['review'] = 'calendar_review'
            return result
        try:
            result['schedule'] = sorted(api.calendar(
                session.get('/orders/vieworderwiseoffdays/' + order['id']),
                order['start'], order['end'], today), key=lambda item: item['date'])
        except api.Blocked as exc:
            if str(exc).startswith('calendar_'):
                result['review'] = 'calendar_review'
                return result
            raise
        if sum(entry['state'] == 'service' for entry in result['schedule']) != 2:
            return result
        uid = members[number][0]
        payment, customer, review = _detail(session, order, uid, api)
        if customer is not None and customer != uid:
            raise IdentityDrift('current_customer_identity')
        result['payment_detail'] = payment
        result['payment_facts'].append((order['id'], customer, payment))
        result['review'] = review
        if any(item['id'] == order['id'] and item['source_state'] != 'active' for item in history):
            result['review'] = 'order_state_changed'
        for later in _later(order, history):
            check()
            reason = None
            if later['start'] is None or later['end'] is None:
                later_payment, later_uid = None, None
                reason = 'renewal_chronology_unknown'
            else:
                later_payment, later_uid, reason = _detail(session, later, uid, api)
                if later_uid is not None and later_uid != uid:
                    reason = 'customer_identity_ambiguous'
                elif later['start'] == order['start']:
                    reason = 'renewal_chronology_unknown'
            if reason is not None:
                result['review'] = reason if reason == 'customer_identity_ambiguous' else result['review'] or reason
            result['later_renewals'].append({'state': later['source_state'],
                'payment_detail': later_payment, 'payment_list': later['payment_list']})
            result['payment_facts'].append((later['id'], later_uid, later_payment))
        return result

    results = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(read, number): number for number in current}
        try:
            for future in as_completed(futures):
                results[futures[future]] = future.result()
                if len(results) % 50 == 0 or len(results) == len(current):
                    _log(phase=phase, calendar_orders_checked=len(results),
                         total_summary_orders=len(current),
                         two_day_candidates_observed=sum(
                             sum(entry['state'] == 'service' for entry in item['schedule']) == 2
                             for item in results.values()))
        except BaseException:
            for future in futures:
                future.cancel()
            raise
    return results


def collect_cohort(session, limit=None, *, api):
    began = api.datetime.now(api.KUWAIT)
    today = began.date().isoformat()
    if limit is not None and (type(limit) is not int or not 1 <= limit <= 10000):
        raise api.Blocked('admin_sample_bounds_invalid')

    def check():
        instant = api.datetime.now(api.KUWAIT)
        if instant - began > api.MAX_AGE - timedelta(minutes=5):
            raise api.Blocked('admin_collection_freshness_exceeded')
        if instant.date() != began.date():
            raise api.Blocked('collection_crossed_kuwait_day')

    for attempt in (1, 2):
        proofs = []

        def exports(phase):
            check()
            active = complete_list(session.get)
            check()
            pending = complete_list(session.get, status='pending')
            check()
            proofs.append({'phase': phase, 'Active': active.proof, 'pending': pending.proof})
            _log(phase=phase, attempt=attempt, active_records=len(active),
                 active_reported=active.reported_total, pending_records=len(pending),
                 pending_reported=pending.reported_total)
            return active, pending

        try:
            members, scope = _scope(api.summaries(session.get, today), api)
            active_a, pending_a = exports('before_observation_A')
            current_a, history_a = _indexed(session, active_a, pending_a, members, api)
            observed_a = _observe(session, current_a, history_a, members, today, check, api, 'observation_A')
            members_b, scope_b = _scope(api.summaries(session.get, today), api)
            if scope != scope_b:
                raise IdentityDrift('summary_membership')
            active_b, pending_b = exports('before_observation_B')
            current_b, history_b = _indexed(session, active_b, pending_b, members_b, api)
            if any(current_a[number]['id'] != current_b[number]['id'] for number in members):
                raise IdentityDrift('current_order_identity')
            observed_b = _observe(session, current_b, history_b, members_b, today, check, api, 'observation_B')
            active_c, pending_c = exports('after_observation_B')
            members_c, scope_c = _scope(api.summaries(session.get, today), api)
            if scope != scope_c:
                raise IdentityDrift('summary_membership')
            current_c, history_c = _indexed(session, active_c, pending_c, members_c, api)
            if any(current_a[number]['id'] != current_c[number]['id'] for number in members):
                raise IdentityDrift('current_order_identity')
            check()
            rows = []
            for number in sorted(members, key=int):
                first, second = observed_a[number], observed_b[number]
                projections = [_projection(current, history) for current, history in (
                    (current_a[number], history_a), (current_b[number], history_b),
                    (current_c[number], history_c))]
                reason = second['review'] or first['review']
                if first['schedule'] != second['schedule']:
                    reason = 'calendar_changed'
                elif not projections[0] == projections[1] == projections[2]:
                    reason = 'order_state_changed' if not projections[0][0] == projections[1][0] == projections[2][0] else 'payment_or_renewal_changed'
                elif first['payment_facts'] != second['payment_facts']:
                    reason = 'payment_or_renewal_changed'
                candidate = any(sum(entry['state'] == 'service' for entry in observation['schedule']) == 2
                                for observation in (first, second))
                if not candidate and reason is None:
                    continue
                order = current_b[number]
                row = {'subscription_id': order['id'], 'phone': order['phone'], 'state': 'active',
                    'payment_detail': second['payment_detail'], 'payment_list': order['payment_list'],
                    'schedule_complete': reason is None, 'renewals_complete': reason is None,
                    'updated_at': began.isoformat(), 'schedule': second['schedule'],
                    'later_renewals': second['later_renewals']}
                if reason is not None:
                    row['review_reason'] = reason
                rows.append(row)
            review_counts = dict(Counter(row['review_reason'] for row in rows if 'review_reason' in row))
            if limit is not None:
                rows = rows[:limit]
            return {'schema_version': 1, 'source_id': 'nutreeze-admin-ui-v1',
                'payment_authority': 'order_detail', 'complete': limit is None,
                'captured_at': began.isoformat(), 'subscriptions': rows,
                'acquisition': {'consistency': 'bounded_two_observations',
                    'scope': 'current_day_summary_cohorts', 'summary_orders': len(members),
                    'attempt': attempt, 'complete_exports': proofs},
                'review_counts': review_counts}
        except IdentityDrift:
            check()
            if attempt == 2:
                raise api.Blocked('admin_relevant_identity_changed_after_bounded_attempts') from None
    raise api.Blocked('admin_collection_unavailable')
