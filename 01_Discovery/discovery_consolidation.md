# Phase 1 — Discovery Consolidation

**Date:** 2026-06-10 · **Status:** Baseline v1.0
**Inputs consolidated:** Step 0–1 discovery, Step 2A operational context, Step 2B feature mapping, Step 2B.1 coverage verification, Step 2C full admin discovery, Phase 3 module analyses (all in `../nutrezee-step-1-discovery/docs/`).

**Evidence convention used throughout:**
- **Verified** — observed directly in the read-only production audit.
- **Inferred** — strongly implied by UI labels/structure but not exercised.
- **Assumed** — stated by business framing or pain-point analysis; requires stakeholder confirmation.

---

## A. Current State Summary

### Current Situation
- Live production admin dashboard at `https://nutreeze.com/dashboard` (Verified). 50 known routes; 46 confirmed and inventoried, 4 unstable (`/driverOrders`, `/summary`, `/confirm-payment`, `/orders/getTotalOrdersNew/tommorow`), 1 skipped as unsafe (`/orders/AutoAssignMealToDrivers` — action-like GET).
- Business model: meal-plan/package subscriptions with order lifecycle (pending → active → pause → expired/canceled), staff-assisted order creation with payment-link generation (Verified at `/orders/create`).
- Orders originate largely from WhatsApp conversations and are manually transcribed by staff into the admin (Assumed — core pain point; volume and exact handling unconfirmed).
- Kitchen, packing, labeling, and driver assignment are coordinated manually outside the system (Assumed from pain points; only a pre-kitchen shortage check exists in the dashboard — Verified).
- Tech stack, source code, database, APIs, and any customer/driver/kitchen apps were not accessible (Verified absence of access).

