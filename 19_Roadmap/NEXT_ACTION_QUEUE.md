# NEXT_ACTION_QUEUE — Nutrezee OS Agent

**Purpose:** the single live, ordered list of the next eligible work. `Continue Nutrezee OS Agent` reads the **top unblocked item** here, executes it per `AUTO_EXECUTION_RULES.md`, then re-writes this file (strike the finished item, promote the next, append anything discovered). This is dynamic state — it changes every session. The static plan lives in `codex_implementation_sequence.md`; this file is its live cursor.

**Last updated:** 2026-06-13 · **Frontier:** WP-API-01 (engineering critical path) · **Goal:** replace the legacy daily order operation (not MVP theory) — see `Legacy_Core_Gap_To_Cutover.md`.

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
- **Staging LIVE** at `https://13-140-159-201.sslip.io` (VPS + Caddy TLS); gate ④ both halves ✅; 10/10 smoke; **D1–D7 fixed**. Controlled via the `nutrezee-vps` MCP server (`tools/vps-mcp/`).
- Legacy core coverage: Orders **B**, Customers/Packages/Products/Reports/Settings **C**, Subscribers **D**. **No module is class A** (browser-operable end-to-end) yet. Detail: `Legacy_Core_Coverage_Matrix.md`.

---

## Engineering Queue (take the top unblocked item)

### ▶ 1. WP-API-01 — Customers + Catalog-read + Masters/Reason-code controllers · **size S · blocked_by: none · ELIGIBLE NOW**
Three HTTP controllers over **already-built, already-tested** services. No schema change. Fulfils two recorded-but-unfilled scope promises (WP-04 "HTTP surface consolidates at WP-07"; WP-03 masters admin).
- **A1 — M04 customers controller** (`app/apps/api/src/modules/m04-customers/`): `GET /customers?phone=` search, `GET /customers/:id` profile (PII/health masking already in service), `POST /customers` guided-create (dup block/warn), `PATCH /customers/:id`, address + allergy sub-routes, `POST /customers/:id/merge` + undo.
- **A2 — M05 catalog read controller** (`app/apps/api/src/modules/m05-catalog/`): `GET /catalog/products`, `/catalog/packages`, `/catalog/masters/*` list + detail (read-only while mirror mode holds; no admin writes — `cutover_catalog` still false).
- **A3 — Masters + reason-code routes** on settings (`app/apps/api/src/platform/settings/`): expose existing `addMaster` (sections/areas/slots/methods) and `addReasonCode` service methods.
- **DoD:** integration tests (TS-C pattern) green in CI; `no-GET-mutation` + boundary scans pass; masking preserved; CI 14/14. **Unblocks:** WP-UI-02 customer search, WP-UI-03 customers/catalog/settings screens.

### 2. WP-UI-02 — Daily order action screens · **size M · blocked_by: WP-API-01 (customer search)**
The screens staff live in all day. Each flow ships with a visible Playwright e2e (`tools/e2e-staging`).
- Intake draft form: customer search (needs A1), package/items, dates, address, slot/method, payment method, completeness feedback, WhatsApp ref panel — replaces legacy `/orders/create`.
- Review queue actions: claim + approve/return/reject with warning overrides.
- Order detail: timeline, fulfillment days, transitions, cancellation request/ack, change request w/ impact.
- Payment review queue (Finance) + per-order payment panel.
- **DoD:** admin typecheck/lint/build green in CI; deployed to staging; Playwright suites green; register run-log entry. **Covers UAT:** WF-01..06, 12, 13, 15.

### 3. WP-UI-03 — Admin parity screens · **size M · blocked_by: WP-API-01, WP-UI-02**
Customers (list/search, profile PII-gated, guided create, merge review) · catalog read screens · reports (3 MVP reports + export) · settings + masters admin · exceptions capture · staff/RBAC + restricted audit query view · dashboard stat cards. **Covers UAT:** WF-14, 16. Closes the daily-admin parity gap for the order-ops slice.

### 4. WP-UI-04 — Catalog enrichment + UAT-driven gaps · **size M · blocked_by: WP-UI-03, workshop pack (partial)**
Catalog enrichment editors (nutrition, allergens, routing rules), plus any screen gaps surfaced by UAT. Partly gated on the workshop pack (routing rules need DEC-006 sections content).

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
