# Phase 4B — Physical Schema Design (PostgreSQL-ready)

**Date:** 2026-06-11 · **Status:** **Proposed** (DEC-011 OPEN — PostgreSQL is the Proposed target per sponsor direction in the Phase 4 prompt; portable-fallback notes included) · **Owner:** Data Architect
Source: `logical_data_model.md` (38 MVP entities) + amendments **A1** (customer.email added here, logged) and **A2** (off_days_unverified flag). This is a design document — DDL fragments are design artifacts; **no migration has been executed**.

## 0. Global mapping rules (applied to every table)

| Logical | PostgreSQL | Notes |
|---|---|---|
| id | `text PRIMARY KEY` — ULID [Proposed; UUIDv7 acceptable alternative at DEC-011] | Time-sortable (DM-01); generated app-side |
| ref(X) | `text NOT NULL REFERENCES x(id) ON DELETE RESTRICT` | RESTRICT everywhere; zero CASCADE (audit refs must never vanish); nullable refs drop NOT NULL |
| ntext | `<f>_en text NOT NULL`, `<f>_ar text` | `_ar` NOT NULL only on customer/kitchen-facing content [Proposed — dictionary §5] |
| money | `amount bigint NOT NULL CHECK (amount >= 0)` + `currency char(3) NOT NULL DEFAULT 'SAR'` | Minor units (DM-07); **default currency [NC — single currency assumed [A], confirm at workshop]** |
| date / datetime / time | `date` / `timestamptz` (UTC) / `time` | FulfillmentDay.date is business-local calendar date (dictionary §5) |
| enum (workshop-changeable) | FK to `reason_code` or own lookup table | Never PG native enums for these (data_dictionary §4 flags) |
| enum (fixed system) | `text CHECK (col IN (...))` | Statuses listed verbatim from status model [Proposed DEC-005] |
| flag | `boolean NOT NULL DEFAULT false` | |
| json-config | `jsonb` | Sub-schemas documented in module specs; consumers tolerate unknown keys |
| std lifecycle | `created_at timestamptz NOT NULL DEFAULT now(), created_by text REFERENCES staff_user(id), updated_at timestamptz, updated_by text REFERENCES staff_user(id), version integer NOT NULL DEFAULT 1` | version = optimistic lock (api_standards) |
| append-only | std minus updated_*/version + enforcement §5 | |
| importable | `origin text NOT NULL DEFAULT 'new' CHECK (origin IN ('new','legacy')), import_batch_id text REFERENCES import_batch(id)` | ADR-010 |

Naming: snake_case; **`order` is reserved → table `customer_order`**; `notification_template` (not `template`). All FKs indexed unless covered by a listed composite.

## 1. Platform realization tables (new in physical design — logged as amendments)

| Amendment | Table | Purpose | Key columns |
|---|---|---|---|
| **A3** | `transition_config` | Config-seeded state machines (validation binding §4) — L1/L2/payment/ticket tables stored as data, owned M16 | machine text CHECK(machine IN ('order','fulfillment','payment','ticket','draft')), from_status text, to_status text, allowed_roles jsonb, validations jsonb, requires_reason boolean, active boolean; UNIQUE(machine, from_status, to_status) |
| **A4a** | `outbox_event` | Transactional outbox — event publishing in same transaction as business write (4C §5) | id, event_type text, version int, occurred_at, actor jsonb, refs jsonb, payload jsonb, dispatched_at timestamptz NULL |
| **A4b** | `idempotency_key` | Create-operation replay protection (api_standards) | key text PK, operation text, request_hash text, response_ref text, created_at; retention sweep [Proposed 7 days] |
| **A4c** | `audit_read_queue` | Async-tolerant sensitive-read logging buffer (audit_architecture §2) | id, payload jsonb (AuditEvent shape), enqueued_at, drained_at NULL |

## 2. Table catalog by creation wave (FK-dependency-sorted = migration order)

