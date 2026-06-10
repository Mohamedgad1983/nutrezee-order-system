# Phase 4F — Codex Implementation Sequence (Work Packages)

**Date:** 2026-06-11 · **Status:** Proposed — execution order for post-Phase-4 coding sessions (Codex / Claude Code)
**Global stop-rule:** a WP may not start while an [NC] dependency that affects its Definition of Done is unresolved. A WP may build *around* an open NC only when the NC is config-content (zero-row-ready) — never when it changes structure or DoD.
**Global entry gate (blocks WP-01, i.e., ALL coding):** ① DEC-011 signed (stack + confirms/overrides PostgreSQL-Proposed) ② DEC-003 signed (MVP cut) ③ R1 closed (both repos pushed to remote) ④ staging environment + CI skeleton live (`16_Deployment/`) ⑤ workshop held **or** sponsor explicitly accepts NC-carry build risk for WP-01–06 only (foundation/data WPs tolerate it; WP-07+ do not).
Sizes: S ≈ days · M ≈ 1–2 wk · L ≈ 2–4 wk (single squad; re-baseline at DEC-011).

| WP | Scope | Key inputs | Definition of Done (all = CI-green per test_strategy gates) | Out of scope | Size | NC blockers |
|---|---|---|---|---|---|---|
| **WP-01 Platform foundation** | Wave-1 DDL + seeds (roles, permissions, transition_config, settings, reason-code domains); authn/session (login/logout/timeout/lockout); staged RBAC check; masking serializer; audit write path + read queue; outbox + dispatcher; idempotency; CI guards (no-GET-mutation scan, cross-module write scan) | physical_schema §1-2 wave 1, backend_foundation §10 | TS-I audit/append-only/outbox green; TS-A #2/#3 green; TS-R generated suite green in log mode; seeds match registers | Any business module; UI beyond login shell | L | None beyond global gate |
| **WP-02 RBAC & staff admin** | M13/M12 complete: role admin UI-API, grants, matrix config loader + export-compare, staff CRUD, dormant-role alert | rbac_architecture, module specs M12/M13 | TS-R full matrix green (log+warn+deny modes); staff lifecycle audited | SSO | M | Matrix sign-off (S8) — build to Proposed matrix, flag |
| **WP-03 Settings & transition engine** | M16 services: settings cache/preview/effective-dating, flags, reason codes, sections/areas/slots/methods admin; transition engine on transition_config | backend_foundation §6-7 | TS-U transition suite (generated) green; settings.changed invalidation proven | Rule *content* (workshop) | M | Content NC = zero-row OK |
| **WP-04 Customers** | M04: profiles (+A1 email), phones+normalization, addresses, allergies, preferences, guided-create + dup check, merge with undo + draft re-link | module specs M04, dictionary §5 | TS-U dedup suite; TS-S #6; pii/health read-logging proven | Import (WP-06) | M | DEC-004 (soft-unique posture per schema [Proposed]) |
| **WP-05 Catalog** | M05 mirror-mode: masters, products/components, packages (cycle guard), allergen resolver, nutrition fields, routing-rule admin | module specs M05 | TS-U allergen-resolver; mirror-mode write restriction proven | Macros content entry; catalog cutover | M | C7 confirm; catalog-owner role |
| **WP-06 Import tooling** | M19 batch runner (dry-run/apply/rollback/gates) + catalog & customer importers + validation reports; M18 sync_record | migration_execution_plan §1-2 (batches 1-2), §4-5 | TS-M green incl. gates + rollback; dry-runs produce reviewable reports from synthetic fixtures | Batch 3 (WP-13); real legacy data until access/export exists | M | Export format (P1/P2) for *real* runs only |
| **WP-07 Intake & WhatsApp panel** | M01 drafts + completeness + incomplete queue + allergy conflicts; M17 message-ref panel | module specs M01/M17, WF-01/02 | TS-U completeness/conflict suites; TS-C drafts; aging alerts fire | WhatsApp API | L | **Workshop: mandatory-field set (S3 Q8)** — DoD includes configured set |
| **WP-08 Review queue** | M02: queue/SLA/claim, decisions incl. override capture, return/recall loop | module specs M02, WF-03–06 | TS-C decisions; override → HIGH audit; TS-S #1 steps 2-3 | — | M | Reviewer=creator rule (Q3) — default allow+audit [Proposed] |
| **WP-09 Order core** | M03: OrderFactory (freeze, day generation), plan+day transitions, change requests w/ impact+cascade, exceptions w/ allergy auto-HIGH | module specs M03, status model, WF-04/12/15 | TS-U/TS-I transitions; TS-S #1 (steps 4,7), #3, #4 green | Dispatch states activation | L | **DEC-005 finals; kitchen_cutoff value** (engine config-ready; values needed for DoD scenario runs) |
| **WP-10 Kitchen** | M08: ticket generator (idempotent, unrouted queue, allergy marker), section board PWA-lite, ticket transitions + rollups, escalations w/ substitute recheck | module specs M08, WF-07/08 | TS-S #1 steps 5-6, #2 tail; unrouted alert proven; board usable on shared tablet | Chef personal app; labels/packing module | L | **DEC-006 sections content for pilot**; shared-device model (Q2) |
| **WP-11 Payments-lite** | M07: status machine (FI-only decisions), review queue, evidence capture; refunds behind flag | module specs M07, WF-13 | TS-S #5; payment.* all HIGH-audited; `not_enabled` on refunds | Gateway integration | S | PAY_METHOD values (placeholder OK); Q20 |
| **WP-12 Notifications & reports** | M11 internal alerts + templates + log; M15 three projections + exports + replay harness | module specs M11/M15, event_catalog consumers | TS-E rebuild-equality green; trigger map configurable; exports audited | Customer notifications; analytics suite | M | Trigger-map content [Proposed seed OK] |
| **WP-13 Bridge & cutover tooling** | M18 reconciliation forms/diffs/alerts, cutover flags; M19 batch 3 (active plans) importer | migration_execution_plan §2.3, §6 | TS-M batch-3 suite; runbook rehearsed on staging with synthetic data | Real cutover (operational event, not a WP) | M | Legacy payment vocab; off_days; **real apply needs access/export + workshop** |
| **WP-14 Pilot hardening & gate** | UAT content from baselined rules; TS-S full pass on staging; TS-A on staging; perf baseline; 50-screen regression mapping; training materials per role; pilot (1 agent + 1 section) | test_strategy gates, mvp cut §7 | All suites green; MVP success criteria §7 measured; pilot exit review | Scale-out beyond pilot | M | **Workshop fully applied — hard requirement; no NC-carry here** |

## Sequencing & parallelism

```
WP-01 ─► WP-02 ─► WP-03 ─►─┬─ WP-04 ─┬─► WP-06 ─────────────┐
                            └─ WP-05 ─┘                       │
                            WP-07 ─► WP-08 ─► WP-09 ─► WP-10 ─┼─► WP-12 ─► WP-13 ─► WP-14 ─► pilot ─► 30-day clock
                                              WP-11 ──────────┘
(WP-04/05 parallel after 03; WP-06 needs both; WP-07 may start after 04+05; WP-11 after 09)
```

## Standing reminders for every Codex session

Read `13_Architecture/backend_foundation_blueprint.md` + the relevant module spec + this WP row **before coding**; respect MVP cut (dormant = `not_enabled`, no tables); never edit Phase 1–4 docs except logging amendments (A5+); every session ends with suites green and a commit referencing its WP id; NO session starts if its NC blockers row is unresolved per the stop-rule.
