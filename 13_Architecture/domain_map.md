# Phase 5 — Order System Domain Map

**Date:** 2026-06-10 · **Status:** Baseline v1.0
Scope: logical domains for the future-state system, grounded in the 51-module catalog (`../nutrezee-step-1-discovery/docs/02_requirements/new_system_module_catalog.md`) and the verified old-system coverage. This is a **domain** map, not a deployment diagram — service boundaries are decided in architecture work after DEC-001/DEC-011.

## Context diagram

```
                                  ┌──────────────────────────── EXTERNAL ────────────────────────────┐
                                  │  WhatsApp Business API   Payment Gateway   Maps/Geo   Printers   │
                                  │  Push/SMS/Email provider                                          │
                                  └────────────┬────────────────────┬──────────────┬─────────┬───────┘
                                               │ adapters (14_Integrations)        │         │
┌──────────────┐   draft    ┌──────────────────▼──────────┐  payment events  ┌─────▼─────────▼──────┐
│  CUSTOMERS   │◄──────────►│           ORDERS            │◄────────────────►│       PAYMENTS        │
│ profile/dedup│  identity  │ intake → review → lifecycle │                  │ status/review/refunds │
└──────┬───────┘            └───────┬─────────────┬───────┘                  └───────────┬──────────┘
       │ allergies/prefs            │ confirmed   │ status events                        │
┌──────▼───────┐  routing   ┌───────▼──────┐      │                            ┌─────────▼──────────┐
│   PRODUCTS   ├───────────►│  OPERATIONS  │      │                            │      REPORTS &     │
│ catalog/nutr.│  metadata  │ kitchen tasks│      │                            │      ANALYTICS     │◄── events from all domains
└──────────────┘            │ packing/label│      │                            └────────────────────┘
                            └───────┬──────┘      │
                                    │ packed/ready│                            ┌────────────────────┐
                            ┌───────▼──────────┐  │                            │ CROSS-CUTTING      │
                            │     DELIVERY     │◄─┘                            │ Administration     │
                            │ dispatch/drivers │── delivered/failed ──► ORDERS │ Support            │
                            └──────────────────┘                              │ Notifications      │
                                                                               │ Promotions         │
                                                                               │ Audit Logs        │
                                                                               │ System Settings   │
                                                                               └────────────────────┘
```

## Domain register

