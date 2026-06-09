# Nutrezee Discovery Coverage Matrix

Date: 2026-06-09
Phase: Step 2B.1 Discovery Coverage Verification
Scope: docs only, no production login

## Purpose

This matrix verifies what was actually discovered before Step 2C workflow and data modeling. The old dashboard remains the functional blueprint for baseline module coverage, but only confirmed or partial discovery evidence should be used as direct blueprint material.

## Coverage Status Definitions

- Confirmed: Screen/module was observed in the read-only browser audit with enough structure to identify purpose, tables/forms/cards, and operational role.
- Partial: Screen/module was reached or structure was partly observed, but audit had timeout/instability or incomplete coverage.
- Skipped: Screen/module or route was intentionally not opened or could not be safely/reliably audited.
- Not Verified: Area was inferred, requested for the new system, or required by business context, but was not observed directly in the old dashboard audit.

## Source Type Definitions

- Browser audit: Read-only authenticated dashboard audit from Step 1.
- Route list: Route was discovered in sidebar, dashboard cards, or route inventory.
- Old dashboard observation: Feature/module was visible or inferable from old dashboard screen structures.
- Docs inference: Requirement inferred from Step 1/2A docs, not directly verified in UI.
- Assumption: Planning assumption requiring Nutrezee confirmation.

## Old Dashboard Route Coverage

