# Phase 3C — Data Dictionary & Conventions

**Date:** 2026-06-11 · **Status:** Proposed (enums gated on workshop where marked)
Field-level detail lives in `logical_data_model.md` (single source — not duplicated here). This file: entity index, conventions, identifier strategy, enum registry, standards.

## 1. Entity index (38 MVP entities + 9 dormant stubs)

| Entity | Module/Owner | Lifecycle | Importable | Sensitive fields |
|---|---|---|---|---|
| StaffUser | M12 | std | – | email/phone PII |
| RoleAssignment | M12 (write via M13 API — C4) | std | – | – |
| Session | M12 | std | – | – |
| Role / Permission / RolePermission | M13 | std/config | – | – |
| AuditEvent | M14 | append, immutable | – | before/after masked at render |
| Setting / FeatureFlag / ReasonCode | M16 | config | – | – |
| SectionMaster / Area / DeliverySlot / DeliveryMethod | M16 | config | Slot/Method legacy [V] | – |
| Customer | M04 | std | ✔ | name/dob PII, diet HEALTH |
| CustomerPhone / Address / Preference | M04 | std | ✔ | phone/address PII |
| CustomerAllergy | M04 | std | ✔ | HEALTH |
| MergeRecord | M04 | append | – | – |
| Product / Package / masters (MealType, DietStatus, Tag, PackageForType, Ingredient, Allergen) | M05 | std | ✔ all [V legacy masters] | – |
| ProductComponent / ProductIngredient / ProductAllergen / NutritionFacts | M05 | std | partial | – |
| RoutingRule | M05 (edit rights: kitchen mgr [NC]) | config-class | – | – |
| DraftOrder / DraftItem | M01 | std | – | address PII, allergy_conflicts HEALTH, price PAY |
| WhatsAppMessageRef | M17 | frozen | – | sender phone PII |
| ReviewQueueItem | M02 | std | – | – |
| ReviewDecision | M02 | append | – | – |
| Order | M03 | std | ✔ (active plans) | amounts PAY |
| OrderItem | M03 | frozen | ✔ | price PAY, allergens HEALTH |
| FulfillmentDay | M03 | std | ✔ (generated at import) | address PII |
| OrderStatusHistory | M03 | append | – | – |
| ChangeRequest / ExceptionCase | M03 | std | – | impact PAY |
| PaymentRecord / PaymentReviewItem | M07 | std | ✔ ref-only | PAY throughout |
| KitchenTicket | M08 | derived | – | allergy_marker (flag only — no HEALTH detail on tickets, per RBAC masking) |
| TicketStatusEvent | M08 | append | – | – |
| Escalation | M08 | std | – | – |
| Template | M11 | config, versioned | – | – |
| NotificationLog | M11 | append | – | minimal payload |
| SyncRecord / ReconciliationRun | M18 | std / append | – | – |
| ImportBatch / ImportRowResult | M19 | std / append | – | – |
| *Dormant:* Driver, Shift, CapacityRule, StopStatus (M10) · DriverAssignment, Manifest, DeliveryEvent (M09) · CartSession, CheckoutSession (M06) · WhatsAppMessage (M17) | — | stubs | — | — |

## 2. Naming conventions

- Entities: PascalCase singular. Fields: snake_case. Refs: `<entity>_ref`. Frozen copies: `_frozen` suffix.
- Enums: SCREAMING_SNAKE registry names, lowercase values. Events: `family.verb_past` (e.g., `order.approved`). Audit event types = event names (one vocabulary, DM-08).
- Business IDs visible to humans: `order_number` (legacy-parity [V]); everything else joins on internal ids.

## 3. Identifier strategy (DM-01)

- Internal `id`: globally unique, time-sortable (ULID-class [Proposed — final form at DEC-011]). Never reused, never recycled.
- `order_number`: human/business number, unique, sequence format **[NC — legacy format unknown; bridge must not collide: new numbers prefixed (e.g., `N-`) until legacy retirement [Proposed]]**.
- Legacy keys preserved on imported rows via `SyncRecord.legacy_key` + `origin/import_batch` on the row (ADR-010).

