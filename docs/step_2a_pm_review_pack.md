# Nutrezee Step 2A PM Review Pack

Date: 2026-06-09
Phase: Step 2A Operational Context Engineering
Build direction: new system from scratch

## Summary

Step 2A converts Step 1 discovery into new-system operational context. The old production dashboard is now treated as reference only. The new Nutrezee system should be designed around operational workflows and automation, especially WhatsApp order intake, kitchen section routing, chef task assignment, automated label printing, driver assignment, and management analytics.

No production access was used for Step 2A. No application code was created or changed.

## Docs Created

- `docs/02_requirements/operational_pain_points.md`
- `docs/02_requirements/business_requirements_backlog.md`
- `docs/01_discovery/meeting_notes/meeting_template.md`
- `docs/step_2a_pm_review_pack.md`

## Key Decisions

| Decision | Impact |
| --- | --- |
| Build a new Nutrezee system from scratch. | Avoids copying old dashboard limitations and allows workflow-first design. |
| Treat old dashboard as reference only. | Old modules inform domain context but do not define target architecture or UX. |
| Keep Step 2A docs-only. | No production or application changes were made. |
| Make future meeting notes structured and repeatable. | New problems can be added without rewriting requirements from scratch. |
| Prioritize operations automation over screen parity. | Core focus moves to intake, kitchen, labels, dispatch, analytics, permissions, and audit. |

## Old Dashboard Observed State

Step 1 observed old-dashboard support for:

- Users/customers.
- Drivers and admin users.
- Products and packages.
- Orders by active, pending, pause, expired, and canceled states.
- Coupons, cashback, advertisements, and gallery.
- Ingredients, allergies, meal types, diet status, tags, package-for types.
- Delivery time slots and delivery methods.
- Settings, static content, contact messages, subscribers, social media, push notifications.
- Sales, payment, revenue, expiration, and dietician reports.

Step 1 did not confirm:

- WhatsApp order intake.
- Chef task app.
- Automated kitchen section routing.
- Box label automation.
- Driver assignment by area/location/time slot/capacity.
- Driver app.
- Audit logs.
- Complete roles/permissions.
- Customer cart/checkout.
- Calories/macros and full nutrition model.
- Inventory dependency.
- Central kitchen or branch dispatch.

## New System Requirements Direction

The new system should support these operating flows:

1. Capture WhatsApp-originating orders into structured draft orders.
2. Review and validate orders before confirmation.
3. Match customers and reuse profile, address, allergy, preference, and order history.
4. Maintain menu, packages, meal plans, nutrition, allergens, and routing metadata.
5. Generate kitchen section tasks from confirmed orders.
6. Assign chefs by section and shift.
7. Show chefs only relevant assigned tasks.
8. Generate and print box labels automatically.
9. Verify packing and handoff to dispatch.
10. Assign drivers using area/location/time slot/capacity rules.
11. Provide driver app workflows for assigned deliveries.
12. Provide analytics for orders, kitchen, chefs, delivery, revenue, payments, and exceptions.
13. Enforce role-based permissions.
14. Audit important operational and financial changes.
15. Support notifications and exception escalation.

## P0 Requirements

- WhatsApp order intake and draft order workflow.
- Admin order review and validation.
- Customer profile matching and address/preference reuse.
- Menu/product/package model with kitchen routing metadata.
- Kitchen section setup and chef-section-shift mapping.
- Chef task app scoped to assigned section work.
- Task decomposition from order items to kitchen sections.
- Box label generation tied to order/meal/route/packing data.
- Packing checklist and kitchen-to-dispatch handoff.
- Driver dispatch by area/location/time slot/capacity.
- Driver app with assignment and delivery statuses.
- Management analytics for orders, kitchen, delivery, chefs, revenue, and exceptions.
- Payment status lifecycle for manual and online payment paths.
- Role-based permissions.
- Audit logs.
- Meal plan/subscription lifecycle.
- Calories/macros/allergens/dietary labels where required by the healthy-food product.
- Exception management across intake, kitchen, packing, delivery, payment, and customer service.
- Sensitive data access control.

## Open Questions

1. Should WhatsApp order intake use WhatsApp Business API, manual-assisted entry, or a phased approach?
2. What are the exact required fields for a WhatsApp order?
3. What is the customer identity source of truth: phone, account, WhatsApp number, or another ID?
4. What are the current kitchen sections?
5. Which menu items/components route to each section?
6. Can chefs work across multiple sections in one shift?
7. What task statuses should kitchen use?
8. Is packing a separate team/section?
9. What exact data must appear on each box label?
10. Which printer model, label size, and print workflow are used?
11. Should labels include QR codes, barcodes, or both?
12. How are delivery areas defined?
13. What driver capacity unit should the system use?
14. Is route optimization required for first release?
15. What payment methods are required for WhatsApp and online orders?
16. What refund and cancellation rules apply?
17. Which KPIs does management need on day one?
18. Which data should chefs and drivers be allowed to see?
19. Which nutrition fields are required internally and customer-facing?
20. Does the new system need inventory dependency in the first release?

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Building from old-dashboard assumptions | New system may reproduce old workflow gaps. | Use old dashboard only as reference; validate new workflows in meetings. |
| WhatsApp process is under-specified | Intake automation may miss real operational cases. | Run focused customer-service/order-intake discovery. |
| Kitchen routing rules are unknown | Chef app and task routing cannot be designed correctly. | Map sections, menu components, chefs, shifts, and exceptions in Step 2B. |
| Label requirements are unknown | Printing automation may fail operationally. | Capture printer, label size, label fields, and trigger timing. |
| Driver assignment rules are unknown | Dispatch automation may assign poorly. | Define areas, capacity, time slots, override rules, and driver workflow. |
| Analytics scope may expand | Dashboards can become unfocused. | Prioritize P0 KPIs and separate live operations from historical analytics. |
| Sensitive customer/health/payment data | Wrong role access can create privacy and trust risk. | Design least-privilege roles and audit logs from day one. |
| More problems will be discovered later | Requirements may drift. | Use the meeting template and backlog as living docs. |

## Recommended Step 2B

Run structured workflow discovery meetings by department:

1. Order intake and customer service.
2. Kitchen management.
3. Individual kitchen sections and chefs.
4. Packing/labeling.
5. Dispatch and drivers.
6. Finance/payments.
7. Management/analytics.
8. Nutrition/dietician/product team.

Step 2B outputs should be:

- Confirmed workflow maps.
- Data-field inventory.
- Role/permission matrix.
- Kitchen section and chef mapping.
- Menu-item-to-section routing matrix.
- Label specification.
- Driver dispatch rule matrix.
- Payment and refund lifecycle.
- P0 analytics KPI list.
- Updated requirements backlog with confirmed priorities.

## Step 2A Approval Recommendation

Approve Step 2A as a documentation baseline for the new build.

Do not move to architecture until Step 2B confirms the operational workflows and data fields with Nutrezee stakeholders.
