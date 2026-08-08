# Ongoing legacy → staging order-resync — runbook

Keeps new/changed legacy orders flowing into staging. Built on the **validated** pieces from
Phase 3 (see `docs/evidence/legacy_full_migration/33_...md`). Design rule: the two consequential
steps (touching legacy; writing the DB) are **separate, deliberate, and guarded**; the routine
loop is read-only.

## Pipeline

```
[A] LEGACY REFRESH  (owner-run; touches legacy production, read-only)
        legacy-detail-extract.mjs orders-index + orders-detail
        → refreshes out/orders_index.jsonl + out/raw/view_<internal_id>.html.gz
[B] ENRICH + PLAN   (read-only; safe to schedule)   → run-order-resync.sh
        enrich-orders.mjs            order_number → internal_id → "Contact no" phone
        incremental-sync.mjs --dry-run   → would_create / would_skip / would_fail
[C] APPLY           (deliberate; writes staging DB) → apply-order-sync.mjs
        snapshot → dry-run→apply per chunk → CORRECTNESS PROBE → 
[D] RELINK          (deliberate; m22)               → meal-history-relink.mjs
```

## The identifier rule (do not violate)
`orders_history.id` / `sync_record` order key = **`order_number`**. Archived pages
`view_<X>.html.gz` and the detail URL = **`internal_id`**. **Disjoint spaces.** Always enrich
`order_number → internal_id (via orders_index) → view_<internal_id> → "Contact no"`. A direct
`order_number → view_<order_number>` join attaches the **wrong customer** (the 2026-06-21 incident).

## [A] Legacy refresh — owner-run only
The assistant cannot log in to legacy (production boundary + classifier). Creds live in
`/opt/nutrezee/legacy-migration.env` (`LEGACY_BASE_URL`, `LEGACY_ADMIN_EMAIL`, `LEGACY_ADMIN_PASSWORD`).
```bash
cd /opt/nutrezee/legacy-detail-2026
set -a; source /opt/nutrezee/legacy-migration.env; set +a
export LEGACY_BASE="$LEGACY_BASE_URL" LEGACY_EMAIL="$LEGACY_ADMIN_EMAIL" LEGACY_PASS="$LEGACY_ADMIN_PASSWORD"
OUT=$PWD/out node legacy-detail-extract.mjs orders-index     # refresh the index
OUT=$PWD/out node legacy-detail-extract.mjs orders-detail    # refresh detail pages (~1.2s each)
```
> The current extractor is a **full** pull (~20k pages ≈ hours). For frequent runs add an
> incremental mode (only `order_number`s not yet in `sync_record`); until then run [A]
> off-peak / on demand.

## [B] Enrich + plan — read-only, schedulable
```bash
/opt/nutrezee/sync/run-order-resync.sh        # enrich + dry-run; appends counts to logs/
```
`would_create > 0` ⇒ new linkable orders are waiting for an apply. `would_skip` ⇒ see
**customer coverage** below. A `systemd` timer is provided (`nutrezee-order-resync.timer`,
**disabled** by default) to run [B] on a schedule as a monitor.

## [C] Apply — deliberate, snapshot + probe (the only DB write)
```bash
# 1) snapshot
docker exec nutrezee-postgres-1 pg_dump -U nutrezee -d nutrezee -Fc > /opt/nutrezee/backups/pre-apply-$(date +%F-%H%M%S).dump
# 2) stage + apply (idempotent; ALLOW_APPLY gate)
docker cp /opt/nutrezee/legacy-detail-2026/orders_history_enriched.json nutrezee-api-1:/srv/orders_history_enriched.json
docker exec -e ALLOW_APPLY=yes -e SYNC_TARGET=staging nutrezee-api-1 node /srv/apply-order-sync.mjs /srv/orders_history_enriched.json
```
**Mandatory correctness probe** before trusting the run — stored customer phone must equal the
legacy page phone for every new order (0 mismatches), as in evidence doc 33 §4. Any mismatch ⇒
restore the snapshot.

## [D] Relink meal-history
```bash
cd /opt/nutrezee/legacy-meal-history
set -a; source /opt/nutrezee/.env; set +a
export DATABASE_URL="postgres://nutrezee:$POSTGRES_PASSWORD@127.0.0.1:5432/nutrezee"
SYNC_TARGET=staging RELINK_MODE=apply RELINK_APPLY_CONFIRM=APPLY_RELINK_STAGING node meal-history-relink.mjs
```

## Customer coverage (the real backlog limiter)
As of 2026-06-21, ~**434** not-yet-synced orders have a correct phone **but their customer is
not in `sync_record`** (`would_skip`). Orders are only created when their customer already
exists — we never fabricate the link. To unblock them, import the missing customers first (their
phone — and name — are already in the same `view_<internal_id>` pages we parse). That customer
re-pull/import is the recommended next build; once customers land, [B]/[C] create their orders
automatically on the next run.
