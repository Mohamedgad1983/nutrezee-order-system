-- 0002_wave1_seeds.sql — Wave 1 seeds (WP-01 DoD: "seeds match registers")
-- Sources: rbac_architecture.md (roles, matrix slice), validation_rules_binding.md §3
-- (settings registry), order_lifecycle_status_model.md (transition tables [Proposed
-- until DEC-005 — config rows, editable without redeploy]), DM-06 (reason-code domains;
-- code CONTENT is workshop-owned, one [Proposed] generic code per domain so flows work).
-- Seed ids use a readable 'seed-' prefix (stable across environments, ULIDs for runtime rows).

-- ===== Roles: 8 active + 4 dormant (rbac_architecture §role evaluation) =====
INSERT INTO role (id, code, name_en, name_ar, active, dormant, created_by) VALUES
 ('seed-role-super_admin','super_admin','Super Admin',NULL,true,false,'seed'),
 ('seed-role-admin','admin','Admin',NULL,true,false,'seed'),
 ('seed-role-ops_manager','ops_manager','Operations Manager',NULL,true,false,'seed'),
 ('seed-role-order_agent','order_agent','Order Agent',NULL,true,false,'seed'),
 ('seed-role-kitchen_user','kitchen_user','Kitchen User',NULL,true,false,'seed'),
 ('seed-role-support_agent','support_agent','Support Agent',NULL,true,false,'seed'),
 ('seed-role-finance','finance','Finance',NULL,true,false,'seed'),
 ('seed-role-report_viewer','report_viewer','Report Viewer',NULL,true,false,'seed'),
 ('seed-role-whatsapp_agent','whatsapp_agent','WhatsApp Agent',NULL,true,true,'seed'),
 ('seed-role-branch_manager','branch_manager','Branch Manager',NULL,true,true,'seed'),
 ('seed-role-driver','driver','Driver',NULL,true,true,'seed'),
 ('seed-role-fleet_supervisor','fleet_supervisor','Fleet Supervisor',NULL,true,true,'seed');

-- ===== Permission vocabulary (operations live in WP-01/02 scope; grows per WP) =====
INSERT INTO permission (id, code, visibility_grants, created_by) VALUES
 ('seed-perm-staff.read','staff.read','["pii"]','seed'),
 ('seed-perm-staff.create','staff.create','["pii"]','seed'),
 ('seed-perm-staff.update','staff.update','["pii"]','seed'),
 ('seed-perm-staff.deactivate','staff.deactivate','[]','seed'),
 ('seed-perm-rbac.role.read','rbac.role.read','[]','seed'),
 ('seed-perm-rbac.role.grant','rbac.role.grant','[]','seed'),
 ('seed-perm-rbac.permission.edit','rbac.permission.edit','[]','seed'),
 ('seed-perm-audit.read','audit.read','[]','seed'),
 ('seed-perm-settings.read','settings.read','[]','seed'),
 ('seed-perm-settings.update.ops','settings.update.ops','[]','seed'),
 ('seed-perm-settings.update.gates','settings.update.gates','[]','seed');

-- ===== Matrix slice (rbac_architecture matrix — [Proposed] pending S8 sign-off) =====
INSERT INTO role_permission (id, role_id, permission_id, created_by)
SELECT 'seed-rp-' || r.code || '-' || p.code, r.id, p.id, 'seed'
FROM role r JOIN permission p ON (
  (r.code = 'super_admin') -- SA: everything seeded so far
  OR (r.code = 'admin' AND p.code IN
      ('staff.read','staff.create','staff.update','staff.deactivate',
       'rbac.role.read','audit.read','settings.read','settings.update.ops'))
  OR (r.code = 'ops_manager' AND p.code IN
      ('staff.read','rbac.role.read','audit.read','settings.read','settings.update.ops'))
  OR (r.code IN ('order_agent','kitchen_user','support_agent','finance','report_viewer')
      AND p.code = 'settings.read')
  OR (r.code = 'finance' AND p.code = 'audit.read')
);

