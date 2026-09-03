# NEXT_ACTION_QUEUE — Nutrezee OS Agent

**Purpose:** the single live, ordered list of the next eligible work. `Continue Nutrezee OS Agent` reads the **top unblocked item** here, executes it per `AUTO_EXECUTION_RULES.md`, then re-writes this file (strike the finished item, promote the next, append anything discovered). This is dynamic state — it changes every session. The static plan lives in `codex_implementation_sequence.md`; this file is its live cursor.

**Last updated:** 2026-08-22 · **Frontier:** **WP-OPS-04 is DONE and live under A43/A44 with extension v0.3.4 / Console a44.3; the remaining real-DOM dark utility styles and black tooltip bars are corrected while Fleetbase's saved theme preference remains untouched. WP-KDS-02 is DONE and production-active under A35; no KDS blocker remains. WP-OPS-03 and WP-OPS-02 remain code/CI-complete but BLOCKED AT RELEASE under A22/A21.** Staging still lacks migrations `0025/0026`, the two protected least-privilege Fleetbase service identities/tokens, and a dedicated named Logistics Manager account; PR #43 remains intentionally unmerged until those release inputs exist. **WP-OPS-01 is production-active under A37–A42:** the guarded 01:00 Kuwait rolling +1/+2 sync is reconciled through Aug-23, with Aug-22 at 674 current source orders (500 assigned, 174 held) plus ten audited missing-source tombstones; started jobs remain immutable. The separate A23/A24 Partner snapshot stays read-only/non-authoritative. WP-LBL-A27/A28/A29 is deployed inside Fleet-Ops with permanent barcodes and exact read-only Partner v2 nutrition sourcing; 552 complete orders are renderable and 187 incomplete orders block explicitly, while complete daily Fleetbase assignment and the physical 100 × 70 mm print/camera pilot remain operational dependencies. WP-LOC-A30 staging software and the bilingual Fleet-Ops Driver Locations screen are deployed and browser-verified with append-only storage and Partner-pin precedence; no capture/correction was submitted. Android 14 bilingual emulator error-path proof is green, while physical assigned-driver call/navigation/GPS-capture/persistence UAT and explicit production activation approval remain open. The legacy-replacement engineering frontier is exhausted and sponsor/workshop-gated. · **Goal:** replace the legacy daily order operation (not MVP theory) — see `Legacy_Core_Gap_To_Cutover.md`. Staging remains seeded for UAT with `cutover_catalog=false`.

---

## How to read this file

1. Verify the **Done baseline** below still matches `build_progress_register.md` (live, from disk). If the register is ahead, update this file first.
2. Take the **first item in Engineering Queue whose `blocked_by` is empty.** That is your task. Do not skip it for a later one unless it is genuinely blocked.
3. If an item is blocked and a **sponsor-owned** unblock exists, you may still proceed with the next engineering item — the two tracks run in parallel.
4. After completing an item: mark it ✅ here with its merge commit, promote the next, and record the same in `build_progress_register.md` run log.

---

## Done baseline (verify against register, do not rebuild from memory)

- Phases 1–5 complete. **WP-00 … WP-13 DONE & merged** (all CI-green; see register rows).
- **WP-UI-01 DONE & merged** — PR #3, merge `b06d646`: login + app shell + sidebar nav (10 sections) + kitchen board + read-only drafts/review-queue/orders lists.
- **WP-API-01 DONE & merged** — PR #4, merge `f9dcae6` (+ D8 nginx-proxy fix `0c3af5a`): M04 customers controller, M05 catalog-read controller, settings masters/reason-code routes. Deployed + verified on staging. (merge/undo deferred → item 5 below.)
- **WP-API-01b DONE & merged** — PR #5, merge `22bdcff`: `GET /settings/masters/:kind` (area/slot/method/section read) — the last API the intake form needed. Deployed + verified. WP-UI-02 now has zero API blockers.
- **Staging LIVE** at `https://13-140-159-201.sslip.io` (VPS + Caddy TLS); gate ④ both halves ✅; 10/10 smoke; **D1–D7 fixed**. Controlled via the `nutrezee-vps` MCP server (`tools/vps-mcp/`).
- Legacy core coverage: Orders **B**, Customers/Packages/Products/Reports/Settings **C**, Subscribers **D**. **No module is class A** (browser-operable end-to-end) yet. Detail: `Legacy_Core_Coverage_Matrix.md`.

