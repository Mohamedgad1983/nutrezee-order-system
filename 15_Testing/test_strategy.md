# Phase 4E — Test Strategy

**Date:** 2026-06-11 · **Status:** Proposed (suite definitions fixed; UAT *content* gated on workshop-baselined rule values — templates only where marked [NC])
Principle: the named suites below are **CI gates wired into WP definitions of done** (`codex_implementation_sequence.md`) — a WP is not done while its suites are red. No application code exists yet; this strategy precedes it deliberately.

## Suite register

### TS-U — Unit
| Area | Cases |
|---|---|
| Transition engine | **Every row of the L1/L2/payment/ticket/draft transition tables = one allow case; every absent (from,to) pair = one deny case** (generated from `transition_config` seed, not hand-written — stays correct when workshop edits config) |
| Validation slots | Each slot in validation_rules_binding §1: phone normalization (incl. unparseable), duplicate-check behaviors, WhatsApp ref requirement, completeness sets, date rules, money ≥ 0, coupon modes (off/warn/strict), slot capacity modes |
| Dedup functions | Normalization table-driven cases; fuzzy-match boundaries; in-batch duplicate handling |
| Allergy conflict computation | CustomerAllergy × declared/derived allergens; recompute triggers on item/customer change |
| Completeness engine | Per-field flags drive incomplete queue membership |

### TS-I — Integration (DB-backed)
| Area | Cases |
|---|---|
| Same-transaction audit | Audit acceptance test #3 verbatim: forced audit-insert failure aborts the business write |
| Append-only/frozen guards | UPDATE/DELETE attempts on all 9 append-only tables + order_item frozen guard → rejected at DB **and** repo layer |
| Outbox | Business write + outbox row commit atomically; dispatcher at-least-once; consumer dedupe on event_id |
| Single-write-path | Cross-module direct-table-write attempt fails CI scan (foundation §1 guard) |
| Optimistic locking | Stale version → conflict_stale |
| Idempotency | Same Idempotency-Key replay returns original result, no duplicate row |

### TS-M — Migration
Dry-run fixtures per batch (synthetic legacy CSVs matching screen-evidenced fields); idempotent re-run = no-op; rollback paths incl. blocked-rollback (post-import write present); edge cases: unparseable phone, in-batch duplicate, unmatched package, unmapped payment status → finance queue, off_days_unverified set (A2), gates §4 thresholds trip correctly.

### TS-R — RBAC
**Matrix-generated:** for every operation in module_api_contracts × every of the 12 roles → allow/deny assertion generated from the M13 config (single source — test fails if code and matrix drift; replaces manual case writing). Plus: masking per visibility class (PII/HEALTH/PAYMENT sentinel + masked:true), staged-mode behavior (log/warn/deny), dormant-role grant alert, AD level-cap, kitchen actor capture (device_session+name_tap [Proposed]).

### TS-A — Audit (the five acceptance tests from audit_architecture, verbatim, as a named CI suite)
1. Reconstruct one order end-to-end from audit alone (intake→approval→kitchen→cancel). 2. Immutability (no role can alter/delete). 3. Same-transaction (=TS-I case, run here too). 4. Masked rendering per reader. 5. HIGH-severity weekly review query returns complete set. **GAP-AUD-01 is declared closed only when TS-A passes on staging with pilot data.**

### TS-C — API contract
Per-operation conformance vs module_api_contracts: request/response field shapes, error codes, pagination envelope, `not_enabled` on all dormant operations (refunds, dispatch, webhooks, customer notifications), **no-GET-mutation scan** (router-level static check + runtime probe).

### TS-E — Event & replay
Envelope v1 conformance per family; ordering per subject; **projection rebuild equality**: replay full outbox history → intake funnel, daily ops, kitchen day-list projections byte-equal to incrementally-built state (event_catalog consumer rule; kitchen day-list additionally cross-checked against derived KitchenTicket regeneration).

### TS-S — Mandatory end-to-end scenarios
1. **Allergy chain steps 1–7** (validation binding §2) — profile → intake conflict → review override (HIGH audit) → frozen allergens → ticket marker → substitution recheck → incident escalation. Non-negotiable before pilot.
2. WhatsApp draft with message ref → incomplete → resume by phone search → submit → approve → days generated → tickets → ready_to_pack → packed.
3. Same-day cancel after kitchen_queued (OM ack + kitchen alert).
4. Change request with day regeneration + price delta.
5. Payment: link_sent → finance confirms paid (FI-only, HIGH audit); unmapped legacy status lands in finance queue.
6. Customer merge with draft re-link + undo.
7. Reconciliation divergence → alert → resolution note.

## UAT (templates now, content [NC])

UAT scripts derive from validation rule slots + workflows WF-01…08/12…16; **content finalizes only after the workshop baselines rule values** (cutoffs, mandatory fields, reason codes, sections). Template per script: role, preconditions, steps, expected status/audit/notification, settings under test. Pilot UAT scope: one agent + one kitchen section + Ops Manager + Finance.

## Environments & gates

| Gate | Suites required green |
|---|---|
| WP-01 exit (foundation) | TS-I (audit/append-only/outbox), TS-A #2/#3, TS-R (log-mode) |
| Each business WP exit | Its TS-U/TS-I/TS-C slices + cumulative TS-R |
| Pre-pilot (WP-14 entry) | All suites incl. TS-S 1–7, TS-A full on staging, TS-M applied-mode rehearsal |
| Go-live | MVP success criteria §7 (mvp cut) + 30-day reconciliation clock started |

Regression duty (BO-5): the 50-screen coverage checklist maps to MVP-replaced slices only (order lists/create, pre-kitchen check); mapping table maintained in `15_Testing/` as WP-14 deliverable. Performance: baseline load test on queue/board/report queries at pilot volumes [Proposed thresholds at DEC-011]; legacy timeout lessons (GAP-SCA-03) inform the board/report query budgets.
