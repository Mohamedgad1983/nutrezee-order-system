# NEXT_ACTION_QUEUE — Nutrezee OS Agent

**Purpose:** the single live, ordered list of the next eligible work. `Continue Nutrezee OS Agent` reads the **top unblocked item** here, executes it per `AUTO_EXECUTION_RULES.md`, then re-writes this file (strike the finished item, promote the next, append anything discovered). This is dynamic state — it changes every session. The static plan lives in `codex_implementation_sequence.md`; this file is its live cursor.

**Last updated:** 2026-06-14 · **Frontier:** WP-UI-03 ✅, WP-API-02 ✅, **WP-UI-04 enrichment editors ✅** (nutrition + allergens; PRs #29/#31). + **WP-UI-05 merge UI ✅** (#33), **WP-UI-06 payment actions ✅** (#35), **WP-14 restore drill ✅** (2026-06-14, backups verified recoverable). **🛑 ENGINEERING FRONTIER EXHAUSTED** — no unblocked build/ops work remains. Everything left is **sponsor/workshop-gated** (see below). The OS should now HOLD and report this, not invent scope. ⚠ **GitHub Actions billing-blocked** — code units admin-merged after local tests + staging Playwright until billing is restored. · **Goal:** replace the legacy daily order operation (not MVP theory) — see `Legacy_Core_Gap_To_Cutover.md`. **Staging is now seeded for UAT** (2026-06-13): the intake→review→order→payment chain is clickable (catalog via M19 import — mirror mode; `uat-seed@nutrezee.local`; see memory `staging-uat-seed-data`). `cutover_catalog` still false.

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

### 🛑 ENGINEERING FRONTIER EXHAUSTED — what the OS is now waiting on (sponsor/workshop)
The OS has built every unit that does not require external inputs. To proceed, **the sponsor/workshop must supply** (see `Legacy_Core_Gap_To_Cutover.md` §3 and `wp14_blocker_report.md`):
- **S1 — legacy export / DB access** → unblocks WP-DATA-01 (real Batch 1/2 migration), then cutover. The single biggest gate.
- **S2 — workshop pack** → DEC-006 kitchen-routing content (→ routing-rule editor 04c), L1/L2 validator semantics, S8 RBAC matrix sign-off, UAT values, ASM-001..050 sign-off.
- **WP-14 pilot** → restore drill done; remaining entry items are workshop/sponsor-owned + the UAT run itself.
**Also operational (user, not engineering):** clear the GitHub Actions billing block so PRs get a real CI gate again.
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
