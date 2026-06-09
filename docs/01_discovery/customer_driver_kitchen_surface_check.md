# Nutrezee Customer, Driver, And Kitchen Surface Check

Date: 2026-06-09
Phase: Step 2C Full Admin-Controlled Existing App Discovery
Scope: read-only surface discovery from admin dashboard and route hints

## Executive Summary

The old admin dashboard confirms strong admin-side customer, order, driver-record, delivery-configuration, and pre-kitchen planning surfaces. It does not confirm standalone customer, driver, kitchen, chef, or packing apps. The admin order creation form is the most important newly confirmed surface because it shows staff-assisted order creation and payment-link generation already exist.

## Surface Coverage Summary

| Surface | Coverage | Evidence | What Was Not Verified |
| --- | --- | --- | --- |
| Admin customer management | Confirmed | `/users/list/3`, `/orders/list/*`, `/orders/create`, `/contact_us`, `/dietician_requests` | Customer detail actions, merge/duplicate handling, customer portal. |
| Staff-assisted admin ordering | Confirmed read-only | `/orders/create` form with customer search, package, address, delivery, notes, and payment fields. | Actual create behavior, payment link generation, validations, downstream impacts. |
| Customer website/app ordering | Inaccessible / not verified | No customer-facing order/cart/checkout screens audited in this step. | Login/register, menu browsing, cart, checkout, payment, order tracking. |
| WhatsApp intake | Partial | `/settings` includes WhatsApp fields; media filenames include WhatsApp image references. | WhatsApp Business API, message intake queue, staff workflow, templates. |
| Driver records | Confirmed | `/users/drivers/2`, delivery slots, delivery methods. | Driver profile details, capacity, shifts, areas, vehicle, login. |
| Dispatch / driver assignment | Partial / skipped | `/driverOrders` timed out; `/orders/AutoAssignMealToDrivers` skipped as unsafe. | Assignment algorithm, manual override, driver manifest, route status. |
| Driver app | Inaccessible / not verified | No driver app route or login audited. | Stops, status updates, proof of delivery, failed delivery flow. |
| Kitchen planning | Partial | `/orders/short-meals-check` date form; `/orders/getMealsDateWiseFilter` route hint/error. | Production board, item routing, shortage output, chef workload. |
| Chef app | Inaccessible / not verified | No chef-specific app/screen found. | Section assignment, task status, exceptions, handoff. |
| Packing / label printing | Inaccessible / not verified | No packing or label route found. | Label templates, printer integration, reprint audit, packing checklist. |
| Dietitian/health surface | Confirmed / partial | `/users/dietitians/8`, `/dietician_requests`, `/diet-customer-service/dietactive-users` partial. | Dietitian workflow details, notes, consent, health-data permissions. |

## Customer Surface Findings

Confirmed admin-side customer features:

- Customer/user listing with identity/contact/status/order-total concepts.
- Admin order creation with customer search.
- Order lifecycle lists by active, pending, pause, expired, and canceled.
- Customer-related reports: birthday orders, customer revenue, package expiration.
- Contact messages and subscribers.
- Dietician requests with health-related fields.

Not verified:

- Customer self-registration.
- Customer login.
- Address book management from customer side.
- Customer menu browsing.
- Cart.
- Checkout.
- Payment gateway flow from customer side.
- Payment link delivery and redemption.
- Customer order status/timeline.
- Customer cancellation/pause/renewal request flow.
- Push notification receipt.

New-system impact:

- Use old admin customer/order screens as back-office baseline only.
- Do not infer customer-facing UX or API behavior from admin tables.
- Treat `/orders/create` as the starting evidence for staff-assisted order intake.

## Driver And Delivery Surface Findings

Confirmed admin-side delivery features:

- Driver list.
- Delivery time slots.
- Delivery methods.
- Driver-wise order route exists but timed out.
- Auto-assign route exists but was skipped as unsafe.

Not verified:

- Driver app login.
- Driver assignment screen behavior.
- Driver capacity.
- Driver areas/zones.
- Shift schedules.
- Vehicle/route data.
- Pickup/on-route/delivered/failed/rescheduled status workflow.
- Proof of delivery.
- Map/geocoding integration.

New-system impact:

- Preserve driver records and delivery slots/methods as baseline.
- Replace old assignment surfaces with dispatch board, explicit assignment confirmation, capacity rules, override reasons, and audit logs.
- Require driver app access before designing final driver workflow.

## Kitchen, Chef, Packing, And Label Surface Findings

Confirmed admin-side kitchen features:

- Pre-kitchen meal shortage check route with date selector.
- Date-wise meal filter route hint exists.

Observed issue:

- Direct navigation to `/orders/getMealsDateWiseFilter` without required input exposed a framework/SQL error page.

Not verified:

- Kitchen sections/stations.
- Menu item to section routing.
- Chef assignment.
- Chef task queue.
- Task status updates.
- Production readiness board.
- Shortage/substitution workflow.
- Packing checklist.
- Box labels.
- Printer integration.
- Dispatch handoff scanning/checking.

New-system impact:

- Use pre-kitchen route only as evidence that planning/shortage checking matters.
- Do not treat the old dashboard as a complete kitchen workflow blueprint.
- Capture kitchen section and label requirements directly from operations/kitchen stakeholders.

## Payment And Checkout Surface Findings

Confirmed:

- Order lists expose payment status and transaction concepts.
- Admin order creation includes paid-already, gateway, paid amount, and payment-link generation action.
- Sales by payment report includes gateway transaction concept.
- Customer revenue report exists.

Partial or not verified:

- `/confirm-payment` timed out.
- Payment link generation was not clicked.
- Payment gateway settings were not found.
- Refund flow was not found.
- Gateway webhook/reconciliation behavior was not visible.
- Customer checkout payment surface was not audited.

New-system impact:

- Treat payment reporting as confirmed baseline.
- Treat payment confirmation, refunds, gateway integration, and checkout as requiring staging/sandbox/source discovery.

## Required Access List

| Needed Access | Why Needed |
| --- | --- |
| Test customer login / customer app | Verify customer profile, menu, cart, checkout, payment, order status, notifications. |
| Test driver login / driver app | Verify driver assignment, route list, statuses, proof of delivery, failed delivery. |
| Test kitchen login / chef app | Verify kitchen sections, chef task queue, statuses, exceptions. |
| Packing user access | Verify packing checklist, labels, batch printing, reprint, handoff. |
| Staging admin | Safely click create/update/status/payment/assignment actions. |
| Source repo | Confirm routes, controllers, validations, side effects, permission checks. |
| Sanitized DB schema | Build real data model and migration map. |
| API docs or route map | Identify mobile/customer/driver/kitchen APIs. |
| Payment sandbox | Test payment link, confirmation, refund, gateway reconciliation. |
| Notification sandbox | Test push notification targeting and delivery history without customer impact. |
| Printer/label specs | Design label template and batch printing correctly. |
| WhatsApp Business access/docs | Confirm intake integration, templates, source tracking, and privacy rules. |

## Recommendation

The next detailed module should be Admin Order Intake And Lifecycle because it connects customer identity, packages, dates, addresses, payment links, kitchen planning, delivery, and finance. Customer, driver, kitchen, and packing apps must remain partial/inaccessible until dedicated test accounts or staging surfaces are provided.
