# 10 — Scaling Plan (conditional)

> Scaling is **gated on first confirming a dish source** (doc 01). Until then there is nothing to scale.
> Two source paths are possible; the plan below applies once one is confirmed.

## Precondition (must pass first)
A small live VPS discovery (after the m22 scrape ends) confirms a **read-only** endpoint that returns the
**saved** dish per order/order_meal_id, OR a decision is made to **capture dish-per-day forward** in the
new system. No bulk work begins before this.

## Path A — catalog enrichment (`getMealsByType`, confirmed read-only)
Builds the dish **reference master** (dish id ↔ name per type/subpackage/date). Bounded: distinct
(meal_type × sub_package × date) combos. Stages sample → last-30 → last-90 → last-year, each:
candidate count · expected requests · runtime (legacy ~5 s/req) · storage · DB growth · concurrency 1–2 /
rate ≥1500 ms · `--resume` · failure threshold (retry like m22) · apply guard · reconciliation.

## Path B — per-customer assignment (only if a read endpoint is found)
The business goal. Stages sample(5→20) → last-7 → last-30 → last-90 → last-year → full, each fully
reconciled before the next (mirrors m22 discipline). Bulk full-history would be large (cf. m22: ~20k
orders × ~26 days ≈ 520k dish-days) → **batched**, never one-shot, never while another scrape runs.

## Hard rules (every stage)
VPS-only · staging-only · read-only allowlist (mutations hard-blocked) · `--resume` · rate-limited ·
counts-only logs · raw outside git · no timer · per-stage gated apply + reconciliation + idempotency ·
no silent drops.

## Current status
**Not started** — blocked on the source precondition. The schema/parser/scraper foundation is ready so
that, once the precondition passes, scaling proceeds immediately and safely.
</content>
