# Cutover Blockers After Import

**Date:** 2026-06-15 · **Companion:** `Full_Staging_Import_Report.md`, `Manual_Review_Summary.md`, `19_Roadmap/Legacy_Core_Gap_To_Cutover.md`
What this staging load proved, and what still stands between it and a real cutover. This was a **staging load for analysis**, not the production migration.

## What the load proved (good news)

- The **M19 import pipeline works end-to-end** on real data: dry-run → gates → apply → idempotent dedup → audit, with **0 import errors** and **0 wrong customer merges**.
- The **rollback path works** (pre-import backup restore exercised + verified).
- **Active-plan data is high quality** — 1,043/1,043 resolved a customer, 0 bad dates, fulfillment days generate cleanly.

## Blockers / open items before a real cutover

| # | Blocker | Severity | Owner | Resolution |
|---|---|---|---|---|
| B1 | **Package resolution** — 545/1,043 orders didn't exact-match a catalog package (name formatting) | High | Eng | normalize names in `packageByNameInTx` (lowercase/trim/collapse spaces); re-run → ~100% link |
| B2 | **Extraction key** — legacy "Unique ID" is non-unique; must key on phone + capture the real DB id | High | Eng | done as a workaround (phone-key); for production, extract the true legacy id (edit-link href) |
| B3 | **Arabic-name policy** — ~38% customers AR-only in `full_name_en` | High | Sponsor | decide allow-AR vs transliterate/backfill |
| B4 | **Delivery method / area / slot absent** — not on the order list | Medium | Eng/Ops | order-detail extraction pass, or first-contact capture (WF-01) |
| B5 | **Coupons not loaded** (517 orders) | Medium | Eng | add coupon field to the active-plan import |
| B6 | **Money precision** — KWD ×1000 assumption | Medium | Eng/Finance | confirm minor-unit factor; default currency is SAR in code |
| B7 | **163-customer tail + 94 placeholder-phone** | Low | Ops/Eng | dilute-and-reapply or review |
| B8 | **Products** not extracted (page timeout) | Low | Eng | find the products AJAX route |
| B9 | **History out of scope** — only active plans loaded; expired/cancelled/completed stay in legacy by design | — | (by plan) | per strangler model — not a blocker |
| B10 | **Workshop/sponsor gates** (DEC-005/006, RBAC, cutoff times, ASM sign-off) | High | Sponsor | unchanged — see `SPONSOR_DECISION_PACK.md` |

## The honest bottom line

A real **production cutover** is NOT ready: B1–B3 (package linking, true legacy key, Arabic-name policy) and the standing sponsor/workshop gates must close first. But this staging load is a **major step** — it proves the migration machinery on real data and surfaces the exact mapping fixes. The single highest-leverage engineering fix is **B1 (normalized package matching)** — it moves 545 orders from frozen-name to linked in one change.

**Recommended next action:** apply B1 (normalized package match), re-run active_plans (idempotent), then re-analyze; in parallel, put B3 (Arabic-name) + B6 (KWD factor) to the sponsor.
