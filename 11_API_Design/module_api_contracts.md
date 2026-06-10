# Phase 3E (part 2) — Module API Contracts (MVP)

**Date:** 2026-06-11 · **Status:** Proposed (role lists mirror rbac_architecture.md matrix [Proposed]; transition validations mirror status model [Proposed DEC-005])
Per operation: roles → key request fields → validation (detail in `08_Business_Rules/validation_rules_binding.md`) → events/audit. Standards (envelope, transitions, idempotency, masking): `api_standards.md`. Roles: SA=Super Admin, AD=Admin, OM=Ops Manager, OA=Order Agent, KU=Kitchen User, SU=Support, FI=Finance, RV=Report Viewer.

## M01 Intake — `/drafts`

| Operation | Roles | Request | Validation | Events / audit |
|---|---|---|---|---|
| Create draft | OA, OM | channel, customer_ref?/unverified flag, items?, dates?, address, slot, notes, whatsapp panel fields | Channel req.; whatsapp ⇒ message ref fields req. (BR-002); allergy_conflicts computed | order.draft_created |
| Update draft | OA (own or team [NC]), OM | field diffs + version | Completeness recomputed; allergy recheck on item/customer change | order.draft_edited |
| List/Get drafts | OA, OM, SU(R), SA(R) | filters: state, channel, aging, agent | — | — |
| Submit | OA, OM | — | Mandatory-field set complete (3G §WF-02); customer matched or unverified-flag justified | order.submitted; → M02 queue |
| Cancel draft | OA(own), OM | reason_code | Not `converted` | audit order.edited(state) |
| Incomplete queue view | OA, OM | aging filters | — | — |

## M02 Review — `/review-queue`, `/drafts/{id}/decisions`

| Operation | Roles | Request | Validation | Events / audit |
|---|---|---|---|---|
| Queue list | OM, OA(own observe), SA(R) | sla, channel filters | — | — |
| Claim/open review | OM | — | reviewer=creator rule [NC RBAC Q3 — default allow+audit [Proposed]] | review.opened (INFO) |
| Decide: approve | OM | warnings_overridden[] + reason per override | Hard warnings resolved or overridden-with-reason (allergy = OM-only override); slot capacity; coupon validity [NC] | order.approved HIGH-if-override; creates Order+days (M03) |
| Decide: reject | OM | reason_code ✔ | — | order.rejected |
| Decide: return | OM | reason_code ✔ | — | order.returned |
| Decide: hold | OM | note | — | audit only |

## M03 Orders — `/orders`, `/orders/{id}/…`

| Operation | Roles | Request | Validation | Events / audit |
|---|---|---|---|---|
| List/Get orders | OM, OA, SU(m), FI(m: PAY visible), KU(day-list view m), RV(aggregates), SA | status, dates, customer filters | masking per class | pii panel opens logged |
| Transition (plan) | OM (system for scheduled) | to, reason_code | Per status-model L1 table; payment gate setting consulted (paused/cancel rules; same-day acknowledgments) | order.status_changed / order.cancelled |
| Get/list fulfillment days | OM, OA, KU(m), SA | date, status | — | — |
| Transition (day) | system (cutoff), KU (kitchen states), OM (cancel_day, overrides) | to, reason_code | Per L2 table; cancel after kitchen_queued ⇒ OM + acknowledgment | fulfillment.status_changed |
| Create change request | OA, OM, SU | diff | Order approved/active; diff non-empty | audit CR created |
| Decide change request | OM | approve/reject; same-day ack if impact says so | Impact recomputed at decision time (stale guard) | order.change_applied / audit reject |
| Create exception case | OA, OM, SU, KU(escalation-sourced) | type, refs, severity | allergy-incident ⇒ severity=high + OM alert (DM-04) | exception events via order.* family; M11 alert |
| Resolve exception | OM, SU(owner) | resolution_code | — | audit |
| Status history / timeline | OM, OA, SU, SA, FI(payment rows) | — | — | — |

## M04 Customers — `/customers`

| Operation | Roles | Request | Validation | Events / audit |
|---|---|---|---|---|
| Search (by phone/name) | OA, OM, SU | query | normalized-phone search first (DEC-004 [A]) | — |
| Create (guided) | OA, OM | name, phones, address, language | duplicate check: exact-phone block, fuzzy → warn+confirm (GAP-ADM-01/DQ-01) | customer.created |
| Get/Update profile | OA, OM, SU; FI(m), KU – | diffs + version | phone normalization; address requires area_ref | customer.updated; pii_viewed on full panel |
| Manage allergies (HEALTH) | OA(intake need), OM | allergen_ref, severity | severity from ALLERGY_SEVERITY [NC scale] | customer.updated + health_viewed on read |
| Merge | OM | winner, loser, field_decisions | undo window set; refs re-pointed (drafts re-linked) | customer.merged HIGH |
| Merge-review queue | OM | — | populated by import + fuzzy matches | — |

## M05 Catalog — `/products`, `/packages`, `/masters/*`, `/routing-rules`

