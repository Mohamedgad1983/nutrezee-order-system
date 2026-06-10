# Phase 3D — Event Catalog v1

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (envelope, families) / Proposed (payloads gated on DEC-005 enums)
Transport: in-process acceptable for MVP (mvp cut §6) — **the contract is what matters**. Events are append-only, versioned, unknown-field-tolerant (guardrails 3/8). Audit (M14) is written directly in the business transaction (DM-08); it is NOT a bus consumer. Projections (M15) and notifications (M11) ARE consumers and must be rebuildable by replay (GAP-AI-01 dependency).

## Envelope v1 (every event)

| Field | Content |
|---|---|
| event_id | Unique, time-sortable (DM-01 id class) — idempotency key for consumers |
| event_type | `family.verb_past` per registry below |
| version | Integer, starts 1; additive changes keep version; breaking → new version, old kept |
| occurred_at | UTC datetime, server-set |
| actor | `{staff_id, role}` or `{system: reason}` (e.g., cutoff job) |
| on_behalf_of | customer_ref when executing a customer request |
| refs | `{order_id?, fulfillment_day_id?, draft_id?, customer_id?, ticket_id?, payment_id?, …}` — all relevant, for cross-entity queries |
| payload | Family-specific fields below (changed-field diffs where noted) |

Rules: ordering guaranteed per subject entity (per order_id), not globally; consumers dedupe on event_id; replay from event 0 must rebuild every projection bit-identically; producers never emit on failed transactions.

## Families

### order.* (producer M01/M02/M03)
| Event | Payload | Consumers |
|---|---|---|
| order.draft_created | channel, customer_ref?, unverified_customer, whatsapp_ref? | M15 intake funnel |
| order.draft_edited | field diff | M15 |
| order.submitted | completeness summary, sla_due_at | M15, M11 (queue alert) |
| order.returned | reason_code | M15, M11 (agent alert) |
| order.approved | order_id created, plan dates, day_count, warnings_overridden[], payment_gate_state | M08 (awaits days), M15, M11 |
| order.rejected | reason_code | M15, M11 |
| order.cancelled | scope(plan/days), reason_code, days_affected, refund_flag [NC Q20] | M08, M15, M11 (kitchen same-day alert) |
| order.status_changed | from, to, reason? — for active/paused/completed/expired | M15, M11 |
| order.change_applied | change_request_id, diff, impact(days regenerated, price delta) | M08, M15, M11 |

### fulfillment.* (producer M03; status from M08 rollups MVP, M09/M10 P4)
| Event | Payload | Consumers |
|---|---|---|
| fulfillment.created | order_ref, date, slot | M08, M15 |
| fulfillment.status_changed | from, to, reason_code? | M15, M11 (ready_to_pack, failed⁴ alerts); plan-completion check in M03 |
| fulfillment.rescheduled⁴ | old_day_ref, new_day_ref, reason | M15, M11 |

### kitchen.* (producer M08)
| Event | Payload | Consumers |
|---|---|---|
| kitchen.ticket_generated | generation_batch, day date, per-section counts, unrouted count | M15 day-list, M11 (unrouted alert if >0 — WF-07-E) |
| kitchen.routing_changed | rule diff (config change) | M15, M14-visible |
| kitchen.escalation_raised / resolved | type, ticket_ref, proposed_substitute? | M11 (kitchen mgr + ops), M15, M03 (exception linkage) |

### payment.* (producer M07)
| Event | Payload | Consumers |
|---|---|---|
| payment.status_changed | from, to, method, amount, evidence_note ref | M03 (gate check), M15, M11 (failed alert) |
| payment.refund_requested / refunded | amount, reason [dormant until Q20 confirms] | M15, M11 |

### customer.* (producer M04)
| Event | Payload | Consumers |
|---|---|---|
| customer.created | channel/source, origin | M15 |
| customer.updated | field diff (PII values masked in projections) | M15 |
| customer.merged | winner, loser, undo_until | M01 (draft re-link), M15 |

### settings.* / bridge.* / notification.* (producers M16 / M18 / M11)
| Event | Payload | Consumers |
|---|---|---|
| settings.changed | key, before, after, effective_from | All modules (config reload), M15 |
| bridge.import_run | batch type, counts, dry_run | M15 |
| bridge.reconciliation_run | type, counts, diffs, state | M11 (divergence alert), M15 |
| notification.sent / failed | template+version, recipient_type, channel | M15 |

### security family (auth.*, rbac.*, staff.*)
Written as **audit events only** (M14 direct) — not published on the bus in MVP [Proposed: prevents accidental projection of security data into reports; revisit if a security dashboard is built].

## Consumer contracts

| Consumer | Subscribes | Rebuild rule |
|---|---|---|
| M15 intake funnel | order.draft_*, order.submitted/returned/approved/rejected | Full replay rebuild |
| M15 daily ops sheet | order.*, fulfillment.*, payment.status_changed, exception via order.* | Full replay rebuild |
| M15 kitchen day-list | kitchen.*, fulfillment.* | Regenerable also from KitchenTicket (derived) — must agree |
| M11 alert router | per-template trigger map (config in M16) | Stateless; NotificationLog is the record |
| Future AI layer (Phase 5) | All families, ≥3-month retention | Read-only; consent rules for any WhatsApp content (GAP-AI-02) |

⁴ = dormant until migration Phase 4.
