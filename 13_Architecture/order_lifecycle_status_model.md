# Phase 2E — Order Lifecycle & Status Model

**Date:** 2026-06-11 · **Status:** **Proposed** — becomes Baselined only after workshop session 2 closes DEC-005. This file is the contract every workflow, module, and report references.

## Core design decision: two-level lifecycle

The legacy system manages subscription **plans** (active/pending/pause/expired/cancelled lists [V]) while daily production and delivery happen outside it [A]. A single flat status list cannot represent "an active 30-day plan whose Tuesday box failed delivery." Therefore (consistent with BR-036/037 and GAP-OM-02):

- **Level 1 — Order (Plan):** the commercial agreement (one-off order or subscription package with calendar).
- **Level 2 — FulfillmentDay:** one customer-day of production+delivery, generated from the plan calendar. The prompt's statuses "Sent to Kitchen … Delivered" live here.
- **Parallel — Payment machine:** payment is an attribute of the Order, never an order status (keeps DEC-009 configurable).

```
ORDER (plan)        DRAFT ─► PENDING_REVIEW ─► APPROVED ─► ACTIVE ─► COMPLETED
                      │            │              │          │  ▲        
                      ▼            ▼              ▼          ▼  │        
                  CANCELLED    REJECTED       CANCELLED   PAUSED─┘   (EXPIRED: legacy-parity end-by-date [NC])
                                                             │
                                                             ▼
                                                         CANCELLED

FULFILLMENT DAY     SCHEDULED ─► KITCHEN_QUEUED ─► IN_PREPARATION ─► READY_TO_PACK ─► PACKED
                        │                                                               │
                        ▼                                                               ▼
                     SKIPPED                                          ASSIGNED_TO_DRIVER ─► OUT_FOR_DELIVERY ─► DELIVERED
                  (off-day/pause)                                              │                    │
                                                                               ▼                    ▼
                                                                          CANCELLED_DAY          FAILED ─► RESCHEDULED (new day)

PAYMENT (attribute) UNPAID ─► LINK_SENT ─► PAID          COD_PENDING ─► COLLECTED
                        │         │          │
                        └────► FAILED    REFUND_REQUESTED ─► REFUNDED
```

## Level 1 — Order (Plan) statuses

| Status | Meaning | Moved in by | Moved out by | Next allowed | Blocked transitions | Required validation | Notification | Audit event |
|---|---|---|---|---|---|---|---|---|
| DRAFT | Intake in progress; incomplete fields allowed (BR-003) | Order Agent, WhatsApp Agent (create) | Same + auto-expiry [NC: retention period] | PENDING_REVIEW, CANCELLED | → APPROVED directly (review is mandatory, GAP-OM-01) | Customer matched-or-flagged; channel + message ref if WhatsApp (BR-002) | Internal: aging-draft alert | order.draft_created / order.edited |
| PENDING_REVIEW | Complete enough; awaiting decision (BR-004) | Order Agent (submit) | Ops Manager (decide); Agent (recall→DRAFT) | APPROVED, REJECTED, DRAFT (recall/correction) | → ACTIVE directly | All mandatory fields; allergy check against profile (BR-039); price/coupon computed | Internal: review queue | order.submitted |
| APPROVED | Confirmed; calendar of FulfillmentDays generated; awaiting start/payment gate | Ops Manager | System (start date / payment per DEC-009); Ops Manager (cancel) | ACTIVE, CANCELLED | → DRAFT (corrections now formal change requests, WF-15) | Payment gate if configured [NC DEC-009]; delivery slot capacity check | Customer: confirmation (BR-035, when channel approved) | order.approved |
| ACTIVE | Fulfillment under way | System (first day reached) | System / Ops Manager | PAUSED, COMPLETED, CANCELLED, (EXPIRED [NC]) | → REJECTED | At least one FulfillmentDay scheduled | — | order.status_changed |
| PAUSED | Customer pause (BR-036); future days → SKIPPED while paused | Ops Manager (customer request) | Ops Manager (resume) | ACTIVE, CANCELLED, EXPIRED [NC] | Pause of COMPLETED/CANCELLED | Pause window rules [NC workshop]; kitchen cutoff respected for same-day | Customer: pause confirm | order.status_changed |
| COMPLETED | **New terminal state** (closes GAP-OM-02): all non-skipped days DELIVERED | System only | — terminal | — | Manual entry by any role | All days terminal | Customer: plan-complete / renewal prompt (BR-036) | order.status_changed |
| EXPIRED | Legacy-parity: end date passed with plan not completed/cancelled [V legacy concept]. **[NC]** — workshop decides merge into COMPLETED/CANCELLED or keep | System | Ops Manager (reactivate? [NC]) | — (proposed terminal) | — | — | Renewal prompt | order.status_changed |
| CANCELLED | Terminated before completion; remaining days → CANCELLED_DAY; refund per DEC-009 [NC] | Ops Manager (Agent may request) | — terminal | — | Cancel of COMPLETED | Reason code mandatory; refund decision recorded | Customer: cancellation | order.cancelled |
| REJECTED | Review declined; terminal; clone-to-new-draft allowed | Ops Manager | — terminal | — | Reuse of rejected order | Reason code mandatory | Agent notified | order.rejected |

## Level 2 — FulfillmentDay statuses

