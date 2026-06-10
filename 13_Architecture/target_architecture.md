# Phase 2B — Target Architecture (10 Layers)

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (layer responsibilities) / Proposed (anything gated on open DECs)
Strategy: strangler-fig beside the live legacy dashboard (ADR-001/002). Layers are logical; physical packaging (services vs modular monolith) is a Phase 3 decision under DEC-011.

## Layer overview

```
            ┌─────────────────────────────── 10. FUTURE AI LAYER (Phase 5; consumes events/history only) ──────────────────────────────┐
            │                                                                                                                          │
┌───────────▼───────────┐   ┌────────────────────────┐   ┌──────────────────────┐   ┌─────────────────────┐   ┌──────────────────────┐
│ 1. CUSTOMER/ORDER     │   │ 2. ADMIN/OPERATIONS    │   │ 4. KITCHEN ROUTING   │   │ 5. DELIVERY/DRIVER  │   │ 7. REPORTING         │
│    ENTRY              │──►│    (review, correct,   │──►│    (tickets, board)  │──►│    (dispatch, app)  │   │    (projections)     │
│ (intake forms,        │   │     approve, manage)   │   └──────────┬───────────┘   └──────────┬──────────┘   └──────────▲───────────┘
│  WhatsApp capture)    │   └──────────┬─────────────┘              │                          │                         │ events
└───────────┬───────────┘              │                            │                          │                         │
            │              ┌───────────▼────────────────────────────▼──────────────────────────▼───────────┐  ┌─────────┴───────────┐
            └─────────────►│ 3. ORDER MANAGEMENT LAYER — order/plan lifecycle, fulfillment days, payments  │─►│ 6. NOTIFICATION      │
                           │    state machines, exceptions (THE HUB — emits all domain events)             │  │    (templates, log)  │
                           └───────────────────────────────────┬───────────────────────────────────────────┘  └──────────────────────┘
                                                               │ every write
┌──────────────────────────────────────────────────────────────▼──────────────────────────────────────────────────────────────────────┐
│ 8. AUDIT / SECURITY LAYER — authn, RBAC, field-visibility classes, immutable audit log, session mgmt (wraps ALL layers above)        │
└──────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────▼──────────────────────────────────────────────────────────────────────┐
│ 9. INTEGRATION LAYER — adapters: Legacy Bridge · WhatsApp · Payment links · Push/SMS/Email · Maps (future) · Export                  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1 — Customer / Order Entry Layer

| Aspect | Definition |
|---|---|
| Responsibility | Capture order intent into structured **Draft Orders**, whatever the channel: WhatsApp-relayed [A — primary channel], phone, walk-in, staff-assisted. Enforce field structure at the point of entry (closes GAP-AUT-01, GAP-DQ-03). |
| Users | Order Agents, WhatsApp Agents [NC whether distinct people], Operations Manager |
| Main workflows | WF-01 Manual intake, WF-02 WhatsApp intake (manual-assisted MVP, API-assisted future per DEC-002) |
| Main data | DraftOrder, WhatsAppMessage reference (BR-002), customer match candidates, requested items/plan, requested slots/address |
| Dependencies | Customer Mgmt (profile match), Product/Menu (valid items), System Settings (slots/areas), RBAC |
| Risks | Agents bypass under load (R9) — entry must be faster than old `/orders/create`; channel assumptions unvalidated (R3) |
| Inside | Draft capture, validation, incomplete queue (BR-003), customer matching UI, message-reference attachment |
| Stays outside | Customer self-service ordering (no customer surface verified [NC]); WhatsApp Business API transport (Integration layer); pricing rules (Product layer); approval (layer 2) |

## Layer 2 — Admin / Operations Layer

| Aspect | Definition |
|---|---|
| Responsibility | Human control plane: review queue, approve/reject/correct drafts (BR-004/005), order corrections, exception handling (BR-042), staff/admin management, settings administration |
| Users | Operations Manager, Order Agents (limited), Super Admin, Admin |
| Main workflows | WF-03 review, WF-04 approve, WF-05 reject, WF-06 edit-before-approval, WF-15 admin correction |
| Main data | ReviewDecision, correction records, exception cases, staff accounts |
| Dependencies | Order Management (state machine), RBAC (approval rights), Audit (every action) |
| Risks | Review becomes a bottleneck — SLA monitoring required (OO-1); over-broad correction powers — bounded by RBAC + audit |
| Inside | Queues, decisions, corrections, staff admin UI |
| Stays outside | Direct DB edits (never); kitchen/dispatch operations (layers 4/5); legacy dashboard administration (stays legacy until retirement) |

## Layer 3 — Order Management Layer (the hub)

| Aspect | Definition |
|---|---|
| Responsibility | Own the canonical order model: **Plan-level lifecycle** (subscription/one-off) and **Fulfillment-Day lifecycle** (daily production/delivery units) — see `order_lifecycle_status_model.md`; payment attribute machine; delivery calendar generation (BR-036); change propagation (BR-037, GAP-OM-03); emits every order/payment/fulfillment event |
| Users | Indirect — all roles act through layers 1/2/4/5 |
| Main data | Order, OrderItem, FulfillmentDay, OrderStatusHistory, PaymentRecord, PlanCalendar, Exception |
| Dependencies | Customer, Product, Settings; Audit/Security wraps it |
| Risks | State machine is Proposed until DEC-005 — transitions configurable, terminal semantics (Expired vs Completed) flagged [NC]; event contract churn ripples everywhere — version events from v1 |
| Inside | State machines, transition validation, calendar/fulfillment generation, event emission |
| Stays outside | UI; kitchen task detail (layer 4 derives tickets from events); reporting aggregates (layer 7) |

## Layer 4 — Kitchen Routing Layer

| Aspect | Definition |
|---|---|
| Responsibility | Decompose each FulfillmentDay into **Kitchen Tickets** per section using routing rules from catalog metadata (BR-009…011, GAP-OPS-01); kitchen board with status updates; shortage/substitution escalation (BR-015). MVP = ticket generation + single shared board; full chef PWA + chef-shift assignment (BR-012/013) = migration Phase 3+ |
| Users | Kitchen User (MVP); Kitchen Manager/Chef split later [NC — sections/shifts DEC-006] |
| Main workflows | WF-07 kitchen routing, WF-08 preparation |
| Main data | KitchenTicket, RoutingRule (settings data), section statuses, escalations |
| Dependencies | Order Mgmt events (approved fulfillment days), Product routing metadata, Settings (SectionMaster) |
| Risks | Routing rules unknown until workshop (R8) — rules are data, editable by Kitchen Manager, never code (ADR-006); adoption (R9) — pilot one section |
| Inside | Ticket generation, board, status capture, escalation |
| Stays outside | Labels/packing (separate module, post-MVP, DEC-007); inventory (BR-040, Future Candidate); recipe management (not evidenced) |

## Layer 5 — Delivery / Driver Layer

| Aspect | Definition |
|---|---|
| Responsibility | Dispatch board (readiness-filtered assignment by area/slot/capacity per DEC-008), driver records/availability, driver app statuses, failure/reschedule handling (BR-020…024). Designed now, **built in migration Phase 4** — not MVP |
| Users | Fleet Supervisor/Dispatcher, Drivers, Operations Manager |
| Main workflows | WF-09 driver assignment, WF-10 out-for-delivery, WF-11 delivered |
| Main data | DriverAssignment, Driver, DeliveryEvent, Area/Slot/Capacity rules |
| Dependencies | Order Mgmt (READY_FOR_DISPATCH events), Settings (areas/slots), RBAC, Notification |
| Risks | Capacity unit and areas undefined (DEC-008) [NC]; replaces legacy unsafe auto-assign + dead `/driverOrders` [V] — assignment is always human-confirmed in v1, rule-suggested only |
| Inside | Assignment, manifests, status capture, failure reasons |
| Stays outside | Route optimization (ENH-F-08, AI layer); vehicle/fuel/fleet maintenance (not order-flow); payroll |

## Layer 6 — Notification Layer

| Aspect | Definition |
|---|---|
| Responsibility | Template-based internal alerts (incomplete drafts aging, kitchen escalations, dispatch issues — BR-034) and customer messages (confirmation, delivery status — BR-035) with delivery history (GAP-NOT-01…03). MVP = internal alerts only |
| Users | All staff (recipients); Admin (template management) |
| Main data | Template, NotificationLog |
| Dependencies | Order/kitchen/dispatch events; provider adapters (Integration layer); RBAC (who manages templates) |
| Risks | Customer-facing messages need channel decision (WhatsApp template approval rules) [NC, DEC-002] |
| Inside | Template render, routing to channel adapter, history |
| Stays outside | Channel transport (adapters); marketing campaigns/push broadcasts (legacy keeps until migration Phase 5) |

## Layer 7 — Reporting Layer

| Aspect | Definition |
|---|---|
| Responsibility | Read-side projections from the event stream. MVP: intake/ops minimal reports. Parity contract: the 5 legacy finance reports [V] reproduced before legacy reports retire (migration Phase 5). Full analytics = ENH-F-01, DEC-010 |
| Users | Report Viewer (management), Finance Viewer, Operations Manager |
| Main data | Projections/aggregates only — never a write dependency (domain map rule 5) |
| Dependencies | Event stream from layers 3/4/5; RBAC for report access (BR-031) |
| Risks | KPI scope creep — locked at gate G3; reconciliation with legacy reports during overlap (legacy_transition §6) |
| Inside | Projections, exports with access logging (GAP-AUD-03) |
| Stays outside | Operational queries used by workflows (those belong to their layer); BI tooling choice (Phase 3, DEC-011) |

## Layer 8 — Audit / Security Layer (foundation — built first)

| Aspect | Definition |
|---|---|
| Responsibility | Authentication + session management (logout, timeout — fixing legacy GAP-SEC-04 pattern), RBAC enforcement (12 roles, `rbac_architecture.md`), field-visibility classes (PII/HEALTH/PAYMENT — BR-043), immutable audit log of all writes + sensitive reads (`audit_architecture.md`, BR-033, GAP-AUD-01) |
| Users | All (enforcement); Super Admin (role admin); auditors |
| Main data | StaffUser, Role, Permission, AuditEvent, Session |
| Dependencies | None downstream (root layer) |
| Risks | Over-restrictive day one blocks operations — enforcement modes: log-only → warn → deny rollout per role |
| Inside | Authn/z, audit write path, visibility masking, role admin |
| Stays outside | Legacy dashboard auth (untouched, isolated); customer auth (no customer surface in scope [NC]) |

## Layer 9 — Integration Layer

| Aspect | Definition |
|---|---|
| Responsibility | All external touchpoints behind adapters with explicit contracts (`integration_boundaries.md`): **Legacy Bridge** (ADR-008), WhatsApp, payment links, notification providers, maps (future), exports |
| Users | None directly — system-to-system |
| Main data | Contract DTOs, sync/reconciliation records, adapter health |
| Dependencies | Target module per adapter; secrets management (GAP-SEC-05) |
| Risks | Legacy internals may stay inaccessible (R2) — every adapter has a degraded manual mode; gateway internals unknown [NC] |
| Inside | Adapters, retries, dead-letter handling, contract versioning |
| Stays outside | Business logic (never in adapters); Odoo/ERP/HR — explicitly out of scope unless it touches order flow (none evidenced) |

## Layer 10 — Future AI Layer (Phase 5 — design constraint only today)

| Aspect | Definition |
|---|---|
| Responsibility | Later: intake parsing assist (ENH-F-06), demand forecasting (F-07), dispatch optimization (F-08), nutrition copilot (F-09). **Today's only architectural obligation:** layers 3–5 emit versioned, timestamped events and retain history (GAP-AI-01); WhatsApp message text stored with consent flag when API arrives (GAP-AI-02) |
| Users | Staff (AI proposes, human approves — allergy-relevant decisions always human-confirmed) |
| Dependencies | ≥3 months event history; data-quality metrics green (gate G4) |
| Inside (future) | Suggestion services with evaluation harnesses (`18_AI_Features/`) |
| Stays outside | Any autonomous state change; any MVP commitment |

---

## Technology guardrails (stack-agnostic until DEC-011)

1. No state mutation on GET — hard rule born from legacy GAP-SEC-02 [V].
2. Single write path per entity through its owning module (data_ownership_blueprint).
3. Events are append-only and versioned; consumers tolerate unknown fields.
4. All operational vocabulary (sections, areas, slots, capacities, templates, transition gates) is configuration editable by business owners — nothing hard-coded (response to R3/R8).
5. Bilingual EN/AR from the first entity (legacy parity [V]); RTL-ready UI standards deferred to `12_UI_UX/`.
6. PWA-first for shop-floor surfaces (kitchen board, later chef/driver apps) — low-end device tolerant.
7. Audit write is part of the transaction, not best-effort.