### Wave 1 — Foundation (M13 · M14 · M16 · M12 + platform)
| Table | Columns (beyond global rules) | Constraints / notes |
|---|---|---|
| `staff_user` | name_en, name_ar, email text NOT NULL UNIQUE (PII), phone text (PII), active bool DEFAULT true, locale text CHECK (locale IN ('en','ar')) | Deactivate-not-delete |
| `role` | code text UNIQUE, name_en/_ar, active, dormant bool | Seed 12 roles (8 active) per rbac_architecture |
| `permission` | code text UNIQUE (module.action[.scope]), visibility_grants jsonb | Code-defined vocabulary, seeded |
| `role_permission` | role_id→role, permission_id→permission | UNIQUE(role_id, permission_id) |
| `role_assignment` | staff_id→staff_user, role_id→role, assigned_by→staff_user, assigned_at | UNIQUE(staff_id, role_id); writes only via M13 grant API (C4) |
| `session` | staff_id, started_at, expires_at, ended_at NULL, source jsonb | Index (staff_id, expires_at) |
| `audit_event` | event_type text, actor_id text NULL (system actions), actor_role text, on_behalf_of text NULL, entity_type text, entity_id text, related_refs jsonb, before jsonb, after jsonb, occurred_at, source jsonb, severity text CHECK (severity IN ('info','warn','high')), reason text | **Append-only §5; monthly RANGE partitions on occurred_at [Proposed]; retention tiers via partition archival (audit_architecture)** |
| `setting` | key text UNIQUE, value jsonb, value_type text CHECK, scope text, effective_from timestamptz, version int, editable_by_roles jsonb | Seed registry from validation binding §3 |
| `feature_flag` | key text UNIQUE, on_flag bool, note text | Carries cutover flags |
| `reason_code` | domain text CHECK (domain IN ('rejection','cancellation','return_to_draft','day_cancel','ticket_block','escalation','complaint','payment_fail','merge')), code text, label_en/_ar, active | UNIQUE(domain, code); content [NC workshop] |
| `section_master` | code UNIQUE, name_en/_ar, active, manager_id→staff_user NULL, site_ref text NULL | Zero rows until DEC-006 [NC] |
| `area` | code UNIQUE, name_en/_ar, active | Zero rows [NC] |
| `delivery_slot` | label_en/_ar, start_time time, end_time time, capacity int NULL, active | CHECK (start_time < end_time); legacy import [V] |
| `delivery_method` | name_en/_ar, active | Legacy import [V] |
| + platform tables §1 | | transition_config seeded from status model [Proposed] |

