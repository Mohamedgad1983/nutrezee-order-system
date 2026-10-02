#!/usr/bin/env python3
"""Two-service-day renewal assessment. Dry-run ONLY; no outbound transport."""
import argparse
from collections import Counter
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from zoneinfo import ZoneInfo

KUWAIT = ZoneInfo('Asia/Kuwait')
MESSAGE = 'لأن صحتك تهمّنا 💚 باقي يومين خدمة على انتهاء اشتراكك في Nutrezee. جدّد اليوم واحصل على خصم15% باستخدام كود US15.'
MAX_AGE = timedelta(minutes=30)


class SourceBlocked(ValueError):
    pass


def phone(value):
    if not isinstance(value, str):
        raise SourceBlocked('invalid_phone')
    value = value.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789'))
    if not re.fullmatch(r'\+?[0-9 ()-]+', value):
        raise SourceBlocked('invalid_phone')
    value = re.sub(r'[ ()-]', '', value)
    value = value[1:] if value.startswith('+') else value[2:] if value.startswith('00') else '965'+value if len(value)==8 else value
    if not re.fullmatch(r'[1-9][0-9]{7,14}', value):
        raise SourceBlocked('invalid_phone')
    if value.startswith(('965', '973')) and len(value) != 11:
        raise SourceBlocked('invalid_country_phone_length')
    return value


