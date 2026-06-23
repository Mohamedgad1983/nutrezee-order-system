# 08 — Per-Order Expiry Report Mode + Call-Centre Reconciliation

**Date:** 2026-06-22 · **Status: DONE (staging)** · Follows [07 — inclusive day-count](07_inclusive_daycount_reconciliation.md).
**Goal:** make the daily expiry report match the call-centre Excel structure (per-order), behind a config flag, and reconcile honestly.

---

## 1. Root cause (confirmed)
The call-centre Excel is **per-order** (one row per order, has an `Order` column). The email was **per-customer** (one row per customer, latest subscription). For multi-order customers they diverge — a customer with an old order expiring in-window but a later renewal appears in the Excel (old order) but not in the per-customer email.

## 2. What changed (`app/scripts/expiring-subscription-email.mjs`)
- **`EXPIRY_REPORT_MODE`** (`per_order` | `per_customer`, **default `per_order`**). `per_order` reads `analytics.order_subscription_periods` (one row per order); `per_customer` reads `analytics.customer_subscription_status` (latest per customer). The per-order grain is derived from each order's own fulfillment days — a customer is **not** suppressed because they renewed later.
- **`EXPIRING_SUBSCRIPTION_EXCLUDE_STATUSES`** (default `rejected`): per-order mode omits `rejected` orders (never a real subscription) — the legacy report's scope. `cancelled` is kept (the Excel includes it).
- Report now carries the **legacy order number** + **start date** columns (CSV/HTML/text), matching the Excel.
- Inclusive day-counting (from doc 07) retained. `buildReportSql(cfg)` extracted as a pure, tested function; `main()` guarded for importability.
- Staging env set: `EXPIRY_REPORT_MODE=per_order`, `EXCLUDE_STATUSES` default, `WINDOW_MODE=exact`, `DAYS_INCLUSIVE=true`, `DAYS_AHEAD=3`.

## 3. Reconciliation vs the 36-row Excel (target window: expire 2026-06-24, "3 days left")

| Stage | Count |
|---|---|
| Per-order, raw (all statuses) | 52 orders |
| − `rejected` (16, none in Excel) | **36 orders** |
| Excel "day-3" orders (expire 24-Jun) | 35 |
| **Order-number match (Excel ∩ report)** | **34** |
| Excel-only (in Excel, not report) | 2 → §4 |
| Report-only (in report, not Excel) | 2 → §5 |

**Per-customer mode (preserved) for the same window = 36** (suppresses the renewed multi-order customers). Both modes verified by dry-run.

## 4. The two Excel-only orders — both legacy/Excel inconsistencies (NOT new-system bugs)

**عبدالرحمن — order 23504.** Excel: day-3 (→24-Jun). Legacy `orders_index` **and** the new system agree the order ends **21-Jun**. The Excel's "3 days left" disagrees with the order's own end-date. **Not force-fixed** (per instruction). *Business action:* confirm whether a newer order ending 24-Jun exists, or the Excel row is stale.

**Nour — order 22679.** Excel: day-2 (→23-Jun). **Verification contradicts the premise:** legacy `orders_index` says this order ends **24-Jun** (not 23-Jun), and `view_21719` references 24-Jun. The migrated fulfillment is contiguous-daily but **truncated at 19-Jun** (42 of ~47 days). So three sources disagree: migrated data **19-Jun**, legacy end-date **24-Jun**, Excel **23-Jun**. The legacy archive has **no meal-grid** for the 20–24 Jun gap (`meals_21719` absent, no `order_detail` row), so the true schedule for those days is not recoverable from what we hold, and a daily-fill cannot distinguish *migration truncation* from *early termination*.
- **Decision: NOT fabricated.** Fixing to the Excel's 23-Jun would contradict legacy (24-Jun); fabricating meal-days absent from the source violates the "do not fake data" rule. Treated as a documented exception alongside عبدالرحمن.
- *Business action:* re-pull order 22679's actual meal schedule from legacy to determine its true end (19/23/24-Jun). A controlled, idempotent single-order correction can then be applied to the **verified** value.

## 5. The two report-only orders — the new system is *more complete*
**23063** (+965515…) and **23211** (+965995…): both `active`, `success` payment, legacy end **24-Jun** (confirmed). They genuinely expire 24-Jun and are correctly in the report; the **Excel omitted them**. Not an error in the new system.

## 6. Honest final result
**34 / 36** of the Excel's orders are correctly represented in the per-order report. The 2 that aren't (عبدالرحمن, Nour) are **legacy/Excel inconsistencies** where the Excel's days-left disagrees with the order's own legacy end-date — **not** new-system bugs. The report additionally surfaces 2 valid orders the Excel missed. **This is 34/36, not 35/36** — the PM's 35/36 assumed Nour was a clean fix to 23-Jun; verification shows Nour is a second legacy/Excel inconsistency.

## 7. Tests
`app/tests/integration/ts-u-expiry-report-mode.test.ts` (TS-U, 9 cases, no DB): per_order → order view + excludes rejected; per_customer → customer view, no status filter; status exclusion configurable; inclusive exact/within window offsets; legacy_order_number + start date in both; `readConfig` defaults to per_order + validates. **9/9 pass.** Typecheck + lint green.

## 8. Commands (staging dry-runs)
```bash
# per-order (call-centre match) / per-customer (preserved)
docker exec --env-file /opt/nutrezee/expiring-subscription.env -e EXPIRING_SUBSCRIPTION_DRY_RUN=true \
  -e EXPIRY_REPORT_MODE=per_order   nutrezee-api-1 node /srv/scripts/expiring-subscription-email.mjs   # -> 36 orders, 2026-06-24
  -e EXPIRY_REPORT_MODE=per_customer ...                                                                # -> 36 (suppresses renewed)
```
No real email sent. No production. Timer unchanged (next scheduled run uses per_order via the env-file).

## 9. Owner decision (2026-06-23) — reverted to per_customer
On review, the owner confirmed the **call-centre Excel is the unreliable source** (it re-lists already-renewed customers, carries the date errors on عبدالرحمن/Nour, and omits valid orders 23063/23211) and the **per_customer "doctor's report" is correct**. The live mode was reverted: staging env `EXPIRY_REPORT_MODE=per_customer` and the code default changed to `per_customer`. `per_order` remains available behind the flag for ad-hoc per-order pulls. The investigation stands as the record of *why* the two disagree.
