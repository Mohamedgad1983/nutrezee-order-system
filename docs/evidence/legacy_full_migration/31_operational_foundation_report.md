# 31 — Operational Foundation Report

> Closes the operational-foundation mission: 30-min sync schedule (dry-run), packing workflow,
> meal/package fulfillment model, driver + area assignment, and the packing↔driver integration —
> all staging-only, additive, with WhatsApp kept dry-run. Branch
> `migration/legacy-full-clone-reconciliation`.

## STATUS: **PARTIAL → operationally complete for the requested foundations**
Every requested foundation is built, tested, and browser/API-operable. The remaining items are
deliberate follow-ups (engine promotion, sync monitor screen, WhatsApp preview screen), not gaps in
the foundations themselves.

---

## 1. Cron / incremental sync
| Item | Result |
|---|---|
| Scheduled | **Yes — built, committed, NOT enabled** (`ops/systemd/nutrezee-legacy-sync.{service,timer}` + `run-legacy-sync.sh`) |
| Mode | **dry-run only** (script refuses `apply` / non-staging, fail-fast before loading drivers) |
| Schedule | `OnCalendar=*:0/30` (every 30 min), `Persistent=false` |
| Overlap guard | triple: `Type=oneshot` + `flock -n` + `O_EXCL` PID lockfile (+ wrapper PID lock) |
| Output schema | started_at, finished_at, duration_ms, records_seen, would_create/update/skip/fail, errors, watermark, next_cursor → run-history.jsonl; alert file on failure |
| Live evidence | staging watermark 24,630; 20,103 synced orders; 26,071 records in extract; 1,272 pending exceptions (read-only) |
| Apply mode | **out of scope** until dry-run signed off as stable (doc 25 §6 checklist) |

Doc: `25_incremental_sync_scheduled_dry_run.md`.

## 2. Packing (m20-packing)
| Aspect | Status |
|---|---|
| Schema | ✅ `0016_wave6_ops_packing.sql` — packing_batch, packing_batch_order, packing_item, packing_label, packing_status_history (append-only) |
| API | ✅ 8 endpoints under `/packing` (list/create/detail/mark-packed/issue/handoff/label preview/print) |
| UI | ✅ `/app/packing` — dashboard, batch detail, label preview, issue panel |
| Tests | ✅ `ts-i-packing` 9/9 |
| Guards | one-active-batch-per-slot, no-dup-order-in-batch, handoff-requires-all-packed |
Docs: `26_packing_workflow_foundation.md`.

## 3. Meal / package fulfillment
| Aspect | Status |
|---|---|
| Docs/model | ✅ `27_meal_fulfillment_foundation.md` — concepts + proposed additive schema (package_meal_plan/day/slot, order_meal_schedule, meal_substitution, chef_assignment) |
| Schema built | 🟨 **none yet — design only** (built lazily when a kitchen-tablet WP needs it; A-OPS-02) |
| Out of scope now | ❌ backfilling ~500k legacy ajax meal-day records (infeasible scrape, fulfillment-domain, not the subscription line); packing/driver deliberately need none of it |

## 4. Driver + area (m21-delivery)
| Aspect | Status |
|---|---|
| Schema | ✅ `0017_wave6_ops_delivery.sql` — driver, driver_area, driver_shift, delivery_route, delivery_route_order, driver_assignment_history (append-only) |
| API | ✅ 11 endpoints (`/drivers`, `/delivery/*`: unassigned/suggest/assign/bulk-assign/routes/status/reassign) |
| UI | ✅ `/app/delivery` — drivers, unassigned+assign, routes+per-stop status |
| Tests | ✅ `ts-i-delivery` 9/9 |
| Guards | DB no-duplicate-active-assignment, per-slot capacity, active-driver, allowed-transition maps |
Docs: `28_driver_area_assignment_foundation.md`, integration `29_packing_driver_integration_flow.md`.

## 5. WhatsApp
| Aspect | Status |
|---|---|
| Sending enabled | **No** — not touched this mission |
| Preview only | Yes (Hermes dry-run preview, doc 23) — stays disabled until operational data is stable |

## 6. Admin UI
✅ Packing + Delivery live and browser-testable; Exceptions live. ⬜ Incremental Sync Monitor +
WhatsApp Queue Preview planned (read-only). Plan: `30_admin_ui_operational_plan.md`.

## 7. Tests / gates (this session, local)
| Gate | Result |
|---|---|
| `npm run typecheck` (3 workspaces) | ✅ exit 0 |
| `npm run lint` (monorepo) | ✅ exit 0 |
| `scan-cross-module-writes` | ✅ OK (new tables registered to m20/m21) |
| `scan-no-get-mutation` | ✅ OK |
| `npm run build` (api tsc + admin vite) | ✅ exit 0 |
| `npx vitest run` (full) | ✅ **48 files, 226 tests passed** (incl. 18 new) |
| `node --check` sync script + `bash -n` wrapper | ✅ parse; guards refuse apply/non-staging |
| migrations 0001→0017 | ✅ apply clean on a fresh DB |

## 8. Follow-ups (amendments)
- **A-OPS-01** — promote packing/delivery state machines into the seeded `transition_config` engine
  (today: guarded + same-transaction-audited + append-only history; platform engine untouched because
  its `Machine` type is a closed union). Aligns delivery with fulfillment `f9..f14`.
- **A-OPS-02** — build the meal-fulfillment schema (doc 27 §3) when the first kitchen-tablet WP needs
  it; do not backfill legacy meal-days.
- New modules `m20-packing` / `m21-delivery` are operational-foundation additions on the migration
  track (not in the frozen physical-schema wave list) — recorded here as the track's evidence home.

## 9. Strict-rules compliance
staging only ✅ · no production ✅ · no destructive SQL (additive/forward-only) ✅ · no raw PII
committed ✅ · no secrets committed ✅ · no WhatsApp sent ✅ · no cron enabled (dry-run unproven) ✅ ·
additive schema only ✅ · legacy IDs preserved (`order_id`, `legacy_driver_id`, frozen snapshots) ✅ ·
audit logs for operational actions ✅ · every workflow browser/API testable ✅.

## NEXT STEP
On the VPS: install the units **disabled**, run `run-legacy-sync.sh` manually for ≥3 consecutive
30-min ticks, confirm `would_fail=0` + clean run-history, then sign off doc 25 §6 before
`systemctl enable --now nutrezee-legacy-sync.timer`. (Apply mode and WhatsApp sending remain out of
scope until operational data is proven stable.)
