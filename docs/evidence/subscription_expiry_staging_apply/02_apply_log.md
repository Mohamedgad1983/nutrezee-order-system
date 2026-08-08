# 02 — Apply Log

**Date applied:** 2026-06-20 (supervised; commit `b2cdc28` references the API work alongside this apply). **Re-verified:** 2026-06-20 (this session).

---

## Method (0021 only — Option A)

The exact committed file `app/db/migrations/0021_analytics_subscription_expiry.sql` was piped into `psql` and applied atomically with its ledger row, in one transaction:

```bash
( echo "BEGIN;";
  cat 0021_analytics_subscription_expiry.sql;
  echo "INSERT INTO schema_migrations(filename) VALUES ('0021_analytics_subscription_expiry.sql') ON CONFLICT DO NOTHING;";
  echo "COMMIT;"
) | docker exec -i nutrezee-postgres-1 psql -U nutrezee -d nutrezee -v ON_ERROR_STOP=1
```

## psql output

```
BEGIN
CREATE SCHEMA
COMMENT
CREATE VIEW
COMMENT
CREATE VIEW
COMMENT
INSERT 0 1        ← schema_migrations row recorded
COMMIT
```

## Ledger recording

`0021` is recorded in `schema_migrations` (the project tracks applied files there; the runner checks per-file, so a non-contiguous ledger — `0021` present while `0020` is absent — is valid). The `ON CONFLICT DO NOTHING` makes re-apply idempotent.

## 0020 untouched

`0020` was **not** applied: it is neither piped nor recorded. `schema_migrations` contains `0021` and not `0020`; the dish-per-day tables do not exist (verified in [03](03_validation_counts.md)).

> Note: the normal migration runner was deliberately **not** used (it would have applied `0020`). A future intentional `node db/migrate.mjs` run would still apply `0020` — that remains a separate human decision.
