# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Two things live in one repo:

1. **A doc-governed delivery program** (root `00_…`–`22_…` directories, `AGENTS.md`). The Nutrezee Order System replaces a live legacy meal-plan ordering dashboard via a strangler-fig migration, delivered as gated **work packages (WP-xx)**. Phase 1–4 docs are frozen source-of-truth; you amend them through registers, never edit them.
2. **The application monorepo** under `app/` — a NestJS modular monolith API + React/Vite admin SPA. This is where code changes happen.

**Read `AGENTS.md` first every session.** It is the binding operating manual: the autonomous execution loop ("Continue Nutrezee OS Agent"), gate checks, the source-of-truth document table, forbidden actions, and git/test discipline. This file does not duplicate it — it covers how the *code* is built and structured.

Note: `app/README.md` is stale (it describes the WP-00 empty scaffold). The modules described below are real and implemented; trust the code.

## Commands

All commands run from `app/` unless noted. Node ≥ 22, npm workspaces (`apps/api`, `apps/admin`, `packages/shared`).

```bash
npm install
npm run typecheck          # tsc --noEmit across all 3 workspaces
npm run lint               # ESLint 9 flat config, whole monorepo
npm run build              # tsc (api) + vite build (admin)
npm run typecheck -w apps/api   # single workspace

# API: GET /health → {"status":"ok","service":"nutrezee-api"}
npm run start:dev -w apps/api   # build + run on :3000
npm run dev -w apps/admin       # Vite dev server on :5173
```

### Tests

Integration/contract suites need **PostgreSQL 16**. Set `DATABASE_URL_TEST` (defaults to `postgres://localhost:5432/nutrezee_test`). Each suite file calls `freshDb()` which drops+recreates `public` and re-runs all migrations, so suites share one DB and run serially (`fileParallelism: false` in `vitest.config.ts`).

```bash
npx vitest run                      # everything
npx vitest run -t "TS-C"            # one suite by tag — this is exactly what CI does
npx vitest run tests/integration/ts-i-orders.test.ts   # one file
npx vitest run -t "TS-U"            # likewise TS-I / TS-M / TS-R / TS-A / TS-C / TS-E / TS-S
```

Suite tags map to test types (see `15_Testing/test_strategy.md`): TS-U unit, TS-I integration, TS-M migration, TS-R RBAC matrix, TS-A audit (cumulative — once green, a permanent gate), TS-C contract, TS-E replay-equality, TS-S smoke. `npm run test:placeholder` is the legacy alias for `vitest run`.

### Database migrations (SQL-first)

```bash
DATABASE_URL=postgres://… node db/migrate.mjs    # apply pending migrations (forward-only)
docker compose -f docker/compose.yml up -d postgres   # local PG (from repo root)
```

Migrations are plain `.sql` in `app/db/migrations/`, applied in **filename order** (`NNNN_waveW_<scope>.sql`), each in one transaction, tracked in `schema_migrations`. Never edit an applied migration — fix forward with a new corrective file. Migrations never run at API boot; they are a gated step (`docker compose --profile tools run --rm migrate`).

### CI guards (also runnable locally)

```bash
node scripts/scan-cross-module-writes.mjs   # fails if a module writes another module's tables
node scripts/scan-no-get-mutation.mjs       # fails on state mutation in GET handlers
```

CI (`.github/workflows/ci.yml`, runs on `main`/`build/**`/PRs): `lint`, `typecheck`, `build`, the 8-suite matrix against Postgres 16, both scan jobs, and `docker-validate`. A WP is DONE only when its DoD suites pass **in CI** — green placeholders mean "not implemented," never "verified."

### End-to-end (staging)

```bash
cd tools/e2e-staging
E2E_EMAIL='…' E2E_PASSWORD='…' npx playwright test            # headed run against staging
E2E_EMAIL='…' E2E_PASSWORD='…' npx playwright test wpui-catalog
```

Credentials come from the environment only — never commit them (a `gitleaks` pre-commit hook guards this). UI work packages ship a visible Playwright e2e proving the flow on staging.

## Architecture

### Backend: NestJS modular monolith (`app/apps/api/src`)

- **`platform/`** — wave-1 cross-cutting services owned by no business module: `auth` (server-side sessions, **no JWTs** — opaque id in the `nz_session` cookie), `rbac`, `audit`, `outbox`, `settings`, `transition` (the config-seeded state machine), `idempotency`, `masking`, `feature-flags`, `staff`, `db`, `config`.
- **`modules/mNN-<name>/`** — business modules in physical-schema wave order: m01-intake, m02-review, m03-orders, m04-customers, m05-catalog, m07-payments, m08-kitchen, m11-notifications, m15-reports, m17-whatsapp, m18-bridge (legacy reconciliation/cutover), m19-migration (legacy import batches).
- **Dependency injection is wired by hand** in `app.module.ts` via `useFactory` + explicit `inject` arrays — there are almost no `@Injectable()` auto-scans. When you add a service or change a constructor, update its provider block in `app.module.ts`. The wiring there is the live dependency graph; read it to see who depends on whom.
- **`main.ts`** runs two in-process 2s background sweeps (outbox dispatch + audit read-queue drain), disabled with `OUTBOX_DISPATCHER=off` (tests only). `trust proxy` is on because the API sits behind the admin nginx proxy + TLS terminator.

