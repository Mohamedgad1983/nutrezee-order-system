# 42 — Full-History Go / No-Go

> **Stage 9. Decision: NO-GO for this run — DEFER full-history to a dedicated, batched, scheduled
> window.** Justified by runtime (legacy server ~5 s/request → ~9 h scrape + ~5 h import), a large
> expected `missing_order_link` tail (order-sync is incomplete — Stage 1), and the prudence of
> controlled batches. Not a guardrail failure; a documented resource/readiness gate.

## Full-history sizing
| metric | value | basis |
|---|---|---|
| full-history candidates | **20,593** | scraper dry-run, window=all |
| already scraped | 4,927 | last-90 + retries |
| in last-year (Stage 3) | 13,453 | superset of last-90 |
| **new fetches for full history** | **~15,666** | 20,593 − 4,927 |
| measured scrape rate | **~0.47 fetch/s** | live last-year run (conc 3, rate 1000 ms) |
| **full-history scrape runtime** | **~9.3 h** | 15,666 / 0.47 |
| import parse/pass | ~45–90 min × 3 passes | importer re-parses the full corpus each run |
| **full-history import** | **~4–5 h** | dry-run + apply + idempotency over ~20.6k files |
| raw storage | ~1.6–3.7 GB total | 80–178 KB/file; 172 GB free — not a constraint |

## Risk factors (against a one-shot run)
1. **Runtime** — ~14 h end-to-end is not a single-session operation; it must be detached + batched +
   resumable across windows.
2. **Order-sync completeness is NOT good enough** — Stage 1 (doc 34) showed the available order extract
   has **no phone**, so order-sync `would_create = 0`; older history will produce a **large
   `missing_order_link` exception tail** (every order not in `sync_record` becomes an exception). The
   meal-days are still archived (no silent drops), but the clean-link yield would be poor until the
   order-sync track lands a fresh full-detail re-pull.
3. **Legacy server stability** — last-90 and last-year both saw occasional transient `http_500`s
   (retryable). At ~15.7k more fetches the absolute failure count grows; manageable with `--resume` but
   argues for batches with per-batch reconciliation.
4. **Exception review load** — `migration_exception_review` already holds 1,272 non-deterministic
   orders across history; full-history surfaces more of them.

## Recommended path when approved (Stage 10 batch design — NOT executed this run)
Run full-history as **controlled batches**, each fully reconciled before the next:
- **batch by legacy internal_id range** (e.g. 2,000-id windows) or **by date range** (quarter), so each
  batch is bounded (~2–3 k fetches ≈ 1.5–2 h) and resumable.
- per batch: VPS scrape (`--resume`) → manifest coverage check → importer dry-run → gated apply
  (`MEAL_IMPORT_SCOPE` would need a `full`/range apply token — a further guard widening, gated by its
  own tests) → DB reconciliation → idempotency → doc.
- **precondition:** improve order-sync completeness first (fresh full-detail legacy order re-pull with
  phone/amount) so the historical meal-days can deterministically link instead of mass-excepting.

## Gate
Risk + runtime not acceptable for a single autonomous run, and order-sync readiness is insufficient →
**DEFER**. Full-history execution (docs 43–45) is intentionally **not** performed here. Proceed to close
the run at last-year scope (in progress) + the deferral gate.
</content>