def timestamp(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError()
        return result
    except (ValueError, TypeError, AttributeError):
        raise SourceBlocked('invalid_source_timestamp') from None


class FileSource:
    """Operations-controlled verified export; unsupported/missing source stays blocked."""
    def __init__(self, path=None, source_id=None, verified=False):
        self.path, self.source_id, self.verified = path, source_id, verified

    def read(self, now):
        if not self.verified or not self.path or not self.source_id:
            raise SourceBlocked('individual_source_not_verified_payment_and_schedule_contract_missing')
        try:
            path = Path(self.path)
            if (path.is_symlink() or path.stat().st_mode & 0o077
                    or path.stat().st_uid != os.getuid()
                    or path.parent.stat().st_mode & 0o077):
                raise SourceBlocked('source_permissions')
            if path.stat().st_size > 10 * 1024 * 1024:
                raise SourceBlocked('source_too_large')
            data = json.loads(path.read_text())
        except SourceBlocked:
            raise
        except (OSError, ValueError):
            raise SourceBlocked('individual_source_unavailable') from None
        if data.get('source_id') != self.source_id or data.get('schema_version') != 1:
            raise SourceBlocked('source_contract_mismatch')
        if data.get('complete') is not True or data.get('payment_authority') != 'order_detail':
            raise SourceBlocked('incomplete_or_non_authoritative_source')
        age = now - timestamp(data.get('captured_at'))
        if age < timedelta(0) or age > MAX_AGE:
            raise SourceBlocked('stale_or_future_source')
        rows = data.get('subscriptions')
        if not isinstance(rows, list) or len(rows)>10000:
            raise SourceBlocked('invalid_source_rows')
        keys = [(r.get('subscription_id'), phone(r.get('phone'))) for r in rows if isinstance(r, dict)]
        if len(keys)!=len(rows) or len(set(keys))!=len(keys):
            raise SourceBlocked('duplicate_or_invalid_source_rows')
        return rows


def eligibility(row, now):
    if not isinstance(row.get('subscription_id'), str) or not row['subscription_id'].strip():
        return 'missing_subscription_id'
    if row.get('schedule_complete') is not True or row.get('renewals_complete') is not True:
        return 'incomplete_individual_schedule_or_renewals'
    if now-timestamp(row.get('updated_at')) > MAX_AGE or timestamp(row.get('updated_at')) > now:
        return 'stale_individual'
    detail, listing = row.get('payment_detail'), row.get('payment_list')
    if detail not in ('paid', 'pending', 'failed', 'refunded'):
        return 'payment_unverified'
    if listing is not None and listing != detail:
        return 'payment_conflict'
    if detail != 'paid':
        return 'current_payment_review'
    if row.get('state') != 'active':
        return 'inactive_subscription'
    renewals = row.get('later_renewals')
    schedule = row.get('schedule')
    if not isinstance(renewals, list) or not isinstance(schedule, list):
        return 'incomplete_individual_schedule_or_renewals'
    for renewal in renewals:
        if renewal.get('state')=='cancelled':
            continue
        payment=renewal.get('payment_detail')
        if renewal.get('payment_list') not in (None, payment):
            return 'renewal_payment_conflict'
        if payment=='paid':
            return 'verified_renewal'
        return 'renewal_payment_review'
    dates=set()
    today=now.astimezone(KUWAIT).date()
    seen=set()
    for entry in schedule:
        try:
            day=date.fromisoformat(entry['date'])
        except (ValueError, KeyError, TypeError):
            return 'invalid_schedule'
        if day in seen or entry.get('state') not in ('service','off','paused','cancelled'):
            return 'duplicate_or_unknown_schedule_day'
        seen.add(day)
        if day>today and entry['state']=='service':
            dates.add(day)
    return 'eligible' if len(dates)==2 else 'not_two_future_service_days'


class Ledger:
    def __init__(self, path, bulk_path=None):
        self.path=Path(path);self.bulk_path=bulk_path
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.parent.stat().st_mode & 0o077 or self.path.is_symlink():
            raise ValueError('ledger_permissions')
        self.db=sqlite3.connect(self.path, timeout=10)
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS run(day TEXT PRIMARY KEY,state TEXT,at TEXT,summary TEXT);
          CREATE TABLE IF NOT EXISTS decision(day TEXT,subscription TEXT,phone TEXT,reason TEXT,PRIMARY KEY(day,subscription,phone));
          CREATE TABLE IF NOT EXISTS suppression(phone TEXT PRIMARY KEY,reason TEXT,at TEXT);
          CREATE TABLE IF NOT EXISTS delivery(subscription TEXT,phone TEXT,state TEXT,PRIMARY KEY(subscription,phone));
          CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT,kind TEXT,actor TEXT,ref TEXT);
        ''')
        os.chmod(self.path,0o600)

    def event(self, now, kind, ref=''):
        self.db.execute('INSERT INTO audit(at,kind,actor,ref) VALUES(?,?,?,?)',(now.isoformat(),kind,'root-operator',ref))

    def optout(self, value, reason, now):
        normalized=phone(value)
        if not reason.strip() or len(reason)>200:
            raise ValueError('optout_reason_required')
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO suppression VALUES(?,?,?)',(normalized,reason,now.isoformat()))
            self.event(now,'optout',json.dumps({'phone_hash':hashlib.sha256(normalized.encode()).hexdigest(),'reason':reason}))

    def blocked(self, subscription, normalized):
        if self.db.execute('SELECT 1 FROM suppression WHERE phone=?',(normalized,)).fetchone():
            return 'opted_out'
        if self.db.execute('SELECT 1 FROM delivery WHERE subscription=? AND phone=?',(subscription,normalized)).fetchone():
            return 'previous_delivery_or_uncertain'
        if self.bulk_path:
            try:
                connection=sqlite3.connect(Path(self.bulk_path).resolve().as_uri()+'?mode=ro',uri=True)
                try:
                    existing=connection.execute("SELECT 1 FROM recipient r JOIN campaign c ON c.id=r.campaign_id WHERE r.phone=? AND c.message=? AND r.state IN ('sending','sent','uncertain') LIMIT 1",(normalized,MESSAGE)).fetchone()
                finally:
                    connection.close()
                if existing:
                    return 'same_message_in_manual_bulk'
            except sqlite3.Error:
                return 'bulk_ledger_unavailable'
        return None

    def recheck(self, source, subscription, normalized, now):
        rows=source.read(now)  # A fresh read on EVERY prospective decision.
        matches=[r for r in rows if r.get('subscription_id')==subscription and phone(r.get('phone'))==normalized]
        if len(matches)!=1:
            return 'subscription_changed_or_missing'
        return self.blocked(subscription,normalized) or eligibility(matches[0],now)

    def evaluate(self, source, now):
        day=now.astimezone(KUWAIT).date().isoformat()
        counts=Counter()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            existing=self.db.execute('SELECT state FROM run WHERE day=?',(day,)).fetchone()
            if existing and existing[0]=='complete':
                self.event(now,'duplicate_run',day)
                return {'mode':'dry-run','live_enabled':False,'state':'duplicate_run','day':day,'sent':0}
            try:
                rows=source.read(now)
                for row in rows:
                    normalized=phone(row['phone']);sid=row.get('subscription_id','')
                    reason=self.blocked(sid,normalized) or eligibility(row,now)
                    counts[reason]+=1
                    self.db.execute('INSERT OR REPLACE INTO decision VALUES(?,?,?,?)',(day,sid,normalized,reason))
                state='complete'
                error=None
            except (SourceBlocked, ValueError, TypeError, AttributeError) as exc:
                # Malformed input never turns into a sendable partial cohort.
                self.db.execute('DELETE FROM decision WHERE day=?',(day,))
                counts=Counter();state='blocked'
                error=str(exc) if isinstance(exc,SourceBlocked) else 'malformed_individual_source'
            summary={'mode':'dry-run','live_enabled':False,'state':state,'day':day,'counts':dict(counts),'sent':0,'error':error}
            self.db.execute('INSERT OR REPLACE INTO run VALUES(?,?,?,?)',(day,state,now.isoformat(),json.dumps(summary)))
            self.event(now,'dry_run_'+state,day)
            return summary


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--ledger',default='/opt/waha/renewal-data/renewal.sqlite3')
    parser.add_argument('--bulk-ledger',default='/opt/waha/bulk-data/campaigns.sqlite3')
    parser.add_argument('--opt-out',action='store_true',help='Read one phone from stdin; never print it.')
    parser.add_argument('--reason',default='')
    args=parser.parse_args()
    now=datetime.now(timezone.utc)
    ledger=Ledger(args.ledger,args.bulk_ledger)
    if args.opt_out:
        ledger.optout(sys.stdin.readline().strip(),args.reason,now)
        print(json.dumps({'opt_out_recorded':True,'live_enabled':False}))
        return
    source=FileSource(os.environ.get('RENEWAL_SOURCE_PATH'),os.environ.get('RENEWAL_SOURCE_ID'),os.environ.get('RENEWAL_SOURCE_VERIFIED')=='yes')
    print(json.dumps(ledger.evaluate(source,now),ensure_ascii=False))

if __name__=='__main__':
    main()