### Binding code constraints (these are enforced/reviewed — violating them breaks CI or review)

- **No state mutation on GET** (`scan-no-get-mutation`).
- **Single write path:** a module writes only its own wave's tables; cross-module data flows through the owning module's service API, never foreign-table SQL (`scan-cross-module-writes`; ownership map is in that script, mirroring `physical_schema_design.md`).
- **Same-transaction audit** — audit rows are written in the same DB transaction as the change they record.
- **All state transitions go through the seeded transition engine**, never ad-hoc status updates. Order lifecycle is the spine (`13_Architecture/order_lifecycle_status_model.md`).
- **Masking at serialization** (PII), **money in minor units**, **bilingual EN/AR**.
- **Dormant/deferred modules stay stubs** (`not_enabled`) — no tables, no UI — until a WP enables them. See `AGENTS.md` "Forbidden actions."
- **No new npm dependencies** without a recorded reason.

### Shared contracts (`app/packages/shared/src`)

TypeScript contract types mirrored from `11_API_Design/module_api_contracts.md`. **The markdown is the source of truth** — if code and doc diverge, log an amendment and fix the types to match the doc.

### Frontend: React/Vite admin SPA (`app/apps/admin/src`)

- No router/data-fetching libraries. `router.tsx` is a ~50-line `history.pushState` router; `api.ts` is a thin `fetch` wrapper (`credentials: 'include'`, friendly error mapping, a global 401→login handler since sessions slide-expire after 60 idle minutes).
- Pages in `src/pages/` map to legacy dashboard screens (Orders, Intake, Review, Customers, Catalog, Kitchen, Payments, Reports, Audit, Settings, Staff). The SPA owns `/app/*`; the API owns its root prefixes (`/auth`, `/drafts`, …) — routing split is in `docker/nginx.admin.conf`.
- The `/kitchen` route is a PWA board.

### Deployment

Three Docker images (`docker/Dockerfile.api`, `Dockerfile.admin`, plus a `migrate` build target). `docker/compose.yml` is the local/staging composition; `compose.staging.yml` + Caddy run on the VPS. Staging is **live** at `https://13-140-159-201.sslip.io`, operated via the `nutrezee-vps` MCP server (`tools/vps-mcp/`). The `deploy-staging` workflow builds + publishes images to GHCR on manual dispatch; the actual deploy job is gated behind `STAGING_DEPLOY_ENABLED`.

### Legacy migration & ops layer (`ops/`, `tools/`, `docs/evidence/`)

Beyond the app code, the strangler-fig migration has an operational layer — partly in-repo, partly on the staging VPS — exercised against the **live staging DB**:

- **`ops/sync/`** (Node) + **`ops/systemd/`** (timers + wrappers) — the legacy→staging order/customer resync pipeline: a read-only **plan-only** monitor (`run-order-resync.sh`) plus deliberate, gated apply scripts (`apply-*.mjs`, `enrich-orders.mjs`, `extract-missing-customers.mjs`). The runbook is `ops/sync/README-ongoing-resync.md`; production copies run on the VPS under `/opt/nutrezee/`. systemd units ship **disabled** (owner installs/enables them).
- **`tools/`** — `vps-mcp/` (the `nutrezee-vps` MCP that drives staging), `e2e-staging/` (Playwright), `legacy-migration/` + `legacy-full-migration/` (read-only legacy exporters).
- **`docs/evidence/<workstream>/NN_*.md`** — each migration/feature pass leaves a **numbered evidence doc** (counts, decisions, what was verified). Add one; don't rely on the commit message alone.

**Writing the live staging DB safely** (imports, resyncs, backfills): `pg_dump` snapshot first → governed M19 **dry-run → apply** (idempotent via `sync_record`) → **correctness-probe** the result (e.g. a created order's stored customer phone must equal its legacy source page's phone). Legacy identifiers are a trap: orders key by `order_number`, archived pages by a *disjoint* `internal_id`, customers by normalized `+965` phone — never link by name or fuzzy match. The assistant is blocked **by design** from logging into the legacy production system and from installing VPS persistence (systemd units); those are owner-run.

## Working rules (summary — full text in AGENTS.md)

- **Branch `build/<wp-id>-<slug>`**; merge to `main` only when the unit's DoD suites are green; commit messages reference the WP/queue id; never force-push or rewrite pushed history. Doc-only changes (registers, run log, status notes) commit directly to `main`.
- **One unit at a time, atomic** — no scope creep past the invoked WP row ("while I'm here" is forbidden).
- **Never** commit secrets, touch production, or write to the legacy system (the m18 bridge is read-only).
- **Amendments, not edits** — contradictions with frozen Phase 1–4 docs are logged as A-ids in `19_Roadmap/build_progress_register.md`, not fixed by editing the doc.
- Label evidence everywhere: **Verified / Inferred / Assumed / Needs Confirmation [NC]**. Workshop-owned business values are config (settings / reason codes / `transition_config`), never hard-coded.
