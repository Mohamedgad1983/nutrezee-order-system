# Execution Modes — Nutrezee Order System

**Date:** 2026-06-10 · **Status:** Active · Authoritative protocol: `19_Roadmap/phase_5_master_prompt.md` (this file summarizes and extends; on conflict the master prompt wins for build modes).

## 1. Discovery Mode (read-only)

For investigation, audits, status questions, gap checks. **No writes** except optional notes in `22_Meeting_Notes/` or register status refresh. Output: findings with Verified/Inferred/Assumed/NC labels and file:line references. Never transitions into building within the same instruction unless the user asked for both.

## 2. Single WP Mode (= master prompt Mode A — default)

`Execute WP-XX per 19_Roadmap/phase_5_master_prompt.md`. One work package per session: STEP 0 gate check → STEPs 1–5 → stop and report. Use when human review between WPs is wanted, for hard-NC-adjacent WPs (WP-07/09/10/13/14), or first-of-kind work.

## 3. Sprint Build Mode (= master prompt Mode B)

`Execute Phase 5 Sprint Build Mode per 19_Roadmap/phase_5_master_prompt.md`. One long session, maximum safe throughput:

- Start with **STEP 0 gate check** from `phase_5_master_prompt.md` — live, from disk.
- **Execute WP-00 first if not DONE.**
- Each WP stays atomic: branch → scope-only implementation → **run its DoD suites** → commit → **merge only when tests pass** → update `build_progress_register.md` → **push `origin/main`**.
- Continue to the next eligible WP per the **dependency diagram** in `codex_implementation_sequence.md` — never simple numeric order.
- **Do not ask between eligible WPs** — continue automatically.
- **Stop only for:** failed gate · failed tests that cannot be fixed safely within scope · unresolved NC blocker affecting a DoD · missing secret/credential · product decision required · forbidden scope · no eligible WPs remain.
- Never build dormant modules beyond allowed `not_enabled` stubs; never skip or weaken tests; never touch Phase 1–4 docs except permitted register/status/amendment writes.
- Close with the sprint final response (rule 10 of Mode B).

## 4. QA Hardening Mode

Post-build, pre-pilot (feeds Phase 6 STEP 1). Adversarial verification of what CI can't see: masking abuse attempts per role, transition-engine abuse, idempotency double-submits, session expiry, bilingual/RTL rendering, shared-tablet kitchen board, destructive exploratory passes on staging. Defects → `15_Testing/` register with severity; fixes ride normal WP-style branches with their suites. No new features in this mode.

## 5. Release Readiness Mode

Maps to `19_Roadmap/phase_6_master_prompt.md` (currently FUTURE-READY — its STEP 0 fails until WP-01…14 are DONE). UAT execution with real staff, pilot readiness, deployment hardening, training records, sponsor sign-off pack (DEC-013), go-live preparation. No production action before DEC-013 is SIGNED.

## Mode selection quick rule

Question → Discovery. One reviewed step → Single WP. "Build as far as gates allow" → Sprint Build. "Break it before users do" → QA Hardening. "Get to pilot/go-live" → Release Readiness.
