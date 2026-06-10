# Phase 2 — Current State Assessment

**Date:** 2026-06-10 · **Status:** Baseline v1.0
Evidence labels: **[V]** verified in read-only audit · **[I]** inferred from UI · **[A]** assumed from pain-point analysis, needs workshop confirmation.

---

## End-to-end current-state workflow map

```
 CUSTOMER                INTAKE STAFF              ADMIN DASHBOARD                KITCHEN                 PACKING               DISPATCH/DRIVER         FINANCE
    │                        │                          │                           │                        │                        │                    │
    │ WhatsApp message [A]   │                          │                           │                        │                        │                    │
    ├───────────────────────►│ read, clarify,           │                           │                        │                        │                    │
    │                        │ re-type details [A]      │                           │                        │                        │                    │
    │                        ├─────────────────────────►│ /orders/create [V]        │                        │                        │                    │
    │                        │                          │ pending → active [V]      │                        │                        │                    │
    │   payment link [V-I]   │◄─────────────────────────┤ payment link gen. [V]     │                        │                        │                    │
    │◄───────────────────────┤                          │                           │                        │                        │                    │
    │                        │                          │ pre-kitchen shortage      │  verbal/paper          │                        │                    │
    │                        │                          │ check [V] ───────────────►│  section coordination  │                        │                    │
    │                        │                          │                           │  & chef tasking [A]    │                        │                    │
    │                        │                          │                           ├───────────────────────►│ manual labels [A]      │                    │
    │                        │                          │                           │                        │ pack from memory [A]   │                    │
    │                        │                          │ /driverOrders UNSTABLE [V]│                        ├───────────────────────►│ manual assignment  │
    │                        │                          │ AutoAssign GET UNSAFE [V] │                        │                        │ [A]                │
    │   delivery [A]         │                          │                           │                        │                        ├───────────────────►│
    │◄───────────────────────┴──────────────────────────┴───────────────────────────┴────────────────────────┴────────────────────────┤                    │
    │                        │                          │                           │                        │     /confirm-payment UNSTABLE [V] ──────────►│ reports [V]
```

No system-recorded handoffs exist between kitchen, packing, and dispatch [A]. No delivered/completed order state was observed [V].

---

## 1. Customer Journey

| Lens | Findings |
|---|---|
| **What exists** | WhatsApp as the primary ordering channel [A]; staff-assisted orders with payment links [V]; subscription packages with start/end, pause, cancel [V]; coupons/cashback [V]; contact-message channel and subscribers list [V]; dietician requests [V]. Customer website/app: existence unconfirmed [V-gap]. |
| **What works well** | Conversational ordering is low-friction for customers; package/subscription model is established; payment links remove cash friction for online payers [I]. |
| **Inefficient** | Customer repeats identity/address/preferences per order [A]; no self-service status visibility [A]. |
| **Manual work** | Every order detail is relayed through a human; change requests and pauses also arrive via chat and are hand-applied [A]. |
| **Delays** | Clarification ping-pong on missing details; confirmation depends on staff availability [A]. |
| **Errors** | Mis-typed addresses/meals; duplicate customer records; missed allergy notes — no systematic allergy check at intake [A]. |

## 2. Order Journey

| Lens | Findings |
|---|---|
| **What exists** | `/orders/create` with customer search, package selection, address, slot/method, notes, paid/gateway fields, "Create Order & Generate Payment Link" [V]. Lifecycle lists: pending, active, pause, expired, canceled + birthday orders [V]. Order fields: number, customer, package, sub-package, dates, transaction ID/date, type, payment status, order status, coupon, amounts [V]. |
| **What works well** | Lifecycle categories match the subscription business; order tables expose payment metadata inline; staff creation flow covers the core fields [V]. |
| **Inefficient** | No draft/incomplete state — an order is either fully entered or doesn't exist [I]; no review/approval step before kitchen/delivery impact [A]. |
| **Manual work** | Validation is human memory; changes/substitutions edited directly with no guard rails [A]. |
| **Delays** | Incomplete intake blocks creation; no queue to park and resume [I]. |
| **Errors** | State machine undocumented — transitions and side effects unknown [V-gap]; no delivered/completed terminal state observed [V]; no audit of who changed what [V-gap]. |

## 3. Operations (Kitchen & Packing) Journey

