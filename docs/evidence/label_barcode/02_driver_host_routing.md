# 02 — Driver-app routing to the collection API (WP-LBL-A27)

> **Status:** ✅ Route LIVE and verified on `ops.nutreeze.com`.
> ⚠️ One step remains before `/collection/*` works: the admin image must be redeployed.
> Owner decisions taken 2026-07-27: **(1)** mount the Nutrezee API under `/nz/*` on
> `ops.nutreeze.com`; **(2)** drivers authenticate with a **Nutrezee staff login**.

## 1. Topology as found

`ops.nutreeze.com` resolves to `13.140.159.201` — the same VPS that hosts everything else.
Before this change it served **Fleetbase only**:

| Path | Upstream |
|---|---|
| `/socketcluster/*` | `fleetbase-socket:8000` |
| `/storage/*` | `fleetbase-httpd:80` |
| `/v1 /int /health /sanctum /storefront /webhooks …` | `fleetbase-httpd:80` |
| everything else | `fleetbase-console:4200` (Ember SPA — returns 200 + HTML for any unknown path) |

The Nutrezee admin + API were on a **different** host, `13-140-159-201.sslip.io` → `admin:80`.
The driver app's `.env` points `FLEETBASE_HOST` / `SOCKETCLUSTER_HOST` at `ops.nutreeze.com`.

A pre-change probe of `https://ops.nutreeze.com/nz/health` returned **200 — but the body was the
Fleetbase console's HTML**, the SPA catch-all. Status code alone would have been misleading; the
body is what proved the route did not exist.

## 2. Change applied

Inserted into the `ops.nutreeze.com` site block, immediately above the console catch-all:

```
	handle_path /nz/* {
		reverse_proxy admin:80
	}
```

`handle_path` strips the `/nz` prefix, so `admin:80` receives `/health`, `/auth/*`,
`/collection/*` exactly as it does on the sslip.io host. No Fleetbase matcher above it matches
`/nz/*`, so no existing route changed.

## 3. A bind-mount trap found on the way (worth knowing)

`docker inspect` reports `/opt/nutrezee/repo/docker/Caddyfile → /etc/caddy/Caddyfile`, but the
**running container is pinned to a stale inode**: the container saw a 91-line file while the host
file had 107 lines. The host file had been replaced (not edited in place) at some point, which
breaks a single-file bind mount. Consequences:

* Editing the host file has **no effect** on the running Caddy, and `caddy reload` inside the
  container silently re-applies the *stale* config. The first attempt at this change did exactly
  that and appeared to do nothing.
* The change was therefore applied by reloading from a merged config built from the **running**
  config, so it took effect live with no container restart and no downtime.

### Pending host-file drift that is NOT ours — recreating Caddy would activate it

The host `Caddyfile` contains two changes that are not live and were not made by this work package:

1. the `ops.nutreeze.com` block wrapped in `route { … }`;
2. `import /config/nzclone.caddy` — the 2026-07-25 "HOPO rebuild", which would bring up
   `shop.13-140-159-201.sslip.io` and `nzadmin.13-140-159-201.sslip.io`.

The host file **is** valid when validated with the real `nutrezee_caddy_config` volume attached
(`/config/nzclone.caddy` exists, 4 555 bytes). But `docker compose up -d caddy` would activate
both changes at once. That is someone else's unfinished work and was deliberately left alone.

**Also note:** the repo's `docker/Caddyfile` (332 bytes, sslip.io only) has drifted far from the
deployed file (~107 lines). The deployed file is the operational source of truth today.

## 4. Verification

```
ops.nutreeze.com/nz/health          {"status":"ok","service":"nutrezee-api"}   ← NEW, our API
ops.nutreeze.com/nz/auth/me         401 {"error_code":"no_session"}            ← NEW, our API
```

Every pre-existing site returned exactly its pre-change status:

| URL | before | after |
|---|---|---|
| `ops.nutreeze.com/` | 200 | 200 |
| `ops.nutreeze.com/int/v1/ping` | 400 | 400 |
| `ops.nutreeze.com/storage/` | 400 | 400 |
| `fleet.13-140-159-201.sslip.io/` | 200 | 200 |
| `fleetapi.…/int/v1/ping` | — | 400 |
| `13-140-159-201.sslip.io/health` | 200 | 200 |
| `erp.nutreeze.com/` | — | 200 |
| `wa.13-140-159-201.sslip.io/` | — | 200 |

Backup of the host Caddyfile before any edit:
`/opt/nutrezee/repo/docker/Caddyfile.bak-20260727-121747`
(sha256 `fc244ff7bcaced581b4fdb22432cb20c71dc2e764a8048034aa458d542a99c1b`).

## 5. Remaining step — admin nginx allow-list

`docker/nginx.admin.conf` routes API traffic by an **allow-list** of root prefixes. WP-LBL-A27 adds
`labels|barcodes|collection` to it (committed), but the **deployed** admin image still runs the old
list, which is directly observable:

```
/nz/auth/me                 → 401 JSON        (auth IS in the deployed list)  ✅
/nz/collection/manifest     → 200 SPA HTML    (collection is NOT)             ❌
```

So `/collection/*` reaches the SPA, not the API, until the admin image is rebuilt and redeployed.
That deploy is a gated owner step (`deploy-staging`, behind `STAGING_DEPLOY_ENABLED`).

Separately, several **pre-existing** prefixes are missing from the same allow-list — `packing`,
`delivery`, `drivers`, `fleetbase`, `exceptions`, `migration` — which means those admin pages
cannot reach their APIs behind this proxy either. Left out of this work package to keep it atomic;
raised as its own task.

## 6. Driver authentication (decision 2)

Drivers will sign in with a **Nutrezee staff account** holding the `driver` role, linked to their
`driver` row by `driver.staff_user_id` (added in migration 0027). This reuses the existing session
auth and RBAC with no new trust relationship and no new credential type — the alternative
(trusting a Fleetbase token to mint a Nutrezee session) would have made Nutrezee an SSO consumer of
Fleetbase and needs its own security review.

Consequence to be aware of: the `driver` role deliberately holds **no `pii` visibility grant**, so
the customer *name* is masked (`***`) for drivers. Drivers identify the stop by order number, area
and delivery time. Granting drivers name visibility is a separate governance decision.
