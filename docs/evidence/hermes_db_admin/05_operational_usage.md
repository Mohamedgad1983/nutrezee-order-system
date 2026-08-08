# 05 — Operational Usage

**Date:** 2026-06-20

---

## What `hermes_ro` is for

Safe, read-only DB inspection on staging — by the Hermes MCP agent (once installed) or any admin/BI tool. Typical uses: schema exploration, ad-hoc `SELECT`s, sanity-checking the analytics views (`analytics.customer_subscription_status`, `analytics.order_subscription_periods`), reconciliation queries.

## Connecting (read-only)

The connection string is in the host secret store (not the repo):
```bash
set -a; . /opt/nutrezee/hermes_ro.env; set +a   # exports HERMES_RO_DATABASE_URL
docker exec -i -e U="$HERMES_RO_DATABASE_URL" nutrezee-postgres-1 \
  sh -c 'psql "$U" -c "SELECT count(*) FROM analytics.customer_subscription_status;"'
```

Any write/DDL attempt fails (`cannot execute … in a read-only transaction`), so the session is safe by construction.

## Example inspection queries

```sql
-- subscription status distribution
SELECT subscription_status, count(*) FROM analytics.customer_subscription_status GROUP BY 1 ORDER BY 2 DESC;
-- customers expiring in exactly 3 days (Asia/Kuwait)
SELECT count(*) FROM analytics.customer_subscription_status
WHERE subscription_expire_date = (now() AT TIME ZONE 'Asia/Kuwait')::date + 3;
-- schema_migrations head (confirm 0020 NOT applied)
SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 3;
```

## Guardrails for operators

- Use `hermes_ro` for reads; use the app's superuser connection only for governed migrations/ops.
- Do not point any agent/MCP at the production DB.
- Do not grant `hermes_ro` write/DDL; do not remove its `default_transaction_read_only` setting.
- Keep PII handling in mind: the role can read PII columns — prefer aggregate/ID-only queries; masking is enforced in the app API, not at this raw DB layer.

## Relationship to the expiring-subscription email

The Hermes/`hermes_ro` layer is for **inspection**. The **daily expiring-subscription email** is produced by the backend job (Part D), which uses the app `DATABASE_URL` (the official source) — not Hermes.
