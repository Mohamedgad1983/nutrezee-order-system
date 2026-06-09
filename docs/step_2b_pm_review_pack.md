# Nutrezee Step 2B PM Review Pack

Date: 2026-06-09
Phase: Step 2B Old-System-to-New-System Feature Mapping
Scope: docs only, no production access

## Summary

Step 2B maps the old Nutrezee dashboard into the new advanced system plan. The old dashboard is the functional blueprint for module coverage: the new system must cover the same business modules first, then improve weak workflows and add missing automation.

The Step 1 audit identified 50 old dashboard screens/routes. Step 2B maps all 50 to new modules and classifies each as Preserve, Improve, or Replace. Additional missing capabilities from Step 2A are classified as Add.

## Files Created

- `docs/02_requirements/old_to_new_feature_map.md`
- `docs/02_requirements/new_system_module_catalog.md`
- `docs/03_user_flows/old_dashboard_workflow_summary.md`
- `docs/12_gap_analysis/old_system_preserve_improve_replace.md`
- `docs/step_2b_pm_review_pack.md`

## Old Modules Mapped

Mapped count: 50 old dashboard screens/routes.

Mapped old screens:

1. Dashboard
2. Users
3. Add New User
4. Drivers
5. Admin Users
6. Video Categories
7. User's Video
8. Video Tutorial
9. Products
10. Ratings
11. Cashback
12. Packages
13. Customer Active Orders
14. Customer Pending Orders
15. Customer Pause Orders
16. Customer Expired Orders
17. Customer Cancel Orders
18. Orders Driver Wise
19. Birthday Orders
20. Pre-Kitchen Meal Check
21. Coupon Master
22. Coupon Category
23. Advertisements / Offer
24. Common Gallery
25. Ingredients
26. Allergies
27. Meal Types
28. Diet Status
29. Tags
30. Package For Types
31. Delivery Time
32. Delivery Methods
33. General/Contact Setting
34. About Us
35. Why Us
36. Terms and Conditions
37. Return Policy
38. Contact Us
39. Subscribers
40. Social Media
41. Push Notification
42. Report Summary
43. Monthly Sales report
44. Daily Sales report
45. Sales by Payment (New)
46. Customer Revenue (New)
47. Confirm Payment (New)
48. Today Expiration
49. Dietician Requests
50. Total Of Tommorow New

## Key Decisions

| Decision | PM Meaning |
| --- | --- |
| Old dashboard is the functional blueprint. | The new build must not omit existing business modules without an explicit decision. |
| Old UI is not the design target. | New modules can redesign workflows while preserving business function. |
| Operations modules come before marketing/content polish. | Orders, kitchen, packing, delivery, finance, RBAC, and audit are dependency-critical. |
| Manual/risky old functions should be replaced. | Driver assignment, payment review, next-day planning, and unclear user creation need safer workflows. |
| Missing operational automation must be added. | WhatsApp intake, chef tasks, labels, dispatch, analytics, and audit logs are required for the advanced system. |

## Top Preserve / Improve / Replace Decisions

### Preserve

- Preserve content and media modules: gallery, videos, static pages, social links.
- Preserve marketing modules: coupons, coupon categories, offers, subscribers.
- Preserve product feedback/rating visibility.
- Preserve reports as business outputs, even where the implementation changes.

### Improve

- Improve customers into full customer profiles with WhatsApp matching.
- Improve products/packages into menu, meal plan, nutrition, allergen, and kitchen-routing catalogs.
- Improve order lists into an audited order lifecycle.
- Improve delivery slots/methods into dispatch-ready capacity rules.
- Improve finance reports into reconciled payment and revenue analytics.
- Improve ingredients/allergies/tags into nutrition and allergy safety models.
- Improve notifications with templates, approvals, delivery history, and audit.

### Replace

- Replace unstable driver-wise order route with dispatch board.
- Replace action-like driver auto-assignment route with safe assignment workflow.
- Replace unstable payment confirmation route with payment review queue.
- Replace report summary route with reliable analytics hub.
- Replace tomorrow order card route with tomorrow production and dispatch readiness board.
- Replace ambiguous add-user route with guided customer creation and duplicate detection.

### Add

- Add WhatsApp order intake.
- Add admin order review and incomplete-order queue.
- Add kitchen sections, item routing, and chef task app.
- Add packing checklist and automated label printing.
- Add driver app and dispatch automation by area/location/time slot/capacity.
- Add RBAC, audit logs, and sensitive data controls.
- Add calories/macros and allergy warnings.
- Add exception management across intake, kitchen, packing, delivery, finance, and support.

## Recommended First Build Sequence

This sequence follows old-system dependency order and the new operational automation needs.

### Phase 1: Foundation

1. Authentication, staff accounts, roles, permissions, audit logs.
2. Customer profiles, addresses, preferences, allergies.
3. Business settings, delivery areas, delivery slots, system configuration.

Why first:

