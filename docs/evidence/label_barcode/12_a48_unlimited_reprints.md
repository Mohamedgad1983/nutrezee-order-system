# 12 — A48: unlimited label reprints, reason optional

Date: 2026-09-03 · Owner directive (Mohamed, after the first live single-label print on staging):
"اعملها مفتوحة أي عدد طباعة". Branch `build/wp-lbl-a48-unlimited-reprints` → `fix/a45-console-performance`.

## Change

| Layer | Before (A27) | After (A48) |
|---|---|---|
| DB | `label_print_event_check`: reprint requires non-blank `reason` | migration `0031` drops the CHECK; `reason` stays optional text |
| API | `recordPrint` / `recordCandidateBatchPrint` and both `…/printed` routes reject reprints without reason | reason optional; blank stored as NULL; audit `label.reprinted` still written in the same transaction |
| Fleet-Ops extension v0.3.6 | client-side gate "A reprint reason is required"; an error replaced the whole panel (label disappeared) | no gate, field labelled optional; errors render above the label, the preview stays visible |
| Console image | `CONSOLE_RELEASE=0.7.48-a45.1` | `0.7.48-a48.1` (theme alias `?v=a48.1`) |

Unchanged: barcode never changes on reprint, print/reprint permissions (`label.print` / `label.reprint`),
append-only trail (tamper trigger), same-transaction audit, current-day-only batch rule.

## Tests (local, 2026-09-03)

TS-I `ts-i-label-barcode` (reprint without reason accepted, stored NULL, history 3 rows, barcode stable;
batch with prior prints accepted without reason), TS-U extension/console tests updated; TS-M 12/12.

## Staging deploy (Verified 2026-09-03, owner: "ادمج … وابدأ التركيب")

PR #59 CI 29/29 → merged `bac7a81` into `fix/a45-console-performance`. Source `releases/a48-src-40923eb.tgz`
(sha256 `c3b238bc…`), snapshot `backups/pre-a48-20260903T104323Z.dump` (91 TABLE DATA).

| Step | Result |
|---|---|
| API | `nutrezee-api:a48-40923eb` built; `run --rm --no-deps migrate` applied **0031** only (postgres container untouched this time); `label_print_event_check` gone; API up, admin nginx restarted, `/health` 200 public |
| Console | Dockerfile/nginx.conf/extension copied to `/opt/fleetbase/console` (previous copies in `/opt/fleetbase/backups/a48-pre/`); rollback image `fleetbase-console:a48-rollback-20260903`; candidate `fleetbase-console:a48.1-candidate` built with production args |
| Candidate gate | production metadata 10 / development 0; `/extensions.json` 10 extensions incl. Nutrezee **v0.3.6**; theme alias `?v=a48.1` 200; `vendor-*.js` gzip 200; fingerprinted assets `immutable`; no `Clear-Site-Data`; engine bundle contains no reprint-reason gate |
| Swap | tagged latest → `docker compose up -d --no-build console`; every other container unchanged; running image = candidate; `ops.nutreeze.com` `/`, `/extensions.json`, `/nz/health`, `fleet.…sslip.io` all 200; restarts 0 |

Rollback: `docker tag fleetbase-console:a48-rollback-20260903 fleetbase-console:latest && docker compose up -d --no-build console`;
API: `nutrezee-api:a47-f94ac7b` (0031 is a dropped CHECK; leaving it dropped is harmless).
