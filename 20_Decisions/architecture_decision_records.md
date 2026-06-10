# Architecture Decision Records (ADR-001 … ADR-010)

**Date:** 2026-06-11 · Companion to `decision_register.md` (DEC-xxx = business decisions awaiting sponsor; ADR-xxx = architecture positions taken now, some provisional pending a DEC). Statuses: Proposed / Accepted / Needs Confirmation.

---

## ADR-001 — Extend vs Replace Strategy
- **Context:** Step 2A originally decided "build from scratch"; the project mandate (2026-06-10) is improve-and-extend; old-system source code has never been accessible (R2); the old dashboard is a verified functional baseline of 50 screens but a poor technical/security baseline (no RBAC/audit [V], unsafe routes [V]).
- **Decision:** Neither pure extension nor big-bang replacement. **Build new modules beside the running legacy system and take over workflows incrementally**, preserving the legacy system untouched as the fallback until each slice proves itself.
- **Options considered:** (a) Extend legacy codebase — impossible to commit to without source access; even with access, stack/quality unknown [NC]. (b) Big-bang rebuild — contradicts mandate; violates BO-5 no-regression; highest disruption risk for a live food operation. (c) Incremental coexistence — chosen.
- **Consequences:** Bridge module required (ADR-008); coexistence reconciliation overhead; legacy quick wins handled separately with legacy owner; old screens retire one-by-one with sign-off DECs.
- **Risks:** Coexistence drags on (mitigation: retirement dates on every bridge element).
- **Status:** **Proposed** → finalizes DEC-001 at Phase 0 exit (access disposition may still enable option (a) elements for quick wins).

## ADR-002 — Strangler-Fig Migration Approach
- **Context:** ADR-001 requires a concrete coexistence mechanic for a daily food operation that cannot stop (R10 double entry, R9 adoption).
- **Decision:** Strangler-fig with **per-workflow, per-date cutover**: a workflow lives in exactly one system at a time; the FulfillmentDay date is the cutover unit; every slice has rehearsed rollback and 30-day retirement criteria (`legacy_transition_architecture.md`).
- **Options:** Parallel-run both systems for everything (rejected: guaranteed double entry); feature-flag hybrid screens inside legacy (rejected: no source access, R2).
- **Consequences:** M18 bridge + M19 migration tooling are MVP modules; reconciliation reports become an operating ritual until Phase 5.
- **Risks:** Staff bypass policy cutover (mitigation: physical operation reads only new-system day-lists from cutover day — bypass becomes self-defeating).
- **Status:** **Accepted** (mechanic), pattern P1/P2/P3 selection **Needs Confirmation** (access).

## ADR-003 — Order Intake First
- **Context:** Six Critical gaps; limited capacity; mandate names intake/review as the starting workflow; intake is the root of the data-quality cascade (GAP-AUT-01 → DQ-03 → kitchen/delivery errors); `/orders/create` is the verified heart of the legacy workflow [V].
- **Decision:** First user-facing slice = M01 Intake + M02 Review + M03 Order Management (after the M13/M14/M16 foundation), per the enhancement spine and Step 2C recommendation.
- **Options:** Kitchen first (rejected: garbage-in without structured orders); analytics first (rejected: nothing reliable to measure); RBAC-only first (partially adopted — it IS first, but has no standalone business value).
- **Consequences:** Kitchen module consumes clean structured orders from day one of its build; intake staff are the first adopters (R9 focus).
- **Status:** **Accepted**.

## ADR-004 — RBAC Foundation
- **Context:** GAP-SEC-01 Critical: legacy grants every admin full PII/HEALTH/PAYMENT visibility [V]; BR-032/043; retrofitting access control is notoriously expensive.
- **Decision:** RBAC (M13) with field-visibility classes is built **before any business module**, enforced via staged rollout (log-only → warn → deny). 12 roles defined, 8 active in MVP (`rbac_architecture.md`).
- **Options:** Ship features first, add RBAC later (rejected: repeats legacy failure; R6); coarse module-level-only permissions (rejected: BR-043 demands field-level for health/payment data).
- **Consequences:** Every module API carries authz context from first commit; matrix needs workshop sign-off (S8).
- **Risks:** Over-restriction stalls ops — staged enforcement handles.
- **Status:** **Accepted** (model) / matrix content **Needs Confirmation**.

## ADR-005 — Audit Log Foundation
- **Context:** GAP-AUD-01 Critical; BR-033; legacy has zero traceability [V]; payment/health data present.
- **Decision:** Audit (M14) is a platform write-path service from first commit: same-transaction writes for state changes, immutable store, sensitive-read logging, retention tiers (`audit_architecture.md`).
- **Options:** Application logs as audit (rejected: mutable, unstructured, no actor semantics); audit per-module later (rejected: gaps guaranteed).
- **Consequences:** Slight write overhead everywhere; "reconstruct order from audit alone" is an MVP acceptance test.
- **Status:** **Accepted**; event list final confirmation at workshop (S8).