| Operation | Roles | Validation | Events / audit |
|---|---|---|---|
| List/Get (all catalog) | all staff roles (R) | — | — |
| Create/Update product, package, masters | AD (catalog owner [NC RBAC Q1]) | bilingual names req.; price ≥ 0; parent_package self-ref acyclic (C7) | product change WARN audit |
| Update nutrition facts / allergen links | AD + dietician role (dormant) | non-negative macros; allergen source set | audit |
| Manage routing rules | KU-manager [NC] or OM | section_ref active; scope+target valid | kitchen.routing_changed |
| MVP note | Catalog is mirror-class until cutover: writes restricted to import + routing/allergen/nutrition enrichment [legacy remains SoT — ADR-010, legacy_transition §4] | | |

## M07 Payments — `/orders/{id}/payments`, `/payment-reviews`

| Operation | Roles | Request | Validation | Events / audit |
|---|---|---|---|---|
| Get payment state | FI, OM(R), OA(status word only — m), SA | — | masking heavy (PAY) | — |
| Record link sent | OA, FI | link_ref | order approved+ | payment.status_changed |
| Request status change | OA(evidence attach), FI | requested_status, evidence_note | legal transition per payment machine | queue item created |
| Decide (confirm paid / failed / cod collected) | **FI only** | decision, evidence | never auto in MVP | payment.status_changed HIGH |
| Refund request / decide | OM request / FI decide — **dormant until Q20** | amount, reason | flag `not_enabled` | payment.refund_* HIGH |

## M08 Kitchen — `/kitchen/board`, `/tickets`

| Operation | Roles | Request | Validation | Events / audit |
|---|---|---|---|---|
| Day board (by section) | KU, OM(R), SA(R) | date, section | — | — |
| Generate tickets (cutoff job; manual re-run) | system; OM (re-run) | date | idempotent per generation_batch; unrouted → null-section tickets + alert (WF-07-E, DM-05) | kitchen.ticket_generated |
| Ticket transition | KU | to, blocked_reason? | TICKET_STATUS machine; blocked ⇒ reason_code | fulfillment rollups; TicketStatusEvent |
| Raise/resolve escalation | KU raise; OM resolve | type, proposed_substitute? | substitute allergy-rechecked before approval (DM-04) | kitchen.escalation_* |
| Confirm packed (MVP slice) | KU | day_ref | all tickets prepared (or OM override) | fulfillment.status_changed → packed |

## M11 Notifications — `/templates`, `/notifications`

| Operation | Roles | Validation | Audit |
|---|---|---|---|
| Manage templates | AD | versioned; channel ∈ active channels (internal, email MVP) | template change WARN |
| Send (system-triggered via trigger map) | system | per trigger config in M16 | notification.sent/failed |
| Log view | AD, OM, SU | — | — |

## M12/M13 Staff & RBAC — `/staff`, `/roles`

| Operation | Roles | Validation | Audit |
|---|---|---|---|
| Staff CRUD | AD, SA | deactivate not delete; AD cannot grant ≥ own level | staff.* HIGH |
| Grant/revoke role | SA (AD within limits) | dormant-role grant ⇒ alert (rbac_architecture) | rbac.role_assigned HIGH |
| Edit role permissions | SA | matrix export-compare guard | rbac.permission_changed HIGH |
| Login/logout/session | all | session expiry per setting | auth.* |

## M15 Reports — `/reports/{intake-funnel | daily-ops | kitchen-day-list}`

| Operation | Roles | Notes |
|---|---|---|
| View | per matrix: OA(intake), KU(kitchen), OM(all ops), FI(finance scope), RV(all) | projections; rebuild-from-events guaranteed |
| Export | roles with Exports right | `POST /exports`; complete-or-fail; data.exported audit |

## M16 Settings — `/settings`, `/sections`, `/areas`, `/slots`, `/reason-codes`

| Operation | Roles | Validation | Audit |
|---|---|---|---|
| Read | all staff | — | — |
| Edit ops settings (cutoffs, slots, sections, reason codes) | OM, AD | preview + effective_from; type check | settings.changed WARN |
| Edit gates (payment_gate), flags, RBAC-adjacent | SA | — | settings.changed HIGH |

## M17 WhatsApp (manual mode) — embedded in `/drafts` panel

| Operation | Roles | Validation | Audit |
|---|---|---|---|
| Attach message ref | OA, OM | sender_phone, message_at req.; immutable once saved | within order.draft_created/edited |
| (dormant) inbound webhook, template send | system | `not_enabled` until DEC-002 | — |

## M18/M19 Bridge & Migration — `/bridge/*`, `/imports`

| Operation | Roles | Validation | Audit |
|---|---|---|---|
| Run import (dry-run default) | SA | type ∈ IMPORT_TYPE; idempotent; dry_run first enforced | bridge.import_run |
| Apply import | SA | dry-run reviewed (state machine) | bridge.import_run HIGH |
| Record/view reconciliation | OM, SA | per RECON_TYPE | bridge.reconciliation_run (WARN on divergence) |
| Toggle cutover flag | SA | — | bridge.cutover_flag_changed HIGH |

## Dormant contract stubs (named, unspecified — Phase 4/decision-gated)

`/dispatch/*`, `/drivers/*` (M09/M10 — Phase 4 design refresh) · `/payments/gateway-webhook` (INT-03 post-access) · `/whatsapp/webhook` (DEC-002) · `/cart`, `/checkout` (M06 — workshop S1 Q1).
