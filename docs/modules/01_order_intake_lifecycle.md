# Module Analysis: Order Intake And Lifecycle

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/orders/create` | Admin order creation form with customer search, package, sub-package, package-for, start date, amount fields, coupon, address, delivery slot/method, notes, paid-already, gateway, paid amount, and payment-link action. |
| `/orders/list` | Generic order lifecycle table route. |
| `/orders/list/Active` | Active order list with customer, package, dates, transaction, payment status, order status, coupon, amounts, and operation columns. |
| `/orders/list/pending` | Pending order list with the same order structure. |
| `/orders/list/Pause` | Paused order list. |
| `/orders/list/Expire` | Expired order list. |
| `/orders/list/cancel` | Canceled order list. |
| `/packageexpirestoday` | Expiring package report. |
| `/orders/getTotalOrdersNew/tommorow` | Tomorrow-order dashboard card route; unstable/partial. |
| `/orders/AutoAssignMealToDrivers` | Action-like assignment route; skipped as unsafe. |

## Current Purpose

The existing admin supports staff-assisted order creation and order monitoring by lifecycle state. The order module is the operational center connecting customers, packages, delivery, payment, kitchen planning, driver assignment, and reports.

## Current Workflow

1. Staff can search/select a customer in the admin order creation form.
2. Staff selects package, sub-package, package-for type, start date, amount fields, coupon, address, delivery time, delivery method, notes, and payment fields.
3. The visible create action can generate a payment link, but this was not clicked.
4. Orders appear in lifecycle lists such as pending, active, pause, expired, and canceled.
5. Reports and dashboard cards provide shortcuts for expiration, tomorrow orders, and downstream delivery/kitchen activity.

## Data Shown Or Needed

- Customer reference and contact concept.
- Package, sub-package, package-for rule, start date, end date.
- Delivery address, area, block/street/house concept, address type, contact, delivery time, delivery method.
- Package amount, total amount, paid amount, coupon code, paid already flag, gateway.
- Transaction date, transaction ID, payment status, order status, coupon, amounts.
- Notes for admin/driver.
- Missing in old evidence: structured source channel, WhatsApp reference, change reasons, lifecycle timeline, approval/hold metadata, cancellation/refund impact, kitchen/dispatch readiness.

## Visible Actions

- Apply coupon.
- Create order and generate payment link.
- Search/clear/filter order lists.
- Export order lists.
- Date-wise meal order links.
- Row-level operation actions.

No create, save, export, payment-link, row operation, assign, cancel, approve, or confirm action was clicked.

## State-Change Risks

- `/orders/create` can create orders and generate payment links.
- Row-level operations may change order status, edit order data, cancel orders, pause/resume subscriptions, or expose sensitive detail.
- `/orders/AutoAssignMealToDrivers` may auto-assign meals to drivers.
- Exports can expose customer/payment data.
- Payment status fields influence kitchen and dispatch readiness.

## Current Pain Points

- WhatsApp orders are manually entered.
- Admin review is needed before orders affect kitchen and delivery.
- Order changes, pauses, cancellations, substitutions, and special cases need explicit reasons and downstream impact preview.
- Pending/active/pause/expired/cancel states exist, but the full state machine and transition rules are not verified.
- Tomorrow order route is unstable and should not be used as a detailed workflow model.

## Preserve Decisions

- Preserve admin order creation as a staff-assisted order intake baseline.
- Preserve lifecycle visibility for pending, active, paused, expired, and canceled orders.
- Preserve package, dates, payment status, coupon, and amount visibility.
- Preserve expiration reporting as a customer-service/renewal input.

## Improve Decisions

- Improve order creation into draft order intake with validation, required fields, source tracking, and incomplete-order queue.
- Improve pending orders into admin review with approve, hold, reject, correct, and reason capture.
- Improve lifecycle lists into a unified order workspace with timeline, downstream readiness, and audit.
- Improve pause/cancel/expire states with reason, calendar impact, refund/credit impact, and customer communication.

## Replace Decisions

- Replace ambiguous or direct action routes with explicit workflows that require confirmation and audit.
- Replace unstable tomorrow-order route with a tomorrow production and dispatch readiness board.
- Replace raw row operation links with role-gated actions tied to order state.

## Add Decisions

- Add WhatsApp-originating draft order flow.
- Add order source/channel, staff owner, intake timestamp, message reference, and validation blockers.
- Add order change request model for renewal, pause, cancellation, substitution, address change, special request, and payment issue.
- Add exception queue for missing data, failed payment, kitchen shortage, label issue, dispatch issue, and customer complaint.
- Add downstream impact preview before confirming changes.

## Automation And AI Opportunities

- AI-assisted extraction of order details from WhatsApp text into draft fields, with staff review required.
- Duplicate customer detection by phone and fuzzy name matching.
- Automatic validation for missing address, delivery slot, package dates, payment state, allergy conflicts, and unavailable items.
- Suggested package renewal or plan continuation based on previous orders.
- Exception prioritization by due date, delivery slot, payment risk, and kitchen impact.

## Required New System Capabilities

- Draft order intake and admin review.
- Order lifecycle state machine.
- Subscription calendar with start, end, off days, pauses, renewals, and cancellations.
- Payment status dependency rules.
- Kitchen/dispatch readiness flags.
- Order detail timeline and audit trail.
- Controlled exports.
- Role-based order actions.

## Required Data Entities And Fields

- `Order`: order number, customer, source, status, payment status, package, sub-package, package-for, start date, end date, created by, reviewed by, notes.
- `OrderDraft`: source channel, raw reference, staff owner, missing fields, validation state.
- `OrderLine` or `MealPlanSelection`: item/package reference, quantity, date, delivery day, substitution status.
- `OrderStatusEvent`: from status, to status, actor, timestamp, reason, source.
- `SubscriptionCalendar`: active days, off days, pauses, expiry, renewal status.
- `OrderException`: type, severity, owner, due time, status, resolution.
- `PaymentLink`: gateway, amount, status, expiry, order reference.

## Required APIs High Level Only

- Customer search and match API.
- Draft order create/update/validate API.
- Order review/confirm/hold/reject API.
- Order lifecycle transition API.
- Subscription calendar calculation API.
- Coupon validation API.
- Payment link generation API.
- Kitchen and dispatch readiness API.
- Order timeline and audit API.
- Order export API with permissions.

## Role And Permission Needs

- Customer service can create drafts and request changes.
- Operations can review, hold, and correct operational fields.
- Finance can handle payment state and finance holds.
- Management can view reports and override with reason.
- Kitchen, packing, and driver roles should see only the order fields needed for their workflow.
- All create, review, state change, cancellation, pause, payment, assignment, and export actions require audit.

## Reports And KPIs

- New orders by source and status.
- Drafts missing required fields.
- Pending review aging.
- Active subscriptions.
- Paused, expired, canceled order counts.
- Order cycle time from intake to confirmation.
- Downstream blocked orders by reason.
- Tomorrow readiness by kitchen, packing, dispatch, and payment.
- Order changes by type and actor.

## Open Questions For Nutrezee

1. What exact states should an order move through from draft to delivered/expired/canceled?
2. Which order types arrive through WhatsApp: new, renewal, pause, cancellation, address change, special request, complaint?
3. Who can confirm, reject, hold, edit, pause, cancel, or renew an order?
4. Does payment need to be confirmed before kitchen production starts?
5. What fields are mandatory before an order can leave draft/pending?
6. What should happen when a confirmed order is changed after kitchen tasks are generated?
7. What historical order data must be migrated or searchable?

## Assumptions Marked

- WhatsApp draft intake is a required new workflow from business pain points, not a discovered old-admin screen.
- Admin order review is inferred from pending orders and the need to control downstream kitchen/dispatch impact.
- Delivered/completed states are not confirmed in old-admin evidence and require Nutrezee confirmation.

## Recommended Build Order

1. Customer search/matching and draft order intake.
2. Required field validation and incomplete-order queue.
3. Admin review and order lifecycle state machine.
4. Subscription calendar and package date rules.
5. Payment status dependencies and payment-link hooks.
6. Kitchen/dispatch readiness linkage.
7. Order timeline, audit, exports, and analytics.
