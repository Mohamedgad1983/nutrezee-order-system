# Test / Build / Lint Commands — Nutrezee Order System

**Date:** 2026-06-10 · **Status:** Living — update when scripts change. Sources: `app/package.json` (+ workspaces), `.github/workflows/ci.yml`, `app/README.md`, WP-00 session evidence.
Labels: **Verified** = executed successfully in the WP-00 build session (2026-06-10, local, Node v25/npm 11) · **Inferred** = defined in scripts/CI and standard, not yet executed · **NC** = Needs Confirmation (environment dependency missing).

All commands run from `app/` unless noted.

| Command | Purpose | Label |
|---|---|---|
| `npm install` | Install all workspaces (root + apps/api, apps/admin, packages/shared) | **Verified** (324 packages) |
| `npm run typecheck` | `tsc --noEmit` across all three workspaces | **Verified** |
| `npm run lint` | ESLint 9 flat config, whole monorepo | **Verified** (clean) |
| `npm run test:placeholder` | Vitest — all suites in `tests/` (currently 8 placeholders) | **Verified** (8/8) |
| `npm run build` | `tsc -p` (api) + `vite build` (admin) | **Verified** (both artifacts) |
| `PORT=3199 node apps/api/dist/main.js` + `curl localhost:3199/health` | Runtime smoke test of built API | **Verified** (`{"status":"ok","service":"nutrezee-api"}`) |
| `npx vitest run -t "TS-U"` (likewise TS-I/M/R/A/C/E/S) | Per-suite filter — exactly what CI's suite matrix runs | Inferred (unfiltered run Verified; `-t` filter not yet executed locally) |
| `npm run start:dev -w apps/api` | Build+run API in one step | Inferred (script defined; equivalent steps Verified separately) |
| `npm run dev -w apps/admin` | Vite dev server on :5173 | Inferred |
| `npm run typecheck -w apps/api` (or `-w apps/admin`, `-w packages/shared`) | Single-workspace typecheck | Inferred (all-workspace form Verified) |
| `docker compose -f docker/compose.yml up -d postgres` (repo root) | Local PostgreSQL 16 | **NC — Docker not installed on the authoring machine**; compose/Dockerfiles unvalidated |
| `docker compose -f docker/compose.yml up --build` | Full local stack (postgres + api + admin) | **NC** (same reason) |
| GitHub Actions `ci.yml` (push to `main`/`build/**`, PRs): jobs `install`, `lint`, `typecheck`, `build`, suite matrix `ts-u…ts-s`, `boundary-scan`*, `no-get-mutation-scan`* | CI gates per test_strategy | **NC — first run on GitHub not yet verified** (no `gh` CLI locally; check the Actions tab). *Scan jobs are placeholders until WP-01 implements the real guards |
| `git status --short && git branch -vv` | STEP 0 #4 clean-tree/sync check | **Verified** |

## Coming with later WPs (do not invent earlier)

DB migration apply command (WP-01 — SQL-first runner choice is part of WP-01 scaffolding) · generated TS-R matrix suite (WP-02) · generated TS-U transition suite (WP-03) · TS-M migration fixtures (WP-06) · TS-E replay-equality harness (WP-12) · staging deploy command (after PG-region note → `16_Deployment/environment_plan.md` §3).
