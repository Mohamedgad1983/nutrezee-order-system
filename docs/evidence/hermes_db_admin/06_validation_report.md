# 06 — Validation Report (Hermes DB Admin)

**Date:** 2026-06-20 · **Scope:** read-only DB user + installer diligence. Agent binary **not** installed (gated).

---

## Summary

| Item | Status |
|---|---|
| Hermes already installed on staging? | **No** (no binary/service/user found) |
| Official installer downloaded + inspected (not piped to shell) | ✅ 2837 lines, sha256 `dbd9d555…`; benign |
| Agent binary installed | ❌ **Deferred/gated** (requires LLM credentials + human approval) |
| Read-only DB user `hermes_ro` created | ✅ |
| `hermes_ro` read works | ✅ `read_ok=19476` |
| `hermes_ro` write blocked | ✅ `ERROR: cannot execute CREATE TABLE in a read-only transaction` |
| No DML grants (`INSERT/UPDATE/DELETE`) | ✅ verified false via `has_table_privilege` |
| `default_transaction_read_only=on` + `statement_timeout=30s` | ✅ in `rolconfig` |
| Secret stored outside repo | ✅ `/opt/nutrezee/hermes_ro.env` (600, root) |
| Production DB exposed | ❌ never |

## Pre-install host check (read-only)

`command -v hermes` → none; `systemctl … | grep hermes` → none; no `hermes` OS user; `/opt/hermes` absent. Node/npm/python3 present. Secret store `/opt/nutrezee/.env` present (root, 600).

## Blocker (clearly stated)

The Hermes **agent** is not installed because it **requires LLM provider credentials** (`hermes setup --portal`) and running an autonomous agent against the staging DB needs human sign-off (architecture decision: "must not become an uncontrolled production data mutator"). This is a documented gate, not a failure. The **read-only enforcement primitive** (`hermes_ro`) is in place so the eventual agent can only read.

## Evidence trail

- Installer: downloaded to `/tmp/hermes-install.sh`, inspected (size/sha256/risky-pattern scan), then removed.
- Role: created + privilege-verified via `pg_roles` / `has_table_privilege` / live read+write tests.
- Secret: written server-side to `/opt/nutrezee/hermes_ro.env`; never surfaced.
