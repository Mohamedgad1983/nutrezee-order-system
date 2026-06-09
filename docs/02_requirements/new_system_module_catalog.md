# Nutrezee New System Module Catalog

Date: 2026-06-09
Phase: Step 2B Old-System-to-New-System Feature Mapping
Scope: docs only

## Purpose

This catalog groups the new Nutrezee system into target modules. It preserves old dashboard business coverage while adding the automation required for WhatsApp intake, kitchen routing, chef tasks, labels, dispatch, analytics, RBAC, audit logs, nutrition/macros, and stronger payment/report workflows.

## Admin

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Admin Operations Home | Central live operating dashboard. | Dashboard cards and shortcuts. | Live KPIs, alerts, exception queues, next-day readiness, role-based widgets. | P0 |
| Staff And Admin Management | Manage internal users and admin users. | Admin Users. | RBAC, departments, kitchen sections, shift assignment, access review. | P0 |
| Customer Service Workspace | Let staff handle customer and WhatsApp-originating work. | Users, Contact Us. | Customer matching, intake queue, support tickets, change requests, exception ownership. | P0 |
| Content Admin | Manage static content and media. | About Us, Why Us, Terms, Return Policy, Gallery, Social Media, Videos. | Versioning, preview, media library, publishing status. | P1 |
| Promotions Admin | Manage coupons, offers, advertisements, cashback. | Coupon Master, Coupon Category, Advertisements / Offer, Cashback. | Promotion rules, wallet ledger, eligibility, usage reporting, audit. | P1 |

## Customer

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Customer Profile | Single profile for identity, phone, addresses, preferences, allergies, and history. | Users. | WhatsApp phone matching, duplicate detection, privacy controls. | P0 |
| Customer Orders | Customer-facing or staff-assisted order history and status. | Order lists. | Order timeline, change requests, delivery status, payment status. | P0 |
| Customer Notifications | Customer communication for confirmations and exceptions. | Push notifications existed but not customer workflow. | Template-based messages through confirmed channels, consent-aware. | P1 |
| Customer Feedback | Capture and review ratings or support messages. | Ratings, Contact Us. | Rating trends, support ownership, issue resolution. | P2 |

## Orders

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| WhatsApp Order Intake | Capture WhatsApp-originating orders into structured drafts. | Not observed. | Source tracking, required fields, incomplete queue, customer matching. | P0 |
| Admin Order Review | Confirm, hold, reject, or correct draft orders. | Pending orders. | Validation blockers, downstream impact preview, audit. | P0 |
| Order Management | Manage active, paused, expired, canceled, and changed orders. | Active, pending, pause, expire, cancel lists. | Full state machine, reason capture, timeline, role-gated actions. | P0 |
| Meal Plan / Subscription Lifecycle | Manage packages, starts, ends, off days, pauses, renewals, expirations. | Packages, active subscriptions, expiration report. | Calendar-aware lifecycle and downstream recalculation. | P0 |
| Order Exceptions | Track missing data, substitutions, failed payments, late prep, failed delivery. | Not unified in old dashboard. | Cross-department exception queue with owner and status. | P0 |

## Kitchen

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Kitchen Section Master | Define kitchen sections/stations. | Not explicit; inferred from business context. | Section capacity, station ownership, active status. | P0 |
| Menu Routing Rules | Map menu items/components to kitchen sections. | Products, ingredients, meal types. | Automatic task generation per section and component. | P0 |
| Chef Assignment | Map chefs to sections by shift/date/time. | Admin users and drivers existed; chef assignment not observed. | Section-scoped chef assignments and workload visibility. | P0 |
| Chef Task App | Show each chef only assigned section tasks. | Not observed. | Task queue, status updates, shortage flags, due times. | P0 |
| Kitchen Planning | Plan daily/tomorrow production and detect shortages. | Pre-Kitchen Meal Check, tomorrow order card. | Production board, shortage exceptions, readiness status. | P0 |

## Packing

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Packing Checklist | Confirm all section tasks are complete per order/box. | Not observed. | Box readiness, missing item alerts, handoff state. | P0 |
| Label Printing | Generate and print box labels. | Not observed; manual business pain point. | Label templates, batch print, QR/barcode support, reprint audit. | P0 |
| Dispatch Handoff | Transfer packed boxes to delivery. | Not explicit. | Driver manifest, scan/check handoff, exception logging. | P0 |

