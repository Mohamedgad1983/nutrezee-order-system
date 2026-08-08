# 01 — Hermes Agent Installation Plan

**Date:** 2026-06-20 · **Decision: INSTALLED** — binary installed under a non-root user with `--skip-setup`, read-only DB MCP wired; **LLM activation remains gated** (no key set → agent is inert).

> History: this was initially deferred (see below). On explicit user approval ("Install binary now (no key)"), the binary was installed and the read-only MCP configured. The activation step (adding an LLM credential) is still a separate human decision.

## Installed (2026-06-20)

- **Version:** Hermes Agent **v0.17.0** (2026.6.19), Python 3.11.15, under user `hermes` (uid 1001, home `/home/hermes`).
- **Command:** `sudo -u hermes -H bash /tmp/hermes-install.sh --skip-setup` (installer sha256 `dbd9d555…`, re-verified before run). Files under `/home/hermes/.hermes/` (`config.yaml`, `.env`, `hermes-agent/`, bundled `uv`/node).
- **`--skip-setup`** → **no LLM credentials configured**; `~/.hermes/.env` contains only non-secret tool defaults. The agent cannot run autonomously until a key is added.
- **Read-only DB MCP wired:** server `nutrezee-staging-ro` → `npx -y @modelcontextprotocol/server-postgres <hermes_ro url>`, **enabled**, exposes a single **read-only `query`** tool (`hermes mcp test` → ✓ connected, 1 tool). See [02](02_mcp_config.md).
- **Browser tools** (bundled Chromium) installed but unused for DB admin; no system libs added (no sudo for `hermes`).

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

## What remains gated: LLM activation

The binary is installed but **inert** — `--skip-setup` left no LLM credential, so the agent cannot run. Activation is a deliberate, separate human step:

1. Choose a provider and add its key to `~/.hermes/.env` (host only, never the repo) — e.g. `OPENROUTER_API_KEY=…` or `hermes login` for Nous Portal.
2. Start a session (`hermes`) — it will then be able to use the read-only `query` tool against staging.

The architecture decision ("must not become an uncontrolled production data mutator") is satisfied at every layer: the MCP exposes only a read-only `query` tool, and the underlying `hermes_ro` role is `default_transaction_read_only=on` with no DML grants ([03](03_db_readonly_user.md)). So even once activated, Hermes can only read.

## Original deferral rationale (kept for the record)

Before the explicit approval, the install was deferred because Hermes *functions* only with an LLM credential and running an autonomous agent on live staging warranted sign-off. The approval scoped it to **binary install + read-only MCP, no key** — which is what was done.

## Approved install procedure (for the gated follow-up)

1. Create a dedicated non-root OS user (e.g. `hermes`) with no sudo and no DB superuser.
2. As that user: `curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh`, re-verify sha256, inspect, then `bash /tmp/hermes-install.sh --skip-setup` (review flags). Record the installed version.
3. `hermes setup` with an LLM credential stored in the host secret store (never the repo).
4. Configure MCP for **read-only DB access only** using `hermes_ro` (see [02](02_mcp_config.md)).
5. Never expose the production DB; never grant write/DDL tools.