-- ===== Settings registry (validation_rules_binding §3 — defaults [Proposed]) =====
INSERT INTO setting (id, key, value, value_type, scope, editable_by_roles, created_by) VALUES
 ('seed-set-draft_retention_days','draft_retention_days','14','number','intake','["ops_manager"]','seed'),
 ('seed-set-review_sla_minutes','review_sla_minutes','120','number','review','["ops_manager"]','seed'),
 ('seed-set-draft_aging_alert_hours','draft_aging_alert_hours','4','number','intake','["ops_manager"]','seed'),
 ('seed-set-coupon_validation_mode','coupon_validation_mode','"warn"','enum','intake','["super_admin"]','seed'),
 ('seed-set-slot_capacity_mode','slot_capacity_mode','"warn"','enum','intake','["ops_manager"]','seed'),
 ('seed-set-merge_undo_days','merge_undo_days','7','number','customers','["super_admin"]','seed'),
 ('seed-set-order_number_prefix','order_number_prefix','"N-"','text','orders','["super_admin"]','seed'),
 ('seed-set-reconciliation_due_hour','reconciliation_due_hour','"10:00"','time','bridge','["ops_manager"]','seed'),
 ('seed-set-kitchen_cutoff_time','kitchen_cutoff_time','null','time','kitchen','["ops_manager"]','seed'),
   -- ^ MUST be set before kitchen go-live (validation binding §3); null = unset
 ('seed-set-payment_gate','payment_gate','"none"','enum','payments','["super_admin"]','seed'),
 ('seed-set-session_idle_minutes','session_idle_minutes','60','number','platform','["super_admin"]','seed'),
 ('seed-set-login_lockout_threshold','login_lockout_threshold','5','number','platform','["super_admin"]','seed'),
 ('seed-set-rbac_enforcement_mode','rbac_enforcement_mode',
  '{"super_admin":"log","admin":"log","ops_manager":"log","order_agent":"log","kitchen_user":"log","support_agent":"log","finance":"log","report_viewer":"log","whatsapp_agent":"log","branch_manager":"log","driver":"log","fleet_supervisor":"log"}',
  'json','platform','["super_admin"]','seed');
   -- staged enforcement: log -> warn -> deny per role (backend_foundation §3 item 3)

-- ===== Cutover flags (legacy_transition §1) =====
INSERT INTO feature_flag (id, key, on_flag, note, created_by) VALUES
 ('seed-flag-cutover_intake','cutover_intake',false,'Order creation moves to new system (G2)','seed'),
 ('seed-flag-cutover_kitchen','cutover_kitchen',false,'Kitchen day-list is system-generated','seed'),
 ('seed-flag-cutover_catalog','cutover_catalog',false,'Catalog SoT moves from legacy mirror','seed'),
 ('seed-flag-refunds_enabled','refunds_enabled',false,'Dormant until workshop Q20 (DEC-009)','seed'),
 ('seed-flag-whatsapp_api','whatsapp_api',false,'Dormant until DEC-002','seed');

-- ===== Reason-code domains (DM-06; one [Proposed] generic code each — workshop fills) =====
INSERT INTO reason_code (id, domain, code, label_en, created_by)
SELECT 'seed-rc-' || d || '-other', d, 'other', 'Other (specify in note) [Proposed seed]', 'seed'
FROM unnest(ARRAY['rejection','cancellation','return_to_draft','day_cancel',
                  'ticket_block','escalation','complaint','payment_fail','merge']) AS d;

-- ===== Transition config (status model L1/L2/payment/ticket/draft — [Proposed DEC-005]) =====
-- order (plan) machine
INSERT INTO transition_config (id, machine, from_status, to_status, allowed_roles, validations, requires_reason, active, created_by) VALUES
 ('seed-tc-o1','order','pending_review','approved','["ops_manager"]','["hard_warnings_resolved","slot_capacity","coupon_validity"]',false,true,'seed'),
 ('seed-tc-o2','order','pending_review','rejected','["ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-o3','order','pending_review','draft','["ops_manager","order_agent"]','[]',true,true,'seed'),
 ('seed-tc-o4','order','approved','active','["system"]','["payment_gate"]',false,true,'seed'),
 ('seed-tc-o5','order','approved','cancelled','["ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-o6','order','active','paused','["ops_manager"]','["pause_window"]',false,true,'seed'),
 ('seed-tc-o7','order','paused','active','["ops_manager"]','[]',false,true,'seed'),
 ('seed-tc-o8','order','active','completed','["system"]','["all_days_terminal"]',false,true,'seed'),
 ('seed-tc-o9','order','active','expired','["system"]','[]',false,true,'seed'),
 ('seed-tc-o10','order','paused','expired','["system"]','[]',false,true,'seed'),
 ('seed-tc-o11','order','active','cancelled','["ops_manager"]','["same_day_ack"]',true,true,'seed'),
 ('seed-tc-o12','order','paused','cancelled','["ops_manager"]','[]',true,true,'seed'),
