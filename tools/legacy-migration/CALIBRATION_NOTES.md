# Legacy Calibration Notes — nutreeze.com

**Date:** 2026-06-14 · **Status:** Calibrated + first full extraction run · **Source:** the real legacy admin (`https://nutreeze.com`, Symfony/PHP, server-side DataTables)
**Companion:** `extract2.ts` (the calibrated extractor), `reports/extraction-validation-record.md`, `10_Data_Model/migration_entity_calibration_playbook.md`

> This file records the real legacy structure discovered during calibration so the extraction is reproducible. Credentials live only in the gitignored env (`.env.legacy` locally / `/opt/nutrezee/legacy-migration.env` on the VPS) — never here.

## Execution environment (VPS, not laptop)
Extraction runs on the staging VPS (no host Node) via the already-pulled Playwright image, with host networking + an env-file:
```
docker run --rm -u root --network host --env-file /opt/nutrezee/legacy-migration.env \
  -v /opt/nutrezee/pr38-legacy-migration/tools/legacy-migration:/work -w /work \
  mcr.microsoft.com/playwright:v1.60.0-noble npx tsx extract2.ts
```
The host `node_modules` resolves Playwright **1.60.0** → use the `v1.60.0-noble` image (not 1.49). Output lands in `migration-output/<stamp>/` (gitignored).

## Login
- Base URL: `https://nutreeze.com` (the sponsor-provided `/dashboard` is just a JS redirect to `/admin`; routes are root-relative).
- Login page: `/admin` (`<h1>Login</h1>`). Form `POST /logincheck`, fields `email_address` + `password`, submit `input[type=submit]`. **authPostAllowlist must be `/logincheck`.**
- Post-login lands on `/dashboard` (title "Nutrezee - Dashboard").

## Entities (calibrated)
| Entity | Page | Data source | Rows | Key columns (index in ajax/DOM) |
|---|---|---|---|---|
| **customers** | `/users/list/3` | **server-side ajax** `GET /serversideuserlist` | **20,151** | 1=UniqueID, 2=Username, 3=Email, 4=Mobile, 5=DOB |
| **orders (active)** | `/orders/list/Active` | **server-side ajax** `GET /orders/ajaxlist/Active` | **1,044** | 1=OrderU.No, 2=Customer+phone, 3=Package, 4=SubPackage, 5=Start, 6=End, 7=TxnDate, 8=TxnId, 9=Type, 10=PayStatus, 11=OrderStatus, 12=Coupon, 13=PkgAmount, 14=PaidAmount |
| orders (pause) | `/orders/list/Pause` | ajax `GET /orders/ajaxlist/Pause` | 0 via ajax (1 visible via DOM — endpoint quirk; negligible) | same |
| packages | `/package` (singular!) | DOM (client-side, one page) | 7 | 2=NameEN, 3=NameAR, 4=Priority, 5=Coupon |
| package-for-type | `/packageFor` | DOM | 7 | 2=NameEN, 3=NameAR, 4=Type, 5=FridayOff, 6=ActiveForNewCustomers |
| delivery methods | `/deliveryMethod` | DOM | 4 | 2=NameEN, 3=NameAR |
| products | `/products` | — | **TIMEOUT >45s** (page hangs; needs a paged/ajax route — not yet found) |

Server-side DataTables expose `GET <ajaxUrl>?draw=&start=&length=&...` returning `{recordsTotal, data:[[...]]}`. Pulled in 2,500-row chunks via the authed `context.request` (read-only GET).

## Normalizer pre-conditioning (applied in extract2.ts)
The toolkit normalizers are KSA-shaped; legacy is Kuwait. Two transforms make them validate:
- **Phone:** Kuwaiti 8-digit (e.g. `51166337`, or embedded `Ghazi .[ 55995646 ]`) → `+965` + the 8 digits → `normalizePhone` ok=true.
- **Dates:** `DD-MM-YYYY` (e.g. `23-06-1992`) → `YYYY-MM-DD` → `toIsoDate` ok=true.

## First full extraction result (2026-06-14)
| Entity | Rows | VERIFIED | INFERRED | NEEDS_MANUAL_REVIEW |
|---|--:|--:|--:|--:|
| customers | 20,151 | 12,405 | 0 | 7,746 |
| orders (active) | 1,044 | 0 | 1,044 | 0 |
| packages | 7 | 0 | 7 | 0 |
| package-for-type | 7 | 0 | 0 | 7 (passthrough) |
| delivery methods | 4 | 0 | 4 | 0 |

The 7,746 customer reviews are mostly **Arabic-only names** (`full_name_en` required → review, per model A1) + unparseable phones → exactly the dedup/merge-review path the migration plan expects.

## Known refinements (next pass — not blockers)
- **products** page times out → find its ajax/paged route or extract via package composition.
- Package **price / duration / meals** and **name_ar** aren't on the list page (separate EN/AR columns + detail pages) → enrich from detail or accept name-keyed match.
- orders **pause** ajax returns 0 (DOM shows 1) → use the DOM list for pause, or find the right ajax filter.
- Catalog **priority/coupon** (packages) and **Friday-off/new-customer** (package-for) ARE captured in `raw/` — feed the MG-C6 parity columns at import.

## Next step (separate, explicit — NOT run here)
The normalized files are import-ready candidates only. The real import is the new system's M19 `dry-run -> human review -> apply` (`10_Data_Model/migration_execution_runbook.md`). **Never** auto-apply from this toolkit.
