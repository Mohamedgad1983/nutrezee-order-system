# Extraction Plan

Date: 2026-06-16

## Priority Order

1. Direct database/export mode.
2. API mode.
3. Browser/admin mode as fallback or verification only.

## A. Direct Database or Export Mode

Required:
- `LEGACY_DATABASE_URL` or `LEGACY_EXPORT_PATH`.
- Read-only user or static export files.

Plan:
- Run only `SELECT` queries against legacy DB if DB access exists.
- Export raw files under `docs/evidence/legacy_full_migration/exports/raw/`.
- Store one JSON object per line with `legacy_source`, `legacy_entity`, `legacy_id`, `extracted_at`, and `raw_payload`.
- Generate counts and deterministic SHA-256 hashes per entity.
- Do not write to legacy DB.

Required raw files when available:
- `customers.raw.jsonl`
- `customer_addresses.raw.jsonl`
- `orders.raw.jsonl`
- `order_details.raw.jsonl`
- `payments.raw.jsonl`
- `deliveries.raw.jsonl`
- `products.raw.jsonl`
- `packages.raw.jsonl`
- `ingredients.raw.jsonl`
- `allergies.raw.jsonl`
- `meal_types.raw.jsonl`
- `diet_statuses.raw.jsonl`
- `delivery_times.raw.jsonl`
- `delivery_methods.raw.jsonl`
- `drivers.raw.jsonl`
- `coupons.raw.jsonl`
- `dietician_requests.raw.jsonl`

## B. API Mode

Required:
- `LEGACY_API_BASE_URL` and documented auth.

Plan:
- Use authenticated read-only GET/list endpoints only.
- Handle pagination deterministically.
- Save raw payloads before transformation.
- Respect rate limits.
- Record endpoint, page, count, and hash in logs.
- Stop on missing pages or inconsistent total counts.

## C. Browser/Admin Mode

Required:
- `LEGACY_ADMIN_URL`, `LEGACY_EMAIL`, `LEGACY_PASSWORD`.

Plan:
- Use Playwright read-only navigation.
- Prefer export buttons if visible.
- If exports are not available, extract paginated table rows only when all pages and fields are visible.
- Open detail pages only for missing fields required by mapping.
- Avoid submit/save/delete/action buttons.
- Capture screenshots to `docs/evidence/legacy_full_migration/screenshots/legacy_admin/` if allowed.

Limit:
- Browser extraction alone cannot be marked 100% unless the UI exposes every required entity/field and stable full pagination/export is proven.

## Current Session Result

Status: `BLOCKED_BY_MISSING_ACCESS`

No raw extraction was run because all legacy access variables are missing.
