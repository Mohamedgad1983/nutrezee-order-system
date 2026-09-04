# 29 — Gated Apply of the Retry Artifacts (last-90, staging)

> **Phase 6 / Part D.** Ran the gated meal-history apply after the clean dry-run (doc 28). It wrote
> **only the m22 tables** on staging — **5 raw + 5 parent + 72 clean items + 0 exceptions** for the 5
> retried orders, skipping the 4,922 already-archived. `applied=true · ok=true · 0 errors`. A
> pre-apply backup was taken first.

## Gate tokens (all required, all explicit)
```
SYNC_TARGET=staging
MEAL_IMPORT_SCOPE=last_90_days
MEAL_IMPORT_MODE=apply
MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_90_STAGING     # per-scope confirmation
MEAL_IMPORT_SOURCE_VPS=1                            # raw is from the VPS-approved scrape path
# importer also self-checks: staging DB version >= 0019, m22 tables deployed (dedup_checked=true)
```
- Staging DB version at apply: `0019_wave6_meal_history_exception_resolution.sql`.
- Pre-apply backup: `/opt/nutrezee/backups/pre-phase6-retry-apply-20260617T183736Z.dump`
  (21 MB, custom-format, verified — 487 TOC entries via `pg_restore -l`).
- Launched detached (`nohup`) on the VPS host, reading `RAW_DIR=/opt/nutrezee/legacy-meal-history/raw`;
  DB via `PG*` env (password never embedded/printed).

## Apply SUMMARY (`run_id 01KVBE0HCKWZ7ZDMS1A1SMCMQ6`)
| field | value |
|---|---|
| records_seen | 4,927 |
| records_candidate | 5 |
| would_archive | 5 |
| **raw_inserted** | **5** |
| **parent_inserted** | **5** |
| **item_inserted** | **72** |
| **exception_inserted** | **0** |
| would_skip_duplicate | 4,922 |
| duplicate_hash | 4,922 |
| invalid_date | 0 |
| missing_order_link | 0 |
| missing_customer_link | 0 |
| dedup_checked | true |
| applied | **true** |
| ok | **true** (errors: []) |
| duration_ms | 824,531 (~13.7 min) |

The inserts exactly match the dry-run prediction (doc 28): 5 archived, 72 clean meal-days, 0 new
exceptions.

## Write-scope attestation
The apply touches **only** m22 tables — `legacy_meal_history_raw`, `customer_meal_history`,
`customer_meal_history_items`, `customer_meal_history_exceptions`,
`customer_meal_history_import_runs`. It reads `sync_record` / `customer_order` for lookup only. **No**
writes to customer/order core, packing, delivery, WhatsApp, or any systemd/timer unit. Each order is
written in its own transaction with `ON CONFLICT DO NOTHING` (idempotent — proven in doc 30).

Full DB storage reconciliation + idempotency proof: **doc 30**.
</content>
