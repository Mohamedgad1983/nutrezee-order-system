# Reconciliation Plan

Date: 2026-06-16

## Required Proof for 100%

100% verification requires all of the following:
- Legacy and new counts match for every migrated entity.
- Every imported record has a preserved legacy source ID.
- No duplicate imported records.
- Foreign keys pass.
- Required field checks pass.
- Checksums match or an equivalent deterministic proof exists.
- Representative browser/API verification passes.
- Every mismatch is listed with exact legacy IDs.

## Entity Count Reconciliation

| Entity | Legacy Count Source | New Count Source | Status |
| --- | --- | --- | --- |
| customers | raw export/API/DB | `customer` + `sync_record` | blocked |
| addresses | raw export/API/DB | `address` + customer FK checks | blocked |
| orders | raw export/API/DB | `customer_order` + `sync_record` | blocked |
| order details | raw export/API/DB | `order_item` | schema/access review needed |
| payments | raw export/API/DB | `payment_record` + `sync_record` | blocked |
| deliveries | raw export/API/DB | `fulfillment_day` | schema/access review needed |
| packages | raw export/API/DB | `package` + `sync_record` | blocked |
| products | raw export/API/DB | `product` + `sync_record` | blocked |
| drivers | raw export/API/DB | no active target table | blocked/deferred |
| coupons | raw export/API/DB | no active target table except frozen code | blocked/deferred |

## FK Integrity Checks

- Every migrated order links to the correct migrated customer.
- Every migrated order detail links to the correct migrated order.
- Every migrated address links to the correct migrated customer.
- Every migrated payment links to the correct migrated order.
- Every migrated delivery links to the correct migrated order.
- Driver links are not verifiable until a target model exists or the scope is amended.

## Field-Level Sampling

When data exists:
- 50 customers or all if less than 50.
- 50 orders or all if less than 50.
- 50 order details or all if less than 50.
- 20 payments or all if less than 20.
- High-risk records: cancelled orders, paid orders, unpaid orders, discounts, allergies, notes, driver assignments, missing fields.

## Checksum Plan

- Normalize each record into deterministic JSON with sorted keys.
- SHA-256 each normalized record.
- Store aggregate checksum per entity in reconciliation output.
- Compare source normalized checksum with target reconstructed checksum where supported.

## Report Format

| Entity | Legacy Count | New Count | Count Match? | Field Checksum Match? | FK Check Passed? | Status |
| ------ | -----------: | --------: | ------------ | --------------------- | ---------------- | ------ |
| customers | 0 | 0 | no source | no source | no source | blocked |
| addresses | 0 | 0 | no source | no source | no source | blocked |
| orders | 0 | 0 | no source | no source | no source | blocked |
| order_details | 0 | 0 | no source | no source | no source | blocked |
| payments | 0 | 0 | no source | no source | no source | blocked |
| deliveries | 0 | 0 | no source | no source | no source | blocked |
