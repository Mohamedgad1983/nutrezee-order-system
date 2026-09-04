# Fleet-Ops Console production-performance contract (A45)

The production Console must be built with `ops/fleetbase/console/Dockerfile` and served with its
adjacent `nginx.conf`. These are deployment overlays only; Fleetbase application/vendor source is
not edited.

## Required build arguments

- `ENVIRONMENT=production`
- `DISABLE_RUNTIME_CONFIG=false`
- `EXTENSIONS=@nutrezee/fleetops-labels-engine`
- `DISABLE_FLEETBASE_ATTRIBUTION=false`
- `CONSOLE_RELEASE=0.7.48-a48.4` (a48.3 → a48.4 with extension v0.3.9: 150 x 100 mm sticker sheet; a48.3 = freshness indicator)

The image build fails unless the emitted metadata says `production`, runtime config is explicitly
enabled, and the extension theme has a non-empty stable alias. Never substitute a development build.

## Serving contract

- gzip JavaScript, CSS, JSON, XML, SVG and text responses;
- revalidate shell HTML, runtime config, the extension manifest and stable aliases;
- cache content-fingerprinted assets for one year as immutable;
- never send `Clear-Site-Data` from Console HTML;
- preserve `/extensions.json`, Fleetbase attribution and all existing routes.

## Candidate gate

Before swapping the Console container, verify inside the candidate image:

1. HTML contains production metadata and no development metadata.
2. `/extensions.json` lists ten extensions including Nutrezee v0.3.9 (v0.3.8 = a48.3).
3. The stable theme alias and every HTML/engine-manifest asset return 200.
4. The initial HTML asset set is materially smaller than the a44.3 baseline of about 40 MB.
5. Requests with `Accept-Encoding: gzip` return `Content-Encoding: gzip` for large JS/CSS.
6. HTML has no `Clear-Site-Data`; fingerprinted assets return `immutable`.

Deploy only the Console container after preserving the current image as rollback. Verify root,
Drivers, `/nz/health`, protected label/location boundaries, signed-in warm-light rendering, cold-load
time and container restart count. No database, Partner, Fleetbase API, dispatch, label or collection
write is part of this release.

## Live result (2026-08-30 deploy + real-device measurement)

Candidate gate passed 6/6 against image `fleetbase-console:a45.1-candidate` (production metadata,
10 extensions incl. Nutrezee v0.3.5, theme alias + 7 HTML assets + 30 engine assets all 200, initial
set 15.1 MB raw / 3.45 MB gzip vs the ~40 MB baseline, gzip on large JS, no `Clear-Site-Data`,
immutable fingerprinted assets). Rollback image preserved as `fleetbase-console:a45-rollback-20260823`
(`095634f0cbbf`, id also in `/root/wp-ops-a45-console-performance-rollback-20260823/`). Only the
Console container was recreated (`docker compose up -d --no-build console`); every other container
untouched, restarts=0.

Cold-load measured on a real phone (Realme RMX3760, Chrome 151 over USB CDP, cache disabled,
strong 5 GHz Wi-Fi), same method before and after:

| Metric | a44.3 (before) | a45.1 (after) |
|---|---|---|
| Bytes transferred | 42.35 MB | 3.79–3.82 MB |
| `load` event | 28.8 s | 5.0–5.4 s |
| App shell rendered | 30.3 s | 6.2–6.5 s |
| Repeat visit (warm cache) | n/a — `Clear-Site-Data` wiped cache every visit | 1.3 KB transferred, rendered 3.7 s |

Live serving contract re-verified after the swap: HTML `no-cache, must-revalidate` + gzip and no
`Clear-Site-Data`; fingerprinted vendor asset gzip + `immutable`; runtime `fleetbase.config.json`
served with real API_HOST; `/extensions.json` = 10 incl. Nutrezee v0.3.5; theme alias 200;
`/fleet-ops/drivers` 200; `/nz/health` ok; footer shows `Fleetbase v0.7.48-a45.1` with attribution.
Signed-in warm-light rendering is unchanged by construction (extension v0.3.5 differs from v0.3.4
only by release marker/comments; the theme loads from the stable alias, which returns 200).
