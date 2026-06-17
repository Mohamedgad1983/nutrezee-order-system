# 10 — Last-30-Days Validation V1–V8 (staging apply `01KVAKEJ81NY46128Z7CWZ1FEY`)

> **Result: ACCEPTED.** All eight checks pass against ground-truth DB reconciliation. An independent
> 10-agent adversarial review flagged apparent count gaps; resolving them against the live DB **proved
> full reconciliation with zero silent data loss** (the gaps were missing bridging fields, not defects).

## Definitive parent/meal-day reconciliation (queried on staging)
```
parents = 60
  ├─ linked (order_id NOT NULL) = 34
  │    ├─ with in-window clean items = 28   → hold all 211 clean items
  │    └─ zero in-window meal-days   = 6    → archival parent only
  └─ unlinked (order_id NULL) = 26
       ├─ with in-window meal-days = 24    → hold all 28 exceptions (missing_order_link)
       └─ zero in-window meal-days = 2     → archival parent only (out-of-window dates kept in raw)

in-window meal-days = sum(meal_day_count) = 239 = 211 clean items + 28 exceptions   ✅ exact
zero-in-window parents = 6 + 2 = 8 = records_seen(60) − records_candidate(52)        ✅
```
**Hard integrity proofs (live queries):**
- unlinked parents with in-window days but **no** exception (silent drop) → **0** ✅
- clean items whose parent is unlinked → **0** ✅ (all 211 belong to linked parents)
- 8 zero-in-window parents → **all 8** have a raw-archive row (lossless, traceable) ✅

## V1–V8
| # | Check | Verdict | Evidence |
|---|---|---|---|
| **V1** | Source→raw + hash dedup | **PASS** | seen 60 = would_archive 60 = raw_inserted 60 = DB raw 60; duplicate_raw_hashes 0; rerun skips all 60. |
| **V2** | Raw→clean transformation; exceptions explain non-imported | **PASS** | **sum in-window meal-days 239 = 211 clean items + 28 exceptions** (exact). Every in-window meal-day is a clean item or an exception; 0 silent drops. (60 parents include 8 zero-in-window archival parents — meal-day grain, not parent grain.) |
| **V3** | internal_id→order_number→sync_record→customer_order→customer | **PASS** | items_with_order_link **211/211** (0 missing item links); 24 unlinked-with-days parents → all 28 exceptions; 0 clean items under unlinked parents. Sample chain 21274/21275/21276 → order_id → customer_id verified. |
| **V4** | Dates valid + in-window; no null/out-of-window | **PASS** | min 2026-05-18 = window_from, max 2026-06-17 = window_to, out_of_window 0, null 0, invalid_date 0. |
| **V5** | No duplicate clean meal-days; raw_sha unique | **PASS** | duplicate_meal_days 0; duplicate_raw_hashes 0; rerun re-archives nothing (would_skip_duplicate 60, inserts 0). |
| **V6** | Exception reasons/counts; ids-only; actionable | **PASS** | 28 = `{missing_order_link:28}`, reconciled across dry-run/apply/DB; detail holds ids only (`{"order_number":...}`), no PII; root cause pinpointed (0/24 order_numbers in sync_record). |
| **V7** | Idempotency | **PASS** | rerun: would_skip_duplicate 60, all inserts 0, DB unchanged (60/60/211/28), 2 apply-run records. |
| **V8** | Readiness + widen-to-90 decision | **PASS (accept); widen after repair** | Mechanics proven, idempotent, no corruption, fully backed up. The 28 missing_order_link exceptions are an **order-sync-completeness dependency** (order_numbers ≥ watermark not yet synced), not a meal-history defect — repair via the relink pass (doc 11) before/with widening. |

## On the adversarial review
The independent panel returned V2 "fail" and V3/V8 "inconclusive/fail" because the evidence bundle I
gave it lacked the bridging fields (zero-in-window parent counts, items-per-parent). Those are **not
defects** — querying the live DB closed every gap: `239 = 211 + 28`, `0` silent drops, `0` orphan
items. The review's value was forcing this ground-truth reconciliation rather than asserting it. The
one substantive lead — "2 unlinked parents with no exception" — resolved to the 2 unlinked orders that
have **zero in-window meal-days** (nothing to import or except; full history preserved in raw archive).

## Decision
**Last-30-days meal-history import is ACCEPTED.** Recommend preparing last-90-days **after** an
order-sync/relink pass clears the `missing_order_link` exceptions (doc 11). Do not widen blindly.