### Wave 2 — Masters, customers, catalog, import (M05 · M04 · M19 + sync)
| Table | Columns | Constraints / notes |
|---|---|---|
| `import_batch` | type text CHECK (type IN ('customer','catalog','active_plans')), source_note text, dry_run bool, counts jsonb, state text CHECK (state IN ('dry_run','applied','rolled_back')) | |
| `import_row_result` | batch_id→import_batch, row_no int, action text CHECK (action IN ('created','matched','merge_review','skipped','error')), target_ref text NULL, messages jsonb | Append-only; index (batch_id, action) |
| `meal_type` / `diet_status` / `tag` / `package_for_type` / `ingredient` | name_en NOT NULL, name_ar NOT NULL, active; importable | Bilingual masters [V] |
| `allergen` | name_en/_ar NOT NULL, default_severity text NULL CHECK (IN ('note','avoid','severe')) [NC scale], active; importable | |
| `customer` | full_name_en NOT NULL, full_name_ar, **email text NULL (PII) — AMENDMENT A1 applied**, dob date NULL (PII), language CHECK, diet_status_id→diet_status NULL (HEALTH), status CHECK (IN ('active','inactive','merge_pending')), notes text (PII); importable | Index lower(full_name_en) for fuzzy assist |
| `customer_phone` | customer_id→customer, phone_normalized text NOT NULL, phone_raw text, label text, is_primary bool, whatsapp bool; importable | **Non-unique index (phone_normalized)** — duplicates possible across family members [NC]; uniqueness enforced softly at intake per setting (validation binding §1) [Proposed]; partial UNIQUE (customer_id) WHERE is_primary |
| `address` | customer_id→customer, label text, area_id→area, address_text text NOT NULL (PII), location_pin jsonb NULL (PII), delivery_notes text, active; importable | |
| `customer_allergy` | customer_id, allergen_id→allergen, severity text NULL [NC], note text (HEALTH) | UNIQUE(customer_id, allergen_id) |
| `preference` | customer_id, key text CHECK, value text | UNIQUE(customer_id, key) |
| `merge_record` | winner_id→customer, loser_id→customer, field_decisions jsonb, merged_by, undo_until timestamptz | Append-only |
| `product` | code text NULL, name_en/_ar NOT NULL, meal_type_id NULL, price bigint+currency, active, description_en/_ar, tags jsonb; importable | |
| `product_component` | product_id→product, name_en/_ar, sequence int | |
| `product_ingredient` | product_id, ingredient_id | UNIQUE pair |
| `product_allergen` | product_id, allergen_id, source CHECK (IN ('declared','derived_from_ingredient')) | UNIQUE(product_id, allergen_id) |
| `nutrition_facts` | product_id UNIQUE→product, calories int NULL CHECK (>=0), protein_g/carbs_g/fat_g numeric(6,1) NULL CHECK (>=0), notes_en/_ar | Nullable until content work [NC mandatory set] |
| `package` | name_en/_ar NOT NULL, parent_package_id→package NULL, duration_days int NULL, meals_per_day int NULL, price bigint+currency, package_for_id NULL, active; importable | **No-cycle trigger on parent chain (C7)** |
| `routing_rule` | scope CHECK (IN ('product','component','meal_type')), target_ref text, section_id→section_master, active, effective_from date | Zero rows until DEC-006; kitchen.routing_changed audit |
| `sync_record` | source text CHECK ('legacy'), object_type CHECK (IN ('customer','product','package','order','payment')), legacy_key text, new_ref text NULL, last_seen_at, snapshot_hash text | **UNIQUE(object_type, legacy_key)** — import idempotency anchor |

### Wave 3 — Intake (M01 · M17 · M02)
| Table | Columns | Constraints / notes |
|---|---|---|
| `draft_order` | state CHECK (IN ('open','submitted','returned','converted','rejected','cancelled','expired')), channel CHECK (IN ('whatsapp','phone','walk_in','staff','other')), customer_id NULL, unverified_customer bool, package_id NULL, start_date/end_date date NULL, address_id NULL, address_inline jsonb NULL (PII), slot_id NULL, method_id NULL, coupon_code text, expected_payment_method text NULL [NC values], price_estimate bigint NULL (PAY), completeness jsonb, allergy_conflicts jsonb (HEALTH), notes, submitted_at/returned_at timestamptz NULL | Index (state, created_at); partial index (state) WHERE state='open' for incomplete queue |
| `draft_item` | draft_id→draft_order, product_id→product, qty int CHECK (>0), note | |
| `whatsapp_message_ref` | draft_id→draft_order, sender_phone text NOT NULL (PII), message_at timestamptz NOT NULL, ref_note text, captured_by | **Append-only (immutable refs)** |
| `review_queue_item` | draft_id→draft_order, entered_at, sla_due_at, reviewer_id NULL, queue_state CHECK (IN ('waiting','in_review','decided')) | Partial UNIQUE(draft_id) WHERE queue_state != 'decided'; index (queue_state, sla_due_at) — queue ordering |
| `review_decision` | draft_id, decision CHECK (IN ('approve','reject','return','hold')), reason_code_id→reason_code NULL (req. reject/return — app-enforced + CHECK (decision NOT IN ('reject','return') OR reason_code_id IS NOT NULL)), note, warnings_overridden jsonb, decided_by, decided_at | Append-only |