---

## Engineering Queue (take the top unblocked item)

### ✅ WP-OPS-06 — Partner daily-deliveries → Nutrezee order feed · **LIVE ON STAGING 2026-09-03 (09-05 applied, 02:20 Kuwait timer enabled)**
- A47: Fleet-Ops barcode labels and the Navigator collection scan need current orders in Nutrezee Postgres; the legacy scrape is frozen at order 24675. The API now imports Partner `/integration/daily-deliveries` per date through the governed M19 runner (`partner_daily`).
- Idempotent by `order_number` + `(order, date)`; customers by normalized `+965` phone; Partner cancel/on-hold mirror to `cancelled_day`/`skipped`; progressed days are never touched.
- DoD: TS-U + TS-I (incl. end-to-end scan) green, typecheck/lint/build/scans, CI; owner deploys migration `0030`, sets the Partner key, runs dry-run → apply once, then enables the 02:20 Kuwait timer.
- Branch `build/wp-ops-06-partner-daily-order-feed`; evidence `docs/evidence/partner_driver_authority/03_*.md`.

### ✅ WP-OPS-05 — Partner driver.id assignment authority · **DONE + LIVE ON STAGING 2026-09-03**
- A46 replaced the routing-area rendezvous hash with Partner `driver.id` (numeric user id + unit code aliases); 9-unit map/roster installed; first apply 2026-09-05 verified; same-day 02:00 Kuwait sync enabled. PR #56 merge `ccdd9aa`. Evidence `docs/evidence/partner_driver_authority/01_*.md`, `02_*.md`.

### ✅ WP-OPS-04 — Nutreeze Fleet-Ops visual system · **DONE + LIVE 2026-08-22**
- A43 applies the official Nutreeze PDF mark and `#956132` bronze; A44 makes the approved warm-light
  presentation authoritative even when Fleetbase/browser state retained a dark preference.
- Scope: accessible header identity/favicon, responsive navigation, warm-light tables/sticky cells,
  forms, real button variants and existing Nutrezee extension panels. Fleetbase attribution stays visible.
- No route/auth/permission/data-workflow change, no Fleetbase application/vendor source edit, and
  no Fleetbase preference write, and no change to the exact 100 x 70 mm label print contract.
- Result: extension v0.3.4 / Console a44.3, A43 PR #52 merge `a52f1ff`, A44 PR #53 merge
  `973050f`, and real-DOM correction PR #54 merge `9fe2779` (`9d535d7`). Focused 12/12,
  full Vitest 72 files / 408 tests, lint/typecheck/build, scans, snapshot 8/8, rolling sync 9/9,
  and PR #54 push/PR/post-merge CI all 14/14. Signed-in live Chrome retained Fleetbase's dark
  marker but rendered the approved warm-light children, light pagination and transparent hidden
  tooltip hosts; renderer CPU settled to 0.3%. Final Console image `095634f0cbbf`.
  No preference, backend/data workflow or vendor change.

### 🛑 WP-OPS-03 — unlimited driver-to-driver order reassignment · **BLOCKED AT RELEASE · size M · blocked_by: protected order-manager token + named manager account + deployment/staging/Navigator proof**
- A22 grants `logistics_manager` every current Nutrezee delivery/driver permission, including password rotation and a dedicated bulk-reassignment grant; unrelated finance, staff/RBAC, catalog, and system-admin permissions remain excluded.
- The manager chooses source driver, target driver, date, and any number of eligible assigned orders; there is no product/UI batch-size cap. The API processes the selection in bounded upstream chunks and reports completed/failed outcomes.
- Server derives Fleetbase driver/order UUIDs from standard read APIs. Browser submits only `driver_*` and `order_*` public ids; arbitrary upstream UUIDs are forbidden.
- ASM-053: only orders with no `started_at` and nonterminal status may move. `started/enroute/completed/canceled` and a driver's current active job stay blocked because Fleetbase bulk reassignment does not transfer activity/current-job state.
- HIGH audit + per-order outcome ledger; no customer/payload PII in the response or audit. No Fleetbase vendor or Navigator `/legacy` modifications.
- DoD: RBAC, unlimited/chunking, source-change, status guard, partial failure, PII-minimization, controller/client tests; full app tests/build/scans; CI; visible staging proof only after protected integration setup.
- Result 2026-07-25: PR #40 merged as `2e255c1` after local typecheck/lint/build, 62 files / 313 tests, cross-module-write/no-GET-mutation scans, snapshot guards, browser QA, and CI runs 30169477421 + 30169478994 all passed. Concurrent attempts for the same order fail closed while an earlier batch is pending. No deployment or live reassignment occurred.
- Release preflight 2026-07-25: staging is healthy but still at migration `0023`; protected order-manager configuration and a dedicated named manager are absent. No deployment or mutation was attempted.

