# New Schema Mapping

Date: 2026-06-16

## Current New-System Import Convention

Verified:
- Import metadata is centralized through `import_batch`, `import_row_result`, and `sync_record`.
- Importable primary tables use `origin='legacy'` and `import_batch_id` where already implemented.
- Legacy source IDs are preserved through `sync_record(object_type, legacy_key, new_ref, snapshot_hash)`.
- Existing M19 imports go through owner-module APIs, not direct cross-module table writes.

Decision for this session:
- No new migration was added. The existing convention already preserves legacy IDs via `sync_record`; adding per-table `legacy_customer_id`, `legacy_order_id`, etc. would duplicate the current design without source schema evidence.
- Full clone support still needs review after real legacy export/schema arrives, especially for order details, deliveries, drivers, coupons, and raw payload retention.

## Mapping Table

| Legacy Entity | Legacy Field | New Table | New Field | Required? | Transform Rule | Risk |
| ------------- | ------------ | --------- | --------- | --------- | -------------- | ---- |
| customer | id | sync_record | legacy_key where object_type=`customer` | Yes | Preserve as string exactly | Low; central mapping pattern |
| customer | name | customer | full_name_en | Yes | Trim only; preserve source text | Medium; Arabic/English split unknown |
| customer | name_ar | customer | full_name_ar | No | Preserve source text if present | Medium |
| customer | email | customer | email | No | Preserve; masked at serialization | Low |
| customer | dob | customer | dob | No | ISO date parse; invalid becomes validation issue | Medium |
| customer | phone | customer_phone | phone_raw, phone_normalized | Yes for dedup if available | Keep raw; normalize with configured country code | High; duplicates/family phones expected |
| customer | diet_status | diet_status, customer | diet_status.id, diet_status_id | No | Match/import master by name | Medium |
| customer_address | id | sync_record | legacy_key where object_type may need `address` | Yes for full clone | Current enum lacks address object_type | High; schema gap if address IDs must be reconciled |
| customer_address | customer_id | address | customer_id | Yes | Resolve through customer sync_record | High if customer missing |
| customer_address | address text | address | address_text | Yes if address row exists | Preserve exactly | Medium; PII |
| customer_address | area | area, address | area.id, area_id | No | Match/import area by code/name | Medium; area lacks origin/import_batch_id today |
| customer_address | notes | address | delivery_notes | No | Preserve exactly | Low |
| product | id | sync_record | legacy_key where object_type=`product` | Yes | Preserve as string exactly | Low |
| product | name | product | name_en/name_ar | Yes | Preserve source text; duplicate name needs review | Medium |
| product | price | product | price | No | Convert to minor units | Medium |
| product | meal_type | meal_type, product | meal_type_id | No | Match/import master by name | Medium |
| product | allergens | allergen, product_allergen | allergen_id/source | No | Preserve declared links if source exposes them | Medium; source depth unknown |
| product | nutrition | nutrition_facts | calories/protein/carbs/fat/notes | No | Numeric validation; preserve notes | High; legacy coverage uncertain |
| package | id | sync_record | legacy_key where object_type=`package` | Yes | Preserve as string exactly | Low |
| package | name | package | name_en/name_ar | Yes | Preserve source text | Low |
| package | parent/sub-package | package | parent_package_id | No | Resolve by legacy ID first, then exact name | High; current importer uses name fallback |
| package | duration | package | duration_days | No | Positive integer | Medium |
| package | meals_per_day | package | meals_per_day | No | Positive integer | Medium |
| package | price | package | price | No | Convert to minor units | Medium |
| master_data | meal/diet/tag/package_for/ingredient/allergen | respective master tables | name_en/name_ar/origin/import_batch_id | Depends | Match-or-create by exact name | Medium; duplicates need review |
| delivery_slot | id | sync_record | legacy_key may need object_type=`master` | Yes for full clone | Current pattern can encode kind in legacy_key | Medium |
| delivery_slot | time labels | delivery_slot | label_en/label_ar/start_time/end_time | Yes if used | Parse time; active default true | Medium |
| delivery_method | id/name | delivery_method | name_en/name_ar | Yes if used | Match/import by name | Medium |
| order | id | sync_record | legacy_key where object_type=`order` | Yes | Preserve as string exactly | Low |
| order | order_number | customer_order | order_number | Yes | Preserve verbatim; must be unique | Medium |
| order | customer_id | customer_order | customer_id | Yes | Resolve through customer sync_record or phone | High |
| order | package_id/name | customer_order | package_id, package_name_frozen_en/ar | No | Resolve package; otherwise freeze legacy name if allowed | High |
| order | status | customer_order | status | Yes | Map legacy active/pause/etc. to configured status | High; full vocabulary unknown |
| order | start_date/end_date | customer_order | start_date/end_date | Yes | ISO date parse; start <= end | High |
| order | off_days | customer_order | off_days, off_days_unverified | No | Parse if structured; otherwise flag unverified | Medium |
| order | coupon_code | customer_order | coupon_code_frozen | No | Preserve text, do not revalidate | Medium; coupon module deferred |
| order | amounts | customer_order | package_amount/discount/total/currency | Yes if financial data exists | Convert to minor units | High |
| order_detail | id | sync_record | object_type currently has no order_detail | Yes for full clone | Requires schema/design decision if item-level legacy IDs must reconcile | High |
| order_detail | order_id | order_item | order_id | Yes | Resolve order through sync_record | High |
| order_detail | product/package item | order_item | product_id/name_frozen_en/ar | Yes | Resolve product when possible; freeze legacy text | High |
| order_detail | qty | order_item | qty | Yes | Positive integer | Medium |
| order_detail | price | order_item | unit_price_frozen | No | Convert to minor units | Medium |
| payment | id | sync_record | legacy_key where object_type=`payment` | Yes | Preserve as string exactly | Low |
| payment | order_id | payment_record | order_id | Yes | Resolve through order sync_record | High |
| payment | status | payment_record | status | Yes | Map known values; unknown creates finance review | High |
| payment | method | payment_record | method | No | Preserve source code/text | Medium |
| payment | amount | payment_record | amount/currency | Yes if paid | Convert to minor units | High |
| payment | transaction_ref | payment_record | transaction_ref/evidence_note | No | Preserve as payment-class data | Medium |
| delivery | id | sync_record | object_type currently has no delivery | Yes for full clone | Needs schema/design decision | High |
| delivery | order_id | fulfillment_day | order_id | Yes | Resolve through order sync_record | High |
| delivery | date/status | fulfillment_day | date/status | Yes | Map status; unknown status blocks/flags | High |
| delivery | slot/address | fulfillment_day | slot_id/address_frozen | Yes if delivery row exists | Resolve slot; freeze address snapshot | Medium |
| delivery | driver_id | no current table | none | No in daily-order MVP | Deferred dispatch/driver module | High for "100% all legacy data" claim |
| coupon | id/code/discount | no current coupon table | customer_order.coupon_code_frozen only | No | Preserve code on order only | High; module deferred |
| driver | id/name | no current driver table | none | No in daily-order MVP | Document as missing/deferred | High |
| dietician_request | request fields | no current table | none | No | Document as missing/deferred | High |

## Schema Gaps for a Literal 100% Clone

Needs Confirmation:
- Whether "100% clone" means daily order operations only or every legacy admin module, including deferred drivers/coupons/subscribers/content/dietician requests.
- Whether raw legacy payload must be stored in the database, or whether local evidence exports are acceptable.
- Whether address, order_detail, delivery, driver, coupon, and dietician request legacy IDs require first-class `sync_record.object_type` values.