| # | Route / Module | Path | Coverage | Discovery Source | Blueprint Use | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dashboard | `/dashboard` | Confirmed | Browser audit, old dashboard observation | Use as baseline overview only | Improve into live operations dashboard. |
| 2 | Users | `/users/list/3` | Confirmed | Browser audit, old dashboard observation | Use as customer/user baseline | PII values were not captured. |
| 3 | Add New User | `/users/newuser/9` | Confirmed | Browser audit, route list | Use cautiously | Route label implies creation, but observed as listing; replace with clear creation flow. |
| 4 | Drivers | `/users/drivers/2` | Confirmed | Browser audit, old dashboard observation | Use as driver baseline | Improve for capacity, areas, shifts. |
| 5 | Admin Users | `/users/drivers/admin` | Confirmed | Browser audit, old dashboard observation | Use as staff baseline | RBAC not confirmed. |
| 6 | Video Categories | `/userVideoCategory` | Confirmed | Browser audit, route list | Optional baseline | Hidden video module. |
| 7 | User's Video | `/userVideo/list` | Confirmed | Browser audit, route list | Optional baseline | Hidden video module. |
| 8 | Video Tutorial | `/tutorialvideolist` | Confirmed | Browser audit, route list | Optional baseline | Hidden video module. |
| 9 | Products | `/products` | Partial | Browser audit, old dashboard observation | Use as catalog baseline with caution | Structure loaded but audit hit timeout warning. |
| 10 | Ratings | `/ratings` | Confirmed | Browser audit, old dashboard observation | Use as feedback baseline | Lower priority for first build. |
| 11 | Cashback | `/cashback/list` | Confirmed | Browser audit, old dashboard observation | Use as wallet/cashback baseline | Financial/customer columns observed; values not captured. |
| 12 | Packages | `/package` | Confirmed | Browser audit, old dashboard observation | Use as package/subscription baseline | Improve lifecycle rules. |
| 13 | Customer Active Orders | `/orders/list/Active` | Confirmed | Browser audit, old dashboard observation | Use as active order baseline | Core order module. |
| 14 | Customer Pending Orders | `/orders/list/pending` | Confirmed | Browser audit, old dashboard observation | Use as pending/review baseline | Improve for WhatsApp intake. |
| 15 | Customer Pause Orders | `/orders/list/Pause` | Confirmed | Browser audit, route list | Use as pause-state baseline | Hidden route; improve lifecycle handling. |
| 16 | Customer Expired Orders | `/orders/list/Expire` | Confirmed | Browser audit, old dashboard observation | Use as expiry baseline | Improve renewal workflow. |
| 17 | Customer Cancel Orders | `/orders/list/cancel` | Confirmed | Browser audit, old dashboard observation | Use as cancellation baseline | Improve reason/refund/audit. |
| 18 | Orders Driver Wise | `/driverOrders` | Skipped | Route list, unstable audit attempt | Do not use as detailed blueprint | Repeated timeout/DOM extraction failures; replace with dispatch board. |
| 19 | Birthday Orders | `/birthdayOrders` | Confirmed | Browser audit, old dashboard observation | Use as occasion-report baseline | Contains sensitive DOB/email columns; values not captured. |
| 20 | Pre-Kitchen Meal Check | `/orders/short-meals-check` | Confirmed | Browser audit, old dashboard observation | Use as kitchen planning seed | Only date-based form observed; full kitchen workflow not verified. |
| 21 | Coupon Master | `/coupon` | Confirmed | Browser audit, old dashboard observation | Use as coupon baseline | Improve rule engine/audit. |
| 22 | Coupon Category | `/coupon/category` | Confirmed | Browser audit, route list | Use as coupon grouping baseline | Hidden route. |
| 23 | Advertisements / Offer | `/advertise` | Confirmed | Browser audit, old dashboard observation | Use as promotion baseline | Improve scheduling where needed. |
| 24 | Common Gallery | `/gallery` | Confirmed | Browser audit, old dashboard observation | Use as media baseline | Shared content/media module. |
| 25 | Ingredients | `/ingredients` | Confirmed | Browser audit, old dashboard observation | Use as ingredient baseline | Improve nutrition/inventory relations. |
| 26 | Allergies | `/allergies` | Confirmed | Browser audit, old dashboard observation | Use as allergen baseline | Improve allergy warnings. |
| 27 | Meal Types | `/mealsType` | Confirmed | Browser audit, old dashboard observation | Use as meal-type baseline | Improve routing/scheduling links. |
| 28 | Diet Status | `/dietstatuslist` | Confirmed | Browser audit, old dashboard observation | Use as diet-status baseline | Improve customer/product constraints. |
| 29 | Tags | `/tagslist` | Confirmed | Browser audit, old dashboard observation | Use as product-tag baseline | Improve dietary/customer-facing labels. |
| 30 | Package For Types | `/packageFor` | Confirmed | Browser audit, old dashboard observation | Use as package-rule baseline | Includes off-day/new-customer concepts. |
| 31 | Delivery Time | `/timeSlots` | Confirmed | Browser audit, old dashboard observation | Use as delivery-slot baseline | Improve for area/capacity/cutoffs. |
| 32 | Delivery Methods | `/deliveryMethod` | Confirmed | Browser audit, old dashboard observation | Use as delivery-method baseline | Improve dispatch integration. |
| 33 | General/Contact Setting | `/settings` | Confirmed | Browser audit, old dashboard observation | Use as settings baseline | Save action not used; improve validation/audit. |
| 34 | About Us | `/about_us` | Confirmed | Browser audit, old dashboard observation | Use as static-content baseline | Lower operational priority. |
| 35 | Why Us | `/why_us` | Confirmed | Browser audit, old dashboard observation | Use as static-content baseline | Lower operational priority. |
| 36 | Terms and Conditions | `/terms` | Confirmed | Browser audit, old dashboard observation | Use as legal-content baseline | Improve versioning/effective dates. |
| 37 | Return Policy | `/return-policy` | Confirmed | Browser audit, old dashboard observation | Use as policy-content baseline | Improve relationship to refund rules. |
| 38 | Contact Us | `/contact_us` | Confirmed | Browser audit, old dashboard observation | Use as support baseline | Improve into support/ticket workflow. |
| 39 | Subscribers | `/subscribers` | Confirmed | Browser audit, old dashboard observation | Use as subscriber baseline | Add consent/privacy controls. |
| 40 | Social Media | `/socialmedia` | Confirmed | Browser audit, old dashboard observation | Use as channel-settings baseline | Low operational priority. |
| 41 | Push Notification | `/pushnotification` | Confirmed | Browser audit, old dashboard observation | Use as notification baseline | Sending/deleting skipped; improve approval/audit. |
| 42 | Report Summary | `/summary` | Skipped | Route list, unstable audit attempt | Do not use as detailed blueprint | Timed out/changed navigation context. |
| 43 | Monthly Sales report | `/salesreport` | Confirmed | Browser audit, old dashboard observation | Use as finance-report baseline | Improve reconciliation/filters. |
| 44 | Daily Sales report | `/singledaysalesreport` | Confirmed | Browser audit, old dashboard observation | Use as finance-report baseline | Sensitive columns observed; values not captured. |
| 45 | Sales by Payment (New) | `/sales-report-by-payment` | Confirmed | Browser audit, old dashboard observation | Use as payment-report baseline | Improve reconciliation. |
| 46 | Customer Revenue (New) | `/customer-revenue-report` | Confirmed | Browser audit, old dashboard observation | Use as revenue-report baseline | Improve accounting model. |
| 47 | Confirm Payment (New) | `/confirm-payment` | Skipped | Route list, unstable audit attempt | Do not use as detailed blueprint | Timed out/stalled; no payment action attempted. |
| 48 | Today Expiration | `/packageexpirestoday` | Confirmed | Browser audit, old dashboard observation | Use as expiration-report baseline | Improve renewal/follow-up workflow. |
| 49 | Dietician Requests | `/dietician_requests` | Confirmed | Browser audit, old dashboard observation | Use as dietician-request baseline | Health data columns observed; values not captured. |
| 50 | Total Of Tommorow New | `/orders/getTotalOrdersNew/tommorow` | Skipped | Dashboard card route, unstable audit attempt | Do not use as detailed blueprint | Timed out; replace with tomorrow readiness board. |