| Status | Meaning | In by | Out by | Next allowed | Validation | Notification | Audit |
|---|---|---|---|---|---|---|---|
| SCHEDULED | Generated from plan calendar | System (on approve / change-propagation BR-037) | System at kitchen-cutoff | KITCHEN_QUEUED, SKIPPED, CANCELLED_DAY | Date within plan; not an off-day | — | fulfillment.created |
| KITCHEN_QUEUED | Kitchen Tickets generated per section (WF-07) | System at cutoff [NC: cutoff time, workshop] | Kitchen User | IN_PREPARATION, CANCELLED_DAY | Routing rules exist for all items (else exception WF-07-E) | Internal: kitchen day-list | kitchen.ticket_generated |
| IN_PREPARATION | ≥1 section ticket started | Kitchen User | Kitchen User | READY_TO_PACK, CANCELLED_DAY | — | — | fulfillment.status_changed |
| READY_TO_PACK | All section tickets done | System (last ticket) / Kitchen User override | Packing (MVP: Kitchen User) | PACKED | All tickets terminal; shortage escalations resolved | Internal: packing alert | fulfillment.status_changed |
| PACKED | Box(es) closed; (labels — post-MVP, DEC-007) | Packing/Kitchen User | Dispatcher | ASSIGNED_TO_DRIVER | — | Internal: dispatch readiness | fulfillment.status_changed |
| ASSIGNED_TO_DRIVER | On a driver manifest (WF-09; migration Phase 4) | Fleet Supervisor (rule-suggested, human-confirmed) | Driver / Fleet Supervisor | OUT_FOR_DELIVERY, PACKED (unassign) | Capacity rule per DEC-008 [NC]; driver available | Driver notified | dispatch.assigned |
| OUT_FOR_DELIVERY | Driver departed | Driver | Driver | DELIVERED, FAILED | — | Customer: out-for-delivery (BR-035) | fulfillment.status_changed |
| DELIVERED | Confirmed handover — **first system-recorded terminal delivery state [closes GAP-OM-02]** | Driver (Fleet Supervisor override, audited) | — terminal | — | Timestamp; optional proof [NC] | Customer: delivered | fulfillment.status_changed |
| FAILED | Attempt failed; reason mandatory (BR-024) | Driver | Fleet Supervisor / Ops Manager | RESCHEDULED, CANCELLED_DAY | Reason code | Internal: exception (WF-14 feed) | fulfillment.status_changed |
| RESCHEDULED | New FulfillmentDay created, linked to failed one | Fleet Supervisor / Ops Manager | — (this day terminal; new day SCHEDULED) | — | New date valid; plan still ACTIVE | Customer: reschedule | fulfillment.status_changed |
| SKIPPED | Off-day or pause window | System | — terminal | — | — | — | fulfillment.status_changed |
| CANCELLED_DAY | Day cancelled (plan cancel or per-day cancel) | System / Ops Manager | — terminal | — | Kitchen cutoff: after KITCHEN_QUEUED requires Ops Manager + reason (food already in production) | Internal | fulfillment.status_changed |

## Payment machine (Order attribute)

| Status | Meaning | Set by | Notes |
|---|---|---|---|
| UNPAID | Default | System | |
| LINK_SENT | Payment link issued (legacy parity: `/orders/create` generates links [V]) | Order Agent/System | MVP: link generated in legacy or gateway portal, recorded here [NC gateway access] |
| PAID | Confirmed via Payment Review queue (ENH-1-05) | Finance role via review; never auto in MVP | payment.status_changed audit, before/after |
| FAILED | Link/gateway failure | Finance/System | Feeds WF-13 |
| COD_PENDING / COLLECTED | Cash on delivery [NC — methods, DEC-009] | Driver→Finance confirm | Two-step: driver reports, finance confirms |
| REFUND_REQUESTED → REFUNDED | Refund workflow (BR-030) [NC — refunds may not exist today, workshop Q20] | Ops request → Finance approve | Post-MVP unless workshop says refunds exist |

**Configurable gate (DEC-009):** `require_payment_before = APPROVED→ACTIVE | KITCHEN_QUEUED | none` — shipped as a System Setting, default `none` + warning flag, so finance policy is config, not redeploy.

## Transition rules (enforced by Order Management layer)

1. Every transition: allowed-roles check (RBAC matrix) + validation + OrderStatusHistory row + audit event in one transaction.
2. No status skipping; corrections move backward only via defined recall/change-request paths — never silent edits (GAP-AUD-01).
3. Plan cancel/pause cascades to future FulfillmentDays atomically (BR-037); past days untouched.
4. All timestamps UTC + local display; cutoff times are Settings.
5. Legacy mapping for coexistence: legacy `pending→PENDING_REVIEW-equivalent`, `active→ACTIVE`, `pause→PAUSED`, `expired→EXPIRED`, `cancel→CANCELLED` [V mapping basis] — used by Legacy Bridge reconciliation only, never to drive new-system transitions.

## Open items for workshop (blocks Baselining)

| # | Question | Affects |
|---|---|---|
| 1 | Keep EXPIRED or fold into COMPLETED/CANCELLED? | Plan machine, reports parity |
| 2 | Kitchen cutoff time(s); same-day change rules | KITCHEN_QUEUED trigger, WF-15 |
| 3 | Payment gate position (DEC-009) | APPROVED→ACTIVE |
| 4 | Proof-of-delivery requirement | DELIVERED validation |
| 5 | Draft retention/auto-expiry period | DRAFT |
| 6 | Refunds existence & rules (Q20) | Payment machine, WF-13 |
