# Phase 4C (part 1) — Backend Foundation Blueprint

**Date:** 2026-06-11 · **Status:** Proposed (application stack open — DEC-011; patterns below are stack-agnostic with PostgreSQL-as-Proposed store) · **Owner:** Tech Lead
This blueprint applies to **every** module; per-module specifics live in `11_API_Design/backend_module_specs.md`. No application code exists yet — these are binding patterns for the build WPs.

## 1. Deployment & boundary posture

- **Modular monolith [Proposed]** (mvp cut §6): one deployable, one PostgreSQL database; modules M01–M19 are enforced package boundaries. Service split later only if DEC-011/scale demands — module boundaries are designed to survive extraction.
- **Dependency direction (enforced by build tooling):** foundation (M13 RBAC, M14 audit, M16 settings, M12 staff, platform) ← business modules. Business modules may depend on foundation + the owning-module APIs of entities they read; **never on each other's tables**.
- **No cross-module table writes** (ADR-010): repository layer is per-owning-module; other modules call its service API. CI check: SQL/table access scanned per package (WP-01 sets up the guard).
- App language/framework/ORM: **open — DEC-011.** Options note (not a decision): any mainstream stack with mature PG, transactions, and PWA-friendly web serving (e.g., TS/Node, Python, Kotlin/JVM, C#/.NET). Decide before WP-01.

## 2. Module layering (every module identical)

```
HTTP/API layer  → request parsing, authn context, idempotency check, RBAC operation check,
                  response shaping incl. visibility masking (api_standards rule 4)
Service layer   → business rules, transition engine calls, validation (rule slots from
                  validation_rules_binding §1), event composition, audit composition
Repository      → single write path for owned tables; read APIs for other modules;
                  append-only/frozen guards (second line behind DB triggers)
Store           → PostgreSQL [Proposed]; transactions owned at service boundary
```
One DB transaction per state-changing operation: business write + order_status_history + audit_event + outbox_event commit together or not at all.

## 3. Request pipeline (cross-cutting)

1. **Authn:** session token → `session` row valid & unexpired → staff context {staff_id, roles[]}; logout + idle timeout per setting (closes legacy GAP-SEC-04 pattern). Server-side actor only — never from client body.
2. **Idempotency:** POST-create requires `Idempotency-Key` → `idempotency_key` table check inside the transaction (A4b); replay returns stored response ref.
3. **RBAC operation check:** operation→roles map loaded from M13 config (mirrors module_api_contracts tables). **Staged enforcement** per role via setting `enforcement_mode`: `log` (record would-deny) → `warn` (allow + flag) → `deny`. Default at go-live: deny for the 8 MVP roles after pilot ramp [Proposed].
4. **Handler → service → repo** per §2.
5. **Response masking:** serializer consults visibility grants (PII/HEALTH/PAYMENT); masked fields → `"***" + masked:true` (api_standards rule 4). Masking is serialization-only; queries fetch full rows (storage never masks).
6. **Sensitive-read logging:** full-panel PII/HEALTH/PAYMENT reads and exports enqueue to `audit_read_queue` (A4c) in-request (cheap insert), drained to `audit_event` by a background sweep; reads never block on audit store health, write-ops do (restricted mode below).

## 4. Audit transaction handling (ADR-005 realized)

- **Write-path events:** composed in the service layer with before/after diffs (changed fields only) and inserted into `audit_event` **in the same transaction** as the business write. The five acceptance tests in audit_architecture §tests are CI gates from WP-01 onward.
- **Restricted mode:** if the audit insert fails (store degradation), the transaction aborts ⇒ state-changing operations are unavailable; read operations continue; `audit_read_queue` buffers. An operational alarm fires. [Proposed — business tolerance to confirm at workshop, flagged NC.]
- **Immutability:** DB triggers + revoked grants (physical schema §4) + no repository update/delete methods for append-only tables.

## 5. Event publishing (transactional outbox — A4a)

- Service composes the v1 envelope (event_catalog) → insert into `outbox_event` in the business transaction.
- **In-process dispatcher** [Proposed for MVP] sweeps undispatched rows (partial index), invokes consumers (M11 trigger router, M15 projection updaters), marks dispatched. At-least-once: consumers dedupe on event_id (catalog rule).
- **Replay harness:** projections (3 MVP reports) must rebuild bit-identically from `outbox_event` history — automated equality test in WP-12 DoD (event_catalog consumer contract). Security family (auth./rbac./staff.) is audit-only — never written to outbox (event_catalog rule, DM-08).

## 6. Transition engine (config-seeded — DEC-005 flexibility)

- Single engine component; machines (`order`, `fulfillment`, `payment`, `ticket`, `draft`) loaded from `transition_config` (A3), seeded from the status-model tables [Proposed].
- `transition(machine, subject, to, ctx)`: row lookup (from,to) → allowed_roles check → validations (named validator registry mapping to rule slots, e.g. `same_day_ack`, `allergy_override`, `payment_gate`) → history append → audit → outbox → status update. One transaction.
- Changing a transition rule = config change (settings.changed HIGH for gate-bearing rows), zero redeploy. Unknown (from,to) ⇒ `transition_not_allowed`.

## 7. Settings, flags, reason codes

- M16 read API with in-process cache; cache invalidation on settings.changed event; effective_from honored (no mid-day cutoff surprises — change preview per ADM gap).
- Feature/cutover flags checked at API layer (`not_enabled` error for dormant operations: refunds, dispatch, WhatsApp webhook, customer notifications).
- Reason-code domains enforced by FK + domain CHECK at validation layer.

## 8. Security plumbing

- Secrets: environment-injected via deployment secret store; never in repo (GAP-SEC-05; legacy `.env` discipline carries over). `16_Deployment/` owns the standard (WP-01).
- Password hashing/session policy: industry-default parameters [Proposed at DEC-011 stack choice]; lockout alarm on ≥5 failed logins (audit WARN→HIGH escalation per audit_architecture).
- No state change on GET — enforced by router convention + CI scan (mvp success criterion, GAP-SEC-02 lesson).
- CORS/CSRF posture per chosen stack [DEC-011]; PWA same-origin baseline [Proposed].

## 9. Error model & observability

- Error envelope per api_standards (error_code registry, field_errors[], trace_ref). trace_ref = request correlation id, logged end-to-end.
- Minimum telemetry: request log with operation+actor+duration, transition counters, outbox lag gauge, audit_read_queue depth, reconciliation divergence counter — these feed the 3 MVP reports' health and the pilot KPIs (time-per-order).

## 10. Foundation build order (= WP-01…03 scope boundary)

1. Wave-1 DDL (physical schema §2) + append-only triggers + seeds (roles, permissions, transition_config, settings registry, reason-code domains).
2. Authn/session + staged RBAC check + masking serializer skeleton.
3. Audit write path + read queue + the five acceptance tests green in CI.
4. Outbox + dispatcher + replay harness skeleton.
5. Settings/flag/reason-code services + transition engine with seeded machines.
Exit gate: audit tests pass; RBAC matrix-driven tests pass in `log` mode; no business module code yet.