### Wave 4 — Orders & payments (M03 · M07)
| Table | Columns | Constraints / notes |
|---|---|---|
| `customer_order` | order_number text UNIQUE NOT NULL, customer_id→customer, package_id→package NULL, package_name_frozen_en/_ar, status CHECK (IN ('draft','pending_review','approved','active','paused','completed','expired','cancelled','rejected')) [Proposed — both expired & completed kept, NC item 1], start_date/end_date date, off_days jsonb, **off_days_unverified bool DEFAULT false — AMENDMENT A2**, channel, source_draft_id→draft_order NULL, coupon_code_frozen text, package_amount/discount/total bigint (PAY)+currency, site_ref NULL; importable | Index (status, start_date); (customer_id); order_number prefix rule for new rows (setting order_number_prefix) |
| `order_item` | order_id→customer_order, product_id NULL, name_frozen_en/_ar NOT NULL, qty, unit_price_frozen bigint (PAY), allergens_frozen jsonb (HEALTH), routing_hint_frozen jsonb | **Frozen: UPDATE forbidden by trigger after insert (§5 frozen guard)** |
| `fulfillment_day` | order_id→customer_order, date date NOT NULL, status CHECK (IN ('scheduled','kitchen_queued','in_preparation','ready_to_pack','packed','assigned_to_driver','out_for_delivery','delivered','failed','rescheduled','skipped','cancelled_day')) — dispatch states dormant P4, slot_id, address_frozen jsonb NOT NULL (PII), reschedule_link_id→fulfillment_day NULL, reason_code_id NULL | UNIQUE(order_id, date) [Proposed — one day-unit per order-date]; index (date, status) — kitchen/day-board driver |
| `order_status_history` | subject CHECK (IN ('order','fulfillment_day')), subject_ref text, from_status, to_status, actor_id NULL, actor_note text ('system'), at timestamptz, reason_code_id NULL | Append-only; index (subject, subject_ref, at) |
| `change_request` | order_id, diff jsonb, impact jsonb (PAY inside), state CHECK (IN ('pending','approved','rejected','applied')), requested_by, decided_by NULL | |
| `exception_case` | type_code_id→reason_code, refs jsonb, severity CHECK (info/warn/high), state CHECK (IN ('open','in_progress','resolved')), owner_id→staff_user, resolution_code_id NULL, notes | Index (state, severity) |
| `payment_record` | order_id→customer_order, status CHECK (IN ('unpaid','link_sent','paid','failed','cod_pending','collected','refund_requested','refunded')) — refund pair dormant [NC Q20], method text NULL [NC values], amount bigint (PAY)+currency, transaction_ref text (PAY), link_ref text (PAY), evidence_note text (PAY); importable | Index (order_id); (status) |
| `payment_review_item` | payment_id→payment_record, requested_status text, state CHECK (waiting/in_review/decided), decided_by NULL, decided_at NULL | Index (state) — finance queue |