### 🛑 WP-OPS-02 — Logistics Manager driver credential rotation · **BLOCKED AT RELEASE · size S · blocked_by: protected Fleetbase service token + named manager account + deployment/staging Playwright/Navigator proof**
- A21 authorizes only the driver-password rotation slice in the Nutrezee admin panel.
- API must list Fleetbase drivers through a server-held least-privilege integration token and derive the linked Fleetbase user UUID server-side.
- `POST` rotation only; no GET mutation. Reject arbitrary user UUIDs, non-driver targets, password mismatch/weak passwords, and missing integration config.
- Password values must never be persisted, logged, emailed, returned, or included in audit before/after data.
- Permission: dedicated Logistics Manager credential-rotation grant; no unrestricted Fleetbase IAM permission in the browser.
- HIGH audit trail records requested/completed/failed outcomes without secrets. Fleetbase vendor source and Navigator `/legacy` stay untouched.
- DoD: focused service/controller/RBAC tests + full app Vitest/lint/typecheck/build/scans green; visible staging Playwright after the protected integration secret is provisioned.
- Result 2026-07-25: PR #39 merged as `0124f60`; local typecheck/lint/build, 59 files / 300 tests, cross-module-write/no-GET-mutation scans, and snapshot guards passed; CI runs 30169312557 + 30169313599 passed 14/14. No deployment or live credential change.
- Release preflight 2026-07-25: the protected credential-manager configuration and dedicated named manager are absent; migration `0025` is not deployed. No credential change was attempted.

### ✅ WP-KDS-02 — User-assigned Kitchen Display section isolation · **DONE 2026-08-08 · production-active · blocked_by: none**

PR #50 merged the protected configurable user manifest, session-bound exact section claims, assignment-scoped API, removal of global totals/manual section selection, and focused full-width UI as `251e1f2`. PR #51 fixed the uncached live-read deadline mismatch and merged as final production release `0fd988a`. Final KDS/root CI passed 6/6 + 14/14 (`31256752632`, `31256752652`). Exact artifact SHA-256 `86f596aaeaa15c235a7edc918adbedb7155c9141c27a6224984bb74fd4c93b80` and image `sha256:e30f357f0872d3ace10d36e1dc396b5a979ba3d93a17632add3dce76de0f095c` are active. Six code-named accounts under ASM-056 each returned only their matching section; cross-section query escalation returned 400; protected live Chromium, direct browser, privacy, security, and hardened-runtime checks passed.

### ✅ WP-KDS-01 — Standalone Kitchen Display section totals · **DONE 2026-08-08 · production-active · user-authorized A31–A33**

Completely independent subproject from `origin/main`. PR #46 merged as `74a703c` after 18/18 review threads were resolved; PR #48 corrected the non-root protected-secret mount contract; PR #49 made English/LTR the fresh-device default while preserving the Arabic/RTL toggle and merged as production release `3743aea`. Post-merge KDS CI 6/6 (`31254271648`) and root CI 14/14 (`31254271662`) are green. Exact artifact SHA-256 `afb83d997d45924554de724a43d10d7e8e5568edf97b62f4add01a094db25240` is installed at `/opt/nutrezee-kds/releases/3743aea`; the healthy hardened image is `sha256:505154f8ea522b178e8dd7cd4797c95a24668f6845099228873feaca904014c0`.

