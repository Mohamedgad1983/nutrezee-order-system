# Nutrezee Operational Pain Points

Date: 2026-06-09
Phase: Step 2A Operational Context Engineering
Build direction: new system from scratch

## Purpose

This document converts Step 1 discovery and current business input into an operational pain point register for the new Nutrezee system.

The old production dashboard is reference only. It should not be modified or treated as the target architecture.

## Source Separation

### Old Dashboard Observed State

Step 1 found that the old dashboard includes users, products, packages, orders, coupons, cashback, delivery configuration, reports, ingredients, allergies, meal types, diet status, tags, and dietician requests.

The old dashboard did not confirm:

- WhatsApp order intake.
- Structured kitchen section routing.
- Chef-specific task views.
- Automated box label printing.
- App-based driver assignment by area/location/time slot/capacity.
- Driver tracking.
- Audit logs.
- Complete roles/permissions.
- Customer-facing checkout.
- Calories/macros and full nutrition support.
- Inventory dependency.

### New System Direction

Nutrezee will build a new system from scratch. The new system should focus on operational automation and management visibility, not on copying the old dashboard screen-for-screen.

### Unknowns Needing Business Confirmation

- Exact WhatsApp order intake process and whether WhatsApp Business API is required.
- Who can confirm, reject, edit, or price manually entered orders.
- Kitchen sections, stations, chefs, and shift rules.
- Meal/task routing rules from item to section and chef.
- Label format, printer type, barcode/QR needs, and label trigger timing.
- Driver areas, capacity rules, location rules, time-slot rules, and reassignment policy.
- Analytics KPIs for management.
- Payment flow for WhatsApp orders and online orders.
- Refund, cancellation, pause, and credit rules.
- Data retention and privacy requirements.

## Pain Point Register

