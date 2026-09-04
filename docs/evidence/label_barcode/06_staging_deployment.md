# 06 — Staging deployment (WP-LBL-A27)

> **Status:** ✅ DEPLOYED and verified 2026-07-27. `/nz/collection/*` now answers from the Nutrezee
> API on `ops.nutreeze.com`.
> Owner decisions: apply **only 0020 + 0027**; deploy from the branch as-is (not yet merged).

## 1. Why this was more than "the admin image"

The admin image only fixes *routing*. Three things were required for `/collection/*` to work:

| Need | Why |
|---|---|
| Admin image | `docker/nginx.admin.conf` is an **allow-list**; `collection` was not in it, so the path fell through to the SPA and returned HTML with a 200 |
| API image | the running API was 5 weeks old and had no `m25-label` module — the route did not exist |
| Migration 0027 | the endpoints need `customer_barcode`, `label_print_event`, `box_collection` |

And 0027 could not be applied on its own: staging was at 0023 with **0020 never applied** (the list
jumps 0019 → 0021), while 0027 adds `sort_order` to `customer_dish_day_item`, which 0020 creates.

A plain `node db/migrate.mjs` would have applied **five** migrations — 0020, 0024, 0025, 0026, 0027 —
four of them belonging to other work packages, including **0025 flipping
`rbac_enforcement_mode.logistics_manager` to `deny`** and creating that role. On the owner's
decision, only 0020 and 0027 were applied; 0024–0026 remain pending for their own owners.

## 2. Safety net taken before anything changed

| Artefact | Location |
|---|---|
| Full DB snapshot | `/opt/nutrezee/backups/nutrezee-pre-wp-lbl-a27-20260727-132509.sql.gz` (21 MB) |
| Snapshot sha256 | `0f40790e0afa06108bd5c953715fad9403b8a368d5983efce8eae7b88246df68` |
| Snapshot integrity | `gzip -t` OK, 78 `COPY` blocks, dump terminator present |
| Previous API image | retagged `nutrezee-api:pre-a27` (`747c2c0b7b98`) |
| Previous admin image | retagged `nutrezee-admin:pre-a27` (`9edb32e86104`) |

## 3. What was done

1. Branch source packaged (394 KB, no `node_modules`/`dist`/`.git`) and extracted to
   `/opt/nutrezee/a27-src`. The pre-existing `/opt/nutrezee/repo` was left untouched — it is stale
   (migrations only to 0013) and is not a git checkout.
2. Migrations **0020** then **0027** applied individually, each wrapped in its own
   `BEGIN … INSERT INTO schema_migrations … COMMIT` with `ON_ERROR_STOP=1`.
3. Images built from the staged source and tagged `:latest`
   (api `f4ac4d488f7e`, admin `58081841b0cb`).
4. **Image contents verified before swapping any container:**
   - new admin: `…|driver-order-reassignments|labels|barcodes|collection` present in the nginx
     allow-list; old admin image had **0** occurrences of `collection`;
   - new api: `/srv/dist/modules/m25-label/label.controller.js` present;
   - new api: **no** runtime `require("@nutrezee/shared")` anywhere — the types-only-package bug
     confirmed absent in the shipped artefact.
5. `docker compose … up -d --no-deps --no-build api admin` recreated only those two containers.
   Postgres and Caddy were not touched.

## 4. Verification

### The goal

```
/nz/collection/manifest      http 401  {"error_code":"no_session"}     ← API JSON, was SPA HTML
/nz/barcodes/customer/none   http 401  {"error_code":"no_session"}
/nz/health                   http 200  {"status":"ok","service":"nutrezee-api"}
/nz/labels/render            http 404  Cannot GET /labels/render       ← POST-only, by design
```

All nine `m25-label` routes registered at boot: `/labels/render`, `/labels/batch`,
`/labels/:orderId/printed`, `/labels/:orderId/print-history`, `/barcodes/customer/:customerId`
(+`/issue`, `/replace`), `/collection/manifest`, `/collection/scan`.

`/nz/labels/render` returning 404 on GET is correct — it is POST-only because the first render
issues the customer's barcode, and a GET must never mutate state.

### No regression

Every site returned its exact pre-deploy status: `ops.nutreeze.com/` 200, `/int/v1/ping` 400,
`/storage/` 400, `fleet.…` 200, `13-140-159-201.sslip.io/` 200 and `/health` 200,
`erp.nutreeze.com` 200, `wa.…` 200, `gad.…` 302.

Every pre-existing admin API prefix still reaches the API (401 = auth gate, not a routing miss):
`/auth/me`, `/customers`, `/orders`, `/catalog/products`, `/settings/masters/area`, `/audit`.
The admin SPA still serves at `/app/*`.

### Correctness probe on the data

Row counts **identical** to the pre-migration baseline — the migrations touched schema only:

| Table | Before | After |
|---|---:|---:|
| `customer` | 19 482 | 19 482 |
| `customer_order` | 20 203 | 20 203 |
| `fulfillment_day` | 530 538 | 530 538 |
| `address` | 9 542 | 9 542 |

The scoped-migration decision is confirmed in the live database:

- `rbac_enforcement_mode` is unchanged — every role still `log`, **no `deny`**;
- the `logistics_manager` role does **not** exist (0025 not applied);
- the **`driver` role still has `(none)` visibility grants** — zero PII, as designed, so drivers
  see `***` for customer names;
- A27 permissions landed on the intended roles only:
  `barcode.replace` → super_admin, admin; `collection.scan` / `collection.manifest.read` →
  super_admin, admin, ops_manager, driver; `label.read` → super_admin, admin, ops_manager,
  kitchen_user.

## 5. Rollback

**Containers/images** (seconds, no data loss):

```bash
docker tag nutrezee-api:pre-a27 nutrezee-api:latest
docker tag nutrezee-admin:pre-a27 nutrezee-admin:latest
cd /opt/nutrezee/repo && docker compose --env-file /opt/nutrezee/.env \
  -f docker/compose.yml -f docker/compose.staging.yml up -d --no-deps --no-build api admin
```

**Caddy `/nz/*` route:** the container's own `/etc/caddy/Caddyfile` has never contained the block
(it was applied via a merged config reload), so a plain reload reverts it:

```bash
docker exec nutrezee-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

**Database:** 0020 and 0027 are purely additive — new tables, two nullable columns, new permission
rows. Nothing existing is altered or dropped, so leaving them applied is harmless even if the code
is rolled back. A full restore, if ever needed:

```bash
zcat /opt/nutrezee/backups/nutrezee-pre-wp-lbl-a27-20260727-132509.sql.gz \
  | docker exec -i nutrezee-postgres-1 psql -U nutrezee -d nutrezee
```

## 6. Still outstanding

- The deployed code is branch `build/wp-lbl-a27-legacy-label-barcode`, **not merged to `main`**,
  and CI has not run on it. Staging and `main` will not match until it is merged.
- Migrations **0024, 0025, 0026 remain pending** on staging. Any future plain `migrate.mjs` run
  will apply them — including the 0025 RBAC change. That is a deliberate hand-off, not an oversight.
- `/collection/*` is reachable, but **no driver on staging is linked to a `staff_user` yet**
  (`driver.staff_user_id` is new and unpopulated), and `driver`/`delivery_route` are empty. A real
  driver scan on staging needs those rows created first.
