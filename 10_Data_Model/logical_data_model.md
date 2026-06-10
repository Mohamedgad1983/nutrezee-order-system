# Phase 3B — Logical Data Model (MVP Modules)

**Date:** 2026-06-11 · **Status:** Proposed (gated on DEC-005/DEC-003 sign-off) — logical model only, NO physical schema/DDL (DEC-011 open)
Field type vocabulary: `text · ntext(bilingual pair _en/_ar) · number · money(minor units) · date · datetime(UTC) · time · enum(NAME) · ref(Entity) · flag · json-config`. Visibility: PII / HEALTH / PAY / –. Lifecycle class: **std** (mutable, audited) · **append** (append-only) · **frozen** (snapshot at event) · **derived** (regenerable) · **config** (settings-class).
All entities implicitly carry: `id (internal)`, `created_at/by`, `updated_at/by` (std only), and importable entities add `origin enum(new,legacy)`, `import_batch ref(ImportBatch)`.

## Foundation cluster — M13 RBAC · M14 Audit · M16 Settings · M12 Staff

```
StaffUser ──< RoleAssignment >── Role ──< RolePermission >── Permission(vocab)
    │                                                            
    └──< Session                AuditEvent (append, immutable, owned M14)
Setting · FeatureFlag · ReasonCode · SectionMaster · Area · DeliverySlot · DeliveryMethod (all config, owned M16)
```

### M12 StaffUser — std
| Field | Type | Req | Vis | Notes |
|---|---|---|---|---|
| name | ntext | ✔ | – | Staff names bilingual optional [Proposed] |
| email | text | ✔ | PII | Login identifier [Proposed — DEC-011 may add SSO] |
| phone | text | – | PII | |
| active | flag | ✔ | – | Deactivate, never delete (audit refs) |
| locale | enum(LOCALE: en, ar) | ✔ | – | |

### M12 RoleAssignment — std (C4 resolution: owned M12, written only via M13 grant API)
| staff_ref ref(StaffUser) ✔ · role_ref ref(Role) ✔ · assigned_by ref(StaffUser) ✔ · assigned_at datetime ✔ | Audit: rbac.role_assigned HIGH |

### M12 Session — std
| staff_ref ✔ · started_at ✔ · expires_at ✔ · source text(app surface) · ended_at | Logout/timeout per layer-8; auth.* audit |

### M13 Role — std
| code text ✔ unique · name ntext ✔ · active flag ✔ · dormant flag | 12 roles seeded per rbac_architecture (8 active, 4 dormant) |

### M13 Permission — config vocabulary (code-defined, data-granted)
| code text ✔ (module.action[.scope]) · visibility_grant enum(VIS: none, pii, health, payment) multi | Matrix export-compare report guards drift |

### M14 AuditEvent — append, immutable (schema = audit_architecture.md verbatim)
| event_type enum(AUDIT_EVENT — see event_catalog) ✔ · actor_ref/actor_role ✔ (`system` allowed) · on_behalf_of ref(Customer) – · entity_type+entity_id ✔ · related_refs json · before/after json (changed fields only) · occurred_at datetime ✔ · source json(surface, session, ip?) · severity enum(SEVERITY: info, warn, high) ✔ · reason text (req. for overrides/rejections/cancels/merges) | No update/delete path exists. Vis: before/after values masked at render per reader's class |

### M16 Setting — config, versioned
| key text ✔ unique · value json-config ✔ · value_type enum(SETTING_TYPE: text, number, time, flag, enum, json) ✔ · scope text · effective_from datetime · version number ✔ · editable_by_roles json | settings.changed WARN/HIGH; gate keys (payment_gate, kitchen_cutoff) HIGH. Registry of MVP keys: validation_rules_binding.md §3 |

### M16 SectionMaster — config [NC content — DEC-006; model complete with zero rows]
| code ✔ · name ntext ✔ · active ✔ · manager_ref ref(StaffUser) – · site_ref – [NC multi-site] |

### M16 Area — config [NC content — DEC-008/workshop]
| code ✔ · name ntext ✔ · active ✔ | Zones for addresses; dispatch rules attach Phase 4 |

### M16 DeliverySlot — config (legacy parity [V delivery time slots])
| label ntext ✔ · start_time time ✔ · end_time time ✔ · capacity number – [NC unit] · active ✔ |

### M16 DeliveryMethod — config (legacy parity [V])
| name ntext ✔ · active ✔ |

### M16 ReasonCode — config (DM-06)
| domain enum(REASON_DOMAIN: rejection, cancellation, return_to_draft, day_cancel, ticket_block, escalation, complaint, payment_fail, merge) ✔ · code ✔ · label ntext ✔ · active ✔ |

### M16 FeatureFlag — config
| key ✔ · on flag ✔ · note | Carries cutover flags (legacy_transition §1) |

