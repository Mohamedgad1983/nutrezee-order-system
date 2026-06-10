# Nutrezee Order System — Phase 4 Executive Summary
## Physical Design · Backend Blueprint · Testing Strategy · Migration Execution · Build Sequence

**Date:** 2026-06-11 · **Status:** For review · **Stack posture:** DEC-011 OPEN at execution time → **PostgreSQL designed as Proposed target** (portable fallbacks noted); application language/framework deliberately left to DEC-011.
**Confirmation: no application code was written.** DDL fragments and patterns in these documents are design artifacts; nothing was executed, scaffolded, or migrated.

## What Phase 4 produced

Six engineering documents + this summary + a build handoff: a **physical schema** (~50 tables in 5 dependency-ordered creation waves, every index justified by a named operation, append-only/frozen enforcement patterns, audit partitioning); a **backend foundation blueprint** (modular monolith posture, four-layer module pattern, same-transaction audit, transactional outbox, config-seeded transition engine, staged RBAC enforcement); **per-module technical specs** for all 16 MVP modules including the closed list of allowed cross-module calls; an **executable migration plan** (three batches with data-quality gates, rollback preconditions, cutover-weekend runbook); a **test strategy** (8 suites — notably matrix-*generated* RBAC tests and transition tests generated from config, so workshop edits can't silently drift from code); and the **Codex implementation sequence** (WP-01…14 with stop-rules and a five-condition entry gate).

## Key physical-design decisions

1. **Generated-from-config testing:** transition and RBAC test suites generate from `transition_config` and the M13 matrix — single source of truth survives workshop changes.
2. **`order` → `customer_order`** (PG reserved word); `notification_template` naming hygiene.
3. **Soft phone uniqueness:** non-unique index + intake-level enforcement per setting — family-shared phones [NC] can't corrupt dedup.
4. **Audit volume:** monthly range partitions mapped to the retention tiers.
5. **One day-unit per order-date** (UNIQUE(order_id, date)); reschedules create new linked rows.
6. **New amendments:** **A3** `transition_config` (state machines as M16 config data) and **A4** platform tables (`outbox_event`, `idempotency_key`, `audit_read_queue`) — the physical realization of patterns Phase 3 specified abstractly. A1 (customer.email) and A2 (off_days_unverified) applied and logged.

## Open [NC] items and what they block

Full register in `19_Roadmap/phase_4_to_build_handoff.md` §3. The pattern: **structure is closed, content is open.** Foundation and data WPs (01–06) tolerate NC-carry; **WP-07 (intake field set), WP-09 (DEC-005 finals + cutoff), WP-10 (sections content), WP-13 (legacy vocab + access), and WP-14 (everything)** have hard workshop dependencies written into their stop-rules.

## The build entry gate — nothing starts before all five

① DEC-011 signed · ② DEC-003 signed · ③ **R1 closed (six commits still have no remote)** · ④ staging + CI live · ⑤ workshop held (or sponsor formally accepts NC-carry for WP-01–06 only).

## First build session

**WP-01 Platform foundation:** wave-1 DDL + seeds, authn/session, staged RBAC, audit write path, outbox, idempotency, CI guards — done when the audit acceptance tests #2/#3, the integration suite, and the generated RBAC suite (log mode) are green. Scope is deliberately boring: the foundation everything else inherits.