### Wave 5 — Kitchen, notifications, bridge (M08 · M11 · M18)
| Table | Columns | Constraints / notes |
|---|---|---|
| `kitchen_ticket` | fulfillment_day_id→fulfillment_day, section_id→section_master NULL, unrouted bool DEFAULT false, item_refs jsonb, status CHECK (IN ('queued','in_progress','prepared','blocked')), allergy_marker bool, blocked_reason_id→reason_code NULL, generation_batch text NOT NULL | CHECK (section_id IS NOT NULL OR unrouted); UNIQUE(fulfillment_day_id, section_id, generation_batch); partial index WHERE unrouted — WF-07-E queue; index (section_id, status) — board |
| `ticket_status_event` | ticket_id, from_status, to_status, actor jsonb (device_session + name_tap [Proposed — RBAC Q2]), at | Append-only |
| `escalation` | ticket_id, type_code_id→reason_code, proposed_substitute_id→product NULL, state CHECK, resolved_by NULL | |
| `notification_template` | code UNIQUE, channel CHECK (IN ('internal','email','whatsapp','push','sms')) — last 3 dormant, body_en/_ar, version int, active | Version pinning per send |
| `notification_log` | template_id+template_version, recipient_type CHECK (IN ('staff_role','staff_user','customer')) — customer dormant, recipient_ref, status CHECK (sent/failed), at, payload_summary jsonb | Append-only; index (at) |
| `reconciliation_run` | run_type CHECK (IN ('daily_orders','weekly_catalog','payments')), counts jsonb, diffs jsonb, state CHECK (ok/divergent), run_by | Append-only |

**Dormant — NO tables created** (deferral documented): driver, shift, capacity_rule, stop_status, driver_assignment, manifest, delivery_event (Phase 4 design refresh); cart_session, checkout_session (workshop S1 Q1); whatsapp_message content table (DEC-002).

## 3. Index register (every index justified)

| Index | Justifying operation |
|---|---|
| customer_phone(phone_normalized) | M04 search-by-phone — WF-01 step 1, dedup pipeline |
| review_queue_item(queue_state, sla_due_at) | WF-03 queue ordering |
| draft_order partial WHERE state='open' | BR-003 incomplete queue |
| fulfillment_day(date, status) | WF-07 cutoff sweep + kitchen day board |
| kitchen_ticket(section_id, status) / partial WHERE unrouted | Section board / unrouted alert |
| customer_order(status, start_date) | Lifecycle lists (legacy-parity views) |
| order_status_history(subject, subject_ref, at) | Timeline + audit reconstruction test |
| audit_event(entity_type, entity_id, occurred_at) + (event_type, occurred_at) + (severity) partial WHERE severity='high' | "History of X" / canned views / weekly HIGH review |
| payment_review_item(state) | Finance queue |
| sync_record UNIQUE(object_type, legacy_key) | Import idempotency |
| outbox_event partial WHERE dispatched_at IS NULL | Dispatcher sweep |
| import_row_result(batch_id, action) | Validation report + merge-review queue |

## 4. Append-only & frozen enforcement (§5 in prompts above)

```sql
-- Pattern (design artifact): applied to audit_event, order_status_history, review_decision,
-- ticket_status_event, notification_log, whatsapp_message_ref, merge_record,
-- import_row_result, reconciliation_run
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'append-only table'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
-- plus: REVOKE UPDATE, DELETE ON <table> FROM app_role;
-- frozen guard (order_item): same trigger on UPDATE only, allowing none after insert
```
Portable fallback: same guards expressible in any RDBMS with triggers; app-layer repository guard is the second line regardless (4C).

## 5. Traceability & deltas from logical model

| Delta | Logical source | Disposition |
|---|---|---|
| customer.email added | A1 (migration_mapping) | Applied + logged |
| customer_order.off_days_unverified | A2 | Applied + logged |
| transition_config table | validation binding §4 ("config-seeded") | **A3 — new config entity, owner M16** |
| outbox_event / idempotency_key / audit_read_queue | api_standards + audit_architecture patterns | **A4 — platform tables, owner foundation layer** |
| Table renames: customer_order, notification_template | PG reserved word / generic-name hygiene | Naming only; logical names unchanged |
| phone uniqueness soft (non-unique index) | DM-03 + family-sharing [NC] | [Proposed]; revisit at DEC-004 |
| fulfillment_day UNIQUE(order_id, date) | implied by calendar semantics | [Proposed]; reschedule creates a new date row, link preserved |

All other tables map 1:1 to logical entities. Retention: audit partitions per audit_architecture tiers; operational tables carry no TTL in MVP [NC legal review].
