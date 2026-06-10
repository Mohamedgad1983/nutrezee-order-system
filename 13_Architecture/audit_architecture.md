# Phase 2G — Audit Architecture

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (foundation design) — event list confirmation at workshop S8 (Q22 "which actions must be audit logged")
Closes GAP-AUD-01 (Critical), GAP-AUD-02, GAP-AUD-03. Implements BR-033, BR-043 read-logging. Module: M14. Cross-cutting workflow: WF-16.

## Principles

1. **Audit is a platform service, not a feature** (ADR-005): the write path exists before the first business module ships.
2. **Same-transaction writes:** a state change that cannot be audited does not happen (guardrail 7). Sensitive-*read* logging is queued/async-tolerant so an audit outage cannot block care-critical reads, but write-ops degrade to restricted mode [Proposed — business tolerance to confirm].
3. **Immutable:** no update or delete API on AuditEvent for any role, including Super Admin. Corrections are new events referencing the disputed one.
4. **Reconstructable:** any order's complete history must be derivable from audit alone — this is an MVP acceptance test (mvp_architecture_cut §7).

## AuditEvent record schema (logical)

| Field | Content | Notes |
|---|---|---|
| event_id | Unique, time-ordered | |
| event_type | Catalog name (below) | Versioned vocabulary |
| actor_id / actor_role | StaffUser + active role; `system` for automated transitions (e.g., cutoff ticket generation) | Kitchen shared-device caveat [NC — RBAC open Q2] |
| on_behalf_of | Customer ref when action executes a customer request (cancel, pause) | |
| entity_type / entity_id | Primary subject (Order, FulfillmentDay, Customer, PaymentRecord, Setting, Role…) | |
| related_refs | Secondary subjects (order↔customer↔driver↔ticket) | Enables "everything about order X" |
| before / after | Changed fields only, values masked per visibility class of the *reader* at query time (PAYMENT/HEALTH values stored, masked on display per RBAC) | |
| timestamp | UTC, server-side | |
| source | App surface + session id; IP/device where the runtime provides it [NC — depends on DEC-011 stack] | Best-effort, never blocking |
| severity | INFO / WARN / HIGH | HIGH = overrides, permission changes, merges, refunds |
| reason / note | Mandatory for overrides, rejections, cancellations, merges | |

## Event catalog (minimum set)

| Domain | Events | Severity | Coverage demanded by |
|---|---|---|---|
| Auth | auth.login, auth.logout, auth.failed_login, auth.session_expired | INFO (failed: WARN, ≥5 consecutive: HIGH) | Prompt list; legacy had no logout [V] |
| Order | order.draft_created, order.edited (field diffs), order.submitted, order.approved, order.rejected, order.cancelled, order.status_changed | INFO; approve/cancel with override: HIGH | BR-033; WF-04/05/06/12/15 |
| Fulfillment | fulfillment.created, fulfillment.status_changed, fulfillment.rescheduled | INFO | WF-07…11 |
| Kitchen | kitchen.ticket_generated, kitchen.routing_changed (rule edits), kitchen.escalation | INFO / WARN | BR-033 "kitchen status changes"; WF-07/08 |
| Dispatch⁴ | dispatch.assigned, dispatch.reassigned, dispatch.capacity_override | INFO / HIGH (override) | BR-033; WF-09 |
| Payment | payment.status_changed, payment.refund_requested, payment.refunded, payment.gate_overridden | All HIGH except status to LINK_SENT | GAP-AUD-02; WF-13 |
| Customer | customer.created, customer.updated (diffs), customer.merged, customer.pii_viewed, customer.health_viewed | merge: HIGH; views: INFO (read log) | BR-043; GAP-AUD-03 |
| RBAC/Admin | rbac.role_assigned, rbac.permission_changed, staff.created, staff.deactivated | HIGH | BR-033 "permission changes" |
| Settings | settings.changed (before/after), settings.gate_changed (payment gate, cutoffs) | WARN / HIGH | BR-033; legacy settings unaudited [V] |
| Data | data.exported (what, filter, row count), report.viewed (finance scope) | WARN | GAP-AUD-03 |
| Notification | notification.sent (template, recipient class) | INFO | GAP-NOT-01 history |
| Bridge | bridge.import_run, bridge.reconciliation_run (diff counts), bridge.cutover_flag_changed | WARN / HIGH (cutover) | ADR-008 |

⁴ activates migration Phase 4.

## Retention recommendation

| Class | Hot (queryable UI) | Archive | Rationale |
|---|---|---|---|
| Payment, RBAC, settings, merges, overrides (HIGH) | 24 months | 7 years [NC — local statutory requirements unknown; legal review task → `21_Risks/`] | Financial/compliance |
| Order/fulfillment/kitchen/dispatch (INFO) | 12 months | 3 years | Operational disputes, analytics (GAP-AI-01 benefits) |
| Read logs (pii_viewed etc.) | 6 months | 2 years | Privacy investigations |
| Auth | 6 months | 2 years | Security forensics |

## Query & access

- Query UI scoped per RBAC matrix (Super Admin full; Admin minus PAYMENT; Ops ops-scope; Finance payment-scope).
- Canned views: "history of order X", "actions by user Y in range", "all HIGH events this week" (weekly review ritual — R6 mitigation).
- Export of audit data is itself audited (data.exported).

## MVP acceptance tests (gate to declaring GAP-AUD-01 closed)

1. Reconstruct one order end-to-end (intake→approval→kitchen→cancel) from audit alone.
2. Verify immutability: no role can alter/delete an event.
3. Verify same-transaction behavior: forced audit-write failure blocks the business write.
4. Verify masked rendering: Finance sees payment before/after; Order Agent sees masked.
5. Weekly HIGH-severity review run once with real data.
