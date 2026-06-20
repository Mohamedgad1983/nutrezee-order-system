# 01 — Hermes Agent Installation Plan

**Date:** 2026-06-20 · **Decision: INSTALL DEFERRED / GATED** (read-only DB user created; agent binary not installed).

---

## What Hermes Agent is

[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) — an open-source autonomous AI agent with a **built-in MCP client** (since v0.2.0) that can connect to external tool servers (databases, GitHub, filesystem, etc.). Official site: `hermes-agent.nousresearch.com`.

## Official installer (downloaded + inspected — NOT executed)

- **Command:** `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` (Linux/macOS/WSL/Termux). Windows: `iex (irm .../install.ps1)`. A desktop installer also exists.
- **Per the safety rule, the installer was downloaded to a temp file and inspected — never piped to a shell.**
  - Size: **2837 lines / 118,086 bytes**. `sha256 = dbd9d555ed4ac67bd1fc71ba6a39b410cf2af0ebcfd8f4889e086af78c9ddcaa` (download date 2026-06-20).
  - `#!/bin/bash`, `set -e`; uses **`uv`** to manage a Python install and a bundled Node runtime under `$HERMES_HOME`.
  - `rm -rf` occurrences are scoped to its own temp/install dirs (`$tmp_dir`, `$HERMES_HOME/node`) — no system-path deletion.
  - Uses `sudo` only (optionally, passwordless) to `apt/dnf/pacman install git`; falls back to printing manual instructions.
  - Post-install requires `hermes setup --portal` to authenticate an LLM provider.
  - The temp copy was removed after inspection.

## Why the binary install is DEFERRED (blocker)

Per the phase rules ("if Hermes installation … requires credentials: do not force it; document the blocker"):

1. **Requires LLM credentials.** Hermes is an LLM agent — `hermes setup --portal` needs an API key / OAuth (Nous Portal, OpenRouter, OpenAI, …). None are available to this run, and provisioning an LLM credential is a human decision.
2. **Autonomous agent on live staging = gated.** The architecture decision states Hermes "must not become an uncontrolled production data mutator." Running an autonomous agent against the staging DB needs human sign-off and a dedicated non-root user. The **read-only DB user** (created — see [03](03_db_readonly_user.md)) is the enforcement primitive that makes any such agent safe; standing up the agent itself is the gated follow-up.

**What WAS done safely now:** the read-only PostgreSQL user (`hermes_ro`) + secret storage + verification, so that *when* a human approves the agent, it can only ever read.

## Approved install procedure (for the gated follow-up)

1. Create a dedicated non-root OS user (e.g. `hermes`) with no sudo and no DB superuser.
2. As that user: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh`, re-verify sha256, inspect, then `bash /tmp/hermes-install.sh --skip-setup` (review flags). Record the installed version.
3. `hermes setup` with an LLM credential stored in the host secret store (never the repo).
4. Configure MCP for **read-only DB access only** using `hermes_ro` (see [02](02_mcp_config.md)).
5. Never expose the production DB; never grant write/DDL tools.
