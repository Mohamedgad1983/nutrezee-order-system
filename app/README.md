# Nutrezee Order System — Application Monorepo

WP-00 scaffold (environment standup). **No business workflow code lives here yet** — modules M01–M19 arrive with WP-01+ per `../19_Roadmap/codex_implementation_sequence.md`. Layout is the binding standard from `../19_Roadmap/phase_5_master_prompt.md` STEP 2; stack per signed DEC-011.

## Layout

| Path | Purpose |
|---|---|
| `apps/api` | NestJS modular monolith (modules `m01-…m19-` + `platform/` from WP-01) — health check only today |
| `apps/admin` | React/Vite admin SPA shell (+ `/kitchen` PWA route at WP-10) — placeholder shell today |
| `packages/shared` | TS types mirrored from `../11_API_Design/module_api_contracts.md` (the .md stays the source of truth) |
| `db/migrations` | SQL-first migrations, numbered by physical-schema wave order — empty until WP-01 |
| `tests/placeholder` | Placeholder tests keeping the 8 CI suite jobs (TS-U…TS-S) green until each WP implements them |

## Setup

```bash
cd app
npm install
cp .env.example .env        # adjust if needed
npm run typecheck           # all workspaces
npm run lint
npm run test:placeholder    # placeholder suites
npm run build               # api (tsc) + admin (vite)
npm run start:dev -w apps/api    # API on :3000 — GET /health
npm run dev -w apps/admin        # admin SPA on :5173
```

Local PostgreSQL via Docker (optional until WP-01 migrations exist):

```bash
docker compose -f ../docker/compose.yml up -d postgres
```

## Rules that bind every contributor (from phase_5_master_prompt.md)

No state mutation on GET · same-transaction audit · single write path per owning module · no cross-module table writes · masking at serialization · transitions only via the config-seeded engine · dormant modules stay `not_enabled`.