-- fulfillment (day) machine (dispatch-state rows seeded but inactive until Phase 4 WPs)
 ('seed-tc-f1','fulfillment','scheduled','kitchen_queued','["system"]','["routing_rules_present"]',false,true,'seed'),
 ('seed-tc-f2','fulfillment','scheduled','skipped','["system"]','[]',false,true,'seed'),
 ('seed-tc-f3','fulfillment','scheduled','cancelled_day','["system","ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-f4','fulfillment','kitchen_queued','in_preparation','["kitchen_user"]','[]',false,true,'seed'),
 ('seed-tc-f5','fulfillment','in_preparation','ready_to_pack','["system","kitchen_user"]','["all_tickets_prepared"]',false,true,'seed'),
 ('seed-tc-f6','fulfillment','ready_to_pack','packed','["kitchen_user"]','[]',false,true,'seed'),
 ('seed-tc-f7','fulfillment','kitchen_queued','cancelled_day','["ops_manager"]','["same_day_ack"]',true,true,'seed'),
 ('seed-tc-f8','fulfillment','in_preparation','cancelled_day','["ops_manager"]','["same_day_ack"]',true,true,'seed'),
 ('seed-tc-f9','fulfillment','packed','assigned_to_driver','["fleet_supervisor"]','["capacity_rule"]',false,false,'seed'),
 ('seed-tc-f10','fulfillment','assigned_to_driver','out_for_delivery','["driver"]','[]',false,false,'seed'),
 ('seed-tc-f11','fulfillment','assigned_to_driver','packed','["fleet_supervisor"]','[]',false,false,'seed'),
 ('seed-tc-f12','fulfillment','out_for_delivery','delivered','["driver"]','[]',false,false,'seed'),
 ('seed-tc-f13','fulfillment','out_for_delivery','failed','["driver"]','[]',true,false,'seed'),
 ('seed-tc-f14','fulfillment','failed','rescheduled','["fleet_supervisor","ops_manager"]','["plan_still_active"]',false,false,'seed'),
 ('seed-tc-f15','fulfillment','packed','cancelled_day','["ops_manager"]','[]',true,true,'seed'),
-- payment machine (refund pair inactive until Q20/DEC-009)
 ('seed-tc-p1','payment','unpaid','link_sent','["order_agent","finance"]','[]',false,true,'seed'),
 ('seed-tc-p2','payment','unpaid','paid','["finance"]','[]',false,true,'seed'),
 ('seed-tc-p3','payment','link_sent','paid','["finance"]','[]',false,true,'seed'),
 ('seed-tc-p4','payment','link_sent','failed','["finance","system"]','[]',true,true,'seed'),
 ('seed-tc-p5','payment','unpaid','cod_pending','["order_agent","finance"]','[]',false,true,'seed'),
 ('seed-tc-p6','payment','cod_pending','collected','["finance"]','[]',false,true,'seed'),
 ('seed-tc-p7','payment','paid','refund_requested','["ops_manager"]','[]',true,false,'seed'),
 ('seed-tc-p8','payment','refund_requested','refunded','["finance"]','[]',true,false,'seed'),
-- ticket machine
 ('seed-tc-t1','ticket','queued','in_progress','["kitchen_user"]','[]',false,true,'seed'),
 ('seed-tc-t2','ticket','in_progress','prepared','["kitchen_user"]','[]',false,true,'seed'),
 ('seed-tc-t3','ticket','in_progress','blocked','["kitchen_user"]','[]',true,true,'seed'),
 ('seed-tc-t4','ticket','queued','blocked','["kitchen_user"]','[]',true,true,'seed'),
 ('seed-tc-t5','ticket','blocked','in_progress','["kitchen_user"]','[]',false,true,'seed'),
-- draft machine (business statuses DRAFT/PENDING_REVIEW project from these — C6)
 ('seed-tc-d1','draft','open','submitted','["order_agent","ops_manager"]','["completeness"]',false,true,'seed'),
 ('seed-tc-d2','draft','submitted','returned','["ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-d3','draft','returned','submitted','["order_agent","ops_manager"]','["completeness"]',false,true,'seed'),
 ('seed-tc-d4','draft','submitted','converted','["system"]','[]',false,true,'seed'),
 ('seed-tc-d5','draft','submitted','rejected','["ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-d6','draft','open','cancelled','["order_agent","ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-d7','draft','returned','cancelled','["order_agent","ops_manager"]','[]',true,true,'seed'),
 ('seed-tc-d8','draft','open','expired','["system"]','[]',false,true,'seed');
