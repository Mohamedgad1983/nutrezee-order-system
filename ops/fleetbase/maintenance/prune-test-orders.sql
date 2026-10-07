SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
START TRANSACTION;
CREATE TEMPORARY TABLE t_o (uuid char(36) collate utf8mb4_unicode_ci primary key, payload_uuid char(36) collate utf8mb4_unicode_ci) AS
  select uuid, payload_uuid from orders where internal_id is not null and internal_id not like 'NUTREEZE-PARTNER-DAY-%' and internal_id not like 'NUTREEZE-WA-DAY-%'
    and (internal_id like 'DEMO-%' or internal_id like 'TEST-%' or internal_id like 'A28-LABEL-PROBE%' or internal_id like 'A62-CONSOLE-TEST%' or internal_id like 'NUTREEZE-PARTNER-ORDER-%' or internal_id like 'NUTREEZE-PARTNER-%');
select concat('target_orders=', count(*)) from t_o;
CREATE TEMPORARY TABLE t_tn (uuid char(36) collate utf8mb4_unicode_ci primary key) AS select uuid from tracking_numbers where owner_uuid in (select uuid from t_o);
CREATE TEMPORARY TABLE t_p (uuid char(36) collate utf8mb4_unicode_ci primary key) AS select distinct payload_uuid as uuid from t_o where payload_uuid is not null;
update drivers set current_job_uuid = null where current_job_uuid in (select uuid from t_o);
update positions set order_uuid = null where order_uuid in (select uuid from t_o);
delete from routes where order_uuid in (select uuid from t_o);
delete from proofs where order_uuid in (select uuid from t_o);
update tracking_numbers set status_uuid = null where uuid in (select uuid from t_tn);
delete from tracking_statuses where tracking_number_uuid in (select uuid from t_tn);
delete from waypoints where payload_uuid in (select uuid from t_p);
delete from entities where payload_uuid in (select uuid from t_p);
delete from orders where uuid in (select uuid from t_o);
select concat('orders=', row_count());
delete from tracking_numbers where uuid in (select uuid from t_tn);
delete from payloads where uuid in (select uuid from t_p);
select concat('payloads=', row_count());
COMMIT;
select concat('orders_left_outside_day_prefixes=', count(*)) from orders where internal_id is null or (internal_id not like 'NUTREEZE-PARTNER-DAY-%' and internal_id not like 'NUTREEZE-WA-DAY-%');
