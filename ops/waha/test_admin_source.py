import json
import unittest
from admin_source import Blocked, allowed, calendar, paged, parse, payment


def day(d, off=False, pause=False, off_button=False):
    checkbox = lambda checked: '<input type="checkbox"'+(' checked' if checked else '')+'>'
    return '<tr><td>1</td><td>'+d+'</td><td>Day</td><td>'+('<button value="Enable">Enable</button>' if off_button else checkbox(off))+'</td><td>'+('-' if off or off_button else checkbox(pause))+'</td></tr>'


def schedule(rows):
    return '<table><tr>'+''.join('<th>'+h+'</th>' for h in ['No','Date','Day','Off Day','Freeze Day'])+'</tr>'+rows+'</table>'


class AdminSourceTests(unittest.TestCase):
    def test_read_allowlist(self):
        for p in ['/admin','/orders/view/12','/orders/ajaxlist/Active?draw=1&start=0&length=100','/summary/off_day/2026-10-02','/orders/getMealsDateWiseFilter/2026-10-03/12']:
            self.assertTrue(allowed(p))
        for p in ['https://evil.invalid/admin','//evil.invalid/admin','/orders/ChangeOffDay','/orders/create','/logout','/orders/view/../create','/orders/view/12?delete=1','/orders/ajaxlist/Active?draw=1&start=0&length=1001','/logincheck']:
            self.assertFalse(allowed(p))
        self.assertTrue(allowed('/logincheck', login=True))

    def test_relogin_and_schema_drift(self):
        with self.assertRaises(Blocked):parse('<input name="password">')
        with self.assertRaises(Blocked):calendar('<table></table>','2026-10-02','2026-10-04')

    def test_service_off_pause_explicit_and_complete(self):
        result=calendar(schedule(day('2026-10-02',True)+day('2026-10-03',off_button=True)+day('2026-10-04',pause=True)+day('2026-10-05')),'2026-10-02','2026-10-05')
        self.assertEqual([r['state'] for r in result],['off','off','paused','service'])
        with self.assertRaises(Blocked):calendar(schedule(day('2026-10-02')+day('2026-10-04')),'2026-10-02','2026-10-04')
        with self.assertRaises(Blocked):calendar(schedule(day('2026-10-02')*2),'2026-10-02','2026-10-02')

    def test_blank_and_conflicting_detail_not_inferred(self):
        html=lambda value:'<table><tr><th>Payment Status</th><th>Order Status</th></tr><tr><td>'+value+'</td><td>Active</td></tr></table>'
        self.assertEqual(payment(html('success')),'paid')
        self.assertEqual(payment(html('pending')),'pending')
        with self.assertRaises(Blocked):payment(html(''))
        with self.assertRaises(Blocked):payment(html('success')+html('pending'))

    def test_pages_exact_membership(self):
        row=lambda n:['']*16+['<a href="/orders/view/'+str(n)+'">view</a>']
        calls=[]
        def get(path):
            calls.append(path)
            return json.dumps({'recordsTotal':3,'recordsFiltered':3,'data':[row(1),row(2)] if 'start=0' in path else [row(3)] if 'start=2' in path else []})
        self.assertEqual(len(paged(get,2)),3)
        self.assertEqual(len(calls),3)
        for data in [ {'recordsTotal':2,'recordsFiltered':2,'data':[row(1)]}, {'recordsTotal':2,'recordsFiltered':2,'data':[row(1),row(1)]}, {'recordsTotal':2,'recordsFiltered':1,'data':[row(1),row(2)]} ]:
            with self.assertRaises(Blocked):paged(lambda _:json.dumps(data),2)

    def test_pagination_change_and_auth_expiry(self):
        responses=iter([json.dumps({'recordsTotal':2,'recordsFiltered':2,'data':[['']*16+['/orders/view/1']]}),json.dumps({'recordsTotal':3,'recordsFiltered':3,'data':[['']*16+['/orders/view/2']]})])
        with self.assertRaises(Blocked):paged(lambda _:next(responses),1)
        with self.assertRaises(Blocked):paged(lambda _:'<input name="password">')

