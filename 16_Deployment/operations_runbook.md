# Operations Runbook — Staging & Production

**Date:** 2026-06-14 · **Status:** Living; staging procedures proven, production procedures inherit on provisioning (MG-E6) · **Owners:** Operator (deploy/infra), Ops Manager (business ops), on-call engineer
**Design source:** `16_Deployment/environment_plan.md`, `16_Deployment/staging_provisioning_checklist.md`, `20_Decisions/NOTE_vps_staging_host.md`, `19_Roadmap/phase_6_master_prompt.md` (Phase 6 monitoring item)
**Control plane:** the `nutrezee-vps` MCP server (`tools/vps-mcp/`) operates staging; never touches app logic.
**Pairs with:** `support_hypercare_plan.md`, `rollback_checklist.md`, `cutover_checklist.md`

> **Staging is LIVE** at `https://13-140-159-201.sslip.io` (sponsor VPS, Ubuntu 24.04, Caddy TLS + Let's Encrypt, PG 16 container on-host, nightly `pg_dump`). This runbook is the operational layer: what to watch, how to back up/restore, and what to do when something breaks. Production inherits the same patterns on a separate instance + DB once MG-E6 is decided.

---

## 1. Daily operations checklist

| Cadence | Check | Tool | Healthy |
|---|---|---|---|
| Each morning | App health | `vps_health` / `GET /health` | 200, db reachable, migrations applied |
| Each morning | Nightly backup ran | `vps_exec` ls of dump dir | last dump < 24h old, non-zero size |
| Each morning | Error rate overnight | container logs (`vps_docker` logs) | no unhandled 5xx spikes |
| Each shift | Review-queue + payment-queue depth | `/app/dashboard` | not growing unbounded |
| Post-cutover | P1 reconciliation counts | reconciliation report | new vs legacy match (or explained) |
| Weekly | Audit HIGH-severity sweep | `/app/audit` (severity filter) | reviewed; no unexplained HIGH |
| Weekly | TLS cert validity | Caddy auto-renew; spot-check | > 14 days to expiry |
| Weekly | Disk + DB size | `vps_exec` df / pg size | headroom > 30% |

## 2. Monitoring & alerting (MG-E7 — stand up before go-live)

Target signals (Phase 6 monitoring mandate). Until a metrics stack is wired, these are **manual daily checks**; wire to alerts before production.

| Signal | Source | Threshold (proposed) | On breach |
|---|---|---|---|
| Outbox lag (notifications) | outbox table depth/age | age > 5 min | investigate worker; check `support_hypercare_plan` |
| Audit-read queue depth | audit projection lag | growing 3 checks running | check projector |
| Error rate (5xx) | container logs | > N/min `[set at baseline]` | page on-call |
| Reconciliation divergence | P1 report | any unexplained | OM follow-up, audited |
| Health endpoint | `GET /health` | non-200 | page on-call (§4 incident) |
| DB connections | PG stats | near pool max | check for leak/runaway |

**Action item (MG-E7):** wire these to a lightweight alerter (even cron + webhook) before production go-live. Health + backup-freshness are the two non-negotiables for day one. **A ready-to-schedule checker is committed: `tools/ops/healthcheck.sh`** (health 200 + `{"status":"ok"}`, newest backup < 26h, disk < 85%; exits non-zero + optional webhook on breach). The operator deploys + cron-schedules it on the host (deploy step in `tools/ops/README.md`) — it does not self-deploy.

## 3. Backup & restore (proven 2026-06-14)

**Backup:** nightly `pg_dump` on the VPS since 2026-06-12 (per `NOTE_vps_staging_host.md`). Verify freshness daily (§1).

**Restore drill — DONE 2026-06-14 (MG-E1 closed):** latest nightly dump restored to a **throwaway** database, verified **13/13 migrations + 62/62 public tables + data integrity intact**, then the throwaway DB dropped — **live database untouched**. Backups are proven recoverable.

**Restore procedure (repeatable):**
1. ☐ Pick the target dump (latest nightly, or a named pre-cutover backup).
2. ☐ Create a throwaway DB (never restore over live without an explicit DR decision).
3. ☐ `pg_restore`/`psql` the dump into the throwaway DB (`vps_exec`).
4. ☐ Verify: migration count = expected (13/13 on current schema), table count (62/62), spot-check key row counts.
5. ☐ For a real DR event only: after verification, repoint the app to the restored DB (or promote it) — this is a **production-risk action**, requires Operator + OM sign-off and a recorded decision.
6. ☐ Drop the throwaway DB when drilling.

**Re-run the drill** before each production cutover and monthly thereafter; record the result row in `support_hypercare_plan.md` / this file.

## 4. Incident response

**Severity:** SEV-1 = order operations down / data-loss risk · SEV-2 = degraded (a workflow blocked, workaround exists) · SEV-3 = minor/cosmetic.

**Flow (any SEV-1/2):**
1. ☐ **Detect** — alert or daily check or staff report.
2. ☐ **Triage** — Operator + OM: scope (which workflow?), blast radius, is data at risk?
3. ☐ **Stabilize** — if order-ops impacted post-cutover, consider `rollback_checklist.md §0` decision matrix (flag-off is the fastest restore).
4. ☐ **Communicate** — notify personas + sponsor for SEV-1; set expectations.
5. ☐ **Fix** — forward-fix if safe; else rollback. Health endpoint must return 200 before declaring resolved.
6. ☐ **Verify** — re-run the affected UAT case / smoke; confirm reconciliation clean.
7. ☐ **Record** — audited event + post-incident note in `20_Decisions/` or a dated ops note; root-cause; prevention.

**Common playbooks:**
| Symptom | First check | Likely action |
|---|---|---|
| Health non-200 | `vps_docker` container status + logs | restart container; if DB down, check PG container/disk |
| Reconciliation diverges post-cutover | P1 report; stray-order list | OM follows up each stray; if systemic → rollback eval |
| Payment queue stuck | Finance role access; outbox worker | unblock worker; verify no auto-payment fired |
| Kitchen board empty at cutoff | `kitchen_cutoff_time` set? routing rules? | set cutoff (MG-D4); unrouted lane should still hold items |
| Deploy failed | `staging_provisioning_checklist §5/§6` | fallback checkout-based deploy; re-run smoke 10-step |

## 5. Deploy procedure (reference)

Full sequence + 10-step smoke runbook: `16_Deployment/staging_provisioning_checklist.md §5–6`. Summary: build/pull image → run migrations → bring up api+admin behind Caddy → run the 10-step smoke (migrations, health, unauth, login, whoami, authed-read, logout, revocation, admin-shell, background-sweeps). D1–D7 deploy defects already fixed + CI-validated. Production deploy reuses this against the production instance once MG-E6 lands.

## 6. Production provisioning gap (MG-E6)

Production is **not provisioned**. Decision needed (sponsor + eng): same VPS posture vs managed PG (`environment_plan.md §1`); production "not before WP-14 gate." On decision: provision → migrate → bootstrap → restore-drill there → smoke → then production becomes a cutover target. Tracked in `SPONSOR_DECISION_PACK.md`.