## Non-Dashboard / New-System Area Coverage

| Area | Coverage | Discovery Source | Blueprint Use | Notes |
| --- | --- | --- | --- | --- |
| Customer app | Not Verified | Docs inference | Cannot use old dashboard as blueprint | Customer-facing screens, account, order history, notifications not audited. |
| Website ordering | Not Verified | Docs inference | Cannot use old dashboard as blueprint | Cart, checkout, product browsing, account flow not audited. |
| WhatsApp order intake | Not Verified | Business input, docs inference | Add new workflow | Known pain point, but exact process not observed. |
| Driver app | Not Verified | Business input, docs inference | Add new workflow | Old dashboard had driver records but no driver mobile app. |
| Kitchen/chef app | Not Verified | Business input, docs inference | Add new workflow | Old dashboard had pre-kitchen check only; chef app not observed. |
| Packing app/checklist | Not Verified | Docs inference | Add new workflow | Labeling/packing not observed. |
| Backend/API | Not Verified | Step 1 repo discovery | Cannot use as technical blueprint | No source code or API docs available. |
| Database/schema | Not Verified | Step 1 repo discovery | Cannot use as data blueprint | No schema/migrations/sanitized export available. |
| Payment gateway | Partial | Browser audit, docs inference | Use reporting as baseline only | Payment reports observed; gateway integration, refunds, confirmation workflow not verified. |
| RBAC | Not Verified | Browser audit, docs inference | Add new security foundation | Admin users observed; permissions model not confirmed. |
| Audit logs | Not Verified | Browser audit, docs inference | Add new security foundation | No audit-log screen observed. |
| Reports/analytics | Partial | Browser audit, docs inference | Use old reports as baseline, improve | Sales/payment/revenue reports observed; operational analytics not confirmed. |
| Hidden role screens | Not Verified | Route list | Cannot assume complete coverage | Hidden sidebar routes observed, but role-specific menus/permissions not verified. |
| Mobile apps | Not Verified | Docs inference | Cannot use old dashboard as blueprint | No customer/driver/chef mobile app audited. |
| Integrations | Not Verified | Docs inference | Cannot use old dashboard as technical blueprint | WhatsApp, payment, maps, notifications, printers, SMS/email integrations unverified. |
| Inventory | Not Verified | Docs inference | Add if confirmed | Ingredients exist, but stock/inventory dependency was not observed. |
| Nutrition/macros | Partial | Browser audit, docs inference | Improve beyond old dashboard | Ingredients/allergies/diet/tags exist; calories/macros not observed. |
| Branch/central kitchen dispatch | Not Verified | Docs inference | Cannot use old dashboard as blueprint | No branch/central kitchen workflow observed. |

## Coverage Summary

| Coverage Type | Count | Meaning |
| --- | ---: | --- |
| Confirmed old dashboard routes | 45 | Safe to use as functional coverage baseline, not as UI/technical design. |
| Partial old dashboard routes | 1 | Use as baseline with caution and confirm in stakeholder review. |
| Skipped/unstable old dashboard routes | 4 | Do not use as detailed blueprint; replace or re-discover safely later. |
| Not verified non-dashboard areas | 15+ | Must be confirmed before Step 2C data and workflow models are finalized. |

## Coverage Rule For Step 2C

Step 2C may use confirmed old dashboard routes as baseline business coverage. It must not treat partial, skipped, unstable, inferred, or assumed areas as validated workflows without Nutrezee confirmation.