## ADR-006 — Kitchen Routing Priority
- **Context:** GAP-OPS-01 Critical; pain points 5–7; but DEC-006 (sections, routing rules, shifts) is unanswered [NC] and shop-floor adoption is risky (R9).
- **Decision:** Kitchen routing IS in MVP but as the **thin slice**: ticket generation + shared section board + escalations. Sections and routing rules are **Settings data editable by the Kitchen Manager — never code**. Chef personal app + shift assignment deferred to Phase 3.
- **Options:** Full chef app in MVP (rejected: DEC-006 inputs missing, adoption risk); kitchen out of MVP entirely (rejected: leaves a Critical gap open and makes intake's value invisible to operations).
- **Consequences:** WF-07-E unrouted queue absorbs rule gaps gracefully; pilot = one section.
- **Status:** **Accepted** (slice) / rule content **Needs Confirmation** (workshop S4).

## ADR-007 — WhatsApp Order Handling
- **Context:** WhatsApp is the assumed primary channel [A]; Business API feasibility unknown (R7); the Critical gap is **unstructured transcription**, not the transport.
- **Decision:** Channel-agnostic intake core (M01) + WhatsApp as an adapter (M17). MVP = manual-assisted structured capture with mandatory message reference (BR-002). API automation is an additive adapter swap, not a redesign. AI parsing (ENH-F-06) later still feeds the same draft pipeline.
- **Options:** Wait for API before building intake (rejected: leaves Critical gap open indefinitely); build API-first (rejected: account approval/cost unknown [NC]).
- **Consequences:** Transcription still human in MVP but structured, referenced, validated — error class changes from "lost/garbled" to "typo-in-form," which review catches.
- **Status:** **Accepted** (architecture) / transport timing = DEC-002 **Needs Confirmation**.

## ADR-008 — Legacy System Bridge
- **Context:** Coexistence needs data flow; legacy internals may never be accessible (R2); writing to legacy is impossible (no API [V-absence]) and undesirable.
- **Decision:** Bridge (M18) is **read-only toward legacy** with three escalating patterns selected by granted access: P1 manual reconciliation (baseline, works with zero access), P2 export/import batch, P3 read-replica. Every bridge element carries a retirement date.
- **Options:** Two-way sync (rejected: write risk to unaudited production, GAP-SEC-02 lesson); no bridge / hard cutover (rejected: BO-5 regression risk, no reconciliation).
- **Consequences:** MVP carries reconciliation labor under P1; bridge work shrinks as slices cut over.
- **Status:** **Accepted** (design) / pattern **Needs Confirmation** (Phase 0 access).

## ADR-009 — MVP Scope Boundary
- **Context:** 34 of 44 BRs are P0 (R5 scope overload); a live operation needs visible wins fast; six Critical gaps define "must".
- **Decision:** MVP = exactly the closure of the six Critical gaps: foundation (M13/14/16/12) + customers/catalog (M04/05 slices) + intake/review/orders (M01/02/03/17-manual) + kitchen thin slice (M08) + payment record-only (M07) + 3 reports + P1 bridge. Dispatch, labels, customer apps, API integrations, analytics suite, AI: **out** (`mvp_architecture_cut.md` §2 lists each with reason and return phase).
- **Options:** Include dispatch (rejected: DEC-008 inputs missing; kitchen must stabilize first); foundation-only MVP (rejected: no operational value, adoption momentum lost).
- **Consequences:** This is the DEC-003 recommendation; additions require sponsor amendment.
- **Status:** **Proposed** → sponsor sign-off = DEC-003.

## ADR-010 — Data Ownership Principles
- **Context:** Coexistence + future service-split both demand unambiguous data ownership; legacy data quality unknown [NC]; GAP-DQ-01 duplicates.
- **Decision:** One owning module per entity = single write path; append-only families for histories/decisions/events; frozen-at-approval order item snapshots; derived data always regenerable; imported rows tagged `origin=legacy`; PII/HEALTH/PAYMENT visibility at field level; migration scope = customers + catalog + active plans only (`data_ownership_blueprint.md`).
- **Options:** Shared-table free-for-all (rejected: legacy anti-pattern, untraceable); full-history migration (rejected: cost/quality risk for low-value closed orders — legacy stays queryable read-only for history).
- **Consequences:** Phase 3 schema design has fixed ownership rails; DEC-012 narrowed to "confirm the active-plan import details."
- **Status:** **Accepted** (principles) / migration scope detail **Needs Confirmation** (DEC-012).
