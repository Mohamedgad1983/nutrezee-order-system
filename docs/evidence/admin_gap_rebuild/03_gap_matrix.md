# Admin Gap Matrix

Date: 2026-06-15

Classification:
- P0 = blocks real operations or legacy order/customer migration.
- P1 = needed for admin parity and day-to-day work.
- P2 = needed soon but not blocking first operational release.
- P3 = later enhancement.

| Gap | Priority | Current State | Needed Next | Blocker / Owner |
|---|---|---|---|---|
| Real legacy customer/order/order-detail migration | P0 | M19 import tooling exists; real export not available | Obtain legacy export/DB/source access; run Batch 1/2 dry-runs on staging | Sponsor S1 |
| Migration mapping calibration | P0 | Screen-evidence mapping only | Calibrate field mappings against actual legacy schema/export | Sponsor S1, engineering after access |
| Workshop validator semantics | P0 | Engines exist; several validators are no-op | Define and implement L1/L2 semantics (`same_day_ack`, `pause_window`, `plan_still_active`, routing/cancel cascade) | Sponsor/workshop S2 |
| Customer addresses in profile | P0 | Backend existed, UI missing | Built this session: add-address UI on customer profile | Done in current branch |
| Customer order history in profile | P0 | API could list/search orders, no direct customer filter/profile view | Built this session: `customer_id` order filter + profile order-history table | Done in current branch |
| Staging UAT credentials for browser rerun | P0 | Playwright suite exists; shell lacks `E2E_EMAIL`/`E2E_PASSWORD` | Provide env vars or run via configured secure environment | Operator |
| GitHub Actions billing | P0 | Current docs say billing-blocked; recent units admin-merged | Restore billing so PRs receive CI gates | Operator |
| Routing-rule editor/content | P1 | Nutrition/allergen enrichment done; routing content blocked | Build 04c after DEC-006 section/routing content lands | Sponsor/workshop S2 |
| RBAC deny-mode sign-off | P1 | Staff/RBAC UI exists; matrix sign-off open | Sign S8 matrix and flip deny mode after verification | Sponsor/workshop S2 |
| Legacy finance report parity | P1 | Operational reports exist; old monthly/daily/payment/revenue/expiration reports not fully replaced | Decide if finance parity enters order-ops cutover or later phase | Product/sponsor |
| Coupon admin/rules | P1 | Coupon code captured; validation warning assumption; no admin module | Add coupon rules/usage only if moved into cutover scope | Product/sponsor |
| Customer allergy editor | P1 | Backend health-write API exists; profile read displays allergies | Add profile allergy editor with health permission guard | Engineering after scope |
| Catalog full CRUD/publish | P1 | Read/enrichment only; mirror mode blocks core writes | Real import, parity columns, cutover flag, then CRUD/publish if needed | S1 + product decision |
| Delivery/driver assignment | P2/P0 if dispatch included | Fulfillment statuses/roles exist; no driver module/UI | Scope amendment required before building dormant dispatch/drivers | Product/sponsor |
| Package expiration/renewal queue | P1 | Orders/reports only | Add renewal/expiration workflow if needed for first ops release | Product/sponsor |
| Dietician requests | P2 | No module | Health-sensitive workflow requires decision and privacy scope | Product/sponsor |
| Notifications to customers | P2 | Internal/email-capable notification log only | Keep dormant until channel/provider/workflow decision | Product/sponsor |
| Cashback/wallet | P2 | No ledger module | Later finance/customer-retention phase | Product/sponsor |
| Content/gallery/ads/social/subscribers | P3 | Not built | Keep legacy as system of record until separate content phase | Product/sponsor |

## Current P0 Status

- Built on branch: order list/detail/actions, customer list/create/edit/merge, customer address add, customer order history, payment queue/actions, audit, settings, staff, reports, catalog read/enrichment.
- Still not self-unblockable: real migration and UAT/pilot readiness require legacy access and workshop decisions.
