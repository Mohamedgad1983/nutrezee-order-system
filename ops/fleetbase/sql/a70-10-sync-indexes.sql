-- A70.10 (2026-10-03): indexes the nightly Partner sync looks orders and customers up by.
-- Without them every lookup scanned ~33,000 rows (50–76 ms each, twice per order).
-- Applied on the Fleetbase MySQL (database `fleetbase`) online; additive only.
ALTER TABLE orders   ADD INDEX idx_orders_company_internal_id   (company_uuid, internal_id), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE contacts ADD INDEX idx_contacts_company_internal_id (company_uuid, internal_id), ALGORITHM=INPLACE, LOCK=NONE;
ALTER TABLE orders   ADD INDEX idx_orders_facilitator           (facilitator_uuid),           ALGORITHM=INPLACE, LOCK=NONE;
-- Rollback: ALTER TABLE orders DROP INDEX idx_orders_company_internal_id, DROP INDEX idx_orders_facilitator;
--           ALTER TABLE contacts DROP INDEX idx_contacts_company_internal_id;