| # | Domain | Responsibilities | Key entities | Depends on | Consumed by | Ownership (business) | State today |
|---|---|---|---|---|---|---|---|
| 1 | **Customers** | Identity (phone-keyed, DEC-004), profiles, address book, preferences, allergies, history, dedup | Customer, Address, Preference, AllergyLink | System Settings (areas) | Orders, Delivery, Notifications, Support, Analytics | Customer Service | Flat user list, duplicates [V] |
| 2 | **Orders** | Intake drafts, review/confirmation, lifecycle states & transitions, change requests, meal-plan/subscription calendar, exceptions | Order, DraftOrder, OrderItem, PlanCalendar, ChangeRequest, Exception | Customers, Products, Payments (status), System Settings | Operations, Delivery, Payments, Analytics, Notifications | Operations Manager | Lifecycle lists + create form [V]; no draft/review |
| 3 | **Products** | Menu items, packages/meal plans, pricing, availability, bilingual content, nutrition facts, allergens, kitchen-routing metadata | Product, Package, Component, NutritionFacts, Allergen, RoutingRule | System Settings (sections vocab) | Orders, Operations, Nutrition surfaces, Analytics | Product/Nutrition team | Catalog masters [V]; no macros/routing |
| 4 | **Cart** | Customer-side selection state before checkout. **Status: hypothetical** — no customer app was observed; for WhatsApp-first flow the "cart" is the draft order | (CartItem → DraftOrder) | Products, Customers | Checkout | TBD after customer-surface discovery | Unverified [gap] |
| 5 | **Checkout** | Conversion of draft/cart to confirmed order: validation, slot selection, coupon application, payment initiation. In current operation this is the **admin review step**, not a customer screen | CheckoutSession → Order | Cart/Orders, Promotions, Payments, Delivery (slots) | Orders | Operations | `/orders/create` is the staff checkout [V] |
| 6 | **Payments** | Payment status lifecycle, payment links, gateway reconciliation, review queue, refunds/credits, cashback/wallet ledger | Payment, PaymentReview, Refund, WalletEntry | Orders; Gateway adapter | Orders, Reports, Audit | Finance | Status fields + link gen [V]; confirm screen unstable |
| 7 | **Order Status** | Canonical state machine (DEC-005): draft → pending → confirmed/active → in-production → packed → dispatched → delivered/failed → completed; pause/expire/cancel branches; emits events | OrderStatusEvent | Orders | Tracking, Operations, Delivery, Notifications, Analytics | Operations | Partial states, no terminal delivered [V] |
| 8 | **Order Tracking** | Status visibility per audience (staff timeline; customer notifications; management aggregates) | TrackingView (projection) | Order Status events | Customers, Support, Notifications | Customer Service | Absent [gap] |
| 9 | **Delivery** | Areas/zones, slots, methods, dispatch board, manifests, handoff records, failure/reschedule handling | Area, Slot, Manifest, DispatchAssignment | Orders (packed), Drivers, System Settings | Order Status, Analytics | Dispatch Lead | Slot/method masters [V]; dispatch manual |
| 10 | **Drivers** | Driver profiles, availability, capacity (unit per DEC-008), driver app sessions, performance data | Driver, Shift, CapacityRule, StopStatus | Delivery, RBAC | Delivery, Analytics | Dispatch Lead | Driver records [V]; no app/capacity |
| 11 | **Notifications** | Templates, approvals, dispatch of internal alerts and customer messages (WhatsApp/push/SMS/email), delivery history | Template, NotificationLog | Order Status, Exceptions; provider adapters | All ops roles, Customers | Operations + Marketing | Raw push send [V]; no templates/history |
| 12 | **Promotions** | Coupons, coupon categories, offers/ads, cashback campaigns | Coupon, Campaign | Products, Orders (redemption) | Checkout, Finance, Analytics | Marketing | Working modules [V] — Preserve class |
| 13 | **Reports** | Operational/finance reports (monthly/daily/by-method/customer revenue/expiration), exports with RBAC | ReportDefinition, Export | Analytics store, RBAC | Finance, Management | Finance | 5 reports [V]; summary route unstable |
| 14 | **Administration** | Staff/admin account management, role assignment, content/media/legal pages, operations home | StaffUser, RoleAssignment, ContentPage | RBAC, Audit | All internal | System Admin | Admin users + content [V]; no RBAC |
| 15 | **Support** | Contact messages, dietician requests, order-linked cases, compensation requests, SLA | Case, DieticianRequest | Customers, Orders, Notifications | Customer Service, Dieticians | Customer Service | Contact + dietician modules [V]; unlinked |
| 16 | **Audit Logs** | Immutable event capture for order/payment/kitchen/dispatch/settings/permission changes; sensitive-data access logging; export trail | AuditEvent | Every domain (writes); RBAC (read) | Compliance, Management, Finance | System Admin | Absent [V] — Critical gap |
| 17 | **System Settings** | Business config: areas, slots, sections, capacities, label specs, notification templates, business rules, feature flags | Setting, SectionMaster, LabelSpec | — (root dependency) | Every domain | Operations + System Admin | Flat settings page [V]; unvalidated |

## Dependency rules

1. **System Settings, Administration (RBAC), and Audit Logs are root domains** — every other domain depends on them; they depend on nothing downstream. Build first (Phase 0/1).
2. **Customers and Products are the data backbone** — Orders cannot be structured without both. Build/clean second (Phase 1).
3. **Orders is the hub.** Operations, Delivery, Payments, Tracking, and Analytics all key off order events. The Order Status event model (domain 7) is the contract to design most carefully — changes there ripple everywhere.
4. **Cart/Checkout are provisional domains.** Until the customer-facing surface is discovered (or DEC-002 commits to WhatsApp-only intake), they fold into Orders as DraftOrder + Review. Do not build standalone cart infrastructure on assumption.
5. **Reports/Analytics are read-side projections** — they must never be a write dependency for any operational flow.
6. **All external integrations live behind adapters** (WhatsApp, gateway, printers, maps, notification providers) owned by the domain that uses them; contracts documented in `14_Integrations/`.

## Ownership model (RACI seed)

| Domain cluster | Accountable | Responsible (day-to-day) | Consulted |
|---|---|---|---|
| Customers, Support, Tracking | Ops Manager | Customer Service Lead | Dietician |
| Orders, Order Status, Checkout | Ops Manager | Order/Intake Lead | Finance, Kitchen |
| Products, Nutrition | Product/Nutrition Lead | Catalog Admin | Kitchen Manager |
| Operations (kitchen/packing/labels) | Kitchen Manager | Section Chefs, Packing Lead | Ops Manager |
| Delivery, Drivers | Dispatch Lead | Dispatcher | Ops Manager |
| Payments, Promotions, Reports | Finance Lead | Finance Staff | Management |
| Administration, Audit, Settings, Notifications | System Admin | PM/Tech Lead | All |

Named individuals to be filled in at the verification workshop → `09_Roles_and_Permissions/`.