### Pain Points
1. Manual WhatsApp transcription → errors, duplicates, missed details (P0 pain #1).
2. Unstructured order data → downstream kitchen/delivery/service failures.
3. Duplicate customer data on each manual entry.
4. Management lacks reliable operational analytics.
5. Multi-section kitchen with no routing, no chef accountability, no itemized tasks.
6. Manual labels → mislabeled boxes, slow packing, no traceability.
7. Manual driver assignment with no capacity enforcement.
8. Unclear kitchen→packing→dispatch handoffs.
9. No RBAC, no audit logs → overbroad access, untraceable changes.
(Full ranked list of 16: `../nutrezee-step-1-discovery/docs/02_requirements/operational_pain_points.md`.)

### Limitations
- Read-only, single-day, production-only discovery; no operations staff interviewed yet.
- No source/schema/staging access → internal behavior, data quality, and integration reality unknown.
- Customer app, driver app, kitchen surfaces never observed; their existence and shape are unconfirmed.
- 4 routes unstable and 1 unsafe — their business value is unknown.

### Opportunities
- The admin dashboard already covers the catalog/order/finance back office — a solid functional baseline to extend rather than reinvent.
- Every manual workflow (intake, kitchen, labels, dispatch) is a high-ROI automation candidate with a clearly described target in the 44-item backlog.
- Security foundation (RBAC/audit) can be introduced with the first new module and immediately reduce existing exposure.

---

## B. Business Objectives

| Lens | Detail |
|---|---|
| **Current situation** | Revenue from meal-plan subscriptions; growth constrained by manual order intake throughput and error-driven rework. Coupons/cashback/offers exist for acquisition and retention (Verified). Management decisions made without timely KPIs (Assumed). |
| **Pain points** | Lost/incorrect orders from manual intake; refund/credit handling invisible; revenue reporting exists but reconciliation does not; customer trust at risk from PII/health-data exposure. |
| **Limitations** | No baseline metrics captured yet (order volume, error rate, intake time) — business case quantification pending workshop. |
| **Opportunities** | Higher intake capacity without headcount; fewer compensation events; defensible data privacy posture; analytics-driven menu and capacity planning. |

**Objectives (proposed, pending sponsor sign-off):**
- BO-1: Increase order intake capacity ≥2× without added intake staff.
- BO-2: Reduce order-error-driven rework and compensation to near zero.
- BO-3: Give management daily reliable revenue/operations KPIs.
- BO-4: Make customer, payment, and health data access least-privilege and auditable.
- BO-5: Preserve 100% of existing business module coverage during modernization (regression checklist = 50 mapped screens).

## C. Operational Objectives

| Lens | Detail |
|---|---|
| **Current situation** | Daily cycle: intake (WhatsApp/manual) → admin order entry → kitchen production (manual coordination) → manual labels/packing → manual driver assignment → delivery. Pre-kitchen shortage check is the only production tooling (Verified). |
| **Pain points** | Pain points 5–13: no section routing, manual chef assignment, whole-order task views, manual labels, unclear handoffs, manual dispatch, no capacity rules. |
| **Limitations** | Kitchen sections, chef shifts, label specs, area definitions, and capacity units are all undocumented — automation cannot be specified until the workshop confirms them. |
| **Opportunities** | Task-level kitchen execution; print-on-event labels; rule-based dispatch; exception management across the whole chain (BR-042). |

**Objectives:** OO-1 structured intake-to-confirmation under a defined SLA; OO-2 every confirmed order decomposed into section tasks with an accountable chef; OO-3 zero hand-written labels; OO-4 dispatch by area/slot/capacity rules with driver-app confirmation; OO-5 every handoff (kitchen→packing→dispatch→customer) recorded.

## D. System Objectives

| Lens | Detail |
|---|---|
| **Current situation** | Server-rendered admin (AdminLTE-style), session login via `/logincheck`, no visible logout, broad admin visibility, two routes leak framework/SQL exceptions (Verified). No staging, CI, tests, or deployment docs found. |
| **Pain points** | Unsafe mutating GET route; unstable payment/driver/summary routes; no audit trail; no RBAC; unknown backup/rollback. |
| **Limitations** | Until source access: cannot patch the old system, cannot assess data quality, cannot confirm integration points. |
| **Opportunities** | New modules built to modern baseline (auth, RBAC, audit, events, adapters) can coexist with the old dashboard and progressively replace its weak surfaces (strangler-fig). |

**Objectives:** SO-1 staging + deploy/rollback pipeline before any production change; SO-2 RBAC with 10 roles + field-level privacy; SO-3 audit log for all sensitive actions (BR-033); SO-4 defined order/payment/delivery event model; SO-5 integration adapters for WhatsApp, gateway, printers, maps, notifications; SO-6 no regression of the 50-screen functional baseline.

## E. Stakeholder Objectives

| Stakeholder | Current situation | Pain points | Limitations | Opportunities / objective |
|---|---|---|---|---|
| Owner/Management | Operates profitably but blind between monthly reports | No live KPIs; error costs invisible | KPI set undefined (DEC-010) | Daily ops/revenue dashboard; scalable growth |
| Customer service / intake staff | Transcribe WhatsApp orders into admin forms | Re-typing, missing fields, duplicate customers | Exact intake fields unconfirmed (DEC-002) | Draft queue with validation; profile reuse |
| Kitchen manager | Coordinates sections verbally/paper | No production board; shortage check only | Sections/shifts undocumented (DEC-006) | Planning board, task routing, throughput stats |
| Chefs | Receive verbal/paper instructions | Whole-order views, unclear ownership | Task statuses unconfirmed | Section-scoped task app |
| Packing staff | Pack from memory/paper; manual labels | Missing items, label errors | Label spec unknown (DEC-007) | Checklist gated on task completion; auto labels |
| Dispatcher | Assigns drivers manually | Overloads, missed slots | Areas/capacity unit unknown (DEC-008) | Dispatch board with rules + overrides |
| Drivers | Receive assignments informally | No stop list, no status capture | Driver app workflows never observed | Driver app: stops, statuses, failure reasons |
| Finance | Uses sales/revenue reports (Verified); confirm-payment unstable | No refund workflow, no reconciliation | Gateway internals unknown (DEC-009) | Payment review queue, audited finance actions |
| Dietician/nutrition | Dietician requests module exists (Verified) | No macros, no allergen enforcement | Required nutrition fields unconfirmed | Nutrition facts + allergy flags in order/kitchen flow |
| Customers | Order via WhatsApp; subscriptions managed by staff | Repetition of details; no status visibility | Customer-facing surfaces never audited | Confirmations and delivery notifications (BR-035) |
| IT/system admin | Maintains production; no staging visible | No audit, no logout, leaked exceptions | Old-system ownership unclear | Staging, RBAC admin, audit tooling |

---

## Consolidated requirement base

The validated backlog remains **BR-001 … BR-044** (34 P0 / 10 P1) in `../nutrezee-step-1-discovery/docs/02_requirements/business_requirements_backlog.md`. This consolidation does not change requirement content; it re-anchors them to the **extend-not-replace** mandate (see DEC-001 in `20_Decisions/`).

## Open items carried forward

- 22 stakeholder questions (Step 2B.1 pack) → workshop agenda, `22_Meeting_Notes/`.
- 12 access requests (Step 2C pack) → Phase 0 gate, `19_Roadmap/`.
- 12 key decisions → `20_Decisions/` register (DEC-001 … DEC-012).