Production acceptance passed at `https://kds.13-140-159-201.sslip.io`: HTTPS/security/session/method/query controls; dedicated protected credentials; four Partner GET requests and no write surface; independent exact arithmetic for 3,178 rows, quantity 3,266, section-work quantity 6,532, six sections, 222 meal/portion groups, and zero unrouted quantity; prohibited-field/log scans; Arabic/English responsive browser journey; and protected live Playwright. No driver/logistics/label dependency, database, workflow mutation, or Partner write capability exists in this service.

### ✅ 1. WP-API-01 — Customers + Catalog-read + Masters/Reason-code controllers · **DONE 2026-06-13** (PR #4 `f9dcae6` + D8 `0c3af5a`)
Shipped A1 customers controller, A2 catalog-read controller, A3 settings masters/reason-code routes. 3-lens review caught + fixed 2 PII leaks + 1 SQL injection pre-merge. CI 14/14; suite 164→190; deployed + verified on staging. merge/undo split out → item 5.

### ✅ 2. WP-UI-02 — Daily order action screens · **DONE 2026-06-13** (02a/b/c/d, PRs #6–#9)
The screens staff live in all day. Each sub-unit = its own branch + visible Playwright e2e (`tools/e2e-staging`). All backing APIs live (WP-API-01 + 01b).
- ✅ **02a intake draft form — DONE** (PR #6): customer find/create/unverified, package/items, dates, area/slot/method, payment, WhatsApp ref → create → completeness → submit. Playwright 4/4 on staging. `/app/intake`.
- ✅ **02b review-queue actions — DONE** (PR #7): claim → approve (per-warning overrides) / return / reject with reason codes (`GET /settings/reason-codes` added). Playwright 3/3. `/app/review-queue`.
- ✅ **02c order detail — DONE** (PR #8): summary + fulfillment days + change-status (cancel w/ reason) + change request + raise exception. Playwright 3/3. `/app/orders`.
- ✅ **02d payment review queue — DONE** (PR #9): Finance confirm/reject via `/payment-reviews` (WF-13). Playwright 3/3. `/app/payments`.
- ✅ **WP-UI-02 COMPLETE** — all four daily-ops roles have their screen.
  - *Per-order payment actions* (record link-sent, request status change) deferred to WP-UI-03 order-detail enhancement — small follow-up on the existing order screen.
- **DoD per sub-unit:** admin typecheck/lint/build green in CI; deployed to staging; Playwright green; register run-log entry. **Covers UAT:** WF-01..06, 12, 13, 15.
- **Staging data gap (cross-cutting):** full happy-path demos (submit a complete draft, approve→order→kitchen) need catalog + ops-master + customer seed data. Catalog is mirror-mode (API writes blocked); area/slot/method are zero-row until the workshop. Resolve via either the pending "seed demo data" approval (SQL/import) or a deliberate `cutover_catalog` flip on staging. Tracked here so UI sub-units don't silently look "empty".

### ✅ 3. WP-UI-03 — Admin parity screens · **DONE 2026-06-13** (all sub-units shipped; all 14 sidebar sections live)
- ✅ **03a customers — DONE** (PR #10): search / guided-create (dup block+warn) / profile (masked) / edit. FULL end-to-end Playwright (no seed data needed). `/app/customers`.
- ✅ **03b catalog browse — DONE** (PR #11 `955c9f4`): read-only products / packages / masters over `GET /catalog/*` (tabs, active filter, product detail w/ nutrition + allergens). Deployed; visible Playwright 1/1 against the seeded catalog. `/app/catalog`. Read-only by design (mirror mode).
- ✅ **03b reports — DONE** (PR #13 `4dd5a3b` + fix PR #14 `1408f60`): read-only intake-funnel / daily-ops / kitchen-day-list over `GET /reports/:name` + JSON export (`POST /exports`). Deployed; visible Playwright 1/1 (`wpui-reports.spec.ts`) — caught + fixed a tab-switch white-screen (mismatched-data cast). `/app/reports` (sidebar now live).
- ✅ **03c settings/masters — DONE** (PR #16 `c490bbd`): masters (area/slot/method/section) + reason-codes view+add over `/settings/masters/:kind` + `/settings/reason-codes`. Deployed (api+admin); visible Playwright 1/1 (incl. live add). `/app/settings` (sidebar live). Also fixed a shadowed `POST /settings/reason-codes` route (was a 404 dead route, `0f42161`).
- ✅ **03c dashboard — DONE** (PR #18 `933060a`): overview stat cards aggregating the M15 report projections + live queue counts (review/payment/orders); new first sidebar entry. `/app/dashboard`. Visible Playwright 1/1.
- ✅ **03c staff/RBAC — DONE** (PR #20 `df95d1a`): staff list + grant/revoke roles + deactivate + new-staff + read-only RBAC matrix, over existing `GET /staff` / `GET /rbac/matrix` / `POST /staff|/rbac/grants|/rbac/revoke|/staff/:id/deactivate`. `/app/staff` (sidebar live). Visible Playwright 1/1 (live grant→revoke round-trip). Caught + fixed a stuck-busy panel bug.
- ✅ **03c exceptions — DONE** (PR #22 `5fcf21f`): added `GET /orders/exceptions` (gated `order.read`, notes PII-masked, route before `:id`) + the view (state filter + resolve with escalation reason code). `/app/exceptions` (sidebar live). Visible Playwright 1/1 (self-seed → list → resolve).
- ✅ **03c audit — DONE** (PR #24 `c7087d8`): `GET /audit` (`audit.read`; before/after masked unless full pii∧health∧payment visibility) + read-only audit log screen (severity/entity/event filters + expandable detail). `/app/audit` (sidebar live). Also added `audit` to the nginx allow-list. **→ WP-UI-03c & WP-UI-03 COMPLETE.**
- **Covers UAT:** WF-14, 16. Closes daily-admin parity for the order-ops slice. (reports now show real seeded rows: intake-funnel 4 drafts / 1 approved.)

### ▶ 4. WP-UI-04 — Catalog enrichment + UAT-driven gaps · **IN PROGRESS · size M · blocked_by: workshop pack (routing only)**
Catalog enrichment editors. Enrichment bypasses mirror mode (no `assertWritable`), so editors work with `cutover_catalog=false`.
- ✅ **04a nutrition — DONE** (PR #29 `7f911d7`): `POST /catalog/products/:id/nutrition` + Edit form on the product detail. Visible Playwright 2/2.
- ✅ **04b allergens — DONE** (PR #31 `ed18791`): `POST /catalog/products/:id/allergens` + AllergenDeclarer on the product detail (dropdown from `GET /catalog/allergens`, seeded Peanuts/Gluten/Dairy via M19 import). Visible Playwright 3/3. **→ WP-UI-04 enrichment editors complete.**
- ⏸ **04c routing-rule editor — BLOCKED on workshop DEC-006** (sections content). Build the engine zero-row-ready when content lands.

### ▶ Next eligible engineering (no sponsor/workshop block) — last 1–2 units before the wall
- ✅ **Customer merge UI — DONE** (PR #33 `0e3cd53`).
- ✅ **Per-order payment actions — DONE** (PR #35 `5b5a0fb`).
- ✅ **WP-14 restore drill — DONE** (2026-06-14): latest nightly dump restored to a throwaway DB, schema 13/13 + 62/62 tables + data intact, dropped; live untouched. Backups proven recoverable.
- ✅ **WP-OPS-01 Partner daily Fleetbase dispatch — JULY 20 OPERATIONAL RUN COMPLETE 2026-07-20 (branch merge pending):** 946/946 distributed across the fixed 11 drivers: 723 real customer pins and 223 clearly labeled known-area fallbacks requiring CALL CUSTOMER FIRST; unknown/country fallbacks 0. Exact rerun produced zero writes. One least-loaded-driver UAT order completed dispatched → started → enroute → completed; post-UAT active 945 / pending 0 / completed 1. Security boundaries passed; unattended timer remains disabled and the A19 exception is not reusable for any other date.
- ✅ **A23/A24 daily read-only Partner snapshot — DEPLOYED + ENABLED 2026-07-23 (branch merge pending):** separate 01:00 Kuwait timer; two-pass count/digest stability guard; root-only PII-free 30-day aggregate manifests; July 22 live proof 873 orders / 3,781 meal rows with `fleetbase_written=false`. Because 01:00 precedes the previously documented 06:00 publication, completeness stays explicitly non-authoritative. The dispatch timer remains disabled/inactive.

### 🛑 ENGINEERING FRONTIER EXHAUSTED — what the OS is now waiting on (sponsor/workshop)
The OS has built every unit that does not require external inputs. To proceed, **the sponsor/workshop must supply** (see `Legacy_Core_Gap_To_Cutover.md` §3 and `wp14_blocker_report.md`):
- **S1 — legacy export / DB access** → unblocks WP-DATA-01 (real Batch 1/2 migration), then cutover. The single biggest gate.
- **S2 — workshop pack** → DEC-006 kitchen-routing content (→ routing-rule editor 04c), L1/L2 validator semantics, S8 RBAC matrix sign-off, UAT values, ASM-001..050 sign-off.
- **WP-14 pilot** → restore drill done; remaining entry items are workshop/sponsor-owned + the UAT run itself.
On the next `Continue Nutrezee OS Agent`, the correct OS behaviour is to **report this hold**, not fabricate work.

> **After these two, the engineering frontier is exhausted** — all remaining work (WP-DATA-01 real migration, routing content, RBAC sign-off, the rest of WP-14 UAT/pilot) needs sponsor legacy-export access (S1) or the workshop pack (S2). See `Legacy_Core_Gap_To_Cutover.md` §3.

### ✅ 5. WP-API-02 — Merge/undo wiring + catalog casing · **DONE 2026-06-13** (PR #26 `57fc41b`)
Merge/undo wired (static owning-module re-link steps for draft_order/customer_order, registered on MergeService; `POST /customers/merge` + `/merge/:id/undo`, ops-only; live smoke ✅). **Catalog casing deferred** — the catalog UI already consumes camelCase; reconciling would churn a live screen for no gain (low-priority cleanup, not blocking). Original scope:
Surfaced by WP-API-01:
- **Merge/undo HTTP**: register `MergeService` as an app provider + wire its FK re-link steps (`draft_order.customer_id`, and audit which other tables reference `customer`) — currently only the test wires them, so a live merge would not re-link draft/order FKs. Then expose `POST /customers/merge` + `POST /customers/merge/:id/undo` (permission `customer.merge`).
- **Catalog response casing**: catalog read endpoints return camelCase while orders/drafts/kitchen return snake_case — reconcile to one convention before WP-UI-03 consumes catalog (cheap if done first).

---

## Sponsor-owned parallel track (engineering cannot unblock — surface, do not wait)

| # | Item | Blocks | Engineering action while waiting |
|---|---|---|---|
| S1 | **Legacy export / DB access** (the 12 access items; choose bridge pattern P1/P2/P3) | every real data migration (Batch 1/2/3), WP-DATA-01, cutover | Keep building UI/API on synthetic data; refine `migration_mapping.md` when first export arrives |
| S2 | **Workshop pack** — L1/L2 validator semantics, DEC-005/006 content, S8 RBAC matrix sign-off, UAT values, settings critical keys, ASM-001..050 sign-off | validators, deny-mode flip, kitchen routing content, **WP-14 entry** | Engineering drafts the decision pack; sponsor decides. Build engines, leave content as config (zero-row-ready) |

## Deferred — NOT on the daily-order cutover path (do not build without a new amendment)

Subscribers (marketing list) · content/legal pages · gallery/video · advertisements · social media · push notifications · cashback/ratings/coupon-module · legacy **finance** report parity (5-report set) · dispatch/driver (WF-09..11). All remain on legacy after order-ops cutover, by recorded plan. See `Legacy_Core_Gap_To_Cutover.md` §1.6.

---

## After the engineering queue empties

WP-DATA-01 (real Batch 1+2 dry-runs once S1 lands) → WP-14 execution (restore drill, L1/L2 impl post-workshop, TS-S/TS-A on staging, perf baseline, training, UAT, pilot) → cutover weekend → 30-day reconciliation clock → legacy order-ops retired. Full sequence: `Legacy_Core_Gap_To_Cutover.md` §3.
