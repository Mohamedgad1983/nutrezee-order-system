# Module Analysis: Labels And Packing Gaps

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| No label route observed | Label printing was not visible in the old dashboard. |
| No packing route observed | Packing checklist/handoff was not visible in the old dashboard. |
| `/orders/list/*` | Order/package/customer/date/payment concepts needed by labels. |
| `/orders/short-meals-check` | Pre-kitchen planning concept that should feed packing readiness. |
| `/driverOrders` | Driver/order assignment route exists but timed out. |
| `/deliveryMethod`, `/timeSlots` | Delivery method and time slot concepts needed for labels and packing batches. |

## Current Purpose

The old admin dashboard does not confirm a label or packing module. Business pain points say labels are printed manually and packing needs checklist/handoff. This module is therefore a gap analysis based on old-admin evidence: preserve only the existing order/package/delivery data that labels and packing will need.

## Current Workflow

Assumption based on pain points:

1. Kitchen prepares items through manual or dashboard-assisted planning.
2. Staff prepare or print labels outside the system.
3. Packing verifies items manually.
4. Packed orders are handed to dispatch/drivers without a fully verified system checklist.

This workflow is an assumption based on business pain points and needs Nutrezee confirmation.

## Data Shown Or Needed

- Needed from orders: order number/reference, customer reference, package, meal/date, delivery slot, delivery method, address/area concept, special notes, allergy/diet flags as allowed by role.
- Needed from kitchen: required section tasks, section completion, blocked items, substitutions.
- Needed for labels: label template, language, package/meal name, date, route/driver/slot, QR/barcode if used, reprint count, print actor.
- Needed for packing: box number, checklist items, missing item status, packing owner, packed timestamp, handoff timestamp.

## Visible Actions

No label or packing actions were observed.

Related visible actions in other modules:

- Order exports and operation actions.
- Kitchen date check.
- Driver assignment route/action hints.

No action was clicked.

## State-Change Risks

- Printing incorrect labels can cause wrong meals, wrong customer delivery, allergy mistakes, or delayed dispatch.
- Packing completion can incorrectly release orders to drivers.
- Reprints can create duplicate or confusing labels unless audited.
- QR/barcode scans must avoid exposing sensitive data.
- Packing status changes must be tied to kitchen readiness and dispatch handoff.

## Current Pain Points

- Box labels are printed manually.
- Packing needs checklist and handoff.
- Kitchen handoff to packing may be unclear.
- Delivery handoff may be manual.
- Multi-section prep needs final completeness checks before dispatch.

## Preserve Decisions

- Preserve order, package, delivery slot, delivery method, customer reference, and kitchen readiness concepts as inputs.
- Preserve old reports/lists only as upstream evidence, not as label/packing workflow.

## Improve Decisions

- Improve order/kitchen/dispatch linkage so packing sees readiness and blockers.
- Improve handoff from kitchen to packing and packing to dispatch with statuses and timestamps.
- Improve labels with system-generated, validated, role-appropriate data.

## Replace Decisions

- Replace manual label preparation with automated label generation.
- Replace informal packing checks with a system checklist.
- Replace undocumented handoff with scan/check handoff and audit.

## Add Decisions

- Add label template management.
- Add label generation per order/box/meal/date.
- Add batch printing by delivery slot, route, driver, kitchen batch, customer, or package.
- Add QR/barcode support if confirmed.
- Add packing checklist with section task dependency.
- Add reprint workflow with reason and audit.
- Add dispatch handoff manifest.

## Automation And AI Opportunities

- Auto-generate label batches from production readiness and delivery grouping.
- Detect label-data conflicts such as missing delivery slot, allergy flag, or unready kitchen task.
- Suggest packing batch order by route/time slot.
- Use barcode/QR scans to update packing and handoff status.
- Predict packing bottlenecks from kitchen readiness and driver cutoff times.

## Required New System Capabilities

- Packing board by date, slot, route, and readiness.
- Box/order checklist generated from kitchen tasks.
- Label generation and print queue.
- Batch print controls.
- Reprint controls with reason.
- Scan/check handoff to dispatch.
- Packing exceptions and missing item workflow.
- Label and packing audit logs.

## Required Data Entities And Fields

- `Box`: order, package/date, box number, status, packed by, packed at.
- `PackingChecklistItem`: box, kitchen task/component, required quantity, checked status, checked by.
- `LabelTemplate`: name, size, language, fields, active version.
- `LabelPrintJob`: template, box/order, printer, batch, status, printed by, printed at.
- `LabelReprintEvent`: reason, actor, timestamp, previous print reference.
- `PackingException`: missing item, wrong item, damaged item, late item, owner, resolution.
- `DispatchHandoff`: box, driver/route, handoff status, scan reference, timestamp.

## Required APIs High Level Only

- Packing readiness API.
- Packing checklist API.
- Label template API.
- Label generation API.
- Print job API.
- Reprint audit API.
- Scan/handoff API.
- Packing exception API.
- Packing analytics API.

## Role And Permission Needs

- Kitchen can mark section tasks ready/handoff.
- Packing can check items, print labels, reprint with reason, and mark packed.
- Dispatcher can receive packed boxes into dispatch manifest.
- Driver can see only assigned delivery/handoff data.
- Management can view packing KPIs.
- Label template changes require admin/operations permission and audit.

## Reports And KPIs

- Boxes packed by date, slot, route, and staff member.
- Packing completion rate and average packing time.
- Missing item exceptions.
- Label print and reprint counts.
- Orders blocked by kitchen section.
- Dispatch handoff readiness.
- Late-to-dispatch orders by cause.

## Open Questions For Nutrezee

1. What label size and printer models are used?
2. What exact fields must appear on labels?
3. Should labels be bilingual?
4. Are QR codes or barcodes required?
5. When should labels print: order confirmation, kitchen readiness, packing, or dispatch?
6. How many boxes can one order/day have?
7. Who can reprint labels and what reason is required?
8. Does packing happen by route, time slot, package, kitchen batch, or customer?

## Assumptions Marked

- Label printing is assumed manual because no old-admin label route was found and business pain points say labels are manual.
- Packing checklist/handoff is assumed missing because no old-admin packing route was found.
- QR/barcode, batch printing, and scan handoff are proposed capabilities, not discovered old-system behavior.

## Recommended Build Order

1. Confirm label template and printer requirements.
2. Define box and packing checklist model.
3. Generate checklist from kitchen tasks.
4. Generate labels from order/box data.
5. Add batch printing and reprint audit.
6. Add packing exceptions and dispatch handoff.
7. Add packing KPIs.
