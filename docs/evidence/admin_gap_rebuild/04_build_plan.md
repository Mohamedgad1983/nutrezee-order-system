# Admin Gap Rebuild Plan

Date: 2026-06-15

## Strategy

Legacy-first, not greenfield. Keep the existing NestJS modular-monolith/API boundaries and React admin patterns. Do not build dormant modules without a recorded scope amendment.

## Completed This Session

| Unit | Scope | Reason |
|---|---|---|
| Customer profile address add | UI over existing `POST /customers/:id/addresses` | Customer addresses are P0 for order operations and migration readiness. |
| Customer profile order history | `GET /orders?customer_id=` plus profile table | Old customer list/profile was an entry point into order context. |
| Orders Playwright selector fix | Active status tab instead of stale select | Existing test no longer matched current branch UI. |
| Customers Playwright coverage | Create -> add address -> edit -> search | Covers the new customer-address P0 slice. |
| Evidence docs | Required matrices and migration readiness docs | Makes remaining gaps explicit and auditable. |

## Recommended Next Build Units

| Order | Unit | Priority | Entry Condition |
|---|---|---|---|
| 1 | Run current branch through local/staging CI and deploy preview | P0 | E2E credentials available; CI billing restored or local gate accepted |
| 2 | Legacy export/DB dry-run pack (`WP-DATA-01`) | P0 | Sponsor provides S1 legacy export/source/DB access |
| 3 | Workshop-driven validators and routing-rule editor | P0/P1 | Sponsor provides S2 DEC-005/006 content and UAT values |
| 4 | Customer allergy editor | P1 | Scope accepted; health write permissions verified |
| 5 | Finance report parity decision and implementation | P1 | Sponsor confirms whether old finance reports are in first cutover |
| 6 | Coupon/renewal queue decision and implementation | P1 | Sponsor confirms business criticality |
| 7 | Dispatch/drivers | P2 unless cutover scope changes | New amendment permitting dormant dispatch/driver module |

## Non-Goals For This Branch

- No production access or writes.
- No legacy admin unsafe route execution.
- No dispatch/driver module build without scope amendment.
- No full catalog CRUD while mirror mode and import-first posture remain active.
- No customer notification sending.
