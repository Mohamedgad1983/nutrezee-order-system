# First-Migration Scope: Core Dataset, Subscription Lifecycle, WhatsApp Segments, Reconciliation

Date: 2026-06-16 · Scope locked by sponsor to the first safe migration (NO per-day meal details — those are a later kitchen/fulfillment phase).

In-scope entities: customers · addresses · orders · packages · payments · delivery method · delivery time · status · products catalog.

---

## A. Core Migration Dataset — status

| Entity | Legacy (source) | Staging (migrated) | State |
| --- | ---: | ---: | --- |
| customers | 20,151 | 19,379 | imported; −772 (dedup-explained, ~180 to review) |
| addresses | (re-extract for baseline) | 9,506 | imported; FK-clean |
| orders | 20,637 distinct | 19,465 | imported; −1,172 (expired-heavy) |
| packages | 7 | 7 | ✅ match |
| payments | (re-extract for baseline) | 11,257 | imported; FK-clean |
| delivery method | 4 | 1 master | **extracting now** (all 4 confirmed in data) |
| delivery time | slots | — | **extracting now** |
| status | active/expire/cancel/pending | active/expired/cancelled/rejected | mapped (see D) |
| products catalog | 1,296 | 2 | **extracted (1,296)**; import pending |

Per-day meal details: **out of scope** this phase (ajax-gated; kitchen/fulfillment domain). They are NOT required to compute subscription start/end dates — those are on the order header. Deferred to a later kitchen migration.

---

## B. Subscription Lifecycle Dataset

Built per legacy customer (most-recent subscription) from migrated staging data. **7,713 rows** exported to `/opt/nutrezee/whatsapp-segments-2026/lifecycle.csv` on the VPS — contains PII (name/phone), **never committed**. Columns:

`legacy_customer_id, legacy_order_id, customer_name, customer_name_ar, customer_phone, package_name, subscription_start, subscription_end, status, payment_status, days_until_expiry, days_since_expiry, whatsapp_segment, renewal_eligible, exclusion_reason`

Delivery area/method/time will be joined in once the order-detail extraction completes (in progress).

---

## C. WhatsApp Bot Readiness Segments

One row per legacy customer with a subscription (7,713). PII-free counts (full breakdown: `whatsapp_segments_summary.json`).

| Segment | Customers | Use |
| --- | ---: | --- |
| EXPIRES_TODAY | 31 | urgent renewal |
| ACTIVE_RENEWAL_3_DAYS | 45 | renewal |
| ACTIVE_RENEWAL_7_DAYS | 118 | renewal |
| EXPIRED_1_7_DAYS | 124 | fresh win-back |
| EXPIRED_8_30_DAYS | 388 | win-back |
| EXPIRED_31_90_DAYS | 633 | win-back |
| EXPIRED_90_PLUS | 4,005 | reactivation |
| PENDING_PAYMENT | 1,141 | payment recovery (exclude from renewal) |
| CANCELLED_EXCLUDE | 554 | exclude |
| ACTIVE_FUTURE_NObot (active >7d) | 674 | not yet a target |
| INVALID_PHONE_EXCLUDE | 0 | — |
| MISSING_DATE_REVIEW | 0 | — |
| DUPLICATE_CUSTOMER_REVIEW | 0 | — |

**Total 7,713.** Immediate renewal targets (today/3d/7d) = **194**; recent win-back (expired ≤30d) = **512**; renewal-eligible total = **5,344**.

Notes: INVALID_PHONE / MISSING_DATE / DUPLICATE = 0 among order-holders (import deduped phones; all legacy orders have start+end dates). **Computed on staging, which is ~1,172 orders short and slightly stale (active 1,054 vs live 1,026) — recompute after the corrective re-import before the operational bot run.**

---

## D. Reconciliation (legacy vs staging)

| Entity | Source count | Staging count | Count match | Missing | Duplicates | FK | Status |
| --- | ---: | ---: | --- | ---: | --- | --- | --- |
| customers | 20,151 | 19,379 | ❌ | ~772 (592 dedup + 29 hold + ~151) | 0 dup phone | 0 orphan | dedup-explained; row-level ledger needed |
| addresses | not yet profiled | 9,506 | ⚠️ | — | — | 0 orphan | needs source baseline (re-extract) |
| orders | 20,637 distinct | 19,465 | ❌ | ~1,172 | 0 dup order_number | 0 orphan | shortfall concentrated in expired |
| packages | 7 | 7 | ✅ | 0 | — | — | match |
| payments | not yet profiled | 11,257 | ⚠️ | — | — | 0 orphan | needs source baseline (re-extract) |
| delivery method | 4 (19,916 orders) | 1 master / 0 per-order | ❌→**extracted** | 3 masters + per-order import | — | — | ✅ extraction complete (0 errors) |
| delivery time | 19,873 orders (96.3%) | 0 | ❌→**extracted** | per-order import | — | — | ✅ extraction complete |
| delivery area | 114 distinct (20,626 orders) | 127 masters / 0 per-order | ⚠️→**extracted** | per-order link import | — | — | ✅ extraction complete |
| status | A/Expire/cancel/pending | active/expired/cancelled/rejected | ⚠️ | — | — | — | active 1,026 vs 1,054 (daily drift) |
| products catalog | 1,296 | 2 | ❌ | 1,294 | — | — | extracted; import gated |

Checksums: no per-record checksums were captured at the original import; reconciliation is count + FK + import-accounting based. FK integrity is clean across all imported entities (0 orphans).

### Not yet 100%

Per the rule, **100% is NOT claimed.** Open items to close the first-migration scope:
1. **Products** (1,294 missing) — extracted; needs a gated import.
2. **Delivery method + time** — extraction in progress; needs import to backfill per-order.
3. **Orders −1,172** and **customers ~180 (29 hold + ~151 unprocessed)** — corrective re-import of the failed/held rows.
4. **Addresses & payments** — need source-side baselines (re-extract counts) to reconcile.
5. All of the above require an authorized staging re-import (`MIGRATION_APPLY=true`); this session is extract + validate + dry-run only.
