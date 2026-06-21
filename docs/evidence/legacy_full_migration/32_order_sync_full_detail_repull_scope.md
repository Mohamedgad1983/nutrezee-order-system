# 32 — Scope: Order-Sync Full-Detail Re-Pull (fix `would_create: 0`)

**Date:** 2026-06-21 · **Status: SCOPE (not implemented)** · **Goal:** make the legacy→new incremental sync actually create/store new & updated orders, so the staging DB receives ongoing legacy order data instead of being frozen at the 2026-06-16 bulk import.

---

## 1. Problem (confirmed on staging this session)

- `nutrezee-legacy-sync.timer` (every 30 min) is **disabled + inactive**; it has only ever run **dry-runs** (Jun 17–18), all reporting **`would_create: 0`**.
- DB is frozen at the bulk import: newest `customer` / `customer_order` / `sync_record` row = **2026-06-16**. No new legacy data is landing.

**Root cause (exact):** the order extract `orders_history.json` (26,071 orders) has keys **`id, start_date, end_date, package, status` only — `has_phone = 0/26,071`.** The sync drops any order without a phone that maps to a known customer:
```js
// incremental-sync.mjs
if (!validPhone(o.phone) || !storedCust.has(o.phone)) continue;   // ← every phone-less order skipped
```
So the orders missing from staging are exactly the ones with no phone in the extract → nothing can be created.

## 2. Key insight (why this is cheap)

- **Customers are already imported** — 19,476 customers with phones, all in `sync_record` (`storedCust`). We do **not** need to re-pull customers.
- We only need the **order → customer phone link**, per order.
- That link **already exists locally**: the prior delivery re-extraction archived **22,547 gzipped order pages** at `/opt/nutrezee/legacy-detail-2026/out/raw/view_<internal_id>.html.gz` (each ~72 KB; a sample contains `customer` / `mobile` + phone patterns). `out/order_detail.jsonl` (20,637 rows) maps `internal_id` ↔ order.
- **⇒ The fix is primarily a re-parse of pages we already have — no new legacy load for the bulk.** Only the gap (orders with no archived page) needs a small read-only re-pull.

**Binding rule (unchanged):** link strictly by the **legacy page's own customer phone**, then match to an existing customer by normalized phone. **Never** match by name or fuzzy phone; never fabricate links; placeholder/shared phones go to exception review, not auto-create.

## 3. Approach — 3 phases

### Phase 1 — Re-parse archive → enrich the order extract (read-only, low risk)
1. **Build a phone parser** for the archived `view_*.html.gz` pages: extract the **customer phone** (and customer name for audit only) from the customer block; normalize to `+965…`. Validate against a labelled sample (≥30 pages) — confirm it pulls the *customer* number, not delivery/other digits.
2. **Re-parse all 22,547 archived pages** → `order_phone_map.jsonl` = `{order_id/internal_id, customer_phone, parse_confidence}`. Record parse failures (no phone / ambiguous) as exceptions, never guesses.
3. **Enrich** `orders_history.json` → `orders_history_enriched.json` by joining the phone map (key on the `internal_id ↔ id` mapping from `order_detail.jsonl`).
4. **Dry-run the sync** against the enriched file: `would_create` must jump from 0. Expected: most of the historical shortfall (legacy 20,637 source vs 19,465+638 staged) + any newer orders become creatable; phone-less / placeholder-phone orders remain skipped (expected).

**Acceptance (P1):** enriched extract has phone for the large majority of the ~missing orders; sync dry-run reports `would_create > 0` with `would_fail = 0`; every skip has a recorded reason.

### Phase 2 — Gap-fill re-pull (read-only scrape, only for the remainder)
- Orders with **no archived page** (≈ 26,071 − 22,547 ≈ up to ~3.5k, minus those already synced) get a **targeted, rate-limited, read-only** re-pull of the legacy order view page → extract phone the same way. GET-only, mutation deny-list, resumable, staging-only (same pattern as the existing meal-history/dish scrapers). Skip if the bulk from P1 already makes the sync complete enough for the business.

**Acceptance (P2):** coverage of creatable orders is ≥ the agreed threshold; remaining un-parseable orders are in exception review with reasons.

### Phase 3 — Supervised apply + go-live (the only data-write step)
1. **Governed apply** through the existing M19 path (`/imports/active_plans`) — same endpoint the sync already dry-runs — in a **supervised** run (not the timer), with a DB snapshot first. Idempotent: re-run creates 0 (existing `sync_record` watermark + dedup).
2. **Reconcile:** new `customer_order` + `sync_record` counts; 0 orphans; spot-check a sample order against its legacy page; confirm the 77 meal-history `missing_order_link` exceptions now resolve deterministically (they were blocked on exactly this).
3. **Enable the 30-min timer** (`systemctl enable --now nutrezee-legacy-sync.timer`) **only after** a clean supervised apply, flipping the sync from dry-run → apply mode via its env. Also fix the cosmetic `Documentation=` parse warning in the unit.

**Acceptance (P3):** supervised apply creates the expected orders with 0 fail/0 orphan; reconciliation clean; timer enabled and a subsequent scheduled run is idempotent (creates 0 once caught up).

## 4. Risks & guardrails
- **PII:** phones are processed server-side only; no phone/name in repo or logs beyond counts. Exception lists stay on the host.
- **Wrong-customer link:** mitigated by using the page's own customer phone + exact normalized match; placeholder/shared phones → exception review (the documented 16+1 cases), never auto-create.
- **Double-create:** prevented by the `sync_record` watermark + the M19 dedup; apply is idempotent.
- **Production:** never touched. Legacy is read-only. No WhatsApp/customer messaging.
- **Parser correctness:** Phase 1 step 1 (labelled-sample validation) is the gate before any apply.

## 5. Effort (rough)
- **P1 (re-parse + enrich + dry-run):** ~half a day — read-only, the highest-value step; this alone proves the fix.
- **P2 (gap re-pull):** ~0.5–1 day if needed (depends on the un-archived remainder).
- **P3 (supervised apply + reconcile + enable timer):** ~half a day, with a snapshot + sign-off.

## 6. Deliverables
- `order_phone_map.jsonl` + parser, enriched extract, dry-run evidence (would_create), supervised apply + reconciliation report, exception list, timer enabled. Evidence under `docs/evidence/legacy_full_migration/` (next docs).

---
**Recommended first move:** execute **Phase 1** (re-parse the existing archive, enrich, dry-run). It's read-only, low-risk, uses data we already have, and definitively confirms the fix (`would_create` goes positive) before any write or scrape.
