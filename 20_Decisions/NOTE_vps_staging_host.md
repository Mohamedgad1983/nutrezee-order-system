# NOTE — Staging host: sponsor VPS (supersedes me-south-1 interim for staging)

**Date:** 2026-06-12 · **Recorded by:** Tech Lead session · **Sponsor input:** VPS provided in-chat

The sponsor provided a dedicated VPS for staging instead of the AWS me-south-1 cloud account anticipated by `NOTE_pg_staging_region_interim.md` and checklist inputs STG-1/STG-2:

| Item | Value |
|---|---|
| Host | `13.140.159.201` (Ubuntu 24.04.4 LTS, 8 vCPU / 24 GB / 193 GB) |
| Hostname / TLS | `https://13-140-159-201.sslip.io` — Caddy 2 terminates TLS (Let's Encrypt), satisfies STG-5/D2 |
| PostgreSQL | **postgres:16-alpine container on the same host** (compose service), not managed PG — deviation from `environment_plan.md` §3 step 2 |
| Backup posture | No PITR. Substitute: nightly `pg_dump` (cron 02:30, `/opt/nutrezee/backup.sh`, 14-day retention in `/opt/nutrezee/backups/`). First dump taken + verified 2026-06-12 |
| Secrets | `/opt/nutrezee/.env` on-host (mode 600): `POSTGRES_PASSWORD` (random 32-char). Never committed |
| Access | SSH key `nutrezee_staging_ed25519` (operator machine) via the `nutrezee-vps` MCP server (`tools/vps-mcp/`) |
| Port posture | ufw allows 22/80/443 only; all compose service ports re-bound to 127.0.0.1 via `docker/compose.staging.yml` (Docker published ports bypass ufw — the base compose file's bindings would otherwise be internet-reachable) |

**Scope:** staging only. The production posture in `environment_plan.md` (managed PG 16, PITR + nightly dump) is unchanged. The data-residency question (DEC-011) remains open for production; the VPS region is accepted for staging by the sponsor providing the host.

**Restore drill** (WP-14 entry item): `gunzip -c <dump> | docker exec -i nutrezee-postgres-1 psql -U nutrezee -d nutrezee` — drill still to be scheduled and evidenced per `environment_plan.md` §4.