## Customer cluster — M04

```
Customer ──< CustomerPhone        Customer ──< Address >── Area
   │──< CustomerAllergy >── Allergen(M05)
   │──< Preference                Customer ──< MergeRecord (append)
```

### Customer — std, importable
| Field | Type | Req | Vis | Notes |
|---|---|---|---|---|
| full_name | ntext | ✔ | PII | Legacy screens show name [V] |
| dob | date | – | PII | Legacy shows DOB [V] |
| language | enum(LOCALE) | ✔ | – | |
| diet_status_ref | ref(DietStatus M05) | – | HEALTH | Legacy master [V] |
| status | enum(CUSTOMER_STATUS: active, inactive, merge_pending) | ✔ | – | |
| notes | text | – | PII | |

### CustomerPhone — std (DM-03)
| phone_normalized text ✔ (E.164-style [Proposed]) · label text · is_primary flag ✔ · whatsapp flag | Unique-candidate matching index — DEC-004 flexibility |

### Address — std (BR-007)
| customer_ref ✔ · label text · area_ref ref(Area) ✔ [NC area list] · address_text text ✔ PII · location_pin json – PII · delivery_notes text · active flag ✔ |

### CustomerAllergy — std, HEALTH (allergy-chain origin, DM-04)
| customer_ref ✔ · allergen_ref ref(Allergen) ✔ · severity enum(ALLERGY_SEVERITY: note, avoid, severe) [NC scale — workshop S8] · note text HEALTH |

### Preference — std
| customer_ref ✔ · key enum(PREF_KEY: contact_channel, delivery_pref, other) · value text |

### MergeRecord — append (WF: customer merge, Ops-only)
| winner_ref ✔ · loser_ref ✔ · field_decisions json ✔ · merged_by ✔ · undo_until datetime ✔ [Proposed window] | customer.merged HIGH |

## Catalog cluster — M05 (MVP: mirror + routing + allergens; macros content continues post-MVP)

```
Product ──< ProductComponent     Product ──< ProductIngredient >── Ingredient
   │──< ProductAllergen >── Allergen     Product ──1 NutritionFacts
Package(parent_package_ref ↺ self, C7) · MealType · DietStatus · Tag · PackageForType
RoutingRule → SectionMaster(M16)
```

### Product — std, importable (legacy [V])
| code · name ntext ✔ · category/meal_type_ref ref(MealType) · price money [NC currency, DM-07] · active ✔ · description ntext · tags refs(Tag) |

### ProductComponent — std (BR-010 multi-section meals)
| product_ref ✔ · name ntext ✔ · sequence number | Routing may target component (RoutingRule.scope) |

### Package — std, importable (legacy [V]; sub-package via parent_package_ref [I — C7])
| name ntext ✔ · parent_package_ref ref(Package) – · duration_days number – [NC] · meals_per_day number – [NC] · price money ✔ · package_for_ref ref(PackageForType) · active ✔ |

### Masters: MealType / DietStatus / Tag / PackageForType / Ingredient / Allergen — std, importable (legacy [V])
| name ntext ✔ · active ✔ | Allergen adds: default_severity enum(ALLERGY_SEVERITY) – [NC] |

### ProductIngredient / ProductAllergen — std
| product_ref ✔ · ingredient/allergen_ref ✔ · ProductAllergen.source enum(ALLERGEN_SOURCE: declared, derived_from_ingredient) ✔ |

### NutritionFacts — std (BR-038; fields nullable until content work done [NC mandatory set — S8 Q22])
| product_ref ✔ unique · calories number – · protein_g number – · carbs_g number – · fat_g number – · notes ntext – |

### RoutingRule — config-class (ADR-006: Kitchen-Manager-editable data) [NC content — DEC-006]
| scope enum(ROUTING_SCOPE: product, component, meal_type) ✔ · target_ref ✔ · section_ref ref(SectionMaster) ✔ · active ✔ · effective_from date | kitchen.routing_changed audit |

## Intake cluster — M01 · M17 · M02

```
DraftOrder ──< DraftItem        DraftOrder ──< WhatsAppMessageRef (M17, immutable)
DraftOrder ──1 ReviewQueueItem ──< ReviewDecision (append)
DraftOrder ──(on approve, WF-04)──► Order (M03)
```

