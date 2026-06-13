# NEXT_ACTION_QUEUE — Nutrezee OS Agent

**Purpose:** the single live, ordered list of the next eligible work. `Continue Nutrezee OS Agent` reads the **top unblocked item** here, executes it per `AUTO_EXECUTION_RULES.md`, then re-writes this file (strike the finished item, promote the next, append anything discovered). This is dynamic state — it changes every session. The static plan lives in `codex_implementation_sequence.md`; this file is its live cursor.

**Last updated:** 2026-06-13 · **Frontier:** WP-UI-03 (admin parity) — WP-UI-02 complete · **Goal:** replace the legacy daily order operation (not MVP theory) — see `Legacy_Core_Gap_To_Cutover.md`. **Recommended before more screens: seed demo data so the intake→review→order→payment chain is clickable for UAT (catalog can't be API-seeded — mirror mode).**

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

### ▶ 3. WP-UI-03 — Admin parity screens · **IN PROGRESS** (sub-units; FRONTIER)
- ✅ **03a customers — DONE** (PR #10): search / guided-create (dup block+warn) / profile (masked) / edit. FULL end-to-end Playwright (no seed data needed). `/app/customers`.
- ▶ **03b — NEXT**: catalog read screens (products/packages/masters browse — `GET /catalog/*`) and/or reports (3 MVP reports + export — `GET /reports/:name`, `POST /exports`). Both fully-wired APIs.
- 03c: settings + masters admin (view/add area/slot/method/reason-codes); exceptions view; staff/RBAC admin + restricted audit query; dashboard stat cards.
- **Covers UAT:** WF-14, 16. Closes daily-admin parity for the order-ops slice. (reports/dashboard show zeros, catalog/settings show seeds only, until data exists — same gap.)

### 4. WP-UI-04 — Catalog enrichment + UAT-driven gaps · **size M · blocked_by: WP-UI-03, workshop pack (partial)**
Catalog enrichment editors (nutrition, allergens, routing rules), plus any screen gaps surfaced by UAT. Partly gated on the workshop pack (routing rules need DEC-006 sections content).

### 5. WP-API-02 — Merge/undo wiring + catalog casing · **size S · blocked_by: none · eligible (do before/with WP-UI-03 merge-review screen)**
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
