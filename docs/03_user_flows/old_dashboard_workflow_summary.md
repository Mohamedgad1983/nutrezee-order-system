# Nutrezee Old Dashboard Workflow Summary

Date: 2026-06-09
Phase: Step 2B Old-System-to-New-System Feature Mapping
Scope: old dashboard workflow summary from Step 1 docs

## Purpose

This document summarizes the old dashboard's observed workflow areas so the new Nutrezee system can preserve core business coverage before improving and automating it.

The old dashboard is a functional blueprint/reference. It is not a technical dependency and production was not accessed during Step 2B.

## Observed Old Dashboard Areas

| Area | Old Screens | Business Meaning | New-System Dependency |
| --- | --- | --- | --- |
| Dashboard home | Dashboard, Total Of Tommorow New | Operations overview and next-day shortcut. | Requires orders, subscriptions, kitchen plan, dispatch plan, analytics. |
| Customer/users | Users, Add New User | Customer and user records. | Required before orders, WhatsApp intake, support, delivery, nutrition restrictions. |
| Staff/drivers/admin | Drivers, Admin Users | Internal users and drivers. | Required before RBAC, chef assignment, driver dispatch. |
| Catalog | Products, Packages, Package For Types, Meal Types, Tags, Diet Status | Menu items, packages, audience/rule types, dietary tagging. | Required before order intake, kitchen routing, nutrition, labels. |
| Nutrition masters | Ingredients, Allergies, Meal Types, Diet Status, Tags | Healthy-food support metadata. | Required before nutrition facts, allergen warnings, kitchen prep rules. |
| Orders | Active, Pending, Pause, Expired, Cancel Orders, Birthday Orders | Order lifecycle, subscription status, customer/order reporting. | Required before kitchen tasks, packing, delivery, finance reports. |
| Kitchen planning | Pre-Kitchen Meal Check | Early kitchen shortage/planning concept. | Required before chef task app and production planning. |
| Delivery | Drivers, Delivery Time, Delivery Methods, Orders Driver Wise | Driver records and delivery configuration. | Required before dispatch board and driver app. |
| Finance | Orders, Cashback, Monthly Sales, Daily Sales, Sales by Payment, Customer Revenue, Confirm Payment | Payment status, sales, revenue, cashback, payment review. | Required before reconciliation, refund, finance analytics. |
| Promotions | Coupon Master, Coupon Category, Advertisements / Offer, Cashback | Coupons, offers, marketing incentives. | Depends on customer, order, package, and finance rules. |
| Content/marketing | Gallery, Video Categories, User's Video, Video Tutorial, About Us, Why Us, Terms, Return Policy, Social Media, Subscribers | Static content, media, subscriber/channel management. | Lower dependency after core business workflows. |
| Support/notifications | Contact Us, Push Notification | Contact messages and outbound notifications. | Depends on customer profile, order status, roles, templates. |
| Reports/analytics | Report Summary, Sales, Payment, Revenue, Expiration, Dietician Requests | Management and operational reporting. | Depends on clean event, order, payment, kitchen, delivery, and customer data. |

## Inferred Old Workflow

1. Admin maintains product/package masters.
2. Admin maintains supporting masters such as ingredients, allergies, meal types, diet status, tags, delivery times, and delivery methods.
3. Staff manage customer/user records.
4. Staff create or manage orders by lifecycle state: pending, active, pause, expired, canceled.
5. Orders carry package, date window, transaction, payment, coupon, amount, and status data.
6. Kitchen receives at least some pre-kitchen date-based planning or shortage check.
7. Delivery depends on drivers, delivery slots, delivery methods, and driver-wise order views.
8. Finance reviews sales, payment, revenue, cashback, and expiration reports.
9. Marketing/content teams manage offers, coupons, gallery, social links, static pages, videos, subscribers, and notifications.
10. Management uses dashboard cards and reports to understand performance.

## Missing Or Weak Old Workflow Areas

The old dashboard did not clearly show:

- WhatsApp order intake.
- Structured draft order validation.
- Customer duplicate/phone matching.
- Kitchen section routing by menu item.
- Chef-specific task app.
- Packing checklist.
- Automated box label printing.
- Safe driver auto-assignment.
- Driver mobile workflow.
- Full RBAC.
- Audit logs.
- Full nutrition facts with calories/macros.
- Refund lifecycle.
- Inventory dependency.
- Branch or central kitchen dispatch.

## New Workflow Direction

The new system should use the old workflow as coverage baseline, then modernize into these connected flows:

### Flow 1: Catalog To Order

1. Admin defines products, packages, meal plans, nutrition, allergens, tags, delivery eligibility, and kitchen routing.
2. Customer service or customer-facing flow creates order from WhatsApp, app, or admin entry.
3. System validates customer, address, package, dates, payment rules, allergies, and missing fields.
4. Admin reviews and confirms the order.

### Flow 2: Order To Kitchen

1. Confirmed order creates kitchen tasks by item/component/section/date/time.
2. Kitchen manager sees daily and tomorrow production plan.
3. Chefs see only tasks for assigned section and shift.
4. Chefs update task statuses and raise exceptions.
5. Kitchen completion feeds packing readiness.

### Flow 3: Kitchen To Packing And Labels

1. Packing sees orders/boxes ready or blocked by section.
2. System generates labels from order, customer reference, meal, date, route, and box data.
3. Labels can be printed individually or in batches.
4. Packing verifies all required items and hands boxes to dispatch.

### Flow 4: Dispatch To Driver

1. Dispatch board groups orders by area, location, time slot, capacity, and readiness.
2. System suggests driver assignment.
3. Dispatcher reviews, overrides if needed, and confirms.
4. Driver app shows assigned stops.
5. Driver updates pickup, on-route, delivered, failed, or rescheduled statuses.

### Flow 5: Finance And Analytics

1. Payment status updates from payment gateway, manual review, cash, or transfer workflows.
2. Finance reviews payment exceptions, refunds, credits, cashback, and reconciliation.
3. Management sees analytics across order intake, kitchen, packing, delivery, chefs, payment, revenue, and exceptions.

## Dependency Order For New Build

1. Security, staff, roles, audit foundations.
2. Customer profiles and addresses.
3. Catalog, packages, nutrition, allergens, delivery slots.
4. Order intake and review.
5. Order lifecycle and subscription calendar.
6. Kitchen sections and routing rules.
7. Chef task app and kitchen planning.
8. Packing and label printing.
9. Delivery dispatch and driver app.
10. Payment review, reports, analytics.
11. Marketing/content/promotions enhancements.

## Step 2C Use

Step 2C should turn this workflow summary into detailed user flows, state diagrams, data models, and acceptance criteria for the first build sequence.