| Lens | Findings |
|---|---|
| **What exists** | Pre-kitchen meal shortage check by date [V]. Masters: ingredients, allergies, meal types, diet status, tags [V]. Nothing else: no production board, sections, tasks, labels, or packing screens [V-absence]. |
| **What works well** | Shortage check shows date-based production awareness exists; master data gives a vocabulary for routing/nutrition to build on [V]. |
| **Inefficient** | Items treated as whole orders — single-section blockage invisible [A]; chef workload unbalanced and informal [A]. |
| **Manual work** | Section routing, chef assignment, label writing/printing, packing verification, dispatch handoff — all manual [A]. |
| **Delays** | Packing waits on unverifiable kitchen completeness; bottleneck sections discovered late [A]. |
| **Errors** | Wrong/missing items in boxes; label mix-ups; allergy meals not flagged to kitchen [A]. |

## 4. Delivery Journey

| Lens | Findings |
|---|---|
| **What exists** | Driver records [V]; delivery time slots and methods [V]; `/driverOrders` (driver-wise orders) exists but times out [V]; `/orders/AutoAssignMealToDrivers` exposed from a dashboard card, unexercised [V]. Driver app: never observed [V-gap]. |
| **What works well** | Slot/method masters are in place and reusable as dispatch inputs [V]. |
| **Inefficient** | Dispatcher assigns from memory; no area/capacity rules [A]; no readiness link to packing [A]. |
| **Manual work** | Assignment, stop sequencing, status reporting, failed-delivery handling [A]. |
| **Delays** | Overloaded drivers, missed slots [A — ranked pain points 9–10]. |
| **Errors** | No proof-of-delivery or failure reasons captured; accountability gaps between packing and driver [A]. |

## 5. Admin Journey

| Lens | Findings |
|---|---|
| **What exists** | 46 confirmed screens: users/drivers/admin users/dietitians, products, packages, ratings, cashback, coupons (+categories), ads/offers, gallery/videos, master data, slots/methods, settings (WhatsApp contact, checkout gap, full-capacity date), static/legal pages, contact messages, subscribers, social, push notifications, 5 finance reports, dietician requests [V]. |
| **What works well** | Broad back-office coverage; bilingual (EN/AR) master data; report set covers core revenue views [V]. |
| **Inefficient** | "Add New User" ambiguous (staff vs customer) [V]; settings lack validation/scoping [I]; no notification templates/approval/history [V-absence]. |
| **Manual work** | KPI compilation across separate reports [A]; payment confirmation through an unstable screen [V]. |
| **Delays** | `/summary` and tomorrow-orders card time out — daily planning views unreliable [V]. |
| **Errors** | No RBAC/audit: any admin can see/change everything, untraceably [V-absence]; no visible logout [V]; two routes leak SQL/framework exceptions [V]. |

## 6. Support Journey

| Lens | Findings |
|---|---|
| **What exists** | Contact messages module [V]; dietician requests with statuses [V]; push notifications (broadcast) [V]; ratings visibility [V]. |
| **What works well** | Inbound channels are at least centralized for web contact and dietician requests [V]. |
| **Inefficient** | No case/ticket linkage to orders or customers; no SLA or ownership [I]. |
| **Manual work** | Support actions (refunds, credits, reschedules) handled outside any visible workflow [A]. |
| **Delays** | Issues discovered downstream (wrong box, failed delivery) have no escalation path [A]. |
| **Errors** | Compensation untracked — finance leakage risk [A]. |

---

## What must be preserved (regression checklist)

The 50 mapped old screens (Step 2B `old_to_new_feature_map.md`) are the **business-coverage contract**: Preserve 20 · Improve 42-of-73-mapped-items · Replace 6 · Add 5 new capability clusters. No old module may be dropped without an explicit decision in `20_Decisions/`.

## Confidence summary

| Area | Confidence | Basis |
|---|---|---|
| Admin back office | High | 46 screens inventoried [V] |
| Order lifecycle concepts | High | Lists + create form [V]; transitions unknown |
| Finance reports | High | 5 reports loaded [V]; workflows unknown |
| Kitchen/packing reality | Low | One screen [V] + pain points [A] |
| Delivery execution | Low | Masters [V]; assignment/driver reality [A] |
| Customer experience | Low | Never observed; WhatsApp flow [A] |
| Tech internals | None | No source/schema/API access |

Low-confidence areas are workshop agenda items before they may enter workflow or data models (`22_Meeting_Notes/`).
