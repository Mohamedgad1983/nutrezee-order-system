# Nutrezee Business Requirements Backlog

Date: 2026-06-09
Phase: Step 2A Operational Context Engineering
Build direction: new system from scratch

## Purpose

This backlog translates Step 1 discovery and known business problems into new-system requirements. The old dashboard is reference evidence only and must not constrain the new system design.

## Requirement Status Values

- Proposed: derived from Step 1 and current business input.
- Needs Confirmation: requires business process confirmation before architecture.
- Future Candidate: likely useful but not required for first design unless confirmed.

## Backlog

| ID | Area | Requirement | Priority | Status | Source / Rationale | Acceptance Direction |
| --- | --- | --- | --- | --- | --- | --- |
| BR-001 | WhatsApp Order Intake | Support structured intake for orders originating from WhatsApp. | P0 | Needs Confirmation | Business says most orders come from WhatsApp and are manually entered. | Staff can capture WhatsApp order details into a draft order with required fields and source tracking. |
| BR-002 | WhatsApp Order Intake | Track WhatsApp source, message reference, staff owner, and intake timestamp. | P0 | Proposed | Needed for auditability and follow-up. | Each draft/order has source metadata without storing unnecessary sensitive chat content. |
| BR-003 | WhatsApp Order Intake | Provide incomplete-order queue for missing customer, menu, delivery, payment, or schedule data. | P0 | Proposed | Manual messages may omit required data. | Orders with missing fields cannot progress until resolved or explicitly overridden with reason. |
| BR-004 | Admin Order Review | Provide admin review workflow before confirmed orders enter kitchen/dispatch. | P0 | Proposed | Prevents kitchen and delivery mistakes from manual intake. | Admin can review, correct, approve, reject, or hold draft orders with audit trail. |
| BR-005 | Admin Order Review | Support order change requests, pauses, cancellations, substitutions, and special cases. | P0 | Needs Confirmation | Old system had pause/cancel states; WhatsApp likely handles changes manually. | Each change type has explicit status, owner, reason, and downstream impact. |
| BR-006 | Customer Profile | Match customers by phone and maintain profile history. | P0 | Needs Confirmation | WhatsApp orders likely identify customers by phone. | Staff can find existing customers and reuse addresses, allergies, preferences, and order history. |
| BR-007 | Customer Profile | Support multiple delivery addresses, area, location pin, notes, and contact preferences. | P0 | Proposed | Required for driver assignment and delivery success. | Each order selects a validated delivery address and time slot. |
| BR-008 | Product/Menu | Maintain menu items, categories, packages, meal plans, prices, availability, images, and language variants. | P0 | Proposed | Old dashboard had products, packages, categories, English/Arabic fields. | Admin can manage catalog data needed for order, kitchen, label, and nutrition workflows. |
| BR-009 | Product/Menu | Map each menu item/component to one or more kitchen sections. | P0 | Proposed | Business needs auto-routing to kitchen section/chef. | Confirmed orders generate section tasks based on item routing rules. |
| BR-010 | Product/Menu | Support item components or prep tasks where one customer meal requires multiple kitchen sections. | P0 | Needs Confirmation | Multi-section kitchen implies task decomposition. | Kitchen task generation can split an order line across sections. |
| BR-011 | Kitchen Sections | Define kitchen sections, stations, active status, capacity, and responsible managers. | P0 | Proposed | Business says kitchen has many sections. | Admin can configure sections used by routing and chef task views. |
| BR-012 | Kitchen Sections | Map chefs to sections by shift/date/time. | P0 | Proposed | Each section should map to specific chefs. | Chef sees only tasks for assigned section(s) and shift. |
| BR-013 | Chef Task App | Provide chef-focused task app scoped by section and chef assignment. | P0 | Proposed | Business explicitly needs chefs to see only assigned section tasks. | Chef view lists assigned tasks with due time, quantity, item, status, and exceptions. |
| BR-014 | Chef Task App | Support task statuses for queued, in progress, prepared, blocked, and handed off. | P0 | Needs Confirmation | Required for operational visibility. | Status changes update live operations dashboards and audit log. |
| BR-015 | Chef Task App | Support shortage/substitution/escalation reporting from kitchen tasks. | P0 | Proposed | Old dashboard had pre-kitchen shortage check. | Chef or kitchen manager can flag exceptions without losing order traceability. |
| BR-016 | Label Printing | Generate box labels automatically from order, customer, delivery, meal, date, and package data. | P0 | Proposed | Business says labels are printed manually. | Labels can be generated at the correct workflow stage with correct order/customer/task data. |
| BR-017 | Label Printing | Support print batches by route, delivery slot, kitchen batch, customer, or order. | P1 | Needs Confirmation | Batch printing may reduce packing workload. | Staff can print labels in operationally useful groups. |
| BR-018 | Label Printing | Support barcode or QR code for order/box tracking if confirmed. | P1 | Needs Confirmation | Useful for packing and driver handoff. | Label can include scan code that maps to box/order without exposing unnecessary data. |
| BR-019 | Packing | Provide packing checklist by order/box across kitchen sections. | P0 | Proposed | Multi-section prep needs final completeness check. | Packing can verify all required section tasks before dispatch. |
| BR-020 | Delivery Dispatch | Assign drivers by area, location, time slot, capacity, and availability. | P0 | Proposed | Business explicitly needs app-based driver assignment. | Dispatcher can auto-assign and manually override with reason. |
| BR-021 | Delivery Dispatch | Track driver capacity by order count, box count, route, shift, or vehicle. | P0 | Needs Confirmation | Capacity unit must match operations. | Auto-assignment prevents exceeding configured capacity unless override is approved. |
| BR-022 | Delivery Dispatch | Support dispatch manifest and driver handoff status. | P0 | Proposed | Needed between packing and delivery. | Driver receives assigned deliveries only after handoff/dispatch confirmation. |
| BR-023 | Driver App | Provide driver app with assigned deliveries, customer contact rules, address/location, time slot, and delivery status. | P0 | Proposed | Delivery assignment requires driver execution surface. | Driver can view assigned stops and update delivery progress. |
| BR-024 | Driver App | Support delivery statuses such as assigned, picked up, on route, delivered, failed, rescheduled. | P0 | Needs Confirmation | Needed for operational analytics and customer service. | Status updates are timestamped and visible to dispatch. |
| BR-025 | Analytics | Provide management analytics for orders, kitchen, delivery, chefs, revenue, and exceptions. | P0 | Proposed | Business explicitly needs analytics. | Management dashboard shows live and historical KPIs with filters. |
| BR-026 | Analytics | Track kitchen throughput and chef productivity by section, chef, task type, time slot, and exception. | P0 | Proposed | Business needs chef/kitchen analytics. | Reports show completed tasks, delay, workload, and exceptions without exposing unnecessary customer data. |
| BR-027 | Analytics | Track delivery performance by driver, area, time slot, capacity, failed deliveries, and delays. | P0 | Proposed | Business needs delivery analytics. | Reports show driver load and delivery outcomes. |
| BR-028 | Analytics | Track revenue by channel, package, payment method, date, customer cohort, and order status. | P0 | Proposed | Step 1 old dashboard had revenue/payment reports; management needs better analytics. | Reports reconcile confirmed orders and payment status. |
| BR-029 | Payments | Support payment status for online, cash, manual transfer, or payment link flows as confirmed. | P0 | Needs Confirmation | WhatsApp orders may use mixed payment methods. | Orders cannot enter configured stages without required payment status or approved exception. |
| BR-030 | Payments | Support payment review, confirmation, reconciliation, refund, and audit trail. | P1 | Needs Confirmation | Old payment confirmation route was unstable; refunds unconfirmed. | Finance can track payment lifecycle with actor/time/reason. |
| BR-031 | Reports | Provide exportable operational and finance reports with role-based access. | P1 | Proposed | Old dashboard had exports; new system needs controlled reporting. | Authorized roles can export required reports with audit logging. |
| BR-032 | Roles/Permissions | Implement role-based access for management, admin, customer service, kitchen manager, chef, packing, dispatcher, driver, finance, and dietician. | P0 | Proposed | Old dashboard did not confirm RBAC; new workflows require least privilege. | Users see only screens/actions required for their role and assignment. |
| BR-033 | Audit Logs | Audit order changes, payment changes, kitchen status changes, label printing, dispatch changes, settings changes, and permission changes. | P0 | Proposed | Old dashboard did not expose audit logs. | Audit records include actor, timestamp, entity, action, before/after, and reason where relevant. |
| BR-034 | Notifications | Notify internal teams about new orders, missing data, kitchen exceptions, packing readiness, dispatch issues, and payment problems. | P1 | Proposed | Multi-team operations need timely handoff. | Notifications are role-scoped and do not leak sensitive data. |
| BR-035 | Notifications | Support customer notifications for order confirmation, schedule, delivery status, and exceptions if confirmed. | P1 | Needs Confirmation | Customer communication channel must be agreed. | Notification channel and templates are configured by business rules. |
| BR-036 | Meal Plans | Support meal plans/packages with start/end date, off days, pause/resume, renewal, expiry, and delivery calendar. | P0 | Proposed | Old dashboard had packages, active subscriptions, pause/expire states. | Meal plan lifecycle drives kitchen and delivery dates correctly. |
| BR-037 | Meal Plans | Support subscription changes and substitutions with downstream kitchen/label/dispatch updates. | P0 | Needs Confirmation | WhatsApp changes likely happen manually today. | Changes recalculate affected tasks and show impact before confirmation. |
| BR-038 | Nutrition/Allergens | Maintain calories, protein, carbs, fat, ingredients, allergens, dietary labels, and nutrition notes per item/meal. | P0 | Proposed | Healthy-food platform requires nutrition; old dashboard did not confirm calories/macros. | Nutrition data can be shown internally and customer-facing where required. |
| BR-039 | Nutrition/Allergens | Flag customer allergies and dietary restrictions during order review and kitchen task generation. | P0 | Proposed | Allergy safety is a core risk. | System warns staff before confirming conflicting orders or substitutions. |
| BR-040 | Inventory | Track ingredients or production availability if business confirms inventory dependency. | P1 | Needs Confirmation | Step 1 identified inventory as unconfirmed; kitchen routing may depend on stock. | Ingredient availability can block or warn on affected items. |
| BR-041 | Freshness/Prep Windows | Define prep windows, freshness windows, shelf-life, and cutoff times per item/meal/section. | P1 | Needs Confirmation | Healthy-food operations need timing discipline. | Kitchen schedule respects freshness and delivery timing constraints. |
| BR-042 | Exceptions | Provide exception management across intake, kitchen, packing, delivery, payment, and customer service. | P0 | Proposed | Manual exceptions create operational blind spots. | Exceptions have type, owner, severity, status, due time, resolution, and audit trail. |
| BR-043 | Data Privacy | Limit sensitive customer, payment, and health data by role. | P0 | Proposed | Step 1 observed PII and health-related data in admin tables. | Roles see only necessary data; exports and audit logs are controlled. |
| BR-044 | Configurability | Allow business-owned configuration for areas, time slots, sections, chefs, capacities, labels, and notification templates. | P1 | Proposed | More problems will be discovered in meetings. | Admin configuration supports future changes without code for core operational rules. |

## Old Dashboard Reference Only

The following old-dashboard capabilities are useful reference points but are not implementation requirements by themselves:

- Products and packages.
- Orders by status.
- Drivers and delivery methods.
- Ingredients, allergies, diet status, tags, and meal types.
- Reports for sales, payment, revenue, and expiration.
- Push notifications.
- Coupons and cashback.

The new system should redesign workflows around the new operational requirements rather than reproducing old screens.

## Open Business Decisions

1. Should WhatsApp integration be manual-assisted first, API-driven first, or phased?
2. What is the source of truth for customer identity: phone, account, WhatsApp number, or another ID?
3. What are all kitchen sections and how do menu items map to them?
4. Does each chef work in one section per shift or multiple sections?
5. What exact data must appear on box labels?
6. Which printers and label sizes are used?
7. What makes a driver eligible for an order?
8. What capacity unit should dispatch use?
9. Which management KPIs are required for day one?
10. Which payment methods and refund paths are required?
11. Which data can drivers and chefs see?
12. Which nutrition data must be customer-facing?

## Step 2B Backlog Refinement

Step 2B should validate this backlog with department leads and convert confirmed P0 items into workflow maps, data fields, and acceptance criteria.
