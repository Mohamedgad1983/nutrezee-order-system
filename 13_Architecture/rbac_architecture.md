# Phase 2F — Security / RBAC Architecture

**Date:** 2026-06-11 · **Status:** Proposed — matrix requires workshop session 8 sign-off (who sees customer/health/payment/driver data — BR-043, workshop Q22)
Closes GAP-SEC-01 (Critical). Enforced by M13; every grant change audited (rbac.* events, M14). Roles ship with staged enforcement: **log-only → warn → deny** per role to avoid blocking live operations (R9).

## Design principles

1. **Least privilege by default** — a role gets nothing unless listed.
2. **Field-visibility classes** orthogonal to module access: **PII** (name, phone, address, DOB), **HEALTH** (allergies, diet status, dietician data), **PAYMENT** (transactions, amounts, refs). A role may see an order without seeing the customer's full PII/HEALTH/PAYMENT panels (masked rendering).
3. **Approval rights are explicit grants**, not implied by module access.
4. **Sensitive reads are logged** (PII/HEALTH/PAYMENT panel opens, exports — GAP-AUD-03).
5. **No shared "admin sees all" account** — the legacy pattern [V] is the anti-goal.

## Role evaluation (12 roles assessed)

| Role | Verdict | Rationale |
|---|---|---|
| Super Admin | **MVP** (≤2 people) | RBAC/settings/audit administration; emergency override (always audited) |
| Admin (System Admin) | **MVP** | Staff accounts, non-financial settings; NO order approval, NO payment confirm |
| Operations Manager | **MVP** | Order approval authority, corrections, exceptions, overrides |
| Order Agent | **MVP** | Intake + drafts + change requests; maps to BR-032 "customer service" |
| WhatsApp Agent | **Fold into Order Agent for MVP** [NC] | No evidence of separate staffing; keep as separate role definition, dormant, if workshop confirms split |
| Kitchen User | **MVP** (single role) | Board + ticket statuses + escalations; Kitchen Manager / Chef split at migration Phase 3 with chef-shift assignment (BR-012/013) |
| Branch Manager | **Dormant [NC]** | No branch/multi-site evidence in discovery [V-absence]; defined but unassigned until workshop |
| Driver | **Defined, activates Phase 4** | Driver app statuses only; minimal PII (delivery-relevant address/contact per BR-023) |
| Fleet Supervisor | **Defined, activates Phase 4** | Dispatch board, assignment confirm, capacity overrides |
| Support Agent | **MVP-lite** | Complaint cases (WF-14); subset of Order Agent + case resolution; may be same people initially [NC] |
| Finance Viewer | **MVP — upgraded to "Finance"** | Read finance + **confirm payments** (WF-13). A pure viewer can't operate the payment review queue; split Finance (act) vs Finance Viewer (read) — both defined |
| Report Viewer | **MVP** | Management dashboards/reports read-only (maps BR-032 "management") |

**MVP active set (8):** Super Admin, Admin, Operations Manager, Order Agent, Kitchen User, Support Agent, Finance, Report Viewer.

## Permissions matrix

Actions: **C**reate · **R**ead · **U**pdate · **D**eactivate · **A**pprove/decide · **X**ecute status change · **–** none. (m) = masked: row visible, PII/HEALTH/PAYMENT fields hidden.

