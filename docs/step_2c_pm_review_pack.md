# Nutrezee Step 2C PM Review Pack

Date: 2026-06-09
Phase: Step 2C Full Admin-Controlled Existing App Discovery
Scope: read-only discovery and docs only

## Goal Status

Step 2C completed as a read-only admin discovery pass. No production data was changed.

The old admin dashboard remains the baseline for existing business coverage. The most important additional finding is the confirmed admin order creation surface at `/orders/create`, which shows staff-assisted order creation and payment-link generation exist in the old system.

## Files Created

- `docs/01_discovery/full_admin_app_discovery.md`
- `docs/01_discovery/admin_route_screen_inventory.md`
- `docs/01_discovery/role_and_permission_discovery.md`
- `docs/01_discovery/customer_driver_kitchen_surface_check.md`
- `docs/01_discovery/module_discovery_depth_matrix.md`
- `docs/step_2c_pm_review_pack.md`

## Audit Method

- Used admin credentials only from environment variables.
- Performed authenticated read-only route navigation.
- Collected screen structure, route names, table header concepts, form field names, filters, and visible button labels.
- Did not collect, document, or commit customer/payment/health row values.
- Did not click row operations, save/update/submit/send/delete/assign/confirm/refund actions.
- Did not test real payments.
- Did not export or download reports.
- Did not capture screenshots.

## Coverage Summary

| Area | Count / Status | Meaning |
| --- | ---: | --- |
| Known old-dashboard menu/submenu routes | 50 | Existing Step 1 route set rechecked under admin access. |
| Confirmed routes | 46 | Loaded with enough structure for screen inventory. |
| Partial routes | 4 | Timed out or aborted: `/driverOrders`, `/summary`, `/confirm-payment`, `/orders/getTotalOrdersNew/tommorow`. |
| Skipped unsafe route | 1 | `/orders/AutoAssignMealToDrivers` skipped because it may mutate assignments. |
| Additional route hints checked | 12 | Included order create, dietitian, push/coupon/delivery/meal/allergy/ingredient add forms, and error routes. |

## Confirmed Modules

- Admin login/session and dashboard.
- Customer/user list.
- Admin/staff/driver/dietitian user listings.
- Admin order creation with payment-link generation action.
- Order lifecycle lists: active, pending, pause, expired, canceled, generic list.
- Product/menu list.
- Package/subscription list.
- Package-for rules.
- Meal types, diet status, tags.
- Ingredients and allergies.
- Delivery time slots and delivery methods.
- Pre-kitchen date check.
- Coupons, coupon categories, coupon add form, promotion/advertising.
- Cashback.
- Ratings.
- Gallery, videos, static pages, legal/policy pages, social links.
- Contact messages and subscribers.
- Push notification list and send form.
- Monthly sales, daily sales, payment-method sales, customer revenue, expiration reports.
- Dietician requests.

## Partial, Skipped, Or Error Areas

| Area | Status | Reason |
| --- | --- | --- |
| Orders Driver Wise | Partial | `/driverOrders` timed out. |
| Report Summary | Partial | `/summary` timed out. |
| Confirm Payment | Partial | `/confirm-payment` timed out; payment actions were not tested. |
| Tomorrow Orders | Partial | `/orders/getTotalOrdersNew/tommorow` aborted. |
| Auto-assign Driver to Meal | Skipped | `/orders/AutoAssignMealToDrivers` appears action-like and may mutate production. |
| Diet customer service active users | Partial | `/diet-customer-service/dietactive-users` timed out. |
| Meals date-wise filter | Error observed | Direct route without required input exposed SQL/framework exception. |
| Add coupon category | Error observed | Direct route without expected context exposed undefined-variable exception. |

## Major Gaps

- Customer-facing website/app ordering.
- Customer cart, checkout, and payment flow.
- Driver app and delivery execution.
- Kitchen/chef app and section routing.
- Packing checklist and label printing.
- Source code, API docs, route/controller map.
- Database schema and migration map.
- Payment gateway integration, payment sandbox, refunds, reconciliation internals.
- RBAC permission matrix.
- Audit logs.
- Hidden role-specific dashboards beyond the discovered dietitian/customer-service hints.
- Mobile app builds.
- Integrations for WhatsApp, payment gateway, maps, notifications, SMS/email, label printers, and accounting.

## Required Access Before Final Workflow/Data Modeling

1. Staging admin environment.
2. Source repository.
3. Sanitized database schema or backup.
4. API docs or generated route/controller map.
5. Test customer login/app build.
6. Test driver login/app build.
7. Test kitchen/chef/packing login or app build.
8. Payment sandbox and gateway documentation.
9. Notification sandbox/provider documentation.
10. WhatsApp Business API/access details.
11. Printer/label hardware and label template requirements.
12. Existing role/permission configuration and audit requirements.

## What Can Be Used As Blueprint

Use the old admin dashboard as blueprint for:

- Existing admin module coverage.
- Old route inventory and baseline business functions.
- Order lifecycle state categories.
- Admin order creation field categories.
- Customer/driver/admin/dietitian user concepts.
- Catalog/package/master-data concepts.
- Delivery slot/method concepts.
- Finance report categories.
- Content/promotion/notification modules.

Do not use the old admin dashboard as blueprint for:

- New UX design.
- Backend architecture.
- API contracts.
- Database schema.
- RBAC.
- Audit logs.
- Payment/refund implementation.
- Customer app.
- Driver app.
- Chef/kitchen app.
- Packing/label workflow.
- Integrations.

## Recommended First Module For Detailed Analysis

Start detailed business analysis with **Admin Order Intake And Lifecycle**.

Reason:

- `/orders/create` is confirmed and central to the old system.
- It connects customers, packages, dates, coupon rules, addresses, delivery slots/methods, notes, payment status, gateway/payment link, and downstream order lists.
- It is the practical bridge between current admin workflow and the new WhatsApp/customer-service order intake design.
- It drives later kitchen, packing, dispatch, payment, reports, and audit requirements.

Run RBAC and audit analysis in parallel because order intake touches customer data, payment data, role-gated actions, and production-changing state transitions.

## PM Decision Gate

Step 2C supports moving into module-by-module workflow analysis, but only with clear labels:

- Confirmed admin functions can become baseline requirements.
- Partial/skipped routes must not become detailed workflow commitments until staging/source validation.
- Inaccessible customer, driver, kitchen, packing, mobile, API, DB, payment, RBAC, audit, and integration areas require access or stakeholder confirmation before final modeling.