- Every old module depends on users/staff/settings.
- New workflows require privacy, RBAC, and audit from day one.

### Phase 2: Catalog And Meal Plan Core

1. Products/menu.
2. Packages/meal plans/subscriptions.
3. Categories, meal types, package-for rules.
4. Ingredients, allergens, dietary tags, calories/macros.
5. Kitchen routing metadata per item/component.

Why next:

- Orders cannot be structured without catalog and plan data.
- Kitchen routing and labels depend on item metadata.

### Phase 3: Order Intake And Lifecycle

1. WhatsApp order intake.
2. Draft/incomplete order queue.
3. Admin order review.
4. Pending, active, pause, expired, canceled lifecycle.
5. Change requests, cancellations, exceptions.

Why next:

- This clones the old order-management core and fixes the biggest manual pain point.

### Phase 4: Kitchen And Packing

1. Kitchen section master.
2. Chef-section-shift assignment.
3. Task generation from confirmed orders.
4. Chef task app.
5. Pre-kitchen shortage/planning.
6. Packing checklist.
7. Automated label printing.

Why next:

- Confirmed orders need to become actionable kitchen work.
- Label automation and packing depend on task completion.

### Phase 5: Delivery And Driver Execution

1. Driver management and availability.
2. Dispatch board by area/location/time slot/capacity.
3. Driver app.
4. Handoff and delivery statuses.
5. Failed/rescheduled delivery exceptions.

Why next:

- Old driver/delivery modules exist but need automation and traceability.

### Phase 6: Finance, Payments, Reports, Analytics

1. Payment status lifecycle.
2. Payment review/confirmation queue.
3. Refunds, credits, cashback ledger.
4. Monthly/daily sales reports.
5. Sales by payment and customer revenue reports.
6. Management analytics for orders, kitchen, chefs, delivery, revenue, exceptions.

Why next:

- Finance needs clean order/payment events from earlier phases.
- Old reports must be preserved but modernized.

### Phase 7: Marketing, Content, Notifications

1. Coupons and promotions.
2. Ads/offers.
3. Gallery/media/static pages.
4. Subscribers/social media.
5. Notification center with templates and approvals.
6. Ratings and feedback.

Why later:

- These modules matter but depend less on the core operational automation path.

## P0 Scope For First Architecture Pass

- RBAC and audit logs.
- Customer profiles.
- Menu/package/nutrition/allergen catalog.
- WhatsApp order intake.
- Admin order review.
- Order lifecycle.
- Kitchen sections and routing.
- Chef task app.
- Packing and label printing.
- Dispatch board and driver app.
- Payment status and review.
- Core analytics.

## Main Risks

| Risk | Impact | Step 2C Action |
| --- | --- | --- |
| Old modules omitted accidentally | New system may regress business coverage. | Use `old_to_new_feature_map.md` as checklist. |
| Old UI copied too literally | New system may preserve old inefficiencies. | Use Preserve/Improve/Replace classification to guide redesign. |
| WhatsApp intake under-specified | Biggest manual pain point remains unresolved. | Create detailed WhatsApp intake flow and data field map. |
| Kitchen routing rules unknown | Chef app cannot be accurate. | Build section and item-routing matrix with kitchen stakeholders. |
| Label printing specs unknown | Packing automation may fail in practice. | Capture printer, label size, label fields, and batch rules. |
| Dispatch rules unknown | Auto-assignment may be wrong. | Define area, location, time slot, capacity, override, and failure rules. |
| Payment workflow unclear | Finance controls may be weak. | Define payment statuses, review, refund, credit, and reconciliation flows. |
| RBAC/audit delayed | Privacy and operational risk increases. | Build security foundation first. |

## Open Questions For Step 2C

1. Which old modules are mandatory for first release versus later release?
2. Which content/video modules are still used by the business?
3. What is the full order state machine?
4. What WhatsApp intake fields are required for each order type?
5. What are the exact kitchen sections and item-routing rules?
6. What are chef shift and section assignment rules?
7. What box label fields and printer hardware are required?
8. What driver assignment algorithm should be used for day one?
9. What payment statuses and refund/credit rules are required?
10. What management analytics are P0 for launch?
11. Which roles can view customer, health, payment, and driver data?
12. What audit events are mandatory?

## Recommended Step 2C

Proceed to Step 2C Workflow And Data Modeling.

Recommended Step 2C deliverables:

- Old module coverage checklist for release planning.
- Order lifecycle state diagram.
- WhatsApp order intake flow.
- Customer profile and address data model.
- Menu/package/nutrition/allergen data model.
- Kitchen section and chef assignment matrix.
- Item-to-kitchen-section routing matrix.
- Packing and label specification.
- Dispatch rule matrix and driver app flow.
- Payment lifecycle and finance reconciliation flow.
- RBAC matrix and audit event catalog.
- P0 analytics KPI definition.

Step 2C should not start implementation. It should produce workflow and data models detailed enough for architecture and implementation planning.
