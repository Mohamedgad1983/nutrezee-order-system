# 03 — Read-Only DB User (`hermes_ro`)

**Date:** 2026-06-20 · **Status: CREATED & VERIFIED on staging** (`nutrezee-postgres-1`, db `nutrezee`).

---

## What was created

A dedicated login role `hermes_ro` for read-only DB inspection (Hermes MCP and any admin tooling).

```sql
CREATE ROLE hermes_ro LOGIN PASSWORD '<generated server-side, stored in host secret store>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE nutrezee TO hermes_ro;
GRANT USAGE ON SCHEMA public    TO hermes_ro;
GRANT USAGE ON SCHEMA analytics TO hermes_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public    TO hermes_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO hermes_ro;   -- incl. the subscription views
ALTER DEFAULT PRIVILEGES IN SCHEMA public    GRANT SELECT ON TABLES TO hermes_ro;  -- future tables readable
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO hermes_ro;
-- Role-scoped hardening (affects ONLY hermes_ro):
ALTER ROLE hermes_ro SET default_transaction_read_only = on;   -- blocks all writes/DDL at runtime
ALTER ROLE hermes_ro SET statement_timeout = '30s';            -- caps runaway queries
```

The password was **generated on the server** (`openssl rand -hex 24`) and written directly to the host secret store — it never appeared in the repo, the transcript, or psql output.

## Verification (DB-checked this run)

| Check | Result |
|---|---|
| Role attributes | `rolsuper=f, rolcreatedb=f, rolcreaterole=f, rolreplication=f, rolcanlogin=t` |
| `SELECT` on `customer` / `analytics.customer_subscription_status` | **true** |
| `INSERT` / `UPDATE` / `DELETE` on `customer` | **false** (not granted) |
| `default_transaction_read_only` | **on** (`rolconfig`) |
| Live READ as `hermes_ro` | `read_ok=19476` ✓ |
| Live WRITE as `hermes_ro` (`CREATE TEMP TABLE`) | **blocked**: `ERROR: cannot execute CREATE TABLE in a read-only transaction` ✓ |

→ `hermes_ro` can read every table/view but **cannot INSERT/UPDATE/DELETE or run DDL**.

## Known residual + remediation (operator-approved)

`has_schema_privilege('hermes_ro','public','CREATE')` returns **true** — inherited from the database-wide default grant of `CREATE` on `public` to the implicit `PUBLIC` group (pre-PG15 default), **not** something granted to `hermes_ro`. It is neutralized at runtime by `default_transaction_read_only=on`. To remove it at the privilege level too, an operator can run (one-time, affects all non-owner roles; the app uses superuser `nutrezee` and is unaffected):

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;   -- PG15+ default best practice
```

This was intentionally **not** applied automatically because it is a database-wide grant change beyond scoping the new user.

## Rollback

```sql
DROP ROLE hermes_ro;   -- after disconnecting any sessions
-- then remove /opt/nutrezee/hermes_ro.env on the host
```
