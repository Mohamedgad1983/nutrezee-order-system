# Environment Plan (WP-00)

**Date:** 2026-06-10 · **Status:** Baselined v1.0 for WP-00 scope; staging provisioning **deferred** pending the PG-region residency note (see §3) · **Owner:** Tech Lead
Stack per signed DEC-011. Secrets standard responds to GAP-SEC-05.

## 1. Environments

| Env | Purpose | Host | Database | State |
|---|---|---|---|---|
| local | Development | `docker/compose.yml` (postgres + api + admin) or bare `npm run` | postgres:16 container | ✅ defined (compose validation pending a Docker-equipped machine) |
| staging | Pre-prod verification; UAT/pilot home | Managed container platform or small VM + compose [Proposed — finalize at provisioning] | Managed PostgreSQL 16 | ⏸ **Deferred — blocked on PG-region residency note** (§3) |
| production | Live operation | Same pattern as staging, separate instance + DB | Managed PostgreSQL 16, PITR + nightly dump | Not before WP-14 gate |

## 2. Secrets standard (GAP-SEC-05)

- No secret ever committed: `.env` is gitignored; `app/.env.example` documents names only.
- Local: developer-managed `.env`. CI: GitHub Actions environment secrets. Staging/prod: host platform secret store, injected as env vars.
- Rotation duty and per-environment `SESSION_SECRET` uniqueness owned by Tech Lead; gateway/WhatsApp credentials arrive only with their integration WPs.

## 3. Staging provisioning checklist (execute once region resolved)

> **2026-06-11:** the region note exists (me-south-1 interim) — the executable, expanded checklist now lives in `staging_provisioning_checklist.md` (exact sponsor inputs STG-1…7, verified env-var surface, pre-deploy defects D1–D6 incl. the admin-SPA proxy gap and the dead `SESSION_SECRET`, deploy sequence, and the 10-step smoke runbook). The steps below remain the summary of record.

The PG **region is pending the data-residency check [NC — DEC-011]** — KSA/Gulf customer PII+health data may require an in-region host (e.g., AWS `me-south-1`). A one-line sponsor note in `20_Decisions/` (interim or final region) unblocks this checklist; until then staging is deferred per the WP-00 carve-out (amendment A5).
1. Sponsor region note recorded → choose platform + region.
2. Provision managed PostgreSQL 16 (PITR on, nightly dump schedule, restore drill documented here).
3. Provision container host; set secrets (DATABASE_URL, SESSION_SECRET).
4. Deploy `docker/` images; verify `GET /health` and admin shell.
5. Record staging URL here; flip gate ④ to ✅ in `build_progress_register.md`.

## 4. Deploy / rollback / backup runbook (skeleton — content hardens in WP-01+)

- **Deploy:** merge to `main` → CI green → build images → deploy to staging (auto) → manual promotion to production via tagged release. Migrations run as an explicit gated step before app rollout (SQL-first, wave-ordered).
- **Rollback:** redeploy previous tag; migrations are forward-only — a faulty migration is reverted by a new corrective migration, never by editing history. Rehearse on staging before any production migration.
- **Backups:** managed-PG PITR + nightly dump; restore drill before pilot (WP-14 entry). Repo backup duty: push after every session (R1 residual).
