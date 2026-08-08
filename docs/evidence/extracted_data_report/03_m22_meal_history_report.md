# 03 — m22 Meal-History Report

**Date:** 2026-06-20 · **Scope:** the m22 meal-history extraction/import program (last-90 complete; last-year in progress).
**Verification:** core counts **DB-verified this run** against staging; pipeline/reconciliation figures **previously documented** in `docs/evidence/meal_history/` (cited inline).

---

## 1. Headline status

| Item | Value | Status | Provenance |
|---|---|---|---|
| Last-90 candidates | 4,927 | CONFIRMED | documented (`meal_history/26,32`) |
| Raw artifacts archived | 4,927 / 4,927 | CONFIRMED | documented (`meal_history/30,32`) |
| DB raw match (distinct sha) | 4,927 / 4,927 | CONFIRMED | documented (`meal_history/30`) |
| Silent drops | 0 | CONFIRMED | documented (`meal_history/30`) |
| Clean meal items (after retry close) | 67,908 | CONFIRMED | **DB-verified** + documented |
| Meal-history parent rows | 4,955 | CONFIRMED | **DB-verified** |
| Raw archive rows | 4,987 | CONFIRMED | **DB-verified** |
| Open exceptions | 77 (all `missing_order_link`) | PARTIAL | **DB-verified** + documented |
| Distinct customers | 2,628 | CONFIRMED | **DB-verified** |
| DB storage confirmed | yes | CONFIRMED | **DB-verified** |
| Idempotency confirmed | yes | CONFIRMED | documented (`meal_history/30,32`) |
| Last-year scrape complete | **NO** | NOT VERIFIED | documented (`meal_history/37,47`) |

> **DB-verified this run (2026-06-20):** `legacy_meal_history_raw`=4,987 · `customer_meal_history`=4,955 · `customer_meal_history_items`=67,908 · open exceptions=77 (all `missing_order_link`) · distinct meal-history customers=2,628. See [sql/read_only_verification.sql](sql/read_only_verification.sql).

---

## 2. What m22 captured correctly — `CONFIRMED`

- **Lossless raw archive.** Every scraped artifact is stored in `legacy_meal_history_raw` keyed by `raw_sha` (UNIQUE), so re-archiving is a no-op. Last-90: 4,927 candidates → 4,927 raw → 4,927 distinct sha in DB, **0 silent drops** *(`meal_history/30`, "Proofs"; DB-verified raw=4,987 incl. earlier phases)*.
- **Clean meal-day model.** 67,908 `customer_meal_history_items`, unique on `(legacy_order_id, meal_date, coalesce(meal_type,''))` — **0 duplicate meal-days** *(`meal_history/32`; migration `0018`)*.
- **Customer coverage.** 2,628 distinct customers have last-90 meal-day history *(DB-verified)*.
- **Idempotency proven.** A full re-apply of all 4,927 artifacts inserted 0 raw/parent/item/exception rows and left DB counts unchanged *(`meal_history/30` "Proof 6"; `meal_history/32` "Idempotency confirmation")*.
- **Date coverage.** 2026-03-19 → 2026-06-17 (the last-90 window) *(`data_intelligence/03`)*.

## 3. What m22 did NOT capture — `PARTIAL` / `BLOCKED`

- **Dish content is null.** `meal_type`, `meal_name`, `meal_ref` on `customer_meal_history_items` are **empty** — items are `(order, date)` pairs only. The parent `meal_types` jsonb (`["breakfast","snack"]`) is a **scrape artifact** (regex over HTML), not real meal-type data *(`data_intelligence/03`, "Meal History (m22) Quality")*.
- **No delivery outcome.** Meal-history carries no delivered/skipped status (and `fulfillment_day` is 100% `scheduled` — DB-verified in report 02).
- **Implication:** meal-history tells you a customer *had a plan-day on a date*, not *what they ate or whether it arrived*. For cadence, `fulfillment_day` (527,724 rows) is richer and is the recommended source.

## 4. The 77 `missing_order_link` exceptions — root cause & why relink cannot be forced — `PARTIAL`

**What they are:** 77 open exceptions, all reason `missing_order_link`, across **40 distinct legacy orders** *(DB-verified: 77 open / all `missing_order_link`; `meal_history/33,34`)*. These meal-days were parsed correctly but reference legacy orders absent from `sync_record`, so they cannot be deterministically linked to a `customer_order`.

**Root cause (the 40 orders split):** *(`meal_history/34`)*
- **17 orders ≤ watermark 24,630** — within order-sync's processed range but **deliberately not synced**: 16 `placeholder_phone/review` + 1 `reversed_dates/review`, held in `migration_exception_review`. Non-deterministic by design.
- **23 orders > watermark 24,630** — order numbers 24,631–24,674, newer than the synced set; not yet processed by order-sync.

