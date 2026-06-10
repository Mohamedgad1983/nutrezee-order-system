-- 0011_wave5_notifications_reports.sql — WP-12 M11/M15 slice.
-- Customer notification channels remain dormant. M15 owns no business tables; it
-- rebuilds projections from outbox history.

CREATE TABLE notification_template (
  id text PRIMARY KEY,
  code text NOT NULL UNIQUE,
  channel text NOT NULL CHECK (channel IN ('internal','email','whatsapp','push','sms')),
  body_en text NOT NULL,
  body_ar text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text,
  updated_at timestamptz, updated_by text, version_row integer NOT NULL DEFAULT 1
);

CREATE TABLE notification_log (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES notification_template(id) ON DELETE RESTRICT,
  template_version integer NOT NULL,
  source_event_id text,
  recipient_type text NOT NULL CHECK (recipient_type IN ('staff_role','staff_user','customer')),
  recipient_ref text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('internal','email','whatsapp','push','sms')),
  status text NOT NULL CHECK (status IN ('sent','failed')),
  at timestamptz NOT NULL DEFAULT now(),
  payload_summary jsonb NOT NULL DEFAULT '{}',
  UNIQUE (source_event_id, template_id, recipient_type, recipient_ref)
);
CREATE INDEX notification_log_at ON notification_log (at);
CREATE TRIGGER notification_log_append_only
  BEFORE UPDATE OR DELETE ON notification_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

INSERT INTO notification_template (id, code, channel, body_en, body_ar, created_by) VALUES
 ('seed-nt-aging-draft','aging_draft','internal','Draft requires follow-up','Draft requires follow-up','migration-0011'),
 ('seed-nt-queue-sla','queue_sla','internal','Review queue SLA needs attention','Review queue SLA needs attention','migration-0011'),
 ('seed-nt-unrouted-items','unrouted_items','internal','Kitchen has unrouted items','Kitchen has unrouted items','migration-0011'),
 ('seed-nt-ticket-blocked','ticket_blocked','internal','Kitchen ticket is blocked','Kitchen ticket is blocked','migration-0011'),
 ('seed-nt-ready-to-pack','ready_to_pack','internal','Fulfillment day is ready to pack','Fulfillment day is ready to pack','migration-0011'),
 ('seed-nt-payment-failed','payment_failed','internal','Payment failed and needs finance review','Payment failed and needs finance review','migration-0011'),
 ('seed-nt-reconciliation-divergent','reconciliation_divergent','internal','Reconciliation run is divergent','Reconciliation run is divergent','migration-0011'),
 ('seed-nt-dormant-role-granted','dormant_role_granted','internal','Dormant role was granted','Dormant role was granted','migration-0011');

INSERT INTO setting (id, key, value, value_type, scope, editable_by_roles, created_by) VALUES
 ('seed-set-notification_trigger_map','notification_trigger_map',
  '{
     "aging_draft": {"event_type":"order.draft_aging_alert","template":"aging_draft","recipient_type":"staff_role","recipient_ref":"ops_manager","enabled":true},
     "queue_sla": {"event_type":"review.sla_alert","template":"queue_sla","recipient_type":"staff_role","recipient_ref":"ops_manager","enabled":true},
     "unrouted_items": {"event_type":"kitchen.ticket_generated","template":"unrouted_items","recipient_type":"staff_role","recipient_ref":"ops_manager","enabled":true},
     "ticket_blocked": {"event_type":"kitchen.ticket_status_changed","template":"ticket_blocked","recipient_type":"staff_role","recipient_ref":"ops_manager","enabled":true},
     "ready_to_pack": {"event_type":"fulfillment.status_changed","template":"ready_to_pack","recipient_type":"staff_role","recipient_ref":"ops_manager","enabled":true},
     "payment_failed": {"event_type":"payment.status_changed","template":"payment_failed","recipient_type":"staff_role","recipient_ref":"finance","enabled":true},
     "reconciliation_divergent": {"event_type":"bridge.reconciliation_run","template":"reconciliation_divergent","recipient_type":"staff_role","recipient_ref":"ops_manager","enabled":true},
     "dormant_role_granted": {"event_type":"rbac.dormant_role_granted","template":"dormant_role_granted","recipient_type":"staff_role","recipient_ref":"super_admin","enabled":true}
   }',
  'json','notifications','["admin","ops_manager"]','migration-0011');

INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-notification.template.manage','notification.template.manage','[]','migration-0011'),
 ('seed-perm-notification.trigger.run','notification.trigger.run','[]','migration-0011'),
 ('seed-perm-notification.log.read','notification.log.read','[]','migration-0011'),
 ('seed-perm-report.view.intake_funnel','report.view.intake_funnel','["pii","payment","health"]','migration-0011'),
 ('seed-perm-report.view.daily_ops','report.view.daily_ops','["pii","payment","health"]','migration-0011'),
 ('seed-perm-report.view.kitchen_day_list','report.view.kitchen_day_list','["pii","health"]','migration-0011'),
 ('seed-perm-report.export','report.export','["pii","payment","health"]','migration-0011');

INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'migration-0011'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin' AND (p.code LIKE 'notification.%' OR p.code LIKE 'report.%'))
  OR (r.code = 'admin' AND p.code IN ('notification.template.manage','notification.trigger.run',
                                      'notification.log.read','report.view.intake_funnel',
                                      'report.view.daily_ops','report.view.kitchen_day_list','report.export'))
  OR (r.code = 'ops_manager' AND p.code IN ('notification.trigger.run','notification.log.read',
                                            'report.view.intake_funnel','report.view.daily_ops',
                                            'report.view.kitchen_day_list','report.export'))
  OR (r.code = 'order_agent' AND p.code = 'report.view.intake_funnel')
  OR (r.code = 'kitchen_user' AND p.code = 'report.view.kitchen_day_list')
  OR (r.code = 'finance' AND p.code IN ('report.view.daily_ops','report.export'))
  OR (r.code = 'report_viewer' AND p.code IN ('report.view.intake_funnel',
                                              'report.view.daily_ops',
                                              'report.view.kitchen_day_list',
                                              'report.export'))
);