| Module / capability | Super Admin | Admin | Ops Mgr | Order Agent | Kitchen User | Support Agent | Finance | Report Viewer | Driver⁴ | Fleet Sup⁴ |
|---|---|---|---|---|---|---|---|---|---|---|
| M01 Intake (drafts) | R | – | CRU | CRU | – | R | – | – | – | – |
| M02 Review queue | R | – | **RA** | R (own) | – | – | – | – | – | – |
| M03 Orders / lifecycle | R | – | RUX | R, change-request | R (day-list, m) | R (m) | R (m, payment visible) | R (aggregates) | R (own stops, m) | R (dispatch view, m) |
| M04 Customers | R | – | CRU + merge-A | CRU | – (allergy flags only via tickets) | R | R (m: PII partial) | – | R (stop address only) | R (m) |
| M05 Product/Menu | R | CRU¹ | R | R | R | R | – | – | – | – |
| M07 Payments | R | – | R + refund-request | R (status only) | – | refund-request | **RUA** (confirm/refund-A) | R (aggregates) | COD report | – |
| M08 Kitchen tickets | R | – | R + escalation-A | – | **RX** + escalate | – | – | R (aggregates) | – | – |
| M09 Dispatch board⁴ | R | – | R + override-A | – | – | – | – | R (aggregates) | – | **RXA** (assign) |
| M10 Drivers⁴ | R | CRU | R | – | – | – | – | – | R (self) | RU |
| M11 Notifications | R | CRU templates | R log | – | – | R log | – | – | – | – |
| M12 Staff accounts | CRUD | CRUD² | R | – | – | – | – | – | – | – |
| M13 RBAC | **CRUA** | R | R | – | – | – | – | – | – | – |
| M14 Audit log | R (full) | R (no PAYMENT) | R (ops scope) | – | – | – | R (payment scope) | – | – | – |
| M15 Reports | R | R | R (ops) | R (intake funnel) | R (kitchen) | – | R (finance) | **R (all)** | – | R (delivery) |
| M16 Settings | CRUA | CRU³ | U (ops settings: cutoffs, slots) | – | – | – | – | – | – | – |
| M17 WhatsApp refs | R | – | R | CRU | – | R | – | – | – | – |
| M18/M19 Bridge & migration | RXA | R | R | – | – | – | – | – | – | – |
| Exports (any) | X | X | X | – | – | – | X | X | – | – |

¹ Admin manages catalog content; routing-rule changes also allowed for Ops Mgr [NC — workshop assigns catalog ownership]. ² Admin cannot grant roles above own level; Super Admin grants Admin. ³ Non-financial, non-RBAC settings. ⁴ Phase 4 activation.

## Data visibility rules (BR-043)

| Class | Visible in full to | Masked for | Read-logged |
|---|---|---|---|
| PII (name, phone, address, DOB) | Super Admin, Ops Mgr, Order Agent, Support Agent | Kitchen (ticket shows order code + allergy marker, not full profile), Report Viewer, Finance (partial: name + amount context), Driver (current stop only) | Yes — panel open + export |
| HEALTH (allergies, diet, dietician) | Ops Mgr, Order Agent (intake need), Dietician role (future) | Finance, Report Viewer, Driver; Kitchen sees **allergy warning markers**, not diagnosis detail | Yes |
| PAYMENT (transactions, amounts, refunds) | Finance, Super Admin, Ops Mgr (read) | Order Agent (status word only), Kitchen, Driver (COD amount only [NC]), Support | Yes |

## Approval rights summary

| Decision | Holder | Backup |
|---|---|---|
| Order approve/reject (WF-04/05) | Operations Manager | Super Admin (emergency, audited) |
| Allergy-warning override | Operations Manager only, reason mandatory | — |
| Payment confirm / refund approve (WF-13) | Finance | Super Admin (audited) |
| Same-day change/cancel after kitchen cutoff (WF-12/15) | Operations Manager | — |
| Capacity override (WF-09)⁴ | Operations Manager | — |
| Customer merge | Operations Manager | — |
| Role/permission change | Super Admin | — |
| Settings change (financial gates) | Super Admin | — |

## Audit requirements per role

- All roles: login/logout/failed-login recorded (auth.*).
- Privileged actions (any **A** column) always produce before/after audit events.
- Super Admin emergency overrides generate a distinct severity=HIGH event reviewed weekly (R6 mitigation).
- Dormant roles (Branch Manager, WhatsApp Agent) assignment triggers an alert until workshop legitimizes them.

## Open questions → workshop

1. Catalog ownership (Admin vs Ops vs Product role?) — S8.
2. Kitchen shared-device login model (badge codes vs shared terminal + name tap) — affects WF-08 audit actor fidelity — S4.
3. Reviewer-equals-creator allowed? — S2.
4. Separate WhatsApp Agent staffing? — S3.
5. Driver COD amount visibility — S6/S7.
