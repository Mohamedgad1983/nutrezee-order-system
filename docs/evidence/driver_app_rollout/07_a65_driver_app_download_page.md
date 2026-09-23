# 07 — A65: driver-app download page on ops.nutreeze.com (interim distribution until MDM)

**Date:** 2026-09-23. **Owner directive:** distribute the app without visiting each phone, and give the fleet manager (admin phone) the update role.
**Live URL:** `https://ops.nutreeze.com/driver-app/` (noindex; QR rendered on the page itself).

## What is live — Verified
| Path | Serves | Check |
|---|---|---|
| `/driver-app/` | bilingual page: Download button, first-install steps, update steps, QR of the page URL | 200 text/html |
| `/driver-app/version.json` | `{package, versionName 1.0.12, versionCode 13, file, bytes, sha256, releasedAt, notes}`, `Cache-Control: no-store` | 200 application/json |
| `/driver-app/nutreeze-driver-1.0.12.apk` | signed release APK, 94,451,882 bytes, SHA-256 `309a6ce2…c80bca` (= local build, verified on the VPS) | 200 `application/vnd.android.package-archive` |

Existing Fleetbase routes re-checked after the reload: `/fleet-ops` 200, `/v1/drivers` 401 (auth required, as before).

## How
- Files live in the Caddy data volume: host path `/var/lib/docker/volumes/nutrezee_caddy_data/_data/public/driver-app/` = container `/data/public/driver-app`. Chosen because that volume is already mounted, so **no container restart** and no compose change.
- Caddy: new `handle_path /driver-app/*` (file_server, root `/data/public/driver-app`) + `handle /driver-app` → 301, inserted above the console catch-all in `/opt/nutrezee/repo/docker/Caddyfile.active` (VPS-only file; the repo's `docker/Caddyfile` does not carry the ops.nutreeze.com block). Backup `Caddyfile.active.bak-a65-<ts>` next to it. `caddy validate` → Valid, `caddy reload` (graceful).
- Upload: scp via the VPS MCP timed out at 84 MB (slow uplink); finished with `rsync --partial --append --inplace`, then hash compared.
- Browser-pane screenshot was unavailable (policy check error), so the render was verified by curl (title, APK href, QR lib on cdnjs reachable) rather than visually. [Inferred]

## Publishing a new version (the fleet manager's routine, one action for all phones)
1. Build + sign on the Mac as in doc 03 (`app-release.apk`).
2. Copy it up as `nutreeze-driver-<ver>.apk` into the folder above (rsync over the same SSH key), `sha256sum` it there.
3. Edit `version.json`: versionName, versionCode, file, bytes, sha256, releasedAt, notes. The page reads it live (no-store), so the button switches immediately.
4. Send the drivers one WhatsApp message with the link. They open it, Download, Install — updates in place, they stay logged in.
5. Old APKs can be deleted after a week (disk is at 94 %).

## Not done / owner-side [NC]
- **Admin (fleet manager) phone:** name + mobile were not given. Needs: (a) the link above, (b) a Fleetbase console user so they can see drivers/vehicles, and (c) optionally the app itself if they will also deliver. Pending owner input.
- **MDM (permanent remote control):** requires an MDM account (owner action) and a factory reset per phone to enrol as Fully Managed; planned after go-live, phased two phones a day after the shift.
- **In-app update check** (app reads `version.json` and prompts): needs a `/src` change outside the authentication scope → separate amendment if wanted.
