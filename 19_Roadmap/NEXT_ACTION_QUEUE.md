# NEXT_ACTION_QUEUE — Nutrezee OS Agent

**Purpose:** the single live, ordered list of the next eligible work. `Continue Nutrezee OS Agent` reads the **top unblocked item** here, executes it per `AUTO_EXECUTION_RULES.md`, then re-writes this file (strike the finished item, promote the next, append anything discovered). This is dynamic state — it changes every session. The static plan lives in `codex_implementation_sequence.md`; this file is its live cursor.

**Last updated:** 2026-06-13 · **Frontier:** WP-UI-02 (engineering critical path) · **Goal:** replace the legacy daily order operation (not MVP theory) — see `Legacy_Core_Gap_To_Cutover.md`.

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

### ▶ 2. WP-UI-02 — Daily order action screens · **size M · blocked_by: none (WP-API-01 done) · ELIGIBLE NOW**
The screens staff live in all day. Each flow ships with a visible Playwright e2e (`tools/e2e-staging`).
- Intake draft form: customer search (`GET /customers`), package/items (`GET /catalog/*`), dates, address (area via `GET /settings/masters/area`), slot/method (`GET /settings/masters/delivery_slot|delivery_method`), payment method, completeness feedback, WhatsApp ref panel (`POST /drafts/:id/whatsapp-ref`) — replaces legacy `/orders/create`. **All backing APIs now live (WP-API-01 + 01b).** Best built as sub-units: 02a intake → 02b review actions → 02c order detail → 02d payment queue, each its own branch + Playwright proof.
- Review queue actions: claim + approve/return/reject with warning overrides.
- Order detail: timeline, fulfillment days, transitions, cancellation request/ack, change request w/ impact.
- Payment review queue (Finance) + per-order payment panel.
- **DoD:** admin typecheck/lint/build green in CI; deployed to staging; Playwright suites green; register run-log entry. **Covers UAT:** WF-01..06, 12, 13, 15.

### 3. WP-UI-03 — Admin parity screens · **size M · blocked_by: WP-API-01, WP-UI-02**
Customers (list/search, profile PII-gated, guided create, merge review) · catalog read screens · reports (3 MVP reports + export) · settings + masters admin · exceptions capture · staff/RBAC + restricted audit query view · dashboard stat cards. **Covers UAT:** WF-14, 16. Closes the daily-admin parity gap for the order-ops slice.

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
