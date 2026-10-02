import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from renewal import FileSource, Ledger, MESSAGE, SourceBlocked, eligibility, phone

NOW=datetime(2026,10,2,10,0,tzinfo=timezone.utc)  # 13:00 Kuwait


def subscription():
    return {'subscription_id':'TEST-SUB-1','phone':'50000001','state':'active',
            'updated_at':NOW.isoformat(),'schedule_complete':True,'renewals_complete':True,
            'payment_detail':'paid','payment_list':'paid','later_renewals':[],
            'schedule':[{'date':'2026-10-02','state':'off'},
                        {'date':'2026-10-03','state':'service'},
                        {'date':'2026-10-04','state':'service'}]}


class RenewalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.ledger=Ledger(self.root/'ledger.sqlite3');self.addCleanup(self.ledger.db.close)

    def source(self, row=None, **changes):
        data={'schema_version':1,'source_id':'TEST','captured_at':NOW.isoformat(),
              'complete':True,'payment_authority':'order_detail','subscriptions':[row or subscription()]}
        data.update(changes);p=self.root/'source.json';p.write_text(json.dumps(data));p.chmod(0o600)
        return FileSource(p,'TEST',True)

    def test_country_phone_validation(self):
        self.assertEqual(phone('00965 50000001'),'96550000001')
        self.assertEqual(phone('+973 30000001'),'97330000001')
        with self.assertRaises(SourceBlocked):phone('009733000001')

    def test_friday_off_two_service_days(self):
        self.assertEqual(eligibility(subscription(),NOW),'eligible')

    def test_weekend_off_only_one(self):
        row=subscription();row['schedule'][1]['state']='off'
        self.assertEqual(eligibility(row,NOW),'not_two_future_service_days')

    def test_paused_october_3_and_5_has_three(self):
        row=subscription();row['schedule']=[{'date':f'2026-10-{d:02}','state':'paused' if d in (3,5) else 'service'} for d in range(3,8)]
        self.assertEqual(eligibility(row,NOW),'not_two_future_service_days')

    def test_today_is_excluded(self):
        row=subscription();row['schedule'][0]['state']='service'
        self.assertEqual(eligibility(row,NOW),'eligible')

    def test_missing_or_partial_source(self):
        with self.assertRaises(SourceBlocked):FileSource().read(NOW)
        with self.assertRaises(SourceBlocked):self.source(complete=False).read(NOW)
        row=subscription();row['schedule_complete']=False
        self.assertEqual(eligibility(row,NOW),'incomplete_individual_schedule_or_renewals')

    def test_stale_and_future_source(self):
        for delta in [timedelta(minutes=-31),timedelta(seconds=1)]:
            with self.assertRaises(SourceBlocked):self.source(captured_at=(NOW+delta).isoformat()).read(NOW)
        row=subscription();row['updated_at']=(NOW-timedelta(minutes=31)).isoformat()
        self.assertEqual(eligibility(row,NOW),'stale_individual')

    def test_payment_conflict_and_pending(self):
        row=subscription();row['payment_detail']='pending'
        self.assertEqual(eligibility(row,NOW),'payment_conflict')
        row['payment_list']='pending'
        self.assertEqual(eligibility(row,NOW),'current_payment_review')

    def test_renewed_pending_and_conflicting_payment(self):
        row=subscription();row['later_renewals']=[{'state':'active','payment_detail':'paid','payment_list':'paid'}]
        self.assertEqual(eligibility(row,NOW),'verified_renewal')
        row['later_renewals'][0]['payment_detail']='pending'
        self.assertEqual(eligibility(row,NOW),'renewal_payment_conflict')
        row['later_renewals'][0]['payment_list']='pending'
        self.assertEqual(eligibility(row,NOW),'renewal_payment_review')

    def test_duplicate_or_unknown_calendar(self):
        row=subscription();row['schedule'].append(copy.deepcopy(row['schedule'][1]))
        self.assertEqual(eligibility(row,NOW),'duplicate_or_unknown_schedule_day')
        row=subscription();row['schedule'][1]['state']='unknown'
        self.assertEqual(eligibility(row,NOW),'duplicate_or_unknown_schedule_day')

    def test_optout_persists_and_audits(self):
        self.ledger.optout('+96550000001','Owner received opt-out',NOW)
        reopened=Ledger(self.root/'ledger.sqlite3')
        try:self.assertEqual(reopened.blocked('TEST-SUB-1','96550000001'),'opted_out')
        finally:reopened.db.close()
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM audit').fetchone()[0],1)
        self.assertEqual(json.loads(self.ledger.db.execute('SELECT ref FROM audit').fetchone()[0])['reason'],'Owner received opt-out')

    def test_sent_and_uncertain_never_retried(self):
        for state in ['sent','uncertain','sending']:
            self.ledger.db.execute('INSERT OR REPLACE INTO delivery VALUES(?,?,?)',('TEST-SUB-1','96550000001',state));self.ledger.db.commit()
            self.assertEqual(self.ledger.blocked('TEST-SUB-1','96550000001'),'previous_delivery_or_uncertain')

    def test_dry_run_and_restart_double_run(self):
        result=self.ledger.evaluate(self.source(),NOW)
        self.assertEqual(result['counts'],{'eligible':1});self.assertEqual(result['sent'],0);self.assertFalse(result['live_enabled'])
        reopened=Ledger(self.root/'ledger.sqlite3')
        try:self.assertEqual(reopened.evaluate(self.source(),NOW)['state'],'duplicate_run')
        finally:reopened.db.close()
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM delivery').fetchone()[0],0)

    def test_concurrent_double_run(self):
        source=self.source();results=[]
        def run():
            ledger=Ledger(self.root/'ledger.sqlite3')
            try:results.append(ledger.evaluate(source,NOW)['state'])
            finally:ledger.db.close()
        threads=[threading.Thread(target=run) for _ in range(2)]
        for t in threads:t.start()
        for t in threads:t.join()
        self.assertCountEqual(results,['complete','duplicate_run'])

    def test_blocked_source_retry_same_day(self):
        self.assertEqual(self.ledger.evaluate(FileSource(),NOW)['state'],'blocked')
        self.assertEqual(self.ledger.evaluate(self.source(),NOW)['state'],'complete')

    def test_recheck_observes_new_renewal_and_optout(self):
        source=self.source();self.assertEqual(self.ledger.recheck(source,'TEST-SUB-1','96550000001',NOW),'eligible')
        row=subscription();row['later_renewals']=[{'state':'active','payment_detail':'paid'}]
        self.source(row)
        self.assertEqual(self.ledger.recheck(source,'TEST-SUB-1','96550000001',NOW),'verified_renewal')
        self.ledger.optout('50000001','Customer request',NOW)
        self.assertEqual(self.ledger.recheck(source,'TEST-SUB-1','96550000001',NOW),'opted_out')

    def test_partial_bad_row_blocks_entire_cohort(self):
        data=subscription();bad=subscription();bad['subscription_id']='TEST-BAD';bad['phone']='50000002';bad['updated_at']='invalid'
        result=self.ledger.evaluate(self.source(subscriptions=[data,bad]),NOW)
        self.assertEqual(result['state'],'blocked');self.assertEqual(result['counts'],{})
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM decision').fetchone()[0],0)

    def test_manual_bulk_ledger_no_mutations(self):
        path=self.root/'bulk.sqlite3';db=sqlite3.connect(path)
        db.executescript('CREATE TABLE recipient(campaign_id INTEGER,phone TEXT,state TEXT);CREATE TABLE campaign(id INTEGER,message TEXT);')
        db.execute('INSERT INTO campaign VALUES(1,?)',(MESSAGE,));db.execute("INSERT INTO recipient VALUES(1,'96550000001','uncertain')");db.commit();db.close()
        ledger=Ledger(self.root/'other.sqlite3',path)
        try:self.assertEqual(ledger.blocked('TEST-SUB-1','96550000001'),'same_message_in_manual_bulk')
        finally:ledger.db.close()
        ledger=Ledger(self.root/'unavailable.sqlite3',self.root/'missing.sqlite3')
        try:self.assertEqual(ledger.blocked('TEST-SUB-1','96550000001'),'bulk_ledger_unavailable')
        finally:ledger.db.close()

    def test_protected_source_and_ledger(self):
        source=self.source();Path(source.path).chmod(0o644)
        with self.assertRaises(SourceBlocked):source.read(NOW)
        self.assertEqual(self.ledger.path.stat().st_mode & 0o777,0o600)

    def test_schedule_timezone_and_no_live_cli(self):
        root=Path(__file__).parent
        timer=(root/'waha-renewal.timer').read_text();service=(root/'waha-renewal.service').read_text()
        self.assertIn('13:00:00 Asia/Kuwait',timer);self.assertIn('Persistent=false',timer)
        self.assertIn('RestrictAddressFamilies=AF_UNIX',service)
        self.assertNotIn('sendText',(root/'renewal.py').read_text())

    def legacy_dependency_run(self, **changes):
        summary={'mode':'dry-run','live_enabled':False,'state':'complete',
                 'day':NOW.date().isoformat(),'counts':{'bulk_ledger_unavailable':41},
                 'sent':0,'error':None}
        summary.update(changes)
        day=NOW.date().isoformat()
        with self.ledger.db:
            self.ledger.db.execute('INSERT OR REPLACE INTO run VALUES(?,?,?,?)',
                                   (day,'complete',NOW.isoformat(),json.dumps(summary)))
            self.ledger.db.executemany('INSERT OR REPLACE INTO decision VALUES(?,?,?,?)',
                [(day,'SYNTHETIC-OLD-'+str(i),'9655000'+str(i).zfill(4),'bulk_ledger_unavailable') for i in range(41)])
        return summary

    def test_unavailable_bulk_blocks_whole_run_and_retry_after_recovery(self):
        path=self.root/'missing-bulk.sqlite3'
        self.ledger.bulk_path=path
        result=self.ledger.evaluate(self.source(),NOW)
        self.assertEqual(result['state'],'blocked')
        self.assertEqual(result['error'],'bulk_ledger_unavailable')
        self.assertEqual(result['counts'],{})
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM decision').fetchone()[0],0)
        db=sqlite3.connect(path)
        db.executescript('CREATE TABLE recipient(campaign_id INTEGER,phone TEXT,state TEXT);CREATE TABLE campaign(id INTEGER,message TEXT);')
        db.close()
        result=self.ledger.evaluate(self.source(),NOW)
        self.assertEqual(result['state'],'complete')
        self.assertEqual(result['counts'],{'eligible':1})
        self.assertEqual(result['sent'],0)

    def test_mid_cohort_bulk_failure_clears_every_decision(self):
        second=subscription();second['subscription_id']='TEST-SUB-2';second['phone']='50000002'
        self.ledger.blocked=lambda sid,number: None if sid=='TEST-SUB-1' else 'bulk_ledger_unavailable'
        result=self.ledger.evaluate(self.source(subscriptions=[subscription(),second]),NOW)
        self.assertEqual(result['state'],'blocked')
        self.assertEqual(result['counts'],{})
        self.assertEqual(result['error'],'bulk_ledger_unavailable')
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM decision').fetchone()[0],0)

    def test_recheck_unavailable_bulk_raises_instead_of_individual_hold(self):
        self.ledger.bulk_path=self.root/'missing-bulk.sqlite3'
        with self.assertRaisesRegex(SourceBlocked,'bulk_ledger_unavailable'):
            self.ledger.recheck(self.source(),'TEST-SUB-1','96550000001',NOW)

    def test_completed_dependency_run_can_retry_retains_original_aggregate_audit(self):
        prior=self.legacy_dependency_run()
        result=self.ledger.evaluate(self.source(),NOW)
        self.assertEqual(result['state'],'complete')
        self.assertEqual(result['counts'],{'eligible':1})
        decisions=self.ledger.db.execute('SELECT subscription,reason FROM decision').fetchall()
        self.assertEqual(decisions,[('TEST-SUB-1','eligible')])
        entry=json.loads(self.ledger.db.execute("SELECT ref FROM audit WHERE kind='retry_bulk_dependency_run'").fetchone()[0])
        self.assertEqual(entry['previous_summary'],prior)
        self.assertEqual(entry['previous_at'],NOW.isoformat())
        self.assertEqual(self.ledger.evaluate(self.source(),NOW)['state'],'duplicate_run')
        self.assertEqual(self.ledger.db.execute("SELECT count(*) FROM audit WHERE kind='retry_bulk_dependency_run'").fetchone()[0],1)
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM delivery').fetchone()[0],0)

    def test_legacy_dependency_retry_failure_stays_blocked_without_stale_decisions(self):
        prior=self.legacy_dependency_run()
        result=self.ledger.evaluate(FileSource(),NOW)
        self.assertEqual(result['state'],'blocked')
        self.assertEqual(result['counts'],{})
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM decision').fetchone()[0],0)
        entry=json.loads(self.ledger.db.execute("SELECT ref FROM audit WHERE kind='retry_bulk_dependency_run'").fetchone()[0])
        self.assertEqual(entry['previous_summary'],prior)
        self.assertEqual(self.ledger.evaluate(self.source(),NOW)['state'],'complete')

    def test_completed_runs_without_exact_safe_dependency_outcome_remain_deduped(self):
        for changes in ({'counts':{'eligible':41}}, {'counts':{'bulk_ledger_unavailable':0}},
                        {'counts':{'bulk_ledger_unavailable':True}}, {'counts':{'bulk_ledger_unavailable':'41'}},
                        {'sent':1}, {'live_enabled':True}, {'mode':'live'}, {'day':'2026-10-01'}):
            with self.subTest(changes=changes):
                self.legacy_dependency_run(**changes)
                result=self.ledger.evaluate(self.source(),NOW)
                self.assertEqual(result['state'],'duplicate_run')
                self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM decision').fetchone()[0],41)
        self.assertEqual(self.ledger.db.execute("SELECT count(*) FROM audit WHERE kind='retry_bulk_dependency_run'").fetchone()[0],0)

if __name__=='__main__':unittest.main()

class SourceReviewTests(unittest.TestCase):
    def test_source_review_cannot_become_eligible(self):
        from renewal import eligibility, KUWAIT
        from datetime import datetime
        self.assertEqual(eligibility({'subscription_id':'synthetic','review_reason':'calendar_changed'},datetime.now(KUWAIT)),'review_calendar_changed')
        self.assertEqual(eligibility({'subscription_id':'synthetic','review_reason':'untrusted value'},datetime.now(KUWAIT)),'source_review_unverified')