## 4. Enum registry

| Enum | Values | Source | Workshop-confirmable? |
|---|---|---|---|
| ORDER_STATUS | draft, pending_review, approved, active, paused, completed, expired, cancelled, rejected | status model L1 [Proposed DEC-005] | Item 1 (expired-vs-completed) |
| FULFILLMENT_STATUS | scheduled, kitchen_queued, in_preparation, ready_to_pack, packed, assigned_to_driver, out_for_delivery, delivered, failed, rescheduled, skipped, cancelled_day | status model L2 | Dispatch states dormant→P4 |
| PAYMENT_STATUS | unpaid, link_sent, paid, failed, cod_pending, collected, refund_requested, refunded | status model payment machine | Refund pair gated on Q20 |
| DRAFT_STATE | open, submitted, returned, converted, rejected, cancelled, expired | C6 resolution | Retention → setting |
| REVIEW_DECISION | approve, reject, return, hold | WF-03/04/05/06 | — |
| TICKET_STATUS | queued, in_progress, prepared, blocked | WF-08 / BR-014 | S4 (chef-accepted statuses) |
| CHANNEL | whatsapp, phone, walk_in, staff, other | BR-002 [A channel mix] | S3 |
| PAY_METHOD | link, gateway, cash, transfer, other | [NC — S7 Q19] | **Yes — placeholder values** |
| ALLERGY_SEVERITY | note, avoid, severe | [Proposed] | **Yes — S8** |
| SEVERITY | info, warn, high | audit_architecture | — |
| QUEUE_STATE | waiting, in_review, decided | M02/M07 queues | — |
| CR_STATE | pending, approved, rejected, applied | WF-15 | — |
| CASE_STATE | open, in_progress, resolved | WF-14 | — |
| CUSTOMER_STATUS | active, inactive, merge_pending | M04 | — |
| NOTIF_CHANNEL | internal, email (+dormant: whatsapp, push, sms) | INT-04 | DEC-002 |
| NOTIF_STATUS | sent, failed | GAP-NOT-01 | — |
| IMPORT_TYPE / IMPORT_ACTION / IMPORT_STATE | per logical model M19 | DEC-012 scope | — |
| SYNC_TYPE / RECON_TYPE | per logical model M18 | ADR-008 | Pattern choice |
| ROUTING_SCOPE | product, component, meal_type | BR-009/010 | S4 |
| REASON_DOMAIN | rejection, cancellation, return_to_draft, day_cancel, ticket_block, escalation, complaint, payment_fail, merge | DM-06 | Codes per domain: **yes** |
| ALLERGEN_SOURCE | declared, derived_from_ingredient | M05 | — |
| LOCALE | en, ar | guardrail 5 | — |
| VIS | none, pii, health, payment | BR-043 | — |
| SETTING_TYPE / PREF_KEY / AUDIT_EVENT | per logical model / event_catalog | — | — |

## 5. Standards

- **Bilingual:** `ntext` = paired `_en` (required) + `_ar` (required for customer/kitchen-facing content; optional for internal-only [Proposed]) — legacy is bilingual [V].
- **Money (DM-07):** integer minor units + `currency` code; single currency assumed [A — NC at workshop]; no floats anywhere.
- **Datetime:** stored UTC; rendered in business-local timezone (one timezone assumed [A]); `date` fields are business-local calendar dates (FulfillmentDay.date is a local operations date, deliberately not UTC-shifted).
- **Time-of-day settings** (cutoffs, slots): local wall-clock `time` type.
- **Phones:** normalized storage (E.164-style [Proposed]); raw-as-entered kept in a `_raw` shadow on capture for dispute resolution [Proposed].
- **Soft-delete:** none. Deactivation flags only; append-only families never deleted; retention per audit_architecture tiers.
- **JSON fields:** schema-documented in Phase 4 specs; consumers tolerate unknown keys (guardrail 8 parity).
