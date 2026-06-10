# Phase 3G — Validation & Business Rules Binding

**Date:** 2026-06-11 · **Status:** Proposed (rule *content* workshop-gated; rule *slots* fixed)
Binds workflow steps (WF-01…16) to field/transition validations and M16 settings. Principle: rule **slots** are designed now; rule **values** come from the workshop (config-over-code, target_architecture guardrail 4, R3/R8 response).

## 1. Field validation (intake → review)

| Field | Rule | Failure behavior | Source |
|---|---|---|---|
| CustomerPhone.phone_normalized | Normalizable to E.164-style [Proposed] | Block save; raw kept in `_raw` | DM-03, DEC-004 [A] |
| Customer duplicate at creation | Exact-phone → hard block with link to existing; fuzzy name+dob → warn+confirm | Agent confirms or links | GAP-ADM-01/DQ-01, WF-01 step 1 |
| DraftOrder.channel=whatsapp | WhatsAppMessageRef (sender_phone, message_at) required | Block submit, not save | BR-002, WF-02 |
| Draft submit completeness | Mandatory set: customer (or unverified-justified), ≥1 item/package, start_date, address(+area), slot, expected_payment_method [NC set — S3 Q8 may amend] | Block submit; completeness json drives incomplete queue | BR-003 |
| Address | area_ref required; address_text non-empty | Block save | BR-007 |
| Dates | start ≤ end; start ≥ today−0 [Proposed: no back-dated starts without OM] | Block / OM override | BR-036 |
| Coupon code | Format check only in MVP; validity **[NC — legacy coupon rules unknown; slot reserved: `coupon_validation_mode` setting = off/warn/strict]** | Per mode | C-legacy gap |
| Slot capacity | Booked-days-per-slot vs DeliverySlot.capacity; null capacity = warn-only | Warn (MVP) [NC unit — DEC-008 adjacent] | WF-01 step 4 |
| Money fields | ≥ 0; integer minor units | Block | DM-07 |

## 2. Allergy safety chain (BR-039, DM-04) — end-to-end field map

| Step | Carrier field | Behavior |
|---|---|---|
| 1. Profile | CustomerAllergy(allergen, severity) [HEALTH] | Maintained by OA/OM |
| 2. Intake | DraftOrder.allergy_conflicts (computed: CustomerAllergy × Product/Package allergens incl. derived-from-ingredient) | Displayed at WF-01/02; recompute on any item/customer change |
| 3. Review | Hard warning in WF-03; approve requires empty conflicts OR ReviewDecision.warnings_overridden + reason; override = OM only | order.approved HIGH audit |
| 4. Order | OrderItem.allergens_frozen [HEALTH] snapshot | Survives catalog edits |
| 5. Kitchen | KitchenTicket.allergy_marker (flag only — masked detail per RBAC) | Visible marker on board/ticket |
| 6. Substitution | Escalation.proposed_substitute re-runs conflict check before OM approval | Block on new conflict unless overridden again |
| 7. Incident | ExceptionCase type=allergy-incident ⇒ severity=high + immediate OM alert | WF-14 step 3 |

## 3. Settings registry (M16 keys MVP — values workshop-fillable)

| Key | Type | Default [Proposed] | Editable by | Used in |
|---|---|---|---|---|
| kitchen_cutoff_time | time | **unset — must be set before kitchen go-live** | OM | WF-07 trigger; WF-12/15 same-day guards |
| payment_gate | enum(none, before_active, before_kitchen) | none (+warn flag on unpaid) | SA (HIGH audit) | WF-04 step 3; DEC-009 |
| draft_retention_days | number | 14 | OM | DRAFT auto-expiry (status model item 5) |
| review_sla_minutes | number | 120 | OM | WF-03 queue ordering + alerts |
| draft_aging_alert_hours | number | 4 | OM | M11 trigger map |
| coupon_validation_mode | enum(off, warn, strict) | warn | SA | §1 coupon rule |
| slot_capacity_mode | enum(off, warn, block) | warn | OM | §1 slot rule |
| merge_undo_days | number | 7 | SA | MergeRecord window |
| order_number_prefix | text | "N-" | SA | dictionary §3 collision rule |
| reconciliation_due_hour | time | 10:00 | OM | P1 bridge ritual alert |
| notification trigger map | json | seeded: aging-draft, queue-SLA, unrouted>0, ticket-blocked, ready-to-pack, payment-failed, reconciliation-divergent, dormant-role-granted | AD | M11 router |
| enforcement_mode per role | enum(log, warn, deny) | log (ramp per rollout plan) | SA | M13 staged enforcement |
| cutover flags (intake, kitchen, catalog…) | flag | off | SA (HIGH) | legacy_transition §1 |

## 4. Transition validation (delegates to status model tables — single source)

- Plan + day transitions: exactly the L1/L2 tables in `13_Architecture/order_lifecycle_status_model.md`; the transition API loads allowed-next + role + validation from config seeded by those tables — **no transition logic hard-coded** (DEC-005 flexibility).
- Same-day guards: any action touching a FulfillmentDay with status ≥ kitchen_queued (cancel, change-apply) requires OM + explicit acknowledgment + reason (WF-12 step 2, WF-15 step 3).
- Payment machine: only FI decides paid/failed/collected (WF-13); refund pair returns `not_enabled` until Q20.
- Ticket machine: blocked requires ReasonCode(domain=ticket_block); prepared-→day-rollup automatic (WF-08 step 4).

## 5. Reason-code governance

Every reject / return / cancel / day-cancel / block / escalation / complaint / merge / payment-fail requires a ReasonCode from its domain (DM-06). Codes are OM/AD-editable config; reports aggregate by code (rejection reasons feed intake coaching — WF-05 success criterion). Workshop seeds initial code lists per domain.

## 6. Cross-references

- `07_Workflows/` (Phase 4 will detail BPMN per WF using these rules).
- `09_Roles_and_Permissions/` — role lists per operation mirror rbac matrix; matrix sign-off updates both.
- `15_Testing/` — every rule slot above becomes a UAT case template; allergy chain steps 1–7 are mandatory test scenarios.
