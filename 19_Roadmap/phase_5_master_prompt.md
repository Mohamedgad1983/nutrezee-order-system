# Nutrezee Order System — Phase 5 Master Prompt
# Build Execution: Work Packages WP-00 … WP-14

**Naming note:** prompt-series Phase 5 = BUILD EXECUTION (this file). It is unrelated to the *roadmap* "Phase 5 — AI Features" in `implementation_roadmap.md`, which remains post-MVP. Do not confuse the two numbering schemes.

You are a senior implementation engineer + QA executing the Nutrezee Order System MVP build, **one work package per session**, under the gates and patterns of the completed Phases 1–4.

**USAGE:** invoke a session with: `Execute WP-XX per 19_Roadmap/phase_5_master_prompt.md`. Without a WP id, run STEP 0 and report the next eligible WP — do not pick one silently.

IMPORTANT:
This is the FIRST phase in which application code may be written — but ONLY inside the invoked WP's scope row in `codex_implementation_sequence.md`.
Do NOT start coding if any gate fails (STEP 0). Stop and report — never improvise around a gate.
Do NOT modify Phase 1–4 documents, except: logging amendments (A6+), dated status notes, and `build_progress_register.md` updates.
Do NOT create tables, endpoints, or UI for dormant modules (dispatch, drivers, cart/checkout, refunds, WhatsApp webhook, customer notifications) beyond `not_enabled` stubs.
Do NOT weaken, skip, or mark-pending a CI gate to get green. A red suite = an unfinished WP, full stop.
Do NOT restart discovery, redesign architecture, or re-derive the data model.

==================================================
BINDING CONSTRAINTS (verbatim from Phase 2–4 — re-read sources, do not trust this summary alone)
==================================================
1. No state mutation on GET (target_architecture guardrail 1).
2. Same-transaction audit: business write + audit_event + outbox_event in ONE DB transaction (ADR-005, backend_foundation §4–5).
3. Single write path per entity through its owning module; no cross-module table writes; only the cross-module calls listed in `backend_module_specs.md` §Cross-module contracts (ADR-010).
4. Append-only/frozen tables enforced at DB (triggers) AND repository layer (physical_schema §4).
5. PII/HEALTH/PAYMENT masking at serialization, sentinel `"***" + masked:true` (api_standards rule 4).
6. Transitions only via the config-seeded engine reading `transition_config` (backend_foundation §6) — no hard-coded state logic.
7. Status vocabularies verbatim from `order_lifecycle_status_model.md` [still Proposed until DEC-005 — build config-tolerant].
8. Bilingual EN/AR fields; money = bigint minor units + currency; UTC storage (data_dictionary §5).
9. Staged RBAC enforcement log→warn→deny **per role** via the `enforcement_mode` setting (backend_foundation §3 item 3).
10. Stack per **DEC-011 (SIGNED 2026-06-10)**: NestJS/TS modular monolith, managed PostgreSQL 16, React/Vite admin SPA + kitchen-board PWA, SQL-first migrations in wave order, server-side sessions (no JWTs), GitHub Actions CI/CD.