class CollectionTests(unittest.TestCase):
    def fixture(self):
        from admin_source import SUMMARY_HEADERS
        class Fake:
            def get(self, path):
                if '/ajaxlist/' in path:
                    row=['']*17
                    pending='/pending?' in path
                    row[1]='101' if pending else '100'
                    row[2]='Synthetic [55667788]'
                    row[5]='05-10-2026' if pending else '01-10-2026'
                    row[6]='08-10-2026' if pending else '04-10-2026'
                    row[10]='pending' if pending else 'success'
                    row[16]='/orders/view/'+('13' if pending else '12')
                    return json.dumps({'recordsTotal':1,'recordsFiltered':1,'data':[row] if 'start=0' in path else []})
                if path.startswith('/summary/'):
                    head='<thead>'+''.join('<th>'+h+'</th>' for h in SUMMARY_HEADERS)+'</thead>'
                    values=['1','100','Synthetic','55667788','2','','','']
                    body='<tr>'+''.join('<td>'+v+'</td>' for v in values)+'</tr>' if '/off_day/' in path else '<tr><td colspan="8">No Records Found</td></tr>'
                    return '<table>'+head+body+'</table>'
                if '/orders/view/' in path:
                    pending=path.endswith('/13')
                    headers=['Order start date','Order end date','Payment Status','Order Status']
                    values=['05-10-2026','08-10-2026','pending','Pending'] if pending else ['01-10-2026','04-10-2026','success','Active']
                    return '<table><tr>'+''.join('<th>'+h+'</th>' for h in headers)+'</tr><tr>'+''.join('<td>'+v+'</td>' for v in values)+'</tr></table>'
                if '/vieworderwiseoffdays/' in path:
                    return schedule(day('2026-10-01')+day('2026-10-02',True)+day('2026-10-03')+day('2026-10-04'))
                if '/getMealsDateWiseFilter/' in path:
                    return '<h1>Order Meals</h1>'
                raise AssertionError('Unexpected read path')
        return Fake()

    def test_complete_reads_pending_renewal_and_calendar(self):
        from admin_source import collect
        result=collect(self.fixture())
        self.assertTrue(result['complete'])
        row=result['subscriptions'][0]
        self.assertEqual(row['payment_detail'],'paid')
        self.assertEqual(row['later_renewals'][0]['payment_detail'],'pending')
        self.assertEqual([x['date'] for x in row['schedule']],['2026-10-03','2026-10-04'])

    def test_sample_never_certifies_complete(self):
        from admin_source import collect
        self.assertFalse(collect(self.fixture(),1)['complete'])

    def test_detail_date_conflict_blocks_whole_source(self):
        from admin_source import collect
        fixture=self.fixture(); original=fixture.get
        fixture.get=lambda p:original(p).replace('01-10-2026','02-10-2026') if '/orders/view/' in p else original(p)
        with self.assertRaisesRegex(Blocked,'order_dates_conflict'):collect(fixture)

    def test_missing_summary_membership_blocks_whole_source(self):
        from admin_source import collect
        fixture=self.fixture(); original=fixture.get
        fixture.get=lambda p:original(p).replace('<td>100</td>','<td>999</td>') if '/summary/off_day/' in p else original(p)
        with self.assertRaisesRegex(Blocked,'summary_active_membership_conflict'):collect(fixture)


class CounterMismatchTests(unittest.TestCase):
    def test_underreported_counter_requires_empty_terminated_scan(self):
        from admin_source import paged
        row=lambda n:['']*16+['/orders/view/'+str(n)]
        def get(path):
            return json.dumps({'recordsTotal':2,'recordsFiltered':2,'data':[row(1),row(2),row(3)] if 'start=0' in path else []})
        result=paged(get)
        self.assertEqual(len(result),3)
        self.assertEqual(result.reported_total,2)
        def missing(path):
            return json.dumps({'recordsTotal':3,'recordsFiltered':3,'data':[row(1)] if 'start=0' in path else []})
        with self.assertRaises(Blocked):paged(missing)

class InvalidContactScopeTests(unittest.TestCase):
    def row(self):
        row=['']*17;row[1]='100';row[2]='Synthetic [00000000]';row[5]='01-10-2026';row[6]='04-10-2026';row[10]='success';row[16]='/orders/view/12';return row

    def test_invalid_contact_only_excluded_after_reference_proof(self):
        from admin_source import index
        with self.assertRaises(Blocked):index([self.row()])
        with self.assertRaises(Blocked):index([self.row()],irrelevant_invalid=lambda _:False)
        self.assertEqual(index([self.row()],irrelevant_invalid=lambda _:True),{})

    def test_historical_date_filter_does_not_infer_contact_identity(self):
        from admin_source import index
        row=self.row();row[2]='Synthetic [55667788]'
        self.assertEqual(index([row],min_start='2026-10-05'),{})

class TransportTests(unittest.TestCase):
    def test_read_rejects_cross_origin_post_and_unknown_mutation(self):
        import urllib.request
        from admin_source import Session
        session=Session.__new__(Session)
        for request in [urllib.request.Request('https://evil.invalid/admin'),urllib.request.Request('https://nutreeze.com/orders/ChangeOffDay',data=b'x'),urllib.request.Request('http://nutreeze.com/admin'),urllib.request.Request('https://nutreeze.com/admin',method='DELETE')]:
            with self.assertRaises(Blocked):session.read(request)

    def test_unambiguous_ui_dates(self):
        from admin_source import iso
        self.assertEqual(iso('2026-10-02'),'2026-10-02')
        self.assertEqual(iso('02-10-2026'),'2026-10-02')
        with self.assertRaises(Blocked):iso('10/02/26')


