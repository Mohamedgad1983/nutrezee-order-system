# 02 — Meal-History Raw Archive Design (m22)

> Lossless, idempotent archive of the legacy meal-history payload. **Built** in migration
> `app/db/migrations/0018_wave6_meal_history.sql` (applies clean 0001→0018 locally). Verified on
> staging via a read-only dry-run; the table itself is **not yet deployed to staging** (a deliberate
> additive migration, see doc 04 / doc 06 next step).

## Table: `legacy_meal_history_raw`

| Column | Type | Purpose |
|---|---|---|
| `id` | text PK | ULID |
| `source_system` | text NOT NULL | e.g. `nutreeze.com` |
| `source_name` | text NOT NULL | e.g. `getMealsDateWiseFilter` |
| `source_record_id` | text NOT NULL | legacy `internal_id` |
| `legacy_order_number` | text | resolved via `orders_index` when possible |
| `payload` | **jsonb** NOT NULL | parsed skeleton `{dates, meal_types, meal_ids}` (lossless re-parse from the gz raw kept on the VPS) |
| `raw_sha` | text NOT NULL **UNIQUE** | sha256 of the raw source → **dedup / idempotency key** |
| `extracted_at` | timestamptz | when scraped from legacy |
| `imported_at` | timestamptz DEFAULT now() | when archived |
| `import_run_id` | text → `customer_meal_history_import_runs(id)` | which run wrote it |

## Requirements → how they are met
- **Original payload as JSONB** → `payload jsonb` (the parsed skeleton; the byte-lossless gz stays on the VPS, hashed into `raw_sha`).
- **Source system / name / record id** → `source_system`, `source_name`, `source_record_id`.
- **Raw hash for dedup** → `raw_sha` with a `UNIQUE` constraint; re-archiving the same payload is a no-op (insert is skipped / conflicts).
- **Extracted/imported timestamps** → `extracted_at`, `imported_at`.
- **No unnecessary PII in logs** → the archive stores ids + meal skeleton, **not** customer name/phone. Import summaries are counts only.
- **Idempotent import** → `raw_sha` unique + the dry-run reports `would_skip_duplicate` / `duplicate_hash` for already-archived payloads (`dedup_checked` flag indicates whether the destination table was present to check against).

## Idempotency proof
TS-I (`ts-i-meal-history`): a second insert with the same `raw_sha` → `duplicate key` rejection. The
import tool computes `mealSha(rawHtml)` and, when the table exists, skips payloads already present.
