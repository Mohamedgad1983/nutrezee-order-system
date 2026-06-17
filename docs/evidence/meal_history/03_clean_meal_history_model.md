# 03 — Clean Meal-History Model (m22)

> The normalized destination for transferred meal history. **Built** in migration 0018. Bad records
> go to an exceptions table — never forced into the clean tables.

## Tables

### `customer_meal_history` — one row per legacy order's meal history
| Column | Notes |
|---|---|
| `id` PK | ULID |
| `import_run_id` | → `customer_meal_history_import_runs` |
| `legacy_order_id` **UNIQUE** | legacy `internal_id`, preserved; one history per order |
| `legacy_order_number` | preserved for traceability |
| `legacy_customer_id` | preserved when available |
| `order_id` → `customer_order(id)` | **link when resolvable** (nullable) |
| `customer_id` → `customer(id)` | **link when resolvable** (nullable) |
| `meal_date_from` / `meal_date_to` / `meal_day_count` | date range + count |
| `meal_types` jsonb | order-level meal types |
| `package_name` / `subpackage_name` / `status` | from `orders_index` |
| `source_sha` | ties back to `legacy_meal_history_raw.raw_sha` |
| `import_status` | `imported` / `partial` / `exception` |

### `customer_meal_history_items` — one row per meal-day
| Column | Notes |
|---|---|
| `id` PK | |
| `meal_history_id` → parent (CASCADE) | |
| `legacy_order_id` | preserved |
| `order_id` → `customer_order(id)` | link when resolvable |
| `meal_date` NOT NULL | the meal-day |
| `meal_type` | breakfast/lunch/dinner/snack (nullable when per-date type not derivable) |
| `meal_name` | **nullable** — dish detail is ajax-gated (later phase) |
| `meal_ref` | legacy `meal_id` |
| `package_name` / `subpackage_name` / `delivery_status` | if available |
| `source_sha` / `import_run_id` | traceability |
| **UNIQUE `(legacy_order_id, meal_date, coalesce(meal_type,''))`** | **no duplicate meal days** |

### `customer_meal_history_import_runs` — every import is its own run
`mode` (dry_run/apply), `scope` (last_30_days/last_90_days/last_year/full), `window_from/to`,
`started/finished_at`, `duration_ms`, **`counts` jsonb** (the full summary), `status`. Meal history's
own run trail — **never mixed into the order sync**.

### `customer_meal_history_exceptions` — bad records land here, not in clean tables
`import_run_id`, `legacy_order_id`, `meal_date`, **`reason`** (CHECK: `missing_order_link`,
`missing_customer_link`, `invalid_date`, `duplicate_hash`, `parse_error`, `duplicate_meal_day`,
`other`), `detail` jsonb (**ids + reason only, no PII**).

## Requirements → how they are met
- **Link to new customers/orders where possible** → nullable FKs `order_id` / `customer_id`.
- **Preserve legacy ids** → `legacy_order_id`, `legacy_order_number`, `legacy_customer_id`, `meal_ref`.
- **Store meal date / name-ref / package / delivery status if available** → as above (`meal_name` nullable).
- **Store source hash / import run id** → `source_sha`, `import_run_id` on history + items.
- **Store import status** → `import_status` on the parent.
- **Exceptions separate** → dedicated table; classification routes bad records there (doc 04).

## Constraint proof (TS-I `ts-i-meal-history`, 7 tests, green)
one-history-per-order unique · no-duplicate-meal-day (allows different type same day) · raw-hash
dedup · clean rows link to `customer_order`+`customer` · invalid mode/scope/reason rejected by CHECK ·
exceptions stored with constrained reason.
