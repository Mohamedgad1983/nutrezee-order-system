# Migration Entity Calibration Playbook (S1-ready)

**Date:** 2026-06-14 · **Status:** Ready to execute the moment legacy access (MG-A1) is granted · **Owner:** Migration Operator
**Companion:** `tools/legacy-migration/README.md` (toolkit), `migration_gap_register.md` (MG-B1..B12), `migration_execution_runbook.md` (the full extract→import flow)

> **What "calibration" means.** The toolkit ships every legacy entity as `calibrated:false`. While false, the entity is **skipped before any page navigation** and reported `NEEDS_CALIBRATION` — nothing is scraped. Calibration is the one-time act of pointing the toolkit's CSS selectors at the **real** legacy DOM and flipping `calibrated:true`. It is read-only: you are tuning *where to read*, never writing anything. This playbook is the exact procedure. It cannot be executed until MG-A1 (legacy URL + read-only credentials) lands — but every step, default selector, and acceptance check below is pre-authored so calibration is a single focused session, not a discovery exercise.

---

## 0. Pre-flight (once, before any entity)

1. Receive from sponsor (MG-A1): `LEGACY_BASE_URL`, `LEGACY_ADMIN_EMAIL`, `LEGACY_ADMIN_PASSWORD` (read-only account preferred). Export as env vars — **never** write them into `config.json` (`tools/legacy-migration/README.md §1`).
2. `cd tools/legacy-migration && npm install && cp config.example.json config.json`.
3. Confirm the safety posture is intact (do **not** weaken it):
   - `legacy.authPostAllowlist` = `["/login"]` only (or the real login path).
   - `legacy.readOnlyGetAllowlist` stays narrow — add an entry **only** for a URL you have manually verified read-only that happens to contain a blocked token (`payment`, `status`, `action`, …). Never allowlist an action namespace.
4. Verify login selectors against the real login page (`emailSelector`, `passwordSelector`, `submitSelector`, `loggedInSelector`). Use `MIGRATION_HEADED=1` to watch, `MIGRATION_MANUAL_LOGIN=1` if 2FA/captcha.
5. Smoke the login only: run `npm run legacy:migration:dry-run` with **all entities still `calibrated:false`**. Expect: login succeeds, strict read-only engages, every entity reported `NEEDS_CALIBRATION`, 0 rows. This proves access + safety before touching a single data page.

## 1. Per-entity calibration loop (repeat for each entity, in cutover-batch order)

For each entity, do this **one at a time** (calibrate → verify → freeze, then next):

1. **Open the real legacy screen** at the entity's `path` (use Playwright codegen: `npx playwright codegen $LEGACY_BASE_URL/<path>` — it generates selectors you can copy).
2. **Fix the four selector fields** in `config.json` for that entity:
   - `path` — the real list URL (correct the default if the legacy route differs).
   - `rowSelector` — the table-row (or card) selector that yields **one node per record**.
   - `nextPageSelector` — the real "next page" control (or remove if single-page / infinite scroll — then set `maxPages:1`).
   - `columns` — map each target field to the cell selector that holds it (`td:nth-child(n)` or a class).
3. **Set `"calibrated": true`** for that entity only.
4. **Verify with an extraction-only run scoped to read:** `npm run legacy:migration:extract`. Check `migration-output/<ts>/raw/<entity>.json` and `normalized/<entity>.json`:
   - Row count ≈ the count visible on screen (±pagination).
   - Key fields populated (not blank): see the per-entity acceptance table below.
   - `confidence_breakdown`: most rows `VERIFIED`; investigate any large `NEEDS_MANUAL_REVIEW` bucket.
   - A screenshot was captured under `screenshots/` (evidence).
5. **Freeze** the entity (leave `calibrated:true`) and move to the next. Do not batch-flip all entities at once — one bad selector then corrupts every report.

## 2. Per-entity acceptance criteria (calibration is "done" when…)

Order entities by cutover batch (Batch 1 catalog first — everything depends on it).

