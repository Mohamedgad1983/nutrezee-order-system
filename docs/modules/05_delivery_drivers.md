# Module Analysis: Delivery And Drivers

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/users/drivers/2` | Driver listing with identity/contact/status/operation columns. |
| `/driverOrders` | Driver-wise orders route exists but timed out. |
| `/orders/AutoAssignMealToDrivers` | Action-like automatic assignment route; skipped as unsafe. |
| `/timeSlots` | Delivery time slot master with start/end time. |
| `/deliveryMethod` | Delivery method master. |
| `/deliveryMethod/addDeliveryMethod` | Delivery method add/update form. |
| `/orders/list/*` | Orders include delivery-relevant package/date/customer/payment concepts. |

## Current Purpose

The existing dashboard manages driver records, delivery time slots, delivery methods, and has evidence of driver-wise order/auto-assignment behavior. The actual dispatch workflow is not safely verified because the driver-wise route timed out and auto-assignment was skipped.

## Current Workflow

Confirmed pieces:

1. Admin maintains driver records.
2. Admin maintains delivery time slots and delivery methods.
3. Orders include delivery-relevant dates and customer references.
4. Dashboard exposes an assignment-like route and a driver-wise order route.

Assumed current workflow:

1. Staff manually assign drivers using area/location/time/capacity judgment.
2. Drivers may receive assignments outside the audited admin or through an unverified route/app.

## Data Shown Or Needed

- Existing: driver identity/contact/status, delivery slot names/start/end, delivery method names, order/customer/package/date/payment concepts.
- Needed: driver area, availability, shift, capacity, vehicle, route, assigned orders, location/address, delivery slot, handoff status, delivery status, failed delivery reason, reschedule reason.

## Visible Actions

- Driver row operations.
- Delivery method row operations.
- Delivery slot row operations.
- Auto-assign driver-to-meal route.
- Driver-wise order route.

No row operation, save, assignment, or dispatch action was clicked.

## State-Change Risks

- Auto-assignment route may mutate production assignments.
- Driver assignment affects customer delivery and kitchen/packing priorities.
- Delivery status changes can affect customer service and analytics.
- Driver app must avoid exposing unnecessary customer, payment, or health data.
- Manual overrides need reasons and audit.

## Current Pain Points

- Driver assignment is manual.
- Driver capacity is not system-enforced.
- Delivery handoff may be manual.
- Driver app is not verified.
- Dispatch needs area/location/time slot/capacity rules.
- Analytics are needed for delivery performance, driver load, failed deliveries, and delays.

## Preserve Decisions

- Preserve driver records.
- Preserve delivery time slots and delivery methods.
- Preserve the business need for driver-wise views/assignment.

## Improve Decisions

- Improve drivers with areas, shifts, capacity, vehicle, availability, and active status.
- Improve delivery slots with area-specific capacity and cutoff rules.
- Improve delivery methods with operational/customer-facing rules if needed.
- Improve driver-wise orders into dispatch board with readiness, filters, and manual override.

## Replace Decisions

- Replace unsafe auto-assignment route with explicit dispatch workflow.
- Replace manual capacity tracking with enforceable capacity model.
- Replace undocumented driver handoff with manifest and status events.

## Add Decisions

- Add dispatch board by area, location, time slot, capacity, and readiness.
- Add driver app for assigned stops and status updates.
- Add assignment suggestions with dispatcher approval.
- Add failed/rescheduled delivery workflow.
- Add delivery exception queue.
- Add delivery analytics.

## Automation And AI Opportunities

- Suggest driver assignment by area, location, time slot, capacity, readiness, and driver availability.
- Detect overloaded drivers before confirmation.
- Cluster stops by area or route if map/geocoding is available.
- Predict delivery risk from late packing, overloaded route, missing address, or payment hold.
- Recommend reassignment when a driver is unavailable or delayed.

## Required New System Capabilities

- Driver profile and availability.
- Area/zone model.
- Delivery slot capacity.
- Dispatch board.
- Auto-assignment suggestion and manual override.
- Driver manifest.
- Driver app status workflow.
- Handoff from packing to dispatch/driver.
- Failed/rescheduled delivery handling.
- Delivery audit logs and analytics.

## Required Data Entities And Fields

- `Driver`: user, contact, status, vehicle, capacity, active areas.
- `DriverShift`: driver, date, start/end, capacity, availability.
- `DeliveryArea`: area name, serviceability, zone, optional map boundary.
- `DeliverySlot`: name, start/end, cutoff, area capacity.
- `DeliveryMethod`: name, rules, availability, customer-facing flag.
- `DispatchAssignment`: order/box, driver, route, slot, status, assigned by, reason.
- `DeliveryStatusEvent`: assigned, picked up, on route, delivered, failed, rescheduled, actor, timestamp.
- `DeliveryException`: type, owner, resolution.

## Required APIs High Level Only

- Driver CRUD and availability API.
- Delivery area/slot/method API.
- Dispatch candidate API.
- Assignment confirmation/override API.
- Driver manifest API.
- Driver status update API.
- Handoff API.
- Delivery exception API.
- Delivery analytics API.
- Dispatch audit API.

## Role And Permission Needs

- Dispatcher can assign, override, and reassign with reason.
- Driver can view assigned stops and update delivery statuses.
- Packing can hand off boxes to dispatch/driver.
- Operations can monitor readiness and exceptions.
- Management can view delivery analytics.
- Customer/payment/health fields should be restricted from driver views unless necessary.

## Reports And KPIs

- Orders assigned by driver, area, and time slot.
- Driver capacity utilization.
- Delivery success/failure rate.
- Late deliveries.
- Failed/rescheduled reasons.
- Handoff-to-delivery cycle time.
- Driver workload and route count.
- Unassigned ready orders.

## Open Questions For Nutrezee

1. How are delivery areas defined?
2. What makes a driver eligible for an order?
3. What capacity unit matters: orders, boxes, bags, weight, route time, or vehicle volume?
4. Is map/geocoding required for first release?
5. What statuses should drivers update?
6. Can drivers contact customers, and what data can they see?
7. Who can override auto-assignment?
8. Does dispatch happen before or after packing labels are printed?

## Assumptions Marked

- Driver app is a target capability; no driver app was discovered.
- Driver capacity by area/location/time slot is a business requirement and needs operations confirmation.
- Existing driver assignment behavior is not confirmed because `/driverOrders` was unstable and auto-assign was skipped as unsafe.

## Recommended Build Order

1. Driver profile, area, shift, and capacity model.
2. Delivery slot/method capacity rules.
3. Dispatch board using ready orders.
4. Assignment suggestion and manual override.
5. Driver app manifest and status updates.
6. Failed/rescheduled workflow and analytics.
