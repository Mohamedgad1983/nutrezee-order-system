# 07 — Expiry email reconciliation vs the call-centre Excel + inclusive day-count fix

**Date:** 2026-06-22 · **Status: DONE (staging)** · Trigger: owner asked to double-check the daily doctor email against the call-centre's "Report Summary" Excel (36 customers expiring in 3 days).

---

## Finding
This morning's scheduled email listed **50** customers ("expiring 2026-06-25, in 3 days"); the call-centre Excel listed **36** ("Days Left" 3, one 2). They overlapped on **1** customer.

**Root cause — NOT a data error.** The migrated expiry data is correct: for every sampled order the new system's last meal-day equals the legacy `end_date` (e.g. order 23296 ends **24-06-2026** in both). The mismatch was a **day-counting convention**:
- Legacy / call-centre counts **inclusively** (today = day 1) → a customer expiring 24-Jun is **"3 days left"**.
- The new system counted **exclusively** (`expire − today`) → the same customer was "2 days", so its *"exactly 3 days"* filter targeted the **25-Jun** cohort instead.

So the email was sending the cohort one day further out than the report the call-centre works from.

## Fix
`app/scripts/expiring-subscription-email.mjs`: added inclusive day-counting (default on).
- New flag `EXPIRING_SUBSCRIPTION_DAYS_INCLUSIVE` (default `true`). Inclusive: `days_left = expire − today + 1`; the window targets `expire = today + (daysAhead − 1)` (exact) or `today … today + (daysAhead − 1)` (within).
- Display ("Days Left" column, HTML, CSV, text) now shows the inclusive count.
- Staging env set: `DAYS_AHEAD=3`, `WINDOW_MODE=exact`, `DAYS_INCLUSIVE=true`.

## Verification (dry-run, staging)
- New email = **36 customers expiring 2026-06-24, "in 3 days"** — same count as the Excel (within-mode = 125, far too broad → exact is correct).
- Customer-by-customer (by phone): **31/36 now match** (was 1/36).
- The residual **5** are data nuances, not the convention bug:
  - **hamad, batool, Rashed** — the new system uses a **later renewal order** (e.g. hamad 23416 → 28-Jun), so it correctly shows them as not-yet-expiring. The Excel rows reference the older order.
  - **عبدالرحمن (+965651…)** — customer not migrated (coverage gap; importable via the customer-coverage path, doc 34).
  - **Nour** — the Excel's day-2 entry; her migrated order has incomplete meal-days.

## Operational note
This morning's already-sent email (50, 25-Jun cohort) was one day off. The corrected logic takes effect on the next scheduled run; to re-send today's corrected list the owner runs the job with `EXPIRING_SUBSCRIPTION_FORCE=true` (the assistant is classifier-blocked from sending the PII email). The 3 renewal-order and 1 coverage cases are worth a separate reconciliation pass.
