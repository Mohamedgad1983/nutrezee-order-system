# Nutrezee Full Admin App Discovery

Date: 2026-06-09
Phase: Step 2C Full Admin-Controlled Existing App Discovery
Scope: read-only admin dashboard discovery, docs only
Dashboard: `https://nutreeze.com/dashboard`

## Executive Summary

The old Nutrezee admin dashboard remains the strongest confirmed blueprint for existing business coverage. The Step 2C read-only audit confirmed functional admin coverage for authentication, customers/users, drivers, admin/dietitian users, products, packages, orders, admin order creation, coupons, cashback, promotions, media/content, master data, delivery slots/methods, settings, notifications, sales/payment/revenue reports, package expiration, and dietician requests.

The audit also confirmed that the existing admin is not only a list/report dashboard. It includes an admin order creation form at `/orders/create` with customer search, package/sub-package selection, package-for rules, start date, amounts, coupon, address, delivery time/method, notes, paid-already flag, gateway, paid amount, and a `Create Order & Generate Payment Link` action. This is a key workflow seed for the new system, but no order was created and no payment link was generated.

Several important areas remain incomplete or inaccessible: customer-facing website/app ordering, driver app, kitchen/chef app, full kitchen production board, packing/label printing, source/API/database, payment gateway internals, refunds, RBAC permission rules, audit logs, mobile app builds, and external integrations.

No production data was created, edited, deleted, approved, canceled, refunded, assigned, submitted, saved, exported, downloaded, or screenshotted.

## Method And Safety Controls

- Used authenticated admin dashboard access with credentials loaded only from environment variables.
- Did not print, save, document, or commit credentials.
- Did not use screenshots.
- Did not store cookies or session files in the repository.
- Did not click row-level operation links.
- Did not click save, submit, send, delete, update, approve, confirm, cancel, refund, or assign actions.
- Did not test invalid login or real payments.
- Masked or omitted customer, payment, health, and contact row values.
- Deleted temporary raw audit output after detecting that it contained row text.

## Login And Session

| Area | Observation | Status |
| --- | --- | --- |
| Unauthenticated redirect | `/dashboard` redirects to `/admin`. | Confirmed |
| Login form | POSTs to `/logincheck` with `email_address` and `password` fields. | Confirmed |
| Successful login | Authenticated session lands on `/dashboard` with title `Nutrezee - Dashboard`. | Confirmed |
| Session behavior | Authenticated route navigation stayed inside the dashboard session. | Confirmed |
| Logout | A `Logout` candidate and logout confirmation modal were present in the authenticated DOM. Logout was not clicked during this workflow audit. | Partial |

## Navigation And Route Coverage

The audit confirmed the same main admin navigation groups seen in Step 1:

- Dashboard
- Users
- Products
- Ratings
- Cashback
- Packages
- Orders
- Coupon Module
- Advertisements / Offer
- Common Gallery
- Masters
- Contact Us
- Subscribers
- Social Media
- General Setting
- Push Notification
- Reports

Known old-dashboard menu/submenu route coverage:

| Coverage | Count | Notes |
| --- | ---: | --- |
| Confirmed admin routes | 46 | Routes loaded with enough structure to identify purpose, forms/tables/filters, and workflow role. |
| Partial admin routes | 4 | `/driverOrders`, `/summary`, `/confirm-payment`, `/orders/getTotalOrdersNew/tommorow` timed out or aborted during read-only audit. |
| Skipped unsafe route | 1 | `/orders/AutoAssignMealToDrivers` was skipped because it appears action-like and may mutate driver assignments. |

Additional non-menu route hints checked read-only:

| Route | Finding | Status |
| --- | --- | --- |
| `/users/dietitians/8` | Dietitian user listing with user identity/status/operation columns. | Confirmed |
| `/diet-customer-service/dietactive-users` | Diet customer service active-user route timed out. | Partial |
| `/orders/list` | Generic order list with the same lifecycle table shape as state-specific order lists. | Confirmed |
| `/orders/create` | Admin order creation form with customer search, package, address, delivery, notes, payment, and payment-link action. | Confirmed read-only |
| `/orders/getMealsDateWiseFilter` | Direct route without required date parameter exposed a Symfony/SQL exception page. | Error observed |
| `/addpushnotification` | Push notification send form with type, title, message, image, user selection, and send button. Send not clicked. | Confirmed read-only |
| `/coupon/addcoupon` | Coupon add/update form with code, limits, dates, discount, category, packages, loyalty points, and status. Save/update not clicked. | Confirmed read-only |
| `/coupon/addCouponCategory` | Direct add-category route without expected context exposed an undefined-variable error page. | Error observed |
| `/deliveryMethod/addDeliveryMethod` | Delivery method add/update form. Save not clicked. | Confirmed read-only |
| `/addMeal` | Meal type add/update form with package/count/image fields. Submit not clicked. | Confirmed read-only |
| `/allergies/add` | Allergy add/update form. Save not clicked. | Confirmed read-only |
| `/ingredients/add` | Ingredient add/update form. Save not clicked. | Confirmed read-only |

## Existing Admin Capabilities

Confirmed old admin capabilities:

- Admin authentication and route-protected dashboard.
- Customer/user listings with search/filter/status/operation columns.
- Admin order creation and payment-link generation surface.
- Order lifecycle lists for active, pending, pause, expired, and canceled orders.
- Order table fields for order number, customer reference, package, sub-package, dates, transaction, payment status, order status, coupon, amounts, and operation.
- Driver records.
- Admin users and dietitian user listing route.
- Product/menu list with package/category filters.
- Package/subscription list.
- Ratings.
- Cashback dashboard and active cashback balance view.
- Coupon master, coupon category, coupon add/update form, and coupon usage report hints.
- Advertisements/offers.
- Common gallery.
- Ingredients, allergies, meal types, diet status, product tags, package-for types, delivery time, delivery methods.
- General/contact/checkout settings with WhatsApp and capacity-date fields.
- Static content forms for About Us, Why Us, Terms, and Return Policy.
- Contact message list.
- Subscribers.
- Social media links.
- Push notification list and send form.
- Monthly sales report.
- Daily sales report.
- Sales by payment method report.
- Customer revenue accrual report.
- Package expiration report.
- Dietician requests with health-related fields.
- Pre-kitchen meal shortage check by date.

## Missing Or Partial Capabilities

Not confirmed enough to use as detailed blueprint:

- Customer-facing website ordering, account, cart, checkout, and order tracking.
- Customer mobile app.
- Driver mobile app or delivery execution screen.
- Kitchen/chef app.
- Kitchen section routing rules.
- Chef assignment by section/shift.
- Packing checklist and label printing.
- Payment gateway settings, webhooks, reconciliation internals, and refund workflow.
- Confirm payment workflow, because `/confirm-payment` timed out.
- Driver-wise assignment/report workflow, because `/driverOrders` timed out.
- Next-day operational board, because `/orders/getTotalOrdersNew/tommorow` aborted.
- Report summary dashboard, because `/summary` timed out.
- RBAC permission matrix.
- Audit logs.
- Backend/API contracts.
- Database schema.
- Mobile app builds.
- Integrations for WhatsApp Business API, payment gateway, maps/geocoding, notification provider, SMS/email, label printers, or accounting.

## Unsafe Or Skipped Routes And Actions

| Route / Area | Why Skipped | New-System Handling |
| --- | --- | --- |
| `/orders/AutoAssignMealToDrivers` | Name indicates automatic driver assignment and may mutate production by GET/navigation. | Replace with safe dispatch board, explicit confirmation, audit, and undo/override controls. |
| Row-level `Operation` actions | Could edit/delete/status-change/view sensitive records or trigger workflows. | Confirm in staging/source; model actions from workflows. |
| Save/update/submit/send buttons | Could modify settings, content, notifications, coupons, orders, master data, or payments. | Inspect in staging/source only. |
| Payment confirmation controls | High-risk financial workflow. | Require payment sandbox and finance stakeholder confirmation. |
| Exports/downloads | Could export customer/payment/health data. | Add role-gated exports and audit in new system. |

## Bugs And Errors Observed

- `/driverOrders` timed out during read-only route navigation.
- `/summary` timed out during read-only route navigation.
- `/confirm-payment` timed out during read-only route navigation.
- `/orders/getTotalOrdersNew/tommorow` aborted during navigation.
- `/orders/getMealsDateWiseFilter` without expected input exposed a Symfony/SQL exception page.
- `/coupon/addCouponCategory` without expected context exposed an undefined-variable error page.
- Old UI typos persist in labels such as `Cutomer`, `Opertation`, `Retun`, and `Tommorow`.
- Multiple screens expose broad row-level operation controls without visible role/audit context.
- Sensitive columns are broadly visible in admin tables, including customer, contact, payment, and health-related fields.

## Security And Privacy Observations

- The authenticated admin session could access customer, driver, admin user, payment, contact-message, subscriber, and health-related dietician request screens.
- RBAC rules were not visible; only user/admin/dietitian lists were found.
- No audit-log module was found.
- Direct route access to add/update forms is possible for multiple modules.
- Some direct routes expose framework/SQL errors instead of controlled error pages.
- Export controls exist on order and finance reports; export behavior was not tested.
- Push notification send controls exist and include user targeting; sending was not tested.
- Payment link generation is present in the admin order creation flow; payment link generation was not tested.

## What Can Be Used As Blueprint

Use as functional blueprint:

- Admin module coverage and route inventory.
- Customer, driver, admin/dietitian, order, catalog, package, coupon, content, delivery, notification, and report concepts.
- Order table field categories and lifecycle states.
- Admin order creation field categories.
- Master-data categories for ingredients, allergies, meal types, diet status, tags, delivery slots, delivery methods, and package-for rules.
- Sales/payment/revenue report categories.

Do not use as blueprint yet:

- Final UI/UX design.
- Source architecture.
- Database schema.
- API contracts.
- Permission model.
- Audit model.
- Payment/refund implementation.
- Driver/kitchen/customer app workflows.
- Integration designs.

## Recommended Next Action

Before Step 2D detailed workflow/data modeling, obtain controlled access to:

1. Staging dashboard and staging database.
2. Source repository.
3. Sanitized database schema.
4. API docs or route/controller map.
5. Payment sandbox and gateway docs.
6. Test customer login/app.
7. Test driver login/app.
8. Test kitchen/chef login/app.
9. Mobile app builds if they exist.
10. Role/permission matrix and audit requirements.

Recommended first detailed business module: **Admin Order Intake And Lifecycle**, including `/orders/create`, pending/active/pause/expired/cancel lists, payment-link behavior, package/calendar rules, and downstream kitchen/delivery/finance impacts. RBAC and audit requirements should be captured in parallel because the order module touches customer, payment, and health-sensitive context.
