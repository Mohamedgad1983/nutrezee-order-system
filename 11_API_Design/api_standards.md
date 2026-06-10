# Phase 3E (part 1) — API Standards

**Date:** 2026-06-11 · **Status:** Baselined v1.0 — stack-agnostic resource contracts (REST-style semantics); no OpenAPI/framework detail until DEC-011.

## Core rules (inherited, non-negotiable)

1. **No state change on GET** — ever (guardrail 1, born from legacy GAP-SEC-02 [V]).
2. **Transitions are explicit operations:** `POST <entity>/{id}/transitions` with `{to, reason_code?, note?}` — the ONLY way a status changes. The operation enforces, atomically: RBAC role check → validation per status model → StatusHistory append → audit write → event emission. No generic PATCH on status fields.
3. **Same-transaction audit:** mutation endpoints fail if the audit write fails (ADR-005).
4. **Masked rendering:** PII/HEALTH/PAYMENT fields are response-shaped per the caller's visibility grants (M13). Masking is serialization-level; storage is never the masking layer. Masked fields return a sentinel `"***"` + `masked: true` metadata, never silent omission [Proposed — keeps UIs honest].
5. **Idempotency:** create operations require an `Idempotency-Key`; retries return the original result.
6. **Bilingual:** `ntext` pairs travel as `{en, ar}` objects.
7. **Dormant operations** (P4 dispatch, refunds pre-Q20, WhatsApp API) are specified but flagged `dormant` — they return `not_enabled` until their feature flag/phase activates.

## Request context

Every call carries authenticated staff context (session from M12). Server derives: staff_id, active roles, visibility grants. APIs never accept actor identity from the client body. `on_behalf_of` (customer requests) is an explicit body field where workflows need it (cancel, pause).

## Standard envelope

**List responses:** `{items: [], page: {cursor_next?, limit}, total_estimate?}` — cursor pagination [Proposed]; filters as documented query params per operation; default + max limits set in M16.
**Errors:**

| Field | Content |
|---|---|
| error_code | Stable machine code (registry per module, e.g. `validation_failed`, `transition_not_allowed`, `role_denied`, `idempotency_replay`, `not_enabled`, `conflict_stale`, `not_found`) |
| message | Human EN (UI localizes) |
| field_errors[] | `{field, rule, detail}` for validation failures |
| trace_ref | Correlation id for support |

**Concurrency:** mutable entities carry `version`; updates send it back; mismatch → `conflict_stale` (optimistic locking) [Proposed].

## Operation classes

| Class | Pattern | Audit |
|---|---|---|
| Create | POST collection (+Idempotency-Key) | *.created |
| Read/List | GET (filters, pagination) | Sensitive panels/exports only (BR-043) |
| Update | PUT/PATCH with version (field diff audited) | *.updated/edited |
| Transition | POST /{id}/transitions | status_changed family |
| Decide | POST /{id}/decisions (review, payment, change requests) — append-only decision record | decision events, HIGH on overrides |
| Config | Settings/rules CRUD with effective dating | settings.changed WARN/HIGH |

## Sensitive-read logging

Opening a full PII/HEALTH/PAYMENT panel and every export emits the corresponding read-audit (customer.pii_viewed, data.exported) — async-tolerant queue (audit_architecture §2). List views with masked fields do NOT log per-row (volume rule).

## Export rule (INT-06)

Exports are operations (`POST <report>/exports`), produce complete files or fail (no partials), and always audit `data.exported {what, filters, row_count}`. Export rights per RBAC matrix Exports row.
