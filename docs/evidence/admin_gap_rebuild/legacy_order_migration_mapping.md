# Legacy Order Migration Mapping

Date: 2026-06-15

Status: repository-evidence mapping. Real field names must be calibrated against legacy DB/export once sponsor S1 access is provided.

| Legacy Entity | Legacy Table/Field | New Entity | New Field | Transform Rule | Risk |
|---|---|---|---|---|---|
| Customer | legacy customer/user id from `/users/list/3` | `customer` | `id`, `origin`, `import_batch_id` | Generate new ID; store legacy key in `sync_record` | Medium: exact legacy key column unknown |
| Customer | name/username | `customer` | `full_name_en`, `full_name_ar` | Preserve available names; Arabic if present | Medium: bilingual split may be absent |
| Customer | email | `customer` | `email` | Normalize blank to null | Low |
| Customer | DOB | `customer` | `dob` | Parse date; reject invalid to quality report | Medium |
| Customer phone | mobile/phone | `customer_phone` | `phone_normalized`, `is_primary`, `whatsapp` | Normalize to E.164-like local rule; first valid phone primary | High: duplicate/family-shared phones |
| Address | address/block/street/house/area fields from order create/customer profile | `address` / frozen order address | `address_text`, `area_id`, `delivery_notes`, `address_frozen` | Map clean area if known; otherwise text snapshot and review flag | High: free-form/partial addresses |
| Order | order number/id | `customer_order` | `order_number`, `source_draft_id`, `origin` | Preserve legacy order number where unique; sync legacy key | High: duplicate legacy order IDs possible |
| Order | customer reference | `customer_order` | `customer_id` | Resolve via customer sync record | Critical: orphan orders block apply |
| Order | package | `customer_order` | `package_id`, `package_name_frozen_en/ar` | Resolve package sync record; freeze legacy display name | High: missing package reference |
| Order | sub-package | `package` | `parent_package_id` or frozen package text | If package hierarchy exists, map to package; otherwise freeze text and flag | High: old sub-package semantics need confirmation |
| Order detail/item | line items/meals | `order_item` | `product_id`, `name_frozen_en/ar`, `qty`, `unit_price_frozen` | Resolve product if possible; otherwise create frozen item row with null product | High: item-level exports may be unavailable |
| Dates | start date/end date/delivery date/off days | `customer_order`, `fulfillment_day` | `start_date`, `end_date`, day rows | Parse date; generate/import fulfillment days; mark unknown off-days unverified | High: date formats/off-day rules |
| Delivery slot | delivery time/time slot | `fulfillment_day` | `slot_id` | Resolve via delivery slot master; null + review flag if unknown | Medium |
| Delivery method | delivery method | `draft_order`/order snapshot | `method_id` or frozen metadata | Resolve via delivery method master; preserve text if unknown | Medium |
| Payment method | payment method/gateway | `payment_record` | `method` | Map to configured method enum (`online_link`, `cash`, `bank_transfer`, `card_gateway`) or review queue | High: vocab unknown |
| Payment status | paid/unpaid/status/confirm-payment state | `payment_record`, `payment_review_item` | `status`, `review state` | Known statuses map to payment machine; unknown statuses create finance review item | High |
| Paid amount | paid amount/package amount/total | `customer_order`, `payment_record` | `package_amount`, `discount`, `total`, `amount` | Convert KWD to minor units; reject negative/invalid | High: currency/minor-unit ambiguity |
| Coupon/discount | coupon code/discount | `customer_order` | `coupon_code_frozen`, `discount` | Preserve code text; discount in minor units if reliable | Medium |
| Notes | admin/order/driver notes | `customer_order`, `fulfillment_day`, audit/import notes | notes/snapshots | Preserve as PII where needed; mask on read | Medium |
| Driver | driver assignment | deferred dispatch model / fulfillment status | not built | Do not import as active assignment until dispatch scope exists; preserve in import report | High if dispatch joins cutover |
| Status | order/payment/delivery statuses | `customer_order`, `fulfillment_day`, `payment_record` | status fields | Map known values to config-seeded machines; unknown -> review-needed | Critical |
| Allergies/dietary notes | allergies/diet status/notes | `customer_allergy`, `customer.diet_status_id`, frozen allergens | health fields | Resolve allergen/diet masters; unknown health text to review | High: health data privacy |
| Dietician request link | `/dietician_requests` relation if present | future dietician workflow | none currently | Do not write to nonexistent module; document linkage for future import | Medium |
| Sync/audit | legacy IDs per entity | `sync_record`, `import_row_result`, `audit_event` | legacy_key/new_ref/report rows | Dry-run before apply; all applies audited | Low if S1 data available |

## Dry-Run Command Posture

Existing API supports non-writing dry runs:

```bash
POST /imports/catalog/dry-run
POST /imports/customers/dry-run
POST /imports/active-plans/dry-run
```

Apply remains gated and must not be used against production without approved staging data, reviewed reports, and explicit apply intent.
