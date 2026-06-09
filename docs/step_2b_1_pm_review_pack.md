# Nutrezee Step 2B.1 PM Review Pack

Date: 2026-06-09
Phase: Step 2B.1 Discovery Coverage Verification
Scope: docs only, no production login

## Summary

Step 2B.1 verifies discovery coverage before Step 2C workflow and data modeling.

The old dashboard is still the functional blueprint for baseline business module coverage, but it is not complete discovery of the full new system. Confirmed old dashboard screens can be used as a module checklist. Partial, skipped, inferred, or assumed areas must be validated with Nutrezee before becoming workflow or data model commitments.

## Files Created

- `docs/01_discovery/discovery_coverage_matrix.md`
- `docs/01_discovery/discovery_gaps_and_assumptions.md`
- `docs/step_2b_1_pm_review_pack.md`

## Coverage Summary

| Coverage Type | Count | Meaning |
| --- | ---: | --- |
| Confirmed old dashboard routes | 45 | Use as business-function baseline. |
| Partial old dashboard routes | 1 | Use cautiously and confirm. |
| Skipped/unstable old dashboard routes | 4 | Do not use as detailed blueprint. |
| Non-dashboard/new-system areas not verified | 15+ | Confirm before Step 2C data/workflow modeling. |

## Confirmed Coverage

Confirmed by read-only browser audit:

- Dashboard.
- Users/customers.
- Drivers.
- Admin users.
- Hidden video/content modules.
- Products.
- Ratings.
- Cashback.
- Packages.
- Active, pending, pause, expired, and canceled order lists.
- Birthday orders.
- Pre-kitchen meal check.
- Coupons and coupon categories.
- Advertisements/offers.
- Gallery.
- Ingredients.
- Allergies.
- Meal types.
- Diet status.
- Tags.
- Package-for types.
- Delivery time slots.
- Delivery methods.
- General/contact settings.
- Static pages and policy pages.
- Contact messages.
- Subscribers.
- Social media.
- Push notifications, excluding send/delete behavior.
- Monthly sales report.
- Daily sales report.
- Sales by payment report.
- Customer revenue report.
- Package expiration report.
- Dietician requests.

These can be used as old-business-module coverage for the new system.

## Partial Coverage

| Area | Reason |
| --- | --- |
| Products | Product structure loaded, but audit had a navigation timeout warning. Product/catalog should be confirmed before final data modeling. |
| Payment/reporting workflows | Reports were visible, but payment gateway, confirmation, refund, and reconciliation workflows were not verified. |
| Kitchen planning | Pre-kitchen meal check was visible, but full kitchen workflow was not verified. |
| Delivery workflow | Drivers, time slots, and methods were visible, but assignment and driver execution were not verified. |
| Nutrition | Ingredients/allergies/diet/tags were visible, but calories/macros and product-level nutrition facts were not verified. |

## Skipped Or Unsafe Coverage

| Area | Why |
| --- | --- |
| `/orders/AutoAssignMealToDrivers` | Action-like route; could mutate production. |
| Row-level actions | Could edit, delete, approve, cancel, refund, assign, or status-change production data. |
| Save/submit controls | Could modify production settings/content/data. |
| Invalid login tests | Would generate production auth events. |
| `/driverOrders` | Repeated timeout/DOM extraction failure. |
| `/summary` | Timed out or changed navigation context. |
| `/confirm-payment` | Timed out/stalled; payment operation risk. |
| `/orders/getTotalOrdersNew/tommorow` | Timed out; dashboard card route only. |

## Major Gaps

The following areas cannot be treated as discovered:

- Customer app.
- Website ordering, cart, checkout.
- WhatsApp order intake workflow.
- Driver app.
- Kitchen/chef app.
- Packing checklist and label printing.
- Backend/API.
- Database/schema.
- Payment gateway, refund, and reconciliation internals.
- RBAC and permissions.
- Audit logs.
- Hidden role-specific dashboards.
- Mobile apps.
- Integrations: WhatsApp, payment, maps/geocoding, notifications, printers, SMS/email.
- Inventory dependency.
- Branch or central kitchen dispatch.
- Calories/macros and complete nutrition facts.

## What Can Be Used As Blueprint

Can be used:

- Old dashboard module list.
- Old screen purposes.
- Old table/form/card structures at a high level.
- Old order state concepts.
- Old product/package/customer/driver/report concepts.
- Old settings/content/promotion/support module coverage.

Cannot be used:

- Old UI as target design.
- Old source architecture.
- Old APIs.
- Old database schema.
- Old security/RBAC model.
- Old audit model.
- Old payment integration design.
- Old kitchen/driver/mobile workflows.
- Any sensitive row values.

## Questions To Ask Nutrezee Before Step 2C

1. Are there customer-facing website or mobile ordering screens outside the admin dashboard?
2. Are there existing driver, kitchen, chef, packing, or finance screens outside the audited dashboard?
3. Which old dashboard modules are mandatory for first release?
4. Which old dashboard modules are no longer used?
5. What are the required WhatsApp order intake fields and order types?
6. Should WhatsApp Business API be included in first release or phased later?
7. What is the full order state machine?
8. What are the current kitchen sections?
9. Which menu items/components route to each kitchen section?
10. How are chefs assigned to sections and shifts?
11. What fields must be printed on box labels?
12. What printers, label sizes, QR/barcode rules, and reprint rules are used?
13. How are delivery areas defined?
14. What driver capacity rules are used?
15. What delivery statuses and failed-delivery reasons are required?
16. What payment methods, confirmation steps, refund rules, and credit rules are required?
17. Which roles can view customer, payment, health, and driver data?
18. What actions must be audit logged?
19. What management KPIs are mandatory for launch?
20. Is ingredient inventory required in first release?
21. Which nutrition fields are required internally and customer-facing?
22. Are there spreadsheets, WhatsApp groups, paper forms, or other manual logs that represent missing workflows?

## Recommended Action Before Step 2C

Run a short verification workshop before detailed workflow/data modeling:

1. Review `discovery_coverage_matrix.md` with Nutrezee stakeholders.
2. Confirm mandatory old modules for first release.
3. Confirm which skipped/unstable routes have current business value.
4. Identify any systems, apps, spreadsheets, or paper workflows outside the old dashboard.
5. Confirm answers to the P0 questions in `discovery_gaps_and_assumptions.md`.

## Step 2C Gate

Proceed to Step 2C only after Nutrezee confirms:

- Old module coverage expectations.
- Missing app surfaces.
- WhatsApp intake process.
- Kitchen/chef routing.
- Label printing.
- Driver assignment.
- Payment/refund lifecycle.
- RBAC/audit requirements.
- P0 analytics KPIs.

Step 2C should then produce detailed workflow maps, data models, state diagrams, role matrices, API boundaries, and acceptance criteria.
