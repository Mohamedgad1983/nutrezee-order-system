# Nutrezee Phase 3 Old Admin Dashboard PM Review Pack

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Scope: Markdown docs only; old admin dashboard baseline only; no app code; no production changes; no final architecture

## Goal Status

Phase 3 old admin dashboard module-by-module analysis is complete. Only the old Nutrezee admin dashboard has been discovered and analyzed as the current business baseline. Customer app, driver app, kitchen/chef app, source/API/database, and payment sandbox are not discovered yet.

The analysis preserves useful old-admin behavior, improves weak behavior, replaces risky/manual behavior, adds missing automation ideas, and marks assumptions clearly.

## Files Created

- `docs/modules/00_admin_dashboard_module_analysis_index.md`
- `docs/modules/01_order_intake_lifecycle.md`
- `docs/modules/02_products_menu_packages.md`
- `docs/modules/03_kitchen_pre_kitchen.md`
- `docs/modules/04_labels_packing_gaps.md`
- `docs/modules/05_delivery_drivers.md`
- `docs/modules/06_payments_finance_reports.md`
- `docs/modules/07_customers_whatsapp_intake.md`
- `docs/modules/08_nutrition_allergens_dietician.md`
- `docs/modules/09_rbac_audit_logs_gaps.md`
- `docs/modules/10_settings_content_notifications.md`
- `docs/modules/11_undiscovered_surfaces_access_needed.md`
- `docs/modules/phase_3_pm_review_pack.md`

## Modules Analyzed

| Module | Priority | Main Decision |
| --- | --- | --- |
| Order Intake And Lifecycle | P0 | Use `/orders/create` and order lifecycle lists as baseline; add draft/review/state-machine workflow. |
| Products, Menu, And Packages | P0 | Preserve catalog/package masters; improve with nutrition, eligibility, and kitchen routing metadata. |
| Kitchen And Pre-Kitchen | P0 | Preserve pre-kitchen planning concept; add section routing and chef task app. |
| Labels And Packing | P0 | Add automated labels, packing checklist, and handoff because old dashboard did not cover them. |
| Delivery And Drivers | P0 | Preserve drivers/slots/methods; replace risky assignment with dispatch board and driver app. |
| Payments, Finance, And Reports | P0/P1 | Preserve reports; replace unstable payment confirmation with controlled finance review. |
| Customers And WhatsApp Intake | P0 | Preserve customer/admin order data; add WhatsApp structured intake and profile matching. |
| Nutrition, Allergens, And Dietician | P0/P1 | Preserve masters and dietician requests; add structured macros and warning rules. |
| RBAC And Audit Logs Gaps | P0 | Add explicit RBAC, field permissions, audit events, and export controls because old admin did not reveal them. |
| Settings, Content, And Notifications | P0/P1/P2 | Preserve content/settings/notification coverage; improve with validation, approval, versioning, and audit. |
| Undiscovered Surfaces And Access Needed | P0 | Document customer app, driver app, kitchen/chef app, source/API/database, payment sandbox, and access gaps. |

## Known Problems Covered

- WhatsApp orders are manually entered.
- Admin order review is needed before orders affect kitchen, dispatch, payment, and reports.
- Kitchen has many sections mapped to chefs.
- Items must route to section and chef through menu/component rules.
- Labels are printed manually.
- Packing needs checklist and handoff.
- Drivers need assignment by area, location, time slot, and capacity.
- Chef app should show assigned section tasks only.
- Analytics are needed for orders, kitchen, delivery, chefs, and revenue.
- RBAC and audit logs are required from the foundation.

## Strongest Preserve Decisions

- Preserve admin order creation and order lifecycle visibility.
- Preserve customer/user, driver, admin, and dietitian user concepts.
- Preserve product, package, meal type, tag, diet status, ingredient, and allergen masters.
- Preserve delivery time slots and delivery methods.
- Preserve finance reports: monthly sales, daily sales, sales by payment, customer revenue, expiration.
- Preserve coupons, cashback, advertisements/offers, media/content, subscribers, social links, and push notification history.

## Strongest Improve Decisions

- Improve order creation into draft intake, validation, admin review, and audited lifecycle.
- Improve customer records into full profiles with phone/WhatsApp matching, addresses, preferences, allergies, and history.
- Improve catalog into menu/package/nutrition/routing foundation.
- Improve pre-kitchen into production planning with shortages, section load, chef tasks, and readiness.
- Improve reports into live and historical analytics with role-gated exports.
- Improve settings, content, and notifications with validation, approvals, versioning, and audit.

## Strongest Replace Decisions

- Replace `/orders/AutoAssignMealToDrivers` with a safe dispatch board and audited assignment workflow.
- Replace unstable `/confirm-payment` with payment review queue.
- Replace unstable `/summary` with reliable analytics hub.
- Replace unstable `/orders/getTotalOrdersNew/tommorow` with tomorrow production/dispatch readiness board.
- Replace ambiguous `/users/newuser/9` behavior with explicit customer creation and duplicate detection.
- Replace manual labels and informal packing with automated labels, checklist, and handoff.

## Strongest Add Decisions

- Add WhatsApp order intake and incomplete-order queue.
- Add admin order review.
- Add kitchen sections, item/component routing, chef assignment, and chef task app.
- Add label printing and packing checklist.
- Add dispatch board and driver app.
- Add payment lifecycle, reconciliation, refunds/credits, and finance audit.
- Add management analytics for orders, kitchen, delivery, chefs, revenue, and exceptions.
- Add RBAC, field-level privacy, and audit logs.
- Add nutrition macros, allergen warnings, and dietician workflow.

## Unresolved Gaps

- Customer app/website ordering was not discovered.
- Driver app was not discovered.
- Kitchen/chef app was not discovered.
- Source/API/database were not available.
- Packing and label printer details are unknown.
- Payment gateway sandbox and refund workflow are unavailable.
- RBAC and audit logs are not observed in the old dashboard.
- Kitchen sections, chef shifts, and item routing rules require stakeholder confirmation.
- Driver capacity unit, areas, and route rules require stakeholder confirmation.
- Nutrition/macros and customer-facing nutrition requirements require confirmation.

## Recommended Next Phase

Proceed to detailed workflow and data modeling, starting with:

1. Admin Order Intake And Lifecycle.
2. Customer And WhatsApp Intake.
3. RBAC And Audit Logs.
4. Products, Packages, Nutrition, And Kitchen Routing.
5. Kitchen, Labels, Packing, Dispatch, Payments, And Analytics.

The recommended first deep-dive remains **Admin Order Intake And Lifecycle**, because it connects customers, WhatsApp intake, products/packages, payment, kitchen, labels, delivery, analytics, RBAC, and audit.

## Required Access Before Final Architecture

- Staging dashboard.
- Source repository.
- Sanitized database schema.
- API docs or generated route/controller map.
- Test customer login/app build.
- Test driver login/app build.
- Test kitchen/chef/packing login or app build.
- Payment sandbox and gateway docs.
- WhatsApp Business API details if integration is desired.
- Printer/label specs.
- Role/permission and audit requirements from stakeholders.

## Safety Confirmation

- No production login was needed for Phase 3.
- No production data was created, edited, deleted, approved, canceled, refunded, assigned, submitted, saved, exported, downloaded, or screenshotted.
- No credentials, customer data, payment data, tokens, cookies, or secrets are included.
- No app code was changed.
- All API references are high-level target capabilities, not confirmed old production APIs.
- Customer app, driver app, kitchen/chef app, source/API/database, and payment sandbox remain undiscovered and are not claimed as verified.
