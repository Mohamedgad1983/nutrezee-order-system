# 04 — Security & Secrets

**Date:** 2026-06-20

---

## Secret handling

- The `hermes_ro` password was generated **on the server** and written only to `/opt/nutrezee/hermes_ro.env` (mode **600**, owner **root**) as `HERMES_RO_DATABASE_URL=postgres://hermes_ro:****@127.0.0.1:5432/nutrezee`.
- The password **never** appears in: the git repo, this documentation, the agent transcript, or psql stdout.
- **No secret is committed.** The repo's `gitleaks` pre-commit guard remains the backstop.
- LLM credentials for Hermes (when the gated install proceeds) must also live in the host secret store, never the repo.

## Least privilege

- `hermes_ro` is `NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION`, has **SELECT-only** grants, is `default_transaction_read_only=on`, and has a 30s `statement_timeout`.
- The app continues to use the superuser `nutrezee` connection; Hermes never uses it.
- The DB listens on `127.0.0.1:5432` (container-local); `hermes_ro` connects over loopback only. **Production DB is never exposed to Hermes.**

## Boundaries / non-goals

- Hermes is a **read-only inspection/admin assistant** on staging. It is **not** wired to send the expiring-subscription email (that is the backend job, Part D) and is **not** a data mutator.
- No MCP write/exec/filesystem-write/migration tools are configured for Hermes.
- The agent binary install is **deferred** pending human approval + LLM credentials ([01](01_installation_plan.md)).

## Threat-model notes

- Even a compromised/over-eager agent session cannot write: no DML grants + read-only transaction default. The only residual write-capability (CREATE in `public` via the `PUBLIC` default) is blocked at runtime by the read-only transaction and is removable with one operator-approved `REVOKE` ([03](03_db_readonly_user.md)).
- `statement_timeout=30s` limits accidental heavy scans (e.g. the global subscription view seq-scans ~527K rows; capped).