### Batch 1 — Catalog (calibrate first)
| Entity (MG) | path default | Key fields that MUST populate | Watch-outs |
|---|---|---|---|
| products (B4) | `/products` | `name`, `price` | price → minor units; EN/AR name columns may be separate cells; **macros NOT scraped** (content work later, GAP-DQ-02) |
| packages (B5) | `/packages` | `name`, `price`, `parent` | "sub-package" → `parent` cell drives `parent_package_ref` (MG-C7); cycle-check runs in normalizer |
| areas (B6) | `/masters/areas` | `name` | `code` optional |
| delivery_slots (B7) | `/masters/slots` | `name` | — |
| delivery_methods (B8) | `/masters/delivery-methods` | `name` | — |
| payment_methods (B9) | `/masters/payment-methods` | `name` | path is on the read-only GET allowlist already |

### Batch 2 — Customers
| Entity (MG) | path default | Key fields that MUST populate | Watch-outs |
|---|---|---|---|
| customers (B1) | `/users/list/3` | `name`, `phone` | phone normalization drives dedup; blank/unparseable phone → `merge_review` (expected, not an error); `email`/`dob` best-effort; Arabic name → `full_name.ar` |

### Batch 3 — Active plans (cutover weekend)
| Entity (MG) | path default | Key fields that MUST populate | Watch-outs |
|---|---|---|---|
| orders (B2) | `/orders` | `customer_name`, `package`, `status`, `start_date`, `end_date`, `payment_status` | **scope filter:** only `active`/`pause` rows migrate; `payment_status` vocabulary unknown (MG-C2) — capture verbatim; `end_date` may be derived (INFERRED) |

### Reference-only (calibrate if time permits — not on the apply path)
| Entity (MG) | path default | Use |
|---|---|---|
| subscriptions (B3) | `/subscribers` | marketing list — NOT migrated (§1.6); calibrate only for the coverage report |
| coupons (B10) | `/coupons` | text-frozen on orders only; codes not re-validated |
| settings (B11) | `/general-setting` | extract to confirm the critical trio values (MG-D4) for the workshop |
| reports (B12) | `/reports` | extract legacy metric values for the legacy-vs-new parity sanity check |

## 3. After all calibrations — full dry-run

1. `npm run legacy:migration:dry-run` (extract → normalize → compare → report, read-only).
2. Review the three generated reports in `migration-output/<ts>/reports/`:
   - `extraction-summary.md` — expected counts per entity? any `NEEDS_MANUAL_REVIEW`?
   - `legacy-vs-new-coverage.md` — legacy vs new counts, matched, only-in-legacy (import candidates), only-in-new (drift).
   - `migration-readiness-report.md` — verdict flips from 🟡 to 🟢 when access + calibration + zero unresolved review rows hold.
3. **Stop here.** This toolkit produces import-ready files only. The actual import is the new system's M19 `dry-run → review → apply` flow — see `migration_execution_runbook.md §4`. **Never** apply from this toolkit.

## 4. Calibration status tracker (flip as each is verified)

| Entity | calibrated | Verified by | Date | Row count vs screen |
|---|---|---|---|---|
| products | ☐ false | — | — | — |
| packages | ☐ false | — | — | — |
| areas | ☐ false | — | — | — |
| delivery_slots | ☐ false | — | — | — |
| delivery_methods | ☐ false | — | — | — |
| payment_methods | ☐ false | — | — | — |
| customers | ☐ false | — | — | — |
| orders | ☐ false | — | — | — |
| subscriptions | ☐ false | — | — | — |
| coupons | ☐ false | — | — | — |
| settings | ☐ false | — | — | — |
| reports | ☐ false | — | — | — |

**Practice mode (do now, no access needed):** `fixtures/mock-legacy-customers.html` lets you rehearse the customer selector loop offline. The 23/23 unit tests (`npm test`) already prove the normalizers + comparators + safety guards work — calibration is the only remaining variable, and it is mechanical once the DOM is in front of you.