class FutureCalendarTests(unittest.TestCase):
    def test_past_flags_are_not_fabricated_or_required_for_future_days(self):
        html=schedule('<tr><td>1</td><td>2026-10-01</td><td>Thursday</td><td>-</td><td>-</td></tr>'+day('2026-10-02',True)+day('2026-10-03')+day('2026-10-04'))
        result=calendar(html,'2026-10-01','2026-10-04',today='2026-10-02')
        self.assertEqual([r['date'] for r in result],['2026-10-03','2026-10-04'])
        self.assertTrue(all(r['state']=='service' for r in result))


class PendingChronologyTests(unittest.TestCase):
    def test_pending_unknown_dates_hold_matching_contact(self):
        from admin_source import index
        row=['']*17;row[1]='101';row[2]='Synthetic [55667788]';row[5]='';row[6]='';row[10]='pending';row[16]='/orders/view/13'
        result=index([row],target_phones={'96555667788'})
        self.assertTrue(result['101']['chronology_unverified'])
        self.assertEqual(index([row],target_phones={'96555443322'}),{})

class AuthenticatedMealReadTests(unittest.TestCase):
    def test_nested_meal_tables_do_not_bypass_login_detection(self):
        from admin_source import Session
        session=Session.__new__(Session)
        page='<table><tr><td><table><tr><td>Meal</td></tr></table></td></tr></table>'
        session.read=lambda request:page
        self.assertEqual(session.get('/orders/getMealsDateWiseFilter/2026-10-03/13'),page)
        session.read=lambda request:page+'<input type="password" name="password">'
        with self.assertRaises(Blocked):session.get('/orders/getMealsDateWiseFilter/2026-10-03/13')

class PendingIdentityTests(unittest.TestCase):
    def row(self,identity,number):
        row=['']*17;row[1]=number;row[2]='Synthetic [55667788]';row[10]='pending';row[16]='/orders/view/'+identity
        return row
    def test_pending_duplicate_and_blank_display_numbers_retain_distinct_ids(self):
        from admin_source import index
        result=index([self.row('13','100'),self.row('14','100'),self.row('15','')],target_phones={'96555667788'},identity_key=True)
        self.assertEqual(set(result),{'13','14','15'})
        self.assertTrue(all(r['chronology_unverified'] for r in result.values()))
    def test_active_display_identity_and_pending_internal_identity_remain_strict(self):
        from admin_source import index
        for rows,kwargs in [([self.row('13','100'),self.row('14','100')],{}),([self.row('13','')],{}),([self.row('13','100'),self.row('13','101')],{'identity_key':True})]:
            with self.assertRaises(Blocked):index(rows,**kwargs)

class ConcurrentSubscriptionTests(unittest.TestCase):
    def test_same_start_different_subscription_holds_individual(self):
        from admin_source import collect
        from renewal import eligibility,KUWAIT
        from datetime import datetime
        fixture=CollectionTests().fixture();original=fixture.get
        def get(path):
            data=original(path)
            if '/ajaxlist/Active?' in path:
                page=json.loads(data);page['recordsTotal']=page['recordsFiltered']=2
                if page['data']:
                    extra=list(page['data'][0]);extra[1]='102';extra[16]='/orders/view/14';page['data'].append(extra)
                return json.dumps(page)
            return data
        fixture.get=get
        result=collect(fixture)
        self.assertTrue(result['complete'])
        row=result['subscriptions'][0]
        self.assertFalse(row['renewals_complete'])
        self.assertEqual(eligibility(row,datetime.now(KUWAIT)),'incomplete_individual_schedule_or_renewals')

class RedirectGuardTests(unittest.TestCase):
    def test_redirect_cannot_add_unapproved_query_or_fragment(self):
        import urllib.request
        from unittest.mock import patch,MagicMock
        from admin_source import Session
        handlers=[]
        def build(*items):
            handlers.extend(items)
            return MagicMock()
        def get(session,path,signing_in=False):
            return '<input name="_csrf" value="synthetic">' if path=='/admin' else '<h1>Dashboard</h1>'
        with patch('admin_source.urllib.request.build_opener',side_effect=build),patch.object(Session,'get',get),patch.object(Session,'read',return_value='<h1>Dashboard</h1>'):
            Session('synthetic','synthetic')
        guard=handlers[0]
        request=urllib.request.Request('https://nutreeze.com/admin')
        for url in ['https://nutreeze.com/orders/view/13?delete=1','https://nutreeze.com/dashboard/#anything','https://other.invalid/dashboard','http://nutreeze.com/dashboard']:
            with self.assertRaises(Blocked):guard.redirect_request(request,None,302,'',{},url)
