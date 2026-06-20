# 02 — Hermes MCP Configuration (read-only DB)

**Date:** 2026-06-20 · **Status: APPLIED & ENABLED** — read-only postgres MCP `nutrezee-staging-ro` configured on staging (1 read-only `query` tool; `hermes mcp test` ✓).

---

## Principle

Expose the staging DB to Hermes through a **read-only Postgres MCP server** bound to the `hermes_ro` role. List/read/query tools only — **no** insert/update/delete/DDL/admin tools. **Never** the production DB.

## Recommended MCP server

Use a read-only Postgres MCP server (e.g. the reference `@modelcontextprotocol/server-postgres`, which is **read-only by design** — it exposes schema listing + a `query` tool and runs statements in a read-only transaction). Node/npx is available on the host.

The connection string comes from the host secret store, never the repo:
```
# value lives only in /opt/nutrezee/hermes_ro.env (mode 600, root):
HERMES_RO_DATABASE_URL=postgres://hermes_ro:****@127.0.0.1:5432/nutrezee
```

## Actual config applied (2026-06-20)

The credential was copied to a `hermes`-owned file and sourced **inside** the `hermes` shell (so the password never transited the agent transcript), then:

```bash
# hermes-owned copy of the read-only credential (600):
install -o hermes -g hermes -m 600 /opt/nutrezee/hermes_ro.env /home/hermes/.hermes/db_ro.env

# add the read-only postgres MCP (run as the hermes user, from its home):
set -a; . ~/.hermes/db_ro.env; set +a
hermes mcp add nutrezee-staging-ro \
  --command npx --args -y @modelcontextprotocol/server-postgres "$HERMES_RO_DATABASE_URL"
```

Result (verified):
```
✓ Connected! Found 1 tool(s): query  (Run a read-only SQL query)   → enabled
hermes mcp test nutrezee-staging-ro → ✓ Connected (2208ms), 1 tool
```

- The MCP entry lives in `/home/hermes/.hermes/config.yaml` (chmod **600**, since the connection string is in the args). `@modelcontextprotocol/server-postgres` v0.6.2 exposes a **single read-only `query` tool** running statements in a read-only transaction — no write/DDL/admin tools.
- Gotchas hit & fixed: run from the `hermes` home (npx fails with `EACCES /root` otherwise); pass the URL by sourcing the hermes-owned file (sudo `--preserve-env` of an unexported var yields an empty URL → `Invalid URL`).

## Tool exposure policy

- **Allow:** schema/table/column listing, `SELECT`/read-only `query`, `EXPLAIN`.
- **Deny / do not configure:** any write tool, migration runner, shell/exec tools, filesystem-write tools, and any MCP server pointed at production.
- Defense-in-depth: even if a write tool were mis-added, `hermes_ro` is `default_transaction_read_only=on` + has no DML grants, so writes fail at the DB ([03](03_db_readonly_user.md)).

## Do NOT

- Do not put the production `DATABASE_URL` in any Hermes MCP config.
- Do not use the app superuser (`nutrezee`) for Hermes.
- Do not embed the password in the repo or in Hermes config files in the repo — inject from the host secret store at runtime.
