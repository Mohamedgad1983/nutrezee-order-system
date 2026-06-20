# 02 — Hermes MCP Configuration (read-only DB)

**Date:** 2026-06-20 · **Status:** config documented; applied only when the gated agent install proceeds ([01](01_installation_plan.md)).

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

## Hermes MCP entry (illustrative `~/.hermes` config)

```jsonc
{
  "mcpServers": {
    "nutrezee-staging-ro": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "${HERMES_RO_DATABASE_URL}"],
      // read-only DB MCP: schema introspection + read-only query tool only
      "env": { "HERMES_RO_DATABASE_URL": "<injected from /opt/nutrezee/hermes_ro.env>" }
    }
  }
}
```

## Tool exposure policy

- **Allow:** schema/table/column listing, `SELECT`/read-only `query`, `EXPLAIN`.
- **Deny / do not configure:** any write tool, migration runner, shell/exec tools, filesystem-write tools, and any MCP server pointed at production.
- Defense-in-depth: even if a write tool were mis-added, `hermes_ro` is `default_transaction_read_only=on` + has no DML grants, so writes fail at the DB ([03](03_db_readonly_user.md)).

## Do NOT

- Do not put the production `DATABASE_URL` in any Hermes MCP config.
- Do not use the app superuser (`nutrezee`) for Hermes.
- Do not embed the password in the repo or in Hermes config files in the repo — inject from the host secret store at runtime.
