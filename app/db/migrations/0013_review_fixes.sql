-- 0013 — WP-01..13 independent review fixes (review/claude-wp01-wp13-audit)
--
-- 1) physical_schema_design.md §2 wave 4: payment_record carries "Index (order_id);
--    (status)" — the order_id index was missing (get-payment-for-order lookups).
CREATE INDEX payment_record_order ON payment_record (order_id);

-- 2) Remove the structurally-dead `dormant_role_granted` notification trigger.
--    Security-family events (auth./rbac./staff.) are audit-only and NEVER written to
--    the outbox (event_catalog rule; backend_foundation §5), so the M11 router can
--    never see `rbac.dormant_role_granted` — the WP-12 seed promised an alert that
--    cannot fire. The dormant-grant alert remains delivered as a HIGH audit event with
--    an explicit reason marker (M13 RoleAdminService, WP-02). Template deactivated to
--    keep the seed history but stop it appearing as live config.
UPDATE setting
SET value = value - 'dormant_role_granted', version = version + 1
WHERE key = 'notification_trigger_map';

UPDATE notification_template
SET active = false, updated_at = now(), updated_by = 'migration-0013'
WHERE code = 'dormant_role_granted';