### M01 DraftOrder — std (C6/DM-02: business statuses DRAFT/PENDING_REVIEW project from `state`)
| Field | Type | Req | Vis | Notes |
|---|---|---|---|---|
| state | enum(DRAFT_STATE: open, submitted, returned, converted, rejected, cancelled, expired) | ✔ | – | `open/returned`→DRAFT; `submitted`→PENDING_REVIEW |
| channel | enum(CHANNEL: whatsapp, phone, walk_in, staff, other) | ✔ | – | BR-002 |
| customer_ref | ref(Customer) | – | – | Null + `unverified_customer` flag allowed (WF-02 exception) |
| unverified_customer | flag | ✔ | – | |
| requested_package_ref / items | ref(Package) / child DraftItems | – | – | Incomplete allowed (BR-003) |
| start_date / end_date | date | – | – | |
| address_ref or address_inline | ref(Address) / json PII | – | PII | Inline allowed pre-customer-confirm |
| slot_ref / method_ref | ref(DeliverySlot/Method) | – | – | |
| coupon_code | text | – | – | Validity check [NC rules — legacy coupon logic unknown] |
| expected_payment_method | enum(PAY_METHOD) | – | – | [NC values — S7] |
| price_estimate | money | – | PAY | Computed |
| completeness | json (per-field flags) | ✔ | – | Drives incomplete queue |
| allergy_conflicts | json (computed, DM-04) | ✔ | HEALTH | From CustomerAllergy × Package/Product allergens |
| notes | text | – | – | |
| sla timestamps | submitted_at, returned_at… | – | – | Intake funnel report |

### M01 DraftItem — std
| draft_ref ✔ · product_ref ✔ · qty number ✔ · note text |

### M17 WhatsAppMessageRef — frozen (immutable once written; BR-002)
| draft_ref ✔ · sender_phone text ✔ PII · message_at datetime ✔ · ref_note text · captured_by ✔ | Future WhatsAppMessage(content, consent_flag) adds alongside, never alters refs (ADR-007) |

### M02 ReviewQueueItem — std
| draft_ref ✔ unique-active · entered_at ✔ · sla_due_at ✔ (setting-driven) · reviewer_ref – · queue_state enum(QUEUE_STATE: waiting, in_review, decided) ✔ |

### M02 ReviewDecision — append
| draft_ref ✔ · decision enum(REVIEW_DECISION: approve, reject, return, hold) ✔ · reason_code ref(ReasonCode) ✔ for reject/return · note text · warnings_overridden json (allergy override requires reason — WF-04) · decided_by ✔ · decided_at ✔ | order.approved/rejected audit (HIGH on override) |

## Order cluster — M03 · M07

```
Order ──< OrderItem(frozen) ── Order ──< FulfillmentDay ──< KitchenTicket(M08, derived)
  │──< OrderStatusHistory(append)        │──< (Phase4: DriverAssignment stub)
  │──< ChangeRequest                     
  │──< PaymentRecord(M07) ──< PaymentReviewItem
  │──< ExceptionCase
```

### M03 Order — std, importable (active-plan import only, ADR-010)
| Field | Type | Req | Vis | Notes |
|---|---|---|---|---|
| order_number | text business-no | ✔ | – | Legacy parity [V]; sequence per DM-01 |
| customer_ref | ref(Customer) | ✔ | – | |
| package_ref + package_name_frozen | ref + ntext | ✔ | – | Name frozen at approval |
| status | enum(ORDER_STATUS: draft, pending_review, approved, active, paused, completed, expired, cancelled, rejected) | ✔ | – | First two are projections (C6); both EXPIRED & COMPLETED kept [NC item 1] |
| start_date / end_date | date | ✔ | – | Legacy [V] |
| off_days | json (weekday list) | – | – | BR-036 [NC legacy visibility] |
| channel / source_draft_ref | enum / ref(DraftOrder) | ✔/– | – | Imported plans: null draft, origin=legacy |
| coupon_code_frozen | text | – | – | Legacy [V] |
| package_amount / discount / total | money | ✔ | PAY | Legacy [V amounts] |
| site_ref | ref | – | – | Dormant [NC multi-site] |

### M03 OrderItem — frozen (snapshot at approval, ADR-010)
| order_ref ✔ · product_ref · name_frozen ntext ✔ · qty ✔ · unit_price_frozen money PAY · allergens_frozen json HEALTH · routing_hint_frozen json | Reports on "what was promised" read this, never live catalog |

### M03 FulfillmentDay — std
| order_ref ✔ · date ✔ · status enum(FULFILLMENT_STATUS: scheduled, kitchen_queued, in_preparation, ready_to_pack, packed, assigned_to_driver, out_for_delivery, delivered, failed, rescheduled, skipped, cancelled_day) ✔ (dispatch states dormant until P4) · slot_ref ✔ · address_ref_frozen ✔ PII · reschedule_link_ref ref(FulfillmentDay) – · skip/cancel reason_code – |

### M03 OrderStatusHistory — append
| subject enum(order, fulfillment_day) ✔ · subject_ref ✔ · from/to ✔ · actor ✔ · at ✔ · reason_code – | Mirrors order./fulfillment.status_changed events |