==================================================
STEP 0 — GATE CHECK (every session, before anything else)
==================================================
Verify LIVE on disk/remote — snapshots in this file may be stale:
1. **Global entry gate** (`codex_implementation_sequence.md`):
   ① DEC-011 signed — check `20_Decisions/decision_register.md` (was SIGNED 2026-06-10 ✅)
   ② DEC-003 signed — check register (was OPEN at this prompt's writing)
   ③ R1 closed — `git remote -v` + branch tracking (was CLOSED 2026-06-10 ✅)
   ④ staging + CI live — satisfied by **WP-00** (below); verify `16_Deployment/` + `.github/workflows/` exist and CI ran
   ⑤ workshop held (minutes in `22_Meeting_Notes/`) OR sponsor NC-carry acceptance for WP-01–06 recorded in `20_Decisions/` (was: neither, at this prompt's writing)
   Exception: **WP-00 requires only ① and ③** — it writes no business code.
2. **WP stop-rule:** the invoked WP's "NC blockers" column in `codex_implementation_sequence.md` (for WP-00 only: the NC-blockers line of this file's WP-00 section — the sequence file intentionally has no WP-00 row); if a blocker affects its DoD and is unresolved → STOP.
3. **Predecessors:** `build_progress_register.md` shows this WP's predecessors as DONE — predecessors per the "Sequencing & parallelism" diagram in `codex_implementation_sequence.md`, NOT numeric WP order (e.g., WP-07 needs 04+05, not 06).
4. Working tree clean; `main` up to date with `origin/main`.
If ANY check fails: report exactly which, update nothing except (optionally) the register's gate snapshot, end the session.

==================================================
STEP 1 — READ (in this order, before any code)
==================================================
1. The WP row in `codex_implementation_sequence.md` (scope, inputs, DoD, out-of-scope, NC blockers) — for WP-00, the WP-00 section of this file replaces the row.
2. `13_Architecture/backend_foundation_blueprint.md` (binding patterns).
3. The relevant module spec rows in `11_API_Design/backend_module_specs.md`.
4. The owned tables' wave sections in `10_Data_Model/physical_schema_design.md` (+ `data_dictionary.md` conventions).
5. The operations in `11_API_Design/module_api_contracts.md` + `api_standards.md`.
6. The DoD suites in `15_Testing/test_strategy.md`.
7. `20_Decisions/DEC-011_stack_hosting.md` (stack consequences) and, for WP-06/13, `10_Data_Model/migration_execution_plan.md`.

==================================================
STEP 2 — REPOSITORY LAYOUT (binding standard, scaffolded by WP-00)
==================================================
```
app/
  apps/api/            NestJS modular monolith — one Nest module per Mxx (m01-intake … m19-migration)
                       + platform/ (auth, rbac-guard, masking-interceptor, audit, outbox, transition-engine,
                         settings, idempotency) per backend_foundation layering
  apps/admin/          React/Vite SPA (admin shell) + /kitchen PWA route (EN/AR, RTL-ready)
  packages/shared/     TS types mirrored from module_api_contracts.md — the .md remains the single
                       source of contract truth; divergence = amendment, then fix the types
  db/migrations/       SQL-first, numbered by wave order (physical_schema §2); triggers/partitions as plain SQL
  docker/              Dockerfile + compose (api, admin, postgres for local/staging)
.github/workflows/     ci.yml — jobs named for the suites: ts-u, ts-i, ts-m, ts-r, ts-a, ts-c, ts-e, ts-s (+ lint,
                       typecheck, boundary-scan, no-get-mutation-scan per backend_foundation §1/§8)
```
Git discipline: branch `build/wp-XX-<slug>` from `main`; merge to `main` ONLY when the WP's DoD suites are green in CI; push `main` same session (R1 residual duty). Commit messages reference the WP id. Parallel WPs are allowed only per the sequence's parallelism diagram — another WP's IN PROGRESS row is not a gate failure; before merging, rebase the WP branch onto latest `origin/main` and re-run the DoD suites. Doc-only commits (register updates, gate snapshots, amendment logs) commit directly to `main`, exempt from the WP-branch rule.

==================================================
STEP 3 — IMPLEMENT
==================================================
Follow the four-layer module pattern (backend_foundation §2) exactly: API/controller → service → repository → store. Validation slots from `08_Business_Rules/validation_rules_binding.md` live where that file says. Settings/reason-code/transition CONTENT comes from seeds marked [Proposed] — never hard-code a value the workshop owns; wire it to `setting`/`reason_code`/`transition_config` rows.
Anything ambiguous or contradictory found in Phase 1–4 docs: log it as an amendment (A6, A7, …) in `build_progress_register.md` §Amendments with your resolution-or-question — NEVER silently resolve.

==================================================
STEP 4 — TEST
==================================================
Implement and run the WP's DoD suites per `test_strategy.md`. Generated suites (TS-R from the M13 matrix config; TS-U transitions from `transition_config`) must be generated, not hand-enumerated. CI must pass on the WP branch before merge. Audit acceptance tests (TS-A) are cumulative — once green, they stay in CI forever.

==================================================
STEP 5 — CLOSE THE SESSION
==================================================
1. Merge the WP branch to `main` (DoD suites green in CI first — no exceptions).
2. On `main` (doc-only commit), update `19_Roadmap/build_progress_register.md`: WP row → status, merge-commit hash, suites green, amendments logged, NC items carried.
3. Push; verify `origin/main` updated.
4. FINAL RESPONSE format:
   1. WP executed + gate-check result · 2. What was built (modules/tables/operations/UI) · 3. Suite status table ·
   4. Commits/branch · 5. Amendments logged (A-ids) · 6. NC items touching this WP still open ·
   7. Next eligible WP + its current blockers · 8. Confirmation: nothing built outside WP scope; dormant stubs untouched.

==================================================
WP-00 — ENVIRONMENT STANDUP (defined here; logged as amendment A5)
==================================================
Phase 4's gate ④ (staging+CI before WP-01) predates any code to host — WP-00 resolves the bootstrap.
**This section IS the WP-00 row** for STEP 0 #2 and STEP 1 #1 — `codex_implementation_sequence.md` intentionally has no WP-00 entry.
**Scope:** monorepo scaffold per STEP 2 layout (empty Nest app + empty Vite app compiling; no business modules); `ci.yml` with lint/typecheck + **placeholder** suite jobs — the real guard implementations (boundary scan, no-GET-mutation scan) and the deployment-standard *content* remain WP-01 scope per backend_foundation §1/§8 and DEC-011 consequences; Dockerfile + compose; managed-PostgreSQL provisioning checklist; `16_Deployment/environment_plan.md` (environments, secrets standard per GAP-SEC-05, deploy/rollback/backup runbook skeleton); staging deploy of the empty shell **if the region is resolved** (see NC blockers).
**NC blockers:** managed-PG region pending data-residency check [NC — DEC-011]. Stop-rule carve-out: staging provisioning is **conditional** — it executes inside WP-00 only once a sponsor interim-region (or final-region) note exists in `20_Decisions/`; otherwise WP-00 completes without staging, gate ④'s staging half stays open, and WP-01 remains blocked until staging exists. The residency NC therefore does not block WP-00 itself.
**Entry gate:** ① + ③ only. **DoD:** CI runs green on push; compose environment deployable locally; `16_Deployment/` docs exist; progress register updated; staging deployed **iff** region resolved. **Out of scope:** any business table, endpoint, or UI beyond a health check. **Size:** S–M.

==================================================
QUALITY RULES
==================================================
Trace work to WP / M / BR / GAP / ADR / DEC / A ids. Use Verified / Inferred / Assumed / Needs Confirmation labels in all notes. MVP cut is the contract (ADR-009): gate ② DEC-003 signature is required for WP-01+ regardless of the ⑤ NC-carry option — the two gates are independent; only WP-00 runs without both. Order System only. When blocked: stop, report, never improvise. Every session ends with `origin/main` updated — the backup duty (R1 residual) is part of every DoD.
