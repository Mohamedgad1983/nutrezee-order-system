# Module Analysis: Kitchen And Pre-Kitchen

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/orders/short-meals-check` | Pre-kitchen meal shortage check route with date selector. |
| `/orders/getMealsDateWiseFilter` | Date-wise meal route hint; direct access exposed error without required input. |
| `/orders/getTotalOrdersNew/tommorow` | Tomorrow-order dashboard card route; unstable/partial. |
| `/products` | Products that should eventually drive kitchen tasks. |
| `/ingredients` | Ingredient master that may support kitchen planning. |
| `/mealsType` | Meal type master. |
| `/package` | Packages that determine meal plans and production demand. |

## Current Purpose

The old dashboard confirms only an early pre-kitchen planning concept. It does not confirm a complete kitchen board, kitchen section model, chef assignment workflow, or chef task app. The business requirement is larger than the old evidence: many kitchen sections must receive tasks by item/component and assigned chefs should see only their relevant section work.

## Current Workflow

1. Admin can choose a date on the pre-kitchen meal shortage check page.
2. Order list routes include date-wise meal order links.
3. Dashboard includes tomorrow-order shortcuts, but the key route was unstable.
4. No production board, section task board, chef queue, or handoff workflow was confirmed.

## Data Shown Or Needed

- Existing evidence: date selector, meal/order route hints, product/package/ingredient masters.
- Needed: kitchen sections, stations, chef assignments, shifts, task quantities, item/component routing, due time, prep window, shortage status, substitution status, completion status, handoff state.
- Needed: production demand by date, package, meal type, product, section, and delivery slot.

## Visible Actions

- Check pre-kitchen date.
- Date-wise meal order links from order lists.
- Dashboard tomorrow-order links.

No check/action route was submitted if it could change or expose sensitive production details beyond structure.

## State-Change Risks

- Kitchen status changes can affect packing, labels, dispatch, customer promises, and management analytics.
- Shortage/substitution actions could alter order content.
- Chef task completion and handoff require audit to avoid disputes.
- Direct malformed route exposed a framework/SQL error, showing validation risk.

## Current Pain Points

- Kitchen has many sections without automated routing.
- Chef assignment is manual or informal.
- Kitchen tasks may not be itemized by production step.
- Chef app should show assigned section tasks only.
- Pre-kitchen shortage/planning is too thin as a full operating workflow.
- Analytics are needed for kitchen throughput, chef productivity, delays, and exceptions.

## Preserve Decisions

- Preserve the concept of pre-kitchen date-based planning.
- Preserve the relationship between orders, packages, products, ingredients, and production demand.
- Preserve tomorrow/day-ahead planning as an operational need.

## Improve Decisions

- Improve pre-kitchen check into a daily/tomorrow production planning board.
- Improve products and packages with kitchen routing metadata.
- Improve kitchen planning with shortage detection, substitution workflow, readiness status, and exception ownership.
- Improve date-wise meal reporting into a validated, role-gated production view.

## Replace Decisions

- Replace unstable tomorrow-order route with reliable tomorrow production readiness.
- Replace direct date-wise route errors with validated filters and controlled error handling.
- Replace manual section assignment with explicit item/component-to-section rules.

## Add Decisions

- Add kitchen section/station master.
- Add chef-section-shift assignment.
- Add automatic kitchen task generation from confirmed orders.
- Add chef task app scoped by assigned section(s).
- Add task statuses: queued, in progress, prepared, blocked, handed off, canceled.
- Add shortage, substitution, escalation, and exception workflow.
- Add kitchen analytics.

## Automation And AI Opportunities

- Auto-generate section tasks from confirmed orders and menu routing rules.
- Predict tomorrow production load by section and delivery slot.
- Detect shortages from ingredient availability if inventory is confirmed.
- Suggest task batching by section, package, delivery time, and prep window.
- Flag overloaded chefs/sections before work starts.

## Required New System Capabilities

- Kitchen section master.
- Menu/component routing rules.
- Production planning by date and delivery slot.
- Chef assignment by section, shift, date, and time.
- Chef task app.
- Shortage/substitution/exception workflow.
- Kitchen readiness status feeding packing and dispatch.
- Kitchen audit logs and analytics.

## Required Data Entities And Fields

- `KitchenSection`: name, active status, capacity, manager, station notes.
- `ChefAssignment`: staff user, section, shift, date, start/end time.
- `RoutingRule`: product/component, section, quantity basis, prep time, sequence.
- `KitchenTask`: order, order line, product/component, section, chef assignment, quantity, due time, status.
- `KitchenTaskEvent`: status change, actor, timestamp, reason.
- `Shortage`: item/ingredient/component, date, affected orders, owner, resolution.
- `ProductionPlan`: date, package demand, section load, readiness status.

## Required APIs High Level Only

- Kitchen section CRUD API.
- Chef assignment API.
- Menu routing rule API.
- Production plan generation API.
- Kitchen task generation API.
- Chef task status API.
- Shortage/exception API.
- Kitchen readiness API.
- Kitchen analytics API.
- Kitchen audit API.

## Role And Permission Needs

- Kitchen manager manages sections, routing review, task reassignment, and shortages.
- Chef sees only assigned section tasks and allowed status controls.
- Operations can view readiness and exceptions.
- Packing can see readiness without unnecessary customer/payment data.
- Management can view analytics.
- All task status, substitution, reassignment, shortage, and handoff actions require audit.

## Reports And KPIs

- Tasks by section, date, delivery slot, and status.
- Chef workload and completion rate.
- Delayed/blocked tasks.
- Shortages by ingredient/product/section.
- Production readiness for tomorrow and today.
- Section throughput and cycle time.
- Exceptions by owner and resolution time.

## Open Questions For Nutrezee

1. What are all kitchen sections and stations?
2. Which products/components route to which sections?
3. Can one product require multiple section tasks?
4. How are chefs assigned to sections and shifts today?
5. What task statuses should chefs use?
6. Who can reassign chef tasks or override routing?
7. What shortage and substitution approvals are required?
8. Does inventory need to block production or only warn?

## Assumptions Marked

- Kitchen sections mapped to chefs are business requirements, not confirmed old-admin screens.
- Chef task app is a target capability; no chef app was discovered.
- Item/component routing to section/chef is inferred from business pain points and requires stakeholder validation.

## Recommended Build Order

1. Kitchen section master and chef assignment.
2. Menu routing rules from products/components to sections.
3. Production plan generation from confirmed orders.
4. Chef task app and task status workflow.
5. Shortage/substitution/exception handling.
6. Packing readiness and analytics integration.