### M03 ChangeRequest — std (WF-15)
| order_ref ✔ · diff json ✔ · impact json (affected days, cutoff conflicts, price delta PAY) ✔ computed · state enum(CR_STATE: pending, approved, rejected, applied) ✔ · requested_by/decided_by ✔/– |

### M03 ExceptionCase — std (WF-14, BR-042 MVP-lite)
| type ref(ReasonCode domain=complaint/escalation) ✔ · refs json(order/day/customer/ticket) ✔ · severity enum(SEVERITY) ✔ (allergy-incident auto=high, DM-04) · state enum(CASE_STATE: open, in_progress, resolved) ✔ · owner_ref ✔ · resolution_code – · notes text |

### M07 PaymentRecord — std (record-only slice)
| order_ref ✔ · status enum(PAYMENT_STATUS: unpaid, link_sent, paid, failed, cod_pending, collected, refund_requested, refunded) ✔ (refund ops dormant [NC Q20]) · method enum(PAY_METHOD: link, gateway, cash, transfer, other) [NC values] · amount money ✔ PAY · transaction_ref text PAY (legacy [V]) · link_ref text PAY · evidence_note text PAY |

### M07 PaymentReviewItem — std
| payment_ref ✔ · requested_status ✔ · state enum(QUEUE_STATE) ✔ · decided_by(Finance) – · decided_at – | All decisions → payment.status_changed HIGH audit |

## Kitchen cluster — M08

### KitchenTicket — derived (regenerable from Order+RoutingRule; DM-05 unrouted handling)
| fulfillment_day_ref ✔ · section_ref ref(SectionMaster) – (null+`unrouted=true` = WF-07-E queue) · item_refs json(frozen OrderItem refs) ✔ · status enum(TICKET_STATUS: queued, in_progress, prepared, blocked) ✔ · allergy_marker flag ✔ (from OrderItem.allergens_frozen × CustomerAllergy — chain step 4, DM-04) · blocked_reason ref(ReasonCode) – · generation_batch ✔ (idempotent regeneration) |

### TicketStatusEvent — append
| ticket_ref ✔ · from/to ✔ · actor ✔ (shared-device: device_session + name_tap [Proposed — RBAC open Q2]) · at ✔ |

### Escalation — std (BR-015)
| ticket_ref ✔ · type ref(ReasonCode domain=escalation) ✔ · proposed_substitute ref(Product) – (allergy-rechecked on approval) · state enum(CASE_STATE) ✔ · resolved_by – |

## Notification cluster — M11 (lite)

### Template — config, versioned
| code ✔ · channel enum(NOTIF_CHANNEL: internal, email; dormant: whatsapp, push, sms) ✔ · body ntext ✔ · version ✔ · active ✔ |

### NotificationLog — append
| template_ref+version ✔ · recipient_type enum(staff_role, staff_user; dormant: customer) ✔ · recipient_ref ✔ · status enum(NOTIF_STATUS: sent, failed) ✔ · at ✔ · payload_summary json (no PII beyond necessity) |

## Bridge & migration cluster — M18 · M19

### M18 SyncRecord — std
| source enum(legacy) ✔ · object_type enum(SYNC_TYPE: customer, product, package, order, payment) ✔ · legacy_key text ✔ · new_ref – · last_seen_at ✔ · snapshot_hash text |

### M18 ReconciliationRun — append
| run_type enum(RECON_TYPE: daily_orders, weekly_catalog, payments) ✔ · counts json ✔ · diffs json ✔ · state enum(ok, divergent) ✔ · run_by ✔ (P1: human) | bridge.reconciliation_run WARN on divergence |

### M19 ImportBatch — std
| type enum(IMPORT_TYPE: customer, catalog, active_plans) ✔ · source_note ✔ · dry_run flag ✔ · counts json · state enum(IMPORT_STATE: dry_run, applied, rolled_back) ✔ |

### M19 ImportRowResult — append
| batch_ref ✔ · row_no ✔ · action enum(IMPORT_ACTION: created, matched, merge_review, skipped, error) ✔ · target_ref – · messages json |

## Dormant stubs (name + owner + activation only — no fields modeled, per MVP cut)

| Entity | Owner | Activates |
|---|---|---|
| Driver, Shift, CapacityRule, StopStatus | M10 | Migration Phase 4 design refresh |
| DriverAssignment, Manifest | M09 | Phase 4 |
| DeliveryEvent (append) | M09/M10 | Phase 4 |
| CartSession, CheckoutSession | M06 | Pending workshop S1 Q1 (customer surface) |
| WhatsAppMessage (content+consent) | M17 | DEC-002 = API |

## Entity → workshop dependency summary

Zero-row-ready (model complete, content pending workshop): SectionMaster, Area, RoutingRule, ReasonCode, ALLERGY_SEVERITY scale, PAY_METHOD values, NutritionFacts mandatory set, off_days semantics, draft retention, slot capacity unit.
