# Nutrezee Legacy Full Migration — Final Report

Date: 2026-06-16
Branch: `migration/legacy-full-clone-reconciliation`
Resumed from: `292ae52`
Reconciliation method: read-only SELECTs against **staging** Postgres (`nutrezee-postgres-1`/`nutrezee`) via the `nutrezee-vps` MCP, compared with the 2026-06-14 legacy extraction on the VPS. Decisive findings independently re-verified by an adversarial 5-agent workflow (`legacy-migration-reconciliation-verify`).

## Final decision

> ## `NOT_VERIFIED_WITH_MISMATCHES`

A real legacy→staging migration **already exists** and is referentially sound, but it is **not** a verified 100% clone. Do **not** claim 100%, and do **not** treat staging as cutover-ready. No import or production action was taken this session.

## Source / Target / Controls

| | |
| --- | --- |
| **Source access** | `FULL_EXPORT_AVAILABLE` — legacy `nutreeze.com` admin extracted read-only 2026-06-14 (files on VPS). Live re-pull not configured this session; per-order detail pages were never extracted. |
| **Target access** | `NEW_STAGING_DB_AVAILABLE` — staging Postgres reachable read-only via `nutrezee-vps` MCP. Staging, **not** production. |
| **Migration controls** | `MIGRATION_DRY_RUN` default true · `MIGRATION_APPLY` default false → **no import performed this session**. |
| **Verification creds** | `E2E_EMAIL`/`E2E_PASSWORD` **missing** → authenticated API + browser verification BLOCKED. |

## Counts

| Entity | Legacy (authoritative) | Extracted | Imported (staging) | Reconciled |
| --- | --- | --- | --- | --- |
| customers | 20,151 | 20,151 (20,165 raw lines) | 19,379 created | ⚠️ −772 = 592 dedup + 29 held + ~151 unprocessed |
| order line items | per-meal (not extracted) | 0 | **1 (seed)** | ❌ P0 missing |
| orders (active) | 1,044 | 1,044 | 1,054 | ❌ +10 unexplained |
| orders (history) | no source total | orders_history.json | 19,465 | ⚠️ unprovable (no baseline) |
| addresses | no source total | — | 9,506 | ⚠️ 49% coverage, unprovable |
| payments | 929/1,044 active | — | 11,257 (paid 9,718) | ⚠️ unprovable |
| deliveries | per-order + 4 methods | not extracted | 0 / 1 method | ❌ P0 missing |
| packages | 7 | 7 | 7 legacy (+2 demo) | ✅ match |
| products | unknown | — | 2 | ⚠️ likely partial |
| areas | — | — | 127 | loaded |

Authoritative legacy↔new map (`sync_record`): customer 19,379 · order 19,465 · payment 11,257 · master 12 · package 9 · product 2.

## Reconciliation result

- **Count match:** NO (customers, active orders, delivery methods differ; order details/deliveries absent).
- **Checksum match:** not applicable — no per-record checksums were captured at extraction; reconciliation is count + FK + accounting based.
- **FK integrity:** YES — 0 orphans (orders→customer, address→customer, payment→order); 0 dup order numbers; 0 invalid dates; 0 dup normalized phones; 0 paid-zero-amount. **The imported data is sound; the failure mode is incompleteness, not corruption.**
- **Mismatches:** `docs/evidence/legacy_full_migration/mismatches.jsonl` (MM-01 … MM-13).

## Mismatch summary (prioritized)

**P0 — blocks any 100% claim**
1. **Per-meal order line items not migrated** (`order_item`=1, a seed). Order *headers* do carry package/total/dates/frozen names, but per-meal detail was never extracted. (MM-01)
2. **Delivery data not migrated** — `site_ref` null on all orders; legacy's 4 delivery methods absent (only new default "Home Delivery"). (MM-02)

**P1 — must be explained/closed before signoff**
3. **Customer −772 delta** = 592 phone-dedup + 29 held + ~151 unprocessed. **Risk:** phone dedup may have collapsed distinct family members sharing a number. Needs a row-level ledger. (MM-03)
4. **1,732 order-import errors** (all in `active_plans`), never re-applied (~8% of attempted orders). (MM-04)
5. **Active orders +10** (1,054 vs 1,044) — drift on the one metric with a baseline. (MM-05)
6. **Order-history completeness unprovable** (no source total for 19,465). (MM-06)
7. **Products only 2** — legacy meal catalog almost certainly larger. (MM-09)
8. **No authenticated app-layer verification** (masking/RBAC/bilingual/contract unverified end-to-end). (MM-12)

**P2 — data quality / process**
9. Addresses 49% coverage, no baseline (MM-10) · 105 customers no phone (MM-11) · 2 demo packages mis-tagged legacy (MM-08) · payments coverage unprovable (MM-07) · bulk load bypassed governed M19 batch flow, `reconciliation_run` empty (MM-13).

## Browser / API verification

- legacy checked: **no** (live legacy not re-accessible this session)
- new admin browser checked: **no** (BLOCKED — missing `E2E_*` creds)
- new API checked: **partial** — `/health` 200 (internal + Caddy); `/customers`,`/orders`,`/drafts` → 401 (auth enforced); migrated legacy orders present & queryable (e.g. order_numbers 24622/24618/24627).
- screenshots: `docs/evidence/legacy_full_migration/screenshots/new_admin/` (none captured)

## Tests (this session)

| Command | Result |
| --- | --- |
| `node --check tools/legacy-full-migration/validate-normalized.mjs` | pass |
| `npm run typecheck` (app) | pass |
| `npm run lint` (app) | pass |
| `npm run build` (app) | pass |
| `npm run test:placeholder` / `npx vitest run` (app) | **pass — 46 files, 207 tests** (native local PG :5432) |
| `npx playwright test` (tools/e2e-staging) | **not run — BLOCKED** (missing `E2E_*`) |
| Adversarial reconciliation workflow (5 agents, 70 DB tool-uses) | completed; 3/4 claims confirmed, 1 corrected (customer dedup) |

## Remaining blockers

1. **Legacy per-order detail extraction** (line items + delivery) — never pulled; requires a fresh read-only legacy session.
2. **`E2E_EMAIL`/`E2E_PASSWORD`** (staging admin) — to run authenticated API + browser verification.
3. **Row-level reconciliation ledger** — categorize every legacy→staging delta (customers 20,151→19,379; active 1,044→1,054; 1,732 order errors) so numbers are *explained*, not asserted.
4. **Product catalog** — confirm legacy meal/product count and re-extract (only 2 present).
5. **Authorization to re-import** — a corrective load needs `MIGRATION_APPLY=true` + explicit sign-off (staging only).

## Recommendation for management

- **Do not** declare the legacy migration complete or cut over. The current staging clone is a **strong partial**: customer/order/payment headers, addresses, and catalog are present, referentially clean, and queryable — suitable for **continued UAT and demo**, not for operational cutover.
- **Single highest-value next action:** obtain staging admin credentials and run the authenticated `tools/e2e-staging` suite against migrated data (the only modality proving user-visible, masking/RBAC-correct rendering), and in parallel re-extract legacy **order detail pages + product catalog** so order line items and deliveries can be imported. Then re-run this reconciliation with a row-level ledger to drive toward a defensible 100%.

## Safety attestation

No production access · no legacy writes · no destructive SQL · no import/apply · no secrets or raw PII printed or committed · target was staging only.
