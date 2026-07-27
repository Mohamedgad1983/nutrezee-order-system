# 04 — WP-LBL-A27 evidence report

> Amendment **A27** — exact legacy label with a permanent customer barcode.
> Branch `build/wp-lbl-a27-legacy-label-barcode`, base `build/partner-daily-fleetbase` @ `ff239a9`.

## 1. Modified files

### Nutrezee repo

| File | Change |
|---|---|
| `app/db/migrations/0027_wave7_label_barcode.sql` | **new** — `customer_barcode`, `label_print_event`, `box_collection`, `driver.staff_user_id`, `customer_dish_day_item.sort_order`, RBAC seeds |
| `app/apps/api/src/modules/m25-label/code128.ts` | **new** — barcode-value codec + Code 128-B encoder/renderer |
| `app/apps/api/src/modules/m25-label/barcode.service.ts` | **new** — issuance, resolution, replacement, merge relink step |
| `app/apps/api/src/modules/m25-label/label.service.ts` | **new** — label document builder, print/reprint recording |
| `app/apps/api/src/modules/m25-label/collection.service.ts` | **new** — manifest + scan, seven outcomes |
| `app/apps/api/src/modules/m25-label/label.controller.ts` | **new** — `/labels`, `/barcodes`, `/collection` |
| `app/apps/api/src/app.module.ts` | wired m25 providers + registered the barcode merge relink step |
| `app/apps/api/src/modules/m21-delivery/delivery.{service,controller}.ts` | accept `staff_user_id` when creating a driver |
| `app/packages/shared/src/index.ts` | label / barcode / collection contract types (types only — see §6) |
| `app/apps/admin/src/components/LabelSheet.tsx` + `labelSheet.css` | **new** — the exact legacy label and its print stylesheet |
| `app/apps/admin/src/pages/Labels.tsx` | **new** — preview, batch, print, reprint-with-reason, print history |
| `app/apps/admin/src/{App,Shell}.tsx` | `/app/labels` route + nav entry |
| `app/scripts/scan-cross-module-writes.mjs` | registered m25's three tables |
| `docker/nginx.admin.conf` | added `labels\|barcodes\|collection` to the API allow-list |
| `app/tests/unit/ts-u-code128.test.ts` | **new** — 14 tests |
| `app/tests/integration/ts-i-label-barcode.test.ts` | **new** — 17 tests |
| `app/tests/integration/ts-i-collection.test.ts` | **new** — 14 tests |
| `AGENTS.md`, `19_Roadmap/build_progress_register.md` | amendment A27 |

### Driver app (`nutreeze-driver-app`, separate repo)

| File | Change |
|---|---|
| `src/services/nutrezee-collection.ts` | **new** — API client + outcome presentation logic |
| `src/screens/CollectMyOrdersScreen.tsx` | **new** — the bilingual collection screen |
| `src/navigation/DriverNavigator.tsx` | registered `DriverCollectTab` |
| `translations/en.json`, `translations/ar.json` | screen strings, all seven outcomes |
| `__tests__/nutrezee-collection-test.js` | **new** — 15 tests |
| `AGENTS.md`, `PLAN.md` | A27 + predeclared source files |

### Infrastructure (VPS, applied live)

`ops.nutreeze.com` Caddy block gains `handle_path /nz/* → admin:80`. Backup at
`/opt/nutrezee/repo/docker/Caddyfile.bak-20260727-121747`.

## 2. Architecture

New module **m25-label**, owning exactly three tables and writing nothing else:

```
customer_barcode      one ACTIVE row per customer (partial unique); values globally unique;
                      merge repoints the loser's row to the survivor as an 'alias'
label_print_event     append-only; reprints require a reason (DB CHECK); stores the barcode
                      printed, proving a reprint never changes it
box_collection        append-only; UNIQUE (customer_id, delivery_date) = collected once a day
```

Everything else — customer, order, address, package, dish, driver, route — is **read only**, which
`scan-cross-module-writes` enforces.

Label rendering is `POST /labels/render`, not GET, because the first render issues the customer's
barcode and a GET must never mutate state (`scan-no-get-mutation`).

## 3. Database changes

Migration `0027_wave7_label_barcode.sql` — additive, forward-only, no existing column or seed
altered:

- three new tables above, with append-only triggers on two of them;
- `driver.staff_user_id` (nullable, unique when set) so a scan can be checked against the
  **signed-in** driver's own manifest. Matching drivers by name or phone was rejected — that is
  precisely the fuzzy identity guessing the programme forbids;
- `customer_dish_day_item.sort_order` (nullable) so meal rows print in source order;
- eight permissions. `collection.manifest.read` deliberately carries **no** `pii` grant, and
  `logistics_manager` is deliberately not granted collection permissions (see §7).

