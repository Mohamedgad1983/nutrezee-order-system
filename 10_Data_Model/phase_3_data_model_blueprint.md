# Phase 3A — Input Review & Data/API Blueprint Index

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (review) · **Owner:** Data Architect / Tech Lead
Labels: **[V]** Verified · **[I]** Inferred · **[A]** Assumed · **[NC]** Needs Confirmation.

## Output file set (Phase 3)

| File | Content |
|---|---|
| `10_Data_Model/phase_3_data_model_blueprint.md` | This review + index (3A) |
| `10_Data_Model/logical_data_model.md` | Entities + ERDs per MVP module (3B) |
| `10_Data_Model/data_dictionary.md` | Entity index, enum registry, conventions (3C) |
| `10_Data_Model/migration_mapping.md` | Legacy import mapping, dedup rules (3F) |
| `11_API_Design/api_standards.md` | Envelope, transitions, errors, masking (3E) |
| `11_API_Design/event_catalog.md` | Event families v1 (3D) |
| `11_API_Design/module_api_contracts.md` | Per-module operations (3E) |
| `08_Business_Rules/validation_rules_binding.md` | Validation + settings-driven rules (3G) |
| `00_Phase_3_Data_API_Executive_Summary.md` | Executive summary |
| `19_Roadmap/phase_3_to_phase_4_handoff.md` | Handoff |

## 1. Locked constraints inherited (not re-decided here)

1. One owning module per entity, single write path — ADR-010 [Accepted].
2. Append-only families: OrderStatusHistory, ReviewDecision, DeliveryEvent⁴, NotificationLog, AuditEvent — ADR-010.
3. Frozen-at-approval OrderItem snapshots — ADR-010.
4. Derived data regenerable (KitchenTicket, projections) — ADR-010.
5. Field-level visibility classes PII / HEALTH / PAYMENT — rbac_architecture.md, BR-043.
6. Same-transaction audit; no GET mutations — audit_architecture.md, ADR-005; target_architecture guardrails 1/7.
7. Bilingual EN/AR data fields — guardrail 5, legacy parity [V].
8. Events versioned v1, append-only, unknown-field-tolerant — guardrail 3.
9. `origin=legacy` + `import_batch` on imported rows — ADR-010.
10. Status vocabularies verbatim from `order_lifecycle_status_model.md` [Proposed pending DEC-005] — no new states invented here.
11. MVP scope per mvp_architecture_cut.md (ADR-009 [Proposed = DEC-003]) — dormant stubs only beyond it.

## 2. Open items affecting data/API design — and how each is kept flexible

| Open item | Source | Flexibility mechanism in this blueprint |
|---|---|---|
| DEC-004 customer identity key (phone [A]) | decision_register | `Customer.id` internal surrogate is the identity; phone is a unique-candidate matching index on `CustomerPhone`, demotable without remodel |
| DEC-005 state machine finals (EXPIRED vs COMPLETED, cutoffs, draft retention) | status model §open items | Enums carry both states; transition table is config-validated at runtime (M16), not hard-coded; retention = setting `draft_retention_days` |
| DEC-002 WhatsApp transport | ADR-007 | `WhatsAppMessageRef` (MVP) is forward-compatible: future `WhatsAppMessage` adds content+consent without altering refs |
| DEC-009 payment gate, methods, refunds | status model, INT-03 | `payment_method` enum extensible [NC values]; gate = setting `payment_gate`; refund states exist in enum but no API operation until workshop Q20 confirms |
| DEC-006 sections/routing | ADR-006 | `SectionMaster` + `RoutingRule` are data; model complete with zero rows pre-workshop |
| DEC-011 stack | ADR list | All types logical (text/money/ref…); no DDL, no OpenAPI; identifiers ULID-or-equivalent [Proposed] |
| DEC-012 migration detail | ADR-010 | ImportBatch typed per scope (customer/catalog/active_plans); unknown legacy fields marked TBD-pending-access, never invented |
| RBAC open Qs 1–5 (catalog owner, shared kitchen device, reviewer=creator…) | rbac_architecture | Authz expressed as role lists per operation, swappable in M13 config; kitchen actor recorded as `device_session + name_tap` [Proposed] |
| Branch/multi-site [NC] | discovery [V-absence] | Optional nullable `site_ref` on Order/FulfillmentDay/SectionMaster, unused in MVP |

## 3. Contradictions & ambiguities found in Phase 1/2 inputs (reported, not silently resolved)

| # | Finding | Disposition |
|---|---|---|
| C1 | Step 2A (discovery repo) decided "build from scratch"; project mandate is extend-and-improve | Already reconciled as ADR-001 [Proposed]; no data-model impact |
| C2 | Screen-count variance across docs: 50 menu routes [V], 46 confirmed at Step 2C [V], "73 mapped items" in Step 2B feature map | The 73 counts sub-items/cards of the 50 routes; regression checklist uses the 50-route map. Noted; no action |
| C3 | Module catalog "51 modules / 11 domains" (Phase 1 exec) vs an earlier draft digest citing 38 | Grep-verified count is 51 (62 table rows − 11 headers); 51 stands |
| C4 | `data_ownership_blueprint` lists RoleAssignment "(with M12)" — dual ownership ambiguity | **Resolved here:** entity owned by M12 (staff lifecycle); grants executed only through M13 API (single write path preserved). Recorded in logical model |
| C5 | EXPIRED vs COMPLETED semantic overlap | Kept both [Proposed], workshop item 1; both in enum, transition-config decides |
| C6 | Status model says PENDING_REVIEW is an Order state; module blueprint holds drafts in M01 until approval creates the Order (M03) | **Resolved here:** DraftOrder (M01) carries states `open/submitted/returned/…`; the *business* statuses DRAFT/PENDING_REVIEW are projections of DraftOrder state; the Order row is created at approval (WF-04). API exposes the unified business status; storage split documented in logical model §M01/M03 |
| C7 | Legacy "sub-package" field on orders [V] has no defined master in discovery | Modeled as `Package.parent_package_ref` (self-reference) [I]; workshop S1 confirms |

## 4. Modeling decisions taken in Phase 3 (within Phase 2 rails)

| ID | Decision | Rationale |
|---|---|---|
| DM-01 | Internal surrogate IDs everywhere + business numbers preserved (`order_number` [V legacy]) | Migration-safe, DEC-004-safe |
| DM-02 | DraftOrder and Order are separate entities (C6) | Drafts are high-churn/incomplete; Orders are audited and frozen-snapshotted — different lifecycle classes |
| DM-03 | `CustomerPhone` is its own entity (multi-number families [NC]) with normalized E.164-style storage [Proposed] | Dedup quality (GAP-DQ-01) |
| DM-04 | Allergy chain carried by explicit fields end-to-end (3G §allergy chain) | BR-039 safety requirement must be schema-visible, not convention |
| DM-05 | Unrouted kitchen items = KitchenTicket with `section_ref = null, unrouted = true` | One queue, no parallel entity (WF-07-E) |
| DM-06 | ReasonCode registry in M16 for all taxonomies (rejection/cancel/failure/complaint/block) | Controlled lists, workshop-fillable, report-aggregable |
| DM-07 | Money as integer minor units + currency code [Proposed — currency NC, single-currency assumed [A]] | Avoids float; currency confirmable later |
| DM-08 | Audit is written directly (same transaction), events feed projections — audit is NOT an event consumer | Prevents audit depending on bus delivery (ADR-005 integrity) |
