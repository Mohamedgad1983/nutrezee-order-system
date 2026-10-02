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
        for p in ['/admin','/orders/view/12','/orders/ajaxlist/Active?draw=1&start=0&length=100','/summary/off_day/2026-10-02']:
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
        self.assertEqual(row['schedule'][1]['state'],'off')

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