Verified applying cleanly on a fresh database, and every constraint verified by direct SQL before
any service code was written (second active barcode rejected, cross-customer value reuse rejected,
reprint without reason rejected, append-only UPDATE/DELETE rejected, duplicate collection rejected).

## 4. Test results

| Suite | Before | After |
|---|---|---|
| Nutrezee monorepo | 62 files / 313 tests | **65 files / 358 tests** |
| Driver app | 63 suites / 312 tests | **64 suites / 327 tests** |

All passing. Lint, typecheck, build, `scan-cross-module-writes` and `scan-no-get-mutation` clean.

Browser validation of the label: **50/50 checks**, covering every legacy field, the totals matching
the reference label exactly (49 / 105 / 35 / 931), layout integrity (no overflow, no barcode
overlap, no wrapped captions, source meal order), the print stylesheet, PDF output, and a
**round-trip decode of the rendered barcode by an independent decoder**.

Collection scan: all seven outcomes exercised over real HTTP, plus idempotent retry and the full
audit trail — see `03_collection_scan_verification.md`.

## 5. Performance

- Admin bundle 340.28 kB → 348.76 kB JS (+2.5 %), 21.68 → 24.60 kB CSS. The Code 128 renderer is
  server-side, so the SPA carries no encoder.
- Test suite runtime 28.9 s → 30.9 s for 45 more tests.
- The label query is a single statement with `LEFT JOIN LATERAL` for phone and address (one row
  each) — no N+1. Batch printing issues one query per order by design, since each label is an
  independent document; a batch of 40 completes well inside the request budget locally.
- The scan path is 4–6 indexed reads plus one insert. Duplicate detection is an index lookup, not
  a scan.

## 6. Notable defects found and fixed during the work

1. **Runtime import failure.** `@nutrezee/shared` publishes raw TypeScript (`main: src/index.ts`),
   so a *value* import from the compiled API threw `ERR_MODULE_NOT_FOUND` at boot. Proven by
   loading the built file, then fixed by moving the codec into the API and keeping `shared`
   types-only. No prior API file imported `shared` at all, so this had never surfaced.
2. **Label layout broken while content was correct.** All content assertions passed while the
   barcode overlapped the address block and captions wrapped to "Qt y". Fixed and covered by
   layout assertions.
3. **Nondeterministic meal order.** Rows imported in one transaction share `created_at`, and ULID
   ids carry a random component within the same millisecond, so the printed dish order was not the
   source order. Fixed with `sort_order`.
4. **Admin nginx allow-list.** New API prefixes 404 behind the proxy unless registered.

## 7. Remaining risks and known limitations

| # | Item | Status |
|---|---|---|
| R1 | **No dish or nutrition data exists.** Staging: `nutrition_facts` 1 row, `order_item` 1 row, 67 983 meal-history items with every `meal_name` NULL, `customer_dish_day` absent. Not extractable from legacy either (m23 finding). | The label renders an explicit "No dish detail recorded for this date" and no totals. The renderer is ready; the data is not. **Blocks the WP-LBL-00 gate "no nutrition value is inferred".** |
| R2 | **Physical label size unmeasured.** 100 × 70 mm landscape is a working default; the type scale is calibrated to the reference photograph, not to measured stock. | Sizes are CSS variables. Needs a printed comparison — an owner gate. **[NC]** |
| R3 | **Drivers see customer names masked.** Grants aggregate per role; a `pii` grant on the manifest would give every driver blanket PII access across the API. | Deliberate. Unmasking is a governance decision. |
| R4 | **`/collection/*` is not yet reachable on staging.** The nginx allow-list fix needs an admin image redeploy. | `/nz/auth/me` returns JSON; `/nz/collection/manifest` still returns SPA HTML. Owner-gated deploy. |
| R5 | **Camera scanning cannot be Simulator-verified.** No camera in the iOS Simulator. | Belongs to the operational pilot on a physical device. The Code 128 payload itself is proven by round-trip decode. |
| R6 | **Caddyfile bind-mount drift on the VPS.** The running container is pinned to a stale inode; the host file also holds two unrelated pending changes. | Route applied live without a restart. Recreating Caddy would activate someone else's pending work — flagged, not touched. |
| R7 | Snacks-per-day, Floor, Flat and Direction have no clean source column. | Rendered as `-`, exactly as the legacy label itself prints them. **[NC]** |
| R8 | Pre-existing: `packing`, `delivery`, `drivers`, `fleetbase`, `exceptions`, `migration` are missing from the nginx allow-list. | Out of scope for A27; raised as a separate task. |

## 8. Rollback

Full instructions in `00_recovery_point.md`. Summary:

```bash
git reset --hard recovery/pre-wp-lbl-a27          # discard all WP-LBL-A27 code
```

Migration 0027 is additive only; no data is destroyed by leaving it applied. To remove the Caddy
route, reload from the backup:

```bash
docker exec nutrezee-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

(the container's own file has never contained the `/nz` block, so this reverts it).
