# Source Access Check

Date: 2026-06-16 (supersedes the 2026-06-16 BLOCKED_BY_MISSING_ACCESS entry below)

## Update — access re-classified after discovering the on-VPS migration

The previous entry classified access as `BLOCKED_BY_MISSING_ACCESS` because the **local shell** has no `LEGACY_*` / `NEW_DATABASE_URL` env vars. That is still true of the local shell, but it is **not** the whole picture: the legacy→staging migration was already executed directly on the staging VPS, and both the legacy extraction and the target DB are reachable through the `nutrezee-vps` MCP. Re-classified accordingly.

### Source access — `FULL_EXPORT_AVAILABLE`

- Legacy `nutreeze.com` admin was extracted (read-only, authenticated) on **2026-06-14**. Evidence on the VPS:
  - `/opt/nutrezee/pr38-legacy-migration/tools/legacy-migration/migration-output/2026-06-14T13-29-40-368Z/summary.jsonl` — login `https://nutreeze.com/dashboard`; `/serversideuserlist` → 20,151 customers; `/orders/ajaxlist/Active` → 1,044; packages 7; delivery_methods 4.
  - `…/raw/customer_details.jsonl` (20,165 lines), `…/raw/orders_history.json` (full order history).
  - `/opt/nutrezee/analysis-results.json` — full legacy data profile.
- **Live legacy re-pull is NOT configured this session** (no `LEGACY_BASE_URL`/credentials in this environment). The existing export is sufficient to reconcile counts but cannot be refreshed here, and per-order **detail pages were never extracted** (a source-coverage gap).

### Target access — `NEW_STAGING_DB_AVAILABLE`

- Staging Postgres `nutrezee-postgres-1` (DB `nutrezee`) is reachable read-only via the `nutrezee-vps` MCP. Staging API healthy (`/health` 200 internal + via Caddy). Protected endpoints enforce 401.
- This is **staging, not production**. No production access was used.

### Migration controls

- `MIGRATION_DRY_RUN` unset → defaults **true**. `MIGRATION_APPLY` unset → defaults **false**.
- Therefore **no import was performed this session**. Work was limited to read-only reconciliation/verification of the already-migrated staging data.

### Verification credentials — partial

- Authenticated **API/browser** verification needs `E2E_BASE_URL` / `E2E_EMAIL` / `E2E_PASSWORD` (or staging admin creds): **missing in this environment**. Only unauthenticated API checks (health, 401 enforcement) and direct read-only DB verification were possible. Authenticated browser verification is **BLOCKED**.

---

## Original entry (2026-06-16) — local-shell env check

The required variables were checked with `test -n "$VAR" && echo "VAR set" || echo "VAR missing"` style commands. Values were not printed.

| Variable | Status (local shell) |
| --- | --- |
| `LEGACY_ADMIN_URL` / `LEGACY_EMAIL` / `LEGACY_PASSWORD` | missing |
| `LEGACY_DATABASE_URL` / `LEGACY_API_BASE_URL` / `LEGACY_EXPORT_PATH` | missing |
| `NEW_DATABASE_URL` / `E2E_BASE_URL` / `E2E_EMAIL` / `E2E_PASSWORD` | missing |
| `MIGRATION_DRY_RUN` / `MIGRATION_APPLY` / `MIGRATION_BATCH_SIZE` | missing |

Local `.env` exposes only key names `NUTREEZE_ADMIN_EMAIL`, `NUTREEZE_ADMIN_PASSWORD` (values not printed). `tools/legacy-migration/config.json` expects `LEGACY_BASE_URL` / `LEGACY_ADMIN_EMAIL` / `LEGACY_ADMIN_PASSWORD` and `NEW_STAGING_URL` / `NEW_ADMIN_EMAIL` / `NEW_ADMIN_PASSWORD`.
