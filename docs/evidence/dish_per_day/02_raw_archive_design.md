# 02 — Raw Archive Design

> Lossless full-response archive so **no detail is ever lost**. Implemented in migration `0020` as
> `legacy_dish_detail_raw`. (Built and ready; not populated this run — dish-content source is BLOCKED,
> doc 01.)

## Table `legacy_dish_detail_raw`
Stores the **full** legacy response (HTML and/or JSON) plus everything needed to reproduce it.
| column | purpose |
|---|---|
| `id` (PK) | ulid |
| `source_system` / `source_name` / `source_endpoint` / `source_method` | provenance (`getMealsDateWiseFilter` grid / future `getMealsByType` catalog; GET/POST) |
| `legacy_internal_id` / `legacy_order_number` / `legacy_order_meal_id` / `legacy_meal_id` / `legacy_meal_type` / `legacy_meal_date` | request identity (nullable for whole-grid responses) |
| `request_params` (jsonb) | exact params → every response is reproducible |
| `response_status` / `raw_content_type` | HTTP status + `text/html`\|`application/json`\|`mixed` |
| `raw_html` (text) | **full HTML** if HTML |
| `raw_json` (jsonb) | **full JSON** if JSON |
| `raw_text` (text) | fallback / mixed |
| `raw_sha` (**UNIQUE**) | dedup / idempotency — re-archiving the same response is a no-op |
| `fetched_at` / `parsed_at` / `parse_status` / `parse_error_code` | capture + parse lifecycle |
| `import_run_id` | FK → `dish_detail_import_run` |

## Guarantees
- **Full fidelity:** `raw_html` / `raw_json` / `raw_text` hold the complete response; nothing is summarized
  away (unlike the m22 DB layer, which kept only a parsed skeleton — the reason m23 re-archives).
- **Idempotent:** `UNIQUE(raw_sha)` → re-running archives nothing twice.
- **Reproducible:** `request_params` + endpoint + method allow re-fetching the exact response.
- **No secrets:** credentials/cookies are **never** stored; only request params (ids/dates/types).
- **PII:** raw HTML may contain PII; it may live in the DB but is **never printed** to docs/logs.

## Note on storage
Full grid HTML is large (real files 0.05–165 MB raw; Postgres TOAST-compresses `text` to ~gz size on
disk). For the eventual catalog/assignment capture, store the targeted response (a per-slot fragment or
the catalog JSON), not the whole 165 MB edit page, unless full fidelity is explicitly required. The
table supports both.
</content>
