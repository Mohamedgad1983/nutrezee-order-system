#!/usr/bin/env python3
"""WP-OPS-A76 — remove Fleetbase orders dated before a fixed day (owner: keep from 2026-10-01 only).
Usage: prune.py count | prune.py apply [YYYYMMDD ...]   Works one delivery day per transaction; a foreign-key
error aborts and rolls back that day only. Never touches a day >= KEEP_FROM, WhatsApp orders, drivers or vehicles."""
import json, subprocess, sys, time
KEEP_FROM = '20261001'
COMPANY = '2db920aa-d0d4-42a7-a0a3-c9d4c6dd487c'
def mysql(sql):
    r = subprocess.run(['docker', 'exec', '-i', 'fleetbase-database-1', 'mysql', '-uroot', '-N', '-B', 'fleetbase'], input=sql, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr.strip()
def days():
    rc, out, err = mysql("select distinct substring(internal_id,22,8) from orders where internal_id like 'NUTREEZE-PARTNER-DAY-%' order by 1;")
    return [d for d in out.split() if d.isdigit() and len(d) == 8 and d < KEEP_FROM]
def totals():
    rc, out, _ = mysql("select 'orders',count(*) from orders union all select 'payloads',count(*) from payloads union all select 'places',count(*) from places union all select 'contacts',count(*) from contacts union all select 'tracking_numbers',count(*) from tracking_numbers union all select 'tracking_statuses',count(*) from tracking_statuses union all select 'kept_orders_from_oct', count(*) from orders where internal_id like 'NUTREEZE-PARTNER-DAY-%' and substring(internal_id,22,8) >= '" + KEEP_FROM + "' union all select 'wa_orders', count(*) from orders where internal_id like 'NUTREEZE-WA-DAY-%' union all select 'drivers', count(*) from drivers union all select 'vehicles', count(*) from vehicles;")
    return dict(l.split('\t') for l in out.strip().splitlines())
def day_sql(day):
    assert day.isdigit() and len(day) == 8 and day < KEEP_FROM
    p = f'NUTREEZE-PARTNER-DAY-{day}'
    return f"""
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @p = '{p}';
START TRANSACTION;
CREATE TEMPORARY TABLE t_o (uuid char(36) collate utf8mb4_unicode_ci primary key, payload_uuid char(36) collate utf8mb4_unicode_ci) AS select uuid, payload_uuid from orders where company_uuid='{COMPANY}' and internal_id like concat(@p,'-ORDER-%');
CREATE TEMPORARY TABLE t_tn (uuid char(36) collate utf8mb4_unicode_ci primary key) AS select uuid from tracking_numbers where owner_uuid in (select uuid from t_o);
CREATE TEMPORARY TABLE t_p (uuid char(36) collate utf8mb4_unicode_ci primary key) AS select distinct payload_uuid as uuid from t_o where payload_uuid is not null;
CREATE TEMPORARY TABLE t_pl (uuid char(36) collate utf8mb4_unicode_ci primary key) AS select uuid from places where company_uuid='{COMPANY}' and json_unquote(json_extract(meta,'$.integration_prefix')) = @p;
CREATE TEMPORARY TABLE t_c (uuid char(36) collate utf8mb4_unicode_ci primary key) AS select uuid from contacts where company_uuid='{COMPANY}' and internal_id like concat(@p,'-CUSTOMER-%');
update drivers set current_job_uuid = null where current_job_uuid in (select uuid from t_o);
update positions set order_uuid = null where order_uuid in (select uuid from t_o);
update positions set destination_uuid = null where destination_uuid in (select uuid from t_pl);
delete from routes where order_uuid in (select uuid from t_o);
delete from proofs where order_uuid in (select uuid from t_o);
update tracking_numbers set status_uuid = null where uuid in (select uuid from t_tn);
delete from tracking_statuses where tracking_number_uuid in (select uuid from t_tn);
delete from orders where uuid in (select uuid from t_o);
select concat('orders=', row_count());
delete from tracking_numbers where uuid in (select uuid from t_tn);
delete from payloads where uuid in (select uuid from t_p);
update contacts set place_uuid = null where place_uuid in (select uuid from t_pl);
delete from places where uuid in (select uuid from t_pl);
select concat('places=', row_count());
delete from contacts where uuid in (select uuid from t_c);
select concat('contacts=', row_count());
COMMIT;
"""
mode = sys.argv[1] if len(sys.argv) > 1 else 'count'
if mode == 'count':
    d = days(); print(json.dumps({'old_days': len(d), 'first': d[:1], 'last': d[-1:], 'totals': totals()}))
elif mode == 'apply':
    todo = sys.argv[2:] or days(); before = totals(); ok = failed = 0; t0 = time.time()
    for day in todo:
        rc, out, err = mysql(day_sql(day))
        if rc == 0 and 'orders=' in out: ok += 1
        else: failed += 1; print(json.dumps({'day': day, 'failed': err[:240]}), flush=True)
        if len(todo) <= 3: print(day, out.split())
    print(json.dumps({'days_done': ok, 'days_failed': failed, 'seconds': round(time.time() - t0), 'before': before, 'after': totals()}))
