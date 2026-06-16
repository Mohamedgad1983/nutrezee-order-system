# Legacy vs New Side-by-Side Verification

Date: 2026-06-16

Status: `NOT_RUN` — live legacy admin not re-accessible this session.

## Why not run

Live side-by-side requires opening the same record in both the **legacy** `nutreeze.com` admin and the **new** staging admin. This session has neither a configured live legacy session (`LEGACY_BASE_URL`/credentials absent) nor staging admin credentials (`E2E_*` absent). The legacy side exists only as the 2026-06-14 extraction snapshot on the VPS, and the new side was verified at the data layer (see `10_reconciliation_results.md`).

## Data-layer cross-check performed instead (read-only, masked)

| Legacy ID | Entity | Legacy (extract) | New (staging) | Match? |
| --- | --- | --- | --- | --- |
| customers (aggregate) | count | 20,151 extracted | 19,379 staged | ❌ −772 |
| orders active (aggregate) | count | 1,044 profiled | 1,054 staged | ❌ +10 |
| packages | count | 7 | 7 | ✅ |
| delivery_methods | count | 4 | 1 | ❌ −3 |
| order line items | presence | per-order detail (not extracted) | 1 (seed) | ❌ |

Individual phone/email/name values are intentionally **not** reproduced here (PII). Representative legacy order numbers confirmed present in staging: 24622, 24618, 24627, 24626, 24614 (status active).

## To complete this phase

Provide a read-only legacy session + staging admin credentials, pick ~10 representative customers/orders, and compare visible fields screen-to-screen, masking phone/email in any committed evidence.
