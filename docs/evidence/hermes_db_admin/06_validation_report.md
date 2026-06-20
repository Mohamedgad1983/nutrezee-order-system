# 06 — Validation Report (Hermes DB Admin)

**Date:** 2026-06-20 · **Scope:** read-only DB user + installer diligence + **binary install (`--skip-setup`) + read-only MCP**. LLM activation gated.

---

## Summary

| Item | Status |
|---|---|
| Hermes already installed on staging? | No (before) → **installed this session** |
| Official installer downloaded + inspected (not piped to shell) | ✅ 2837 lines, sha256 `dbd9d555…`; benign |
| Agent binary installed (non-root `hermes`, `--skip-setup`) | ✅ **Hermes Agent v0.17.0** |
| LLM credential configured | ❌ **none** (inert; activation gated) |
| Read-only postgres MCP `nutrezee-staging-ro` | ✅ enabled; `hermes mcp test` ✓ (1 read-only `query` tool) |
| `config.yaml` perms (holds the conn string) | ✅ chmod 600 |
| Read-only DB user `hermes_ro` created | ✅ |
| `hermes_ro` read works | ✅ `read_ok=19476` |
| `hermes_ro` write blocked | ✅ `ERROR: cannot execute CREATE TABLE in a read-only transaction` |
| No DML grants (`INSERT/UPDATE/DELETE`) | ✅ verified false via `has_table_privilege` |
| `default_transaction_read_only=on` + `statement_timeout=30s` | ✅ in `rolconfig` |
| Secret stored outside repo | ✅ `/opt/nutrezee/hermes_ro.env` (600, root) |
| Production DB exposed | ❌ never |

## Pre-install host check (read-only)

`command -v hermes` → none; `systemctl … | grep hermes` → none; no `hermes` OS user; `/opt/hermes` absent. Node/npm/python3 present. Secret store `/opt/nutrezee/.env` present (root, 600).

## Remaining gate (clearly stated)

The binary is installed and the read-only MCP is wired, but Hermes is **inert** — no LLM credential is set (`--skip-setup`). **Activation** (adding a provider key so the agent can actually run) is the one remaining human decision. Even after activation, Hermes can only read: the MCP exposes a single read-only `query` tool and `hermes_ro` is read-only at the DB. Production DB is never exposed.

## Evidence trail

- Installer: downloaded to `/tmp/hermes-install.sh`, sha256 re-verified (`dbd9d555…`), inspected, run as `hermes` with `--skip-setup`. Version `v0.17.0`.
- MCP: `hermes mcp add` (URL sourced from a hermes-owned 600 file) → connected, 1 read-only `query` tool, enabled; `hermes mcp test` ✓ (2208ms). `config.yaml` chmod 600.
- Inert check: 0 LLM provider keys set in `~/.hermes/.env`.
- Role: created + privilege-verified via `pg_roles` / `has_table_privilege` / live read+write tests.
- Secret: stored on host only (`/opt/nutrezee/hermes_ro.env` root 600; `/home/hermes/.hermes/db_ro.env` hermes 600); never surfaced in repo/transcript.