## Delivery

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Driver Management | Manage driver profiles and availability. | Drivers. | Areas, shifts, capacity, vehicle, active status. | P0 |
| Delivery Slot Management | Configure time slots and capacity. | Delivery Time. | Area-specific capacity, cutoff rules, kitchen dependency. | P0 |
| Delivery Method Management | Configure delivery methods. | Delivery Methods. | Pricing/rules if needed, availability, customer-facing options. | P1 |
| Dispatch Board | Assign orders to drivers by area/location/time/capacity. | Orders Driver Wise unstable; AutoAssign route skipped. | Auto-assignment, manual override, map/list view, audit. | P0 |
| Driver App | Give drivers assigned routes and status controls. | Not observed. | Pickup, on-route, delivered, failed, rescheduled statuses. | P0 |

## Finance

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Payment Status | Track payment state on orders. | Order tables and payment reports. | Payment status lifecycle, holds, exceptions, reconciliation. | P0 |
| Payment Review | Review manual/gateway payments. | Confirm Payment route unstable. | Safe review queue with approve/reject/hold and audit. | P0 |
| Refunds And Credits | Manage refunds, wallet credits, and compensation. | Refund flow not observed; cashback existed. | Refund workflow, credit ledger, finance approval. | P1 |
| Cashback / Wallet | Manage customer balance and cashback entries. | Cashback. | Immutable ledger, adjustments, expiry, audit. | P1 |

## Analytics

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Management Analytics | Executive view across business operations. | Dashboard, Report Summary unstable. | Live and historical KPIs for orders, kitchen, delivery, chefs, revenue. | P0 |
| Order Analytics | Analyze intake, status, changes, cancellations, renewals. | Order lists and exports. | Channel, source, cycle time, exception rates. | P0 |
| Kitchen Analytics | Analyze production throughput and chef workload. | Not observed. | Tasks by section, chef, delay, shortage, completion. | P0 |
| Delivery Analytics | Analyze driver load and performance. | Driver records, delivery slots/methods. | Driver capacity, delivery success, delays, area trends. | P0 |
| Finance Analytics | Sales, payment, revenue, customer revenue, expiration. | Monthly, daily, payment, customer revenue, expiration reports. | Reconciliation, accrual model, role-gated exports. | P0 |

## Nutrition

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Ingredient Master | Manage ingredients. | Ingredients. | Nutrition values, allergen links, availability if inventory is used. | P0 |
| Allergen Master | Manage allergens and warnings. | Allergies. | Product/customer warning rules and severity. | P0 |
| Nutrition Facts | Maintain calories, protein, carbs, fat, and nutrition notes. | Not confirmed. | Per item/meal/package macros and customer-facing labels. | P0 |
| Dietary Tags And Programs | Manage diet status, product tags, meal types. | Diet Status, Tags, Meal Types. | Customer restrictions, filters, meal-plan eligibility. | P1 |
| Dietician Requests | Manage dietician appointments and requests. | Dietician Requests. | Privacy-aware workflow, status, notes, follow-up. | P1 |

## Settings

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Business Settings | Configure global business rules. | General/Contact Setting. | Checkout gaps, capacity dates, WhatsApp/contact settings, audit. | P0 |
| Areas And Zones | Configure delivery areas and dispatch zones. | Not explicitly observed. | Area boundaries, serviceability, capacity rules. | P0 |
| Notification Templates | Configure internal/customer messages. | Push Notification. | Templates, channels, previews, approvals, delivery history. | P1 |
| Legal / Policy Content | Manage terms, return policy, legal content. | Terms, Return Policy. | Versioning and effective dates. | P1 |
| Media And Static Content | Manage content pages and assets. | About Us, Why Us, Gallery, Social Media, Videos. | Preview, media reuse, language support. | P2 |

## Security

| Module | Purpose | Old Dashboard Coverage | New Capabilities | Priority |
| --- | --- | --- | --- | --- |
| Authentication | Secure staff/customer/driver access. | Login existed; no logout found. | Explicit logout, session timeout, password policy, MFA if required. | P0 |
| RBAC | Enforce least privilege. | Admin Users only; no RBAC observed. | Role-permission matrix for admin, operations, kitchen, chef, packing, driver, finance, management. | P0 |
| Audit Logs | Trace important actions. | Not observed. | Actor, timestamp, entity, before/after, reason, source. | P0 |
| Data Privacy | Protect customer, payment, and health data. | PII and health data appeared in old tables. | Field-level visibility, export controls, retention policy. | P0 |
| Integration Security | Protect WhatsApp, payment, map, notification, and printer integrations. | Not available in old dashboard audit. | Secret management, webhook validation, retry logs, failure alerts. | P0 |

## Build Principle

The new system should not copy old UI one-to-one. It should preserve old business capabilities, improve weak modules, and add missing automation in the dependency order documented in `docs/step_2b_pm_review_pack.md`.
