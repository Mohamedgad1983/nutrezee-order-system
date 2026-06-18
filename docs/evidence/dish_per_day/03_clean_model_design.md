# 03 — Clean Data Model Design

> Clean dish-per-day tables (migration `0020`). Built and ready; not populated this run (source BLOCKED,
> doc 01). Bad/unlinkable records go to exceptions — **never forced into clean tables, never dropped**.

## `customer_dish_day` — one row per (order, date, slot)
Key columns: `customer_id`?, `customer_order_id`?, `legacy_customer_id`?, `legacy_internal_id`,
`legacy_order_number`, `legacy_order_meal_id` (the legacy slot id), `meal_date`, `meal_slot` (type label
when known), `package_id`?, `package_name`, `source_raw_id`→`legacy_dish_detail_raw`, `import_run_id`,
`link_status` ∈ {linked, order_only, unlinked}.
- **UNIQUE** `(legacy_internal_id, meal_date, coalesce(legacy_order_meal_id,''))` → no duplicate dish-days.
- links to `customer_order`/`customer` only when **deterministically** resolvable (else nullable + exception).

## `customer_dish_day_item` — one row per actual dish / component
Key columns: `customer_dish_day_id`→parent (CASCADE), `legacy_dish_id`?, `legacy_meal_id`?,
`legacy_order_meal_id`?, `dish_name`?, `dish_name_normalized`?, `quantity/portion/unit`?,
`calories/protein/carbs/fat/fiber/sodium`?, `ingredients_text`?, `allergen_text`?, `category`?,
`meal_component_type` (meal/protein/carb/raw_eggs/white_eggs/…), `is_replacement/is_deleted/is_edited`?,
**`extra_json`** (UNKNOWN parsed fields preserved here — never dropped), `source_raw_id`, `import_run_id`.
- **UNIQUE** `(customer_dish_day_id, meal_component_type, legacy_meal_id, legacy_dish_id)` → no duplicate items.
- every nutrition/allergen/ingredient column is **nullable** (absent in the legacy grid; filled by future
  catalog/macro enrichment or forward capture).

## `dish_detail_import_run` — auditable run trail
`scope` ∈ {sample,last_7_days,last_30_days,last_90_days,last_year,full,custom}; `mode` ∈ {dry_run,apply};
`source`; timings; `status`; `counts` jsonb; `errors` jsonb; `applied`.

## `dish_detail_exception` — failures captured, never deleted
`reason` CHECK ∈ {missing_order_link, missing_customer_link, missing_required_params, parse_failed,
no_dish_found, invalid_date, duplicate_hash, duplicate_dish_item, unknown_fields, other};
`resolution_status` ∈ {open, resolved, superseded}; `detail` jsonb (ids/counts only, no PII).

## Constraints / safety (enforced by 0020)
- no duplicate raw hashes (`UNIQUE(raw_sha)`); no duplicate dish-days; no duplicate dish-items.
- FKs `ON DELETE SET NULL`/`CASCADE` chosen so cleanup never orphans or cascades into core tables.
- nullable links when legacy/customer/order link is not deterministic (never guessed).
- exceptions are append-only and never deleted (resolution via status flag).
- `extra_json` guarantees unknown fields are preserved, satisfying "never discard unknown fields".

Migration `0020` applies cleanly `0001→0020` on a fresh DB (gate). **Not yet applied to staging** — no
dish data to import; deferred until a dish source is confirmed (doc 01).
</content>