**Why relink cannot be forced:** the legacy order extract on the VPS (`orders_history.json`, 26,071 records) carries **only `id, start_date, end_date, package, status` — no phone, no amount, no customer** *(`meal_history/34`)*. The governed order-sync creates an order only when a valid phone matches an already-synced customer. With no phone, every candidate is skipped → **`would_create = 0`**. The relink dry-run therefore reports **resolvable = 0** *(`meal_history/35`, `31`; `32`)*.

**Binding rule:** these must **never** be repaired by name or phone matching. The known case **order #24629** is `placeholder_phone/review/pending` (below watermark) — explicitly non-deterministic; do not auto-link *(`meal_history/34`; `22`)*.

## 5. What must be repaired first (before deterministic relink) — `RECOMMENDED`

1. **Fresh full-detail legacy order re-pull** including **phone + amount + customer** for orders ≥ 24,631 — this is the *order-sync / extract* track's job, a read-only legacy scrape with its own gates (not meal-history).
2. **Governed M19 import apply** to create those orders + `sync_record` rows where a deterministic customer link exists.
3. **Manual review** of the 16 `placeholder_phone` + 1 `reversed_dates` cases held in `migration_exception_review` (human decision; auto-linking by phone/name is forbidden).

Only after (1)–(3) can the meal-history relink job deterministically promote the 77 exceptions. *(`meal_history/34`, "What must be repaired first".)*

## 6. Last-year scrape — `NOT VERIFIED`

- **Candidate count:** 13,453 *(`meal_history/36`)*.
- **State on record:** **IN PROGRESS, resumable** — a snapshot of ~413 of ~8,526 new fetched (~4.8%), ETA ~5–6h *(`meal_history/37`, title + progress table)*.
- **Completion evidence:** **NONE.** The doc explicitly states it "does **not** block on the multi-hour scrape" and that "Last-year import/apply/reconcile (docs 38, 40, 41) follow scrape completion." Those follow-up docs do not exist in the repo. The master closure report lists last-year as "🔄 **IN PROGRESS** (resumable, ~5–6h; doc 37)" *(`meal_history/47`)*.

> **Statement for the record:** *Last-year completion is **not confirmed** from repository evidence.* It was started and is resumable; no DB apply or reconciliation of the last-year window is documented or present in staging.

- **Apply guard (shipped & tested):** the importer guard was widened so a `last_year` apply is allowed **only** under its own explicit token `MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_YEAR_STAGING`, plus `SYNC_TARGET=staging`, scope present in `APPLY_SCOPES`, `MEAL_IMPORT_SOURCE_VPS=1`, DB ≥ 0019. `full`/`all`/unknown scopes stay non-applyable — no backdoor to full history. 9/9 guard tests green *(`meal_history/39`)*.
- **Full-history decision:** **NO-GO / DEFER** — a documented resource/readiness gate (~14h end-to-end + large expected `missing_order_link` tail because order-sync is incomplete), not a guardrail failure *(`meal_history/42`, `47`)*.

## 7. Incremental sync — `CONFIRMED` DISABLED

Built as a **read-only, dry-run, DISABLED** planner: `meal-history-incremental-sync.mjs` + wrapper + a oneshot systemd service with **no `[Install]`, no `.timer`** (manual start only). Apply mode and production target are refused; even when started it stays dry-run. Last dry-run: records_seen 2981 / already_archived 2967 / would_scrape 14 *(`meal_history/46`)*. **No timer is enabled.**

## 8. Migration tables (reference)

`legacy_meal_history_raw`, `customer_meal_history` (parent, UNIQUE `legacy_order_id`), `customer_meal_history_items` (UNIQUE `(legacy_order_id, meal_date, coalesce(meal_type,''))`), `customer_meal_history_exceptions` (reason enum incl. `missing_order_link`), `customer_meal_history_import_runs` (scope: last_30/last_90/last_year/full/relink) — all from migration `0018`; resolution-trail columns added in `0019` *(migrations `0018`, `0019`)*.

## 9. Recommended next step for m22 — `RECOMMENDED`

1. **Do not** force-relink the 77 exceptions; leave them open until a full-detail order re-pull exists.
2. **Do not** start full-history; the DEFER gate stands.
3. If last-year detail is wanted, **finish the resumable last-year scrape**, then run the gated `APPLY_LAST_YEAR_STAGING` apply + reconciliation **before** claiming last-year coverage.
4. For analytics now, **use `fulfillment_day` for cadence**, not meal-history (which adds no content). m22's analytics value is corroboration, not content.
