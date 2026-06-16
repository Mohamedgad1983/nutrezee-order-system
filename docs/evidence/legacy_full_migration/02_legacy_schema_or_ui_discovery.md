# Legacy Schema or UI Discovery

Date: 2026-06-16

## Discovery Sources

Verified from repo documents:
- `10_Data_Model/migration_mapping.md`
- `10_Data_Model/migration_execution_plan.md`
- `13_Architecture/legacy_transition_architecture.md`
- `19_Roadmap/Legacy_Core_Gap_To_Cutover.md`
- `19_Roadmap/Legacy_Core_Coverage_Matrix.md`
- `nutrezee-step-1-discovery/docs/` worktree path exists but remains ignored by this worktree.

Verified from local untracked migration config metadata:
- `tools/legacy-migration/config.json` describes a Symfony/PHP legacy admin login and candidate read-only entity paths. Its entity selectors are marked `calibrated:false`, so they are not enough to claim extraction readiness.

## Legacy Entities Identified

| Entity | Evidence | Candidate Legacy UI Path | Fields Seen or Inferred | Status |
| --- | --- | --- | --- | --- |
| Customers | Existing discovery and migration mapping | `/users/list/3` | id, name, phone, email, dob, diet status if linked | Screen-level only |
| Customer addresses | Existing mapping requires them if exported | detail pages unknown | address text, area, delivery notes | Needs legacy export/detail access |
| Orders / active plans | Existing mapping and legacy coverage matrix | `/orders/create`, `/orders/list/Active`, other lifecycle lists | order number, customer, package, status, start/end dates, payment status | Screen-level only |
| Order details/items | Migration mission requires them | unknown | product/package item lines, qty, price, allergens | Needs legacy export/detail access |
| Payments | Existing mapping and payments domain notes | `/confirm-payment`, reports | payment status, transaction ref/date, amount, method | Values unknown |
| Deliveries | Existing architecture captures delivery fields | order detail/list pages unknown | address, area, slot, method; driver assignment deferred | Needs legacy export/detail access |
| Products | Existing discovery | `/products` | id, name, price, meal type, tags, allergens/nutrition where visible | Screen-level only |
| Packages | Existing discovery | `/package`, `/packageFor` | id, name, duration, meals per day, price, parent package | Screen-level only |
| Ingredients/allergies | Existing discovery | `/ingredients`, `/allergies` | names, allergen links if visible | Needs export/detail access |
| Meal types/diet statuses/tags | Existing discovery | `/mealsType`, `/dietstatuslist`, `/tagslist` | bilingual names, active flag if visible | Needs export/detail access |
| Areas/slots/methods | Local config and settings docs | `/areas/slots/methods`, `/slots/methods`, `/deliveryMethod` | name/code/time/method | Needs export/detail access |
| Drivers | Migration mission requires count | legacy routes not confirmed in current docs | driver identity/assignment | Deferred module; needs sponsor decision and source access |
| Coupons | Local config candidate | `/coupons` | code, discount | Out of current daily-order cutover scope except frozen coupon text |
| Dietician requests | Coverage matrix mentions route group | unknown | request fields unknown | Deferred; needs source access |
| Subscribers | Coverage matrix | `/subscribers` | marketing email list, not meal-plan subscriptions | Deferred/off daily-order path |

## Missing Source Evidence

Needs Confirmation:
- Legacy DB schema or export format.
- Exact row counts for all required entities.
- Exact primary keys and foreign keys.
- Payment status vocabulary.
- Delivery status vocabulary.
- Order detail/item model.
- Driver/coupon/dietician request schema.
- Whether legacy admin exposes export buttons for each entity.
- Whether browser scraping is legally/operationally allowed for full-data extraction.

## Extraction Readiness

Status: `NOT_READY`

Reason:
- No `LEGACY_DATABASE_URL`, `LEGACY_API_BASE_URL`, `LEGACY_EXPORT_PATH`, or legacy admin URL/credentials are set.
- Browser-only extraction cannot prove 100% completeness unless the UI exposes all records, all fields, stable pagination, and export or detail pages for every entity.