| Pain Point | Current Manual Process | Business Impact | Required Capability | Priority P0/P1/P2 | Notes |
| --- | --- | --- | --- | --- | --- |
| WhatsApp orders are manually entered | Staff receive orders in WhatsApp, interpret messages, and manually create records elsewhere. | Slow intake, errors, duplicate work, missed details, poor audit trail. | WhatsApp order intake workflow with structured capture, review, customer matching, and order creation. | P0 | Confirm if initial version uses manual copy/paste intake or WhatsApp Business API integration. |
| Order details are not consistently structured at intake | Staff infer customer, meals, dates, delivery, notes, and payment from messages. | Missing data causes kitchen, delivery, and customer-service issues. | Required order fields, validation, incomplete-order queue, and admin review. | P0 | Define required fields for new, renewal, pause, change, and cancellation orders. |
| Manual order entry duplicates customer data | Staff may retype name, phone, address, preferences, allergies, and plan details. | Data quality issues and customer-history fragmentation. | Customer profile matching by phone, reusable delivery addresses, preferences, allergies, and order history. | P0 | Use phone as likely primary match key, subject to confirmation. |
| Management lacks reliable operational analytics | Management manually asks teams or reviews disconnected reports. | Delayed decisions on revenue, kitchen load, chef productivity, delivery performance, and order trends. | Management analytics for orders, kitchen, delivery, chefs, revenue, payments, exceptions, and capacity. | P0 | Dashboards should separate live operations from historical reporting. |
| Kitchen has many sections without automated routing | Staff manually decide which kitchen section handles each item. | Bottlenecks, missed tasks, wrong station assignment, unclear accountability. | Kitchen section model and item-to-section routing rules. | P0 | Need kitchen section list and station ownership. |
| Chef assignment is manual or informal | Staff/chefs rely on verbal instructions, printed lists, or shared sheets. | Chef workload imbalance and unclear task ownership. | Chef task app showing only assigned section tasks based on chef-section mapping and shift assignment. | P0 | Confirm whether chefs can belong to multiple sections per shift. |
| Kitchen tasks are not itemized by production step | Orders may be viewed as whole orders rather than station-level tasks. | One meal can be blocked by a hidden station dependency. | Item/task decomposition by product, component, section, batch, time slot, and status. | P0 | Requires menu/component model. |
| Box labels are printed manually | Staff prepare or print labels outside the system. | Label errors, wrong customer/order/date, slow packing, poor traceability. | Automated label generation and printing tied to order, customer, date, meal, route, and packing status. | P0 | Confirm printer model, label size, language, QR/barcode needs. |
| Driver assignment is manual | Staff assign drivers based on judgment, area, time, and capacity. | Route inefficiency, overloaded drivers, missed slots, unclear accountability. | Driver dispatch engine using area/location/time slot/capacity with manual override and audit trail. | P0 | Confirm if map distance/route optimization is required in first release. |
| Driver capacity is not system-enforced | Staff track capacity manually. | Overloaded drivers and delivery failures. | Driver capacity model by shift, vehicle, route, time slot, and order count/box count. | P0 | Capacity unit may be boxes, orders, bags, weight, or route duration. |
| Chef app needs section-specific focus | Chefs should not see all kitchen work if only one section is relevant. | Noise, confusion, and accidental work on wrong tasks. | Role and section scoped chef task views. | P0 | Needs role-based permissions and section assignment. |
| Kitchen handoff to packing may be unclear | Prepared items may be checked manually before packing. | Missing items in boxes and delayed dispatch. | Section completion, order readiness, packing checklist, and exception handling. | P0 | Confirm whether packing is its own section/team. |
| Delivery handoff may be manual | Packed orders are assigned or handed over without a full system record. | Lost accountability between kitchen, packing, and drivers. | Dispatch manifest, driver handoff scan/check, and status transitions. | P0 | Label QR/barcode could support handoff scan. |
| Existing reports do not cover all new KPIs | Old dashboard has sales/revenue reports but not full operational analytics. | Management cannot see kitchen throughput, chef productivity, or driver performance. | Analytics model across order intake, kitchen tasks, labels, dispatch, payments, and exceptions. | P0 | Define KPI list in Step 2B meetings. |
| Payment confirmation and refunds are unclear | Old dashboard had payment reporting, but confirmation/refund workflows were not verified. | Finance risk and manual reconciliation. | Payment status workflow, gateway integration, manual payment review, refunds, and audit logs. | P1 | Must handle WhatsApp/manual orders and online checkout. |
| Roles and permissions are not defined | Old dashboard showed admin users but no verified RBAC. | Overbroad access and operational mistakes. | Role-based access for admin, order staff, kitchen manager, chef, packing, dispatcher, driver, finance, manager. | P0 | Include least-privilege model from the start. |
| Audit logs were not observed | Admin changes may not be traceable. | Operational disputes, security risk, and weak accountability. | Audit log for order changes, payments, kitchen status, labels, dispatch, settings, and user actions. | P0 | Audit log should include actor, timestamp, before/after, reason where relevant. |
| Nutrition data is incomplete | Old dashboard showed ingredients, allergies, diet status, and tags, but not calories/macros. | Healthy-food product promise is hard to support. | Nutrition model for calories, protein, carbs, fat, allergens, dietary labels, ingredients, and meal-plan constraints. | P1 | Confirm whether nutrition appears on customer app, labels, admin, or all. |
| Meal plans and subscriptions need clear lifecycle | Old dashboard had packages and order states, but lifecycle rules are unknown. | Pause, expiry, renewal, and delivery-date errors. | Meal plan/subscription lifecycle with start/end dates, off days, pauses, renewals, changes, and expiry rules. | P0 | Align with current package business process. |
| Exceptions are handled manually | Missing meals, late delivery, wrong address, substitutions, failed payment, and customer changes may be ad hoc. | Delays, inconsistent resolution, weak reporting. | Exception queue with owner, status, reason, impact, resolution, and audit trail. | P0 | Capture exception types in department meetings. |
| Future problems are expected | More workflows will be discovered in meetings. | Rigid docs will become outdated. | Updateable meeting template, backlog, and decision log structure. | P1 | Meeting template added in Step 2A. |

## Priority Definitions

- P0: Required for safe core operations or management visibility in the new build.
- P1: Important for first major release or required for a complete business process.
- P2: Useful enhancement or optimization after core workflows are stable.

## Step 2B Inputs Needed

Use this register to drive department interviews with operations, kitchen, packing, delivery, finance, customer service, management, and nutrition/dietician stakeholders.
