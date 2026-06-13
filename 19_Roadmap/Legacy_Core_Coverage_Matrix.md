# Legacy Core Coverage Matrix

**Date:** 2026-06-13 · **Method:** evidence-only audit of existing project records — legacy discovery (`nutrezee-step-1-discovery/docs/`), gap analysis (`03_Gap_Analysis/`), implementation register (`19_Roadmap/build_progress_register.md`), independent review, alignment audit, and the code itself (`app/apps/api/src`, `app/apps/admin/src`). No new discovery performed; no business questions re-asked.
**Staging baseline:** full API + WP-UI-01 SPA (login, shell, kitchen board, read-only drafts/review-queue/orders lists) live at `https://13-140-159-201.sslip.io` since 2026-06-12; DB empty; import/bridge tooling deployed but never run against real legacy data.

**Classification:** A = fully implemented (backend+API+UI usable for daily ops) · B = backend complete, UI missing · C = partially implemented · D = not implemented.

## Summary matrix

| Module | Legacy evidence | Screens discovered | Backend | API | UI | Staging | Cutover-ready | Class |
|---|---|---|---|---|---|---|---|---|
| **Orders** | `modules/01_order_intake_lifecycle.md`, `03_user_flows/old_dashboard_workflow_summary.md` | 10 routes: `/orders/create`, `/orders/list` + 5 lifecycle lists (Active/pending/Pause/Expire/cancel), `/packageexpirestoday`, 2 unstable | ✅ Complete, reviewed (M01+M02+M03; WP-07/08/09) | ✅ Full HTTP surface (drafts 9, review 5, orders 10 endpoints) | ◐ Read-only lists only; no intake form, no decisions, no order detail/actions | Deployed, smoke-tested, empty DB | ❌ No action UI; no real data; L1/L2 validator content open | **B** |
| **Subscribers** | `admin_route_screen_inventory.md` L61, `modules/07`, `modules/10` | 1 route: `/subscribers` (marketing **email newsletter list** — NOT meal-plan subscriptions, which live under legacy Orders → M03/M19 `active_plans`) | ❌ None (no table, no module) | ❌ None | ❌ None | Nothing deployed | ❌ — but explicitly **off the daily-order critical path** (alignment audit L85 defers Content/Marketing group) | **D** |
| **Customers** | `modules/07_customers_whatsapp_intake.md` | 8 routes incl. `/users/list/3`, `/users/newuser/9`, customer search in `/orders/create`, `/contact_us`, `/birthdayOrders`, `/dietician_requests` | ✅ Complete + tested (M04: search-by-phone, guided-create dup block/warn, merge+undo, PII/health read-logging; WP-04) | ❌ **Internal service only — no HTTP controller** ("consolidates at WP-07" was never delivered) | ❌ None — not even a sidebar entry | Schema deployed; functionally unreachable | ❌ API + UI + real customer import all missing | **C** |
| **Packages** | `modules/02_products_menu_packages.md` | `/package`, `/packageFor` + associations on `/products`, `/addMeal` | ✅ Mirror-mode core done (WP-05: hierarchy w/ cycle guard, import ports). Schema parity gaps: no priority/coupon fields; `package_for_type` lacks Friday-off/new-customer flags | ❌ Internal service only (reachable solely via M19 `/imports`) | ❌ None | Deployed, inert (empty DB, `cutover_catalog`=false) | ❌ By design (mirror mode) until import parity + flag flip; API/UI/import/rules all open | **C** |
| **Products** | `modules/02`, `modules/08_nutrition_allergens_dietician.md` | 9 routes: `/products`, `/package`, `/packageFor`, `/mealsType`, `/addMeal`, `/tagslist`, `/dietstatuslist`, `/ingredients`, `/allergies` | ✅ Complete for MVP slice (products/components, allergen resolver, nutrition tables, routing-rule admin; 68/68 tests) | ❌ Internal service only — no `catalog.controller.ts` | ❌ None (zero of 9 legacy screens replaced) | Deployed, inert | ❌ Same as Packages + nutrition content missing (GAP-DQ-02), routing rules zero-row (DEC-006) | **C** |
| **Reports** | `modules/06_payments_finance_reports.md`, `nutrezee_step_1b_dashboard_audit.md` L66 | 6 confirmed finance reports (`/salesreport`, `/singledaysalesreport`, `/sales-report-by-payment`, `/customer-revenue-report`, `/packageexpirestoday`, `/cashback/list`) + `/summary` | ✅ Complete for the **3-report MVP cut** (intake-funnel, daily-ops, kitchen-day-list; replay-equality proven) | ✅ Live (`GET /reports/:name`, `POST /exports` — JSON-only export) | ❌ `live:false` placeholder | API live, projections return zeros (empty DB) | ❌ UI missing; **legacy finance reports ≠ MVP reports** — finance parity deferred behind DEC-003 amendment (alignment audit L163/210) | **C** |
| **Settings** | `modules/10_settings_content_notifications.md` | 14 routes: `/settings` + content/legal pages, gallery/video, `/advertise`, `/socialmedia`, `/subscribers`, `/pushnotification` ×2 | ◐ Split: M16 ops-settings engine complete (typed validation, preview, effective-dating, gate keys, audit); **content/social/push has no backend at all** | ◐ 4 `/settings` endpoints live; **masters admin (sections/areas/slots/methods) + reason-code service methods have no routes** despite WP-03 scope | ❌ Placeholder only | 4 endpoints live, 13 seeded keys; masters zero-row | ❌ Legacy critical keys (checkout gap, full-capacity date, WhatsApp contact) not seeded; `kitchen_cutoff_time` null; masters unreachable | **C** |

## Per-module evidence notes

### Orders — B
The operational center of the legacy panel (staff order creation incl. WhatsApp transcription, lifecycle monitoring). The full new-system pipeline draft → review → order → fulfillment days is built, independently reviewed, and HTTP-complete (`m01-intake/draft.controller.ts`, `m02-review/review.controller.ts`, `m03-orders/order.controller.ts`). The **only** engineering gap is action UI: `app/apps/admin/src/pages/lists.tsx` is explicitly read-only ("Detail/action screens arrive in WP-UI-02"). Content gaps held at WP-14: four registered no-op transition validators (`same_day_ack`, `pause_window`, `plan_still_active`, `routing_rules_present` — review finding L1) and the cancel-cascade engine bypass (L2) are DEC-005 workshop items.

### Subscribers — D (off critical path)
Discovery proves legacy `/subscribers` is the **marketing newsletter email list** (Email/status/operation columns; grouped under Content/Marketing, "lower dependency after core business workflows"). Meal-plan subscriptions — what the sidebar name suggests — are legacy *Orders* data and are covered by M03 + the M19 `active_plans` importer. Zero subscriber code exists at any layer, and the alignment audit defers the whole group to a future content-marketing package. **Daily order operations can cut over while legacy remains the marketing-list system of record.**

### Customers — C
Strongest backend in the system (guided-create with duplicate block/warn, merge with undo, PII/health read-logging — all tested, TS-S #6 green) but **zero HTTP surface**: `m04-customers/` has no controller, and the WP-04 register promise "HTTP surface consolidates at WP-07" was never fulfilled (WP-07 shipped only the drafts controller; confirmed by alignment audit L28). No UI, no sidebar entry, and the WP-UI A16 row's UI-02+ list does not yet name customer screens — **scope amendment required**.

### Packages / Products — C
WP-05 delivered the catalog core in deliberate **mirror mode** (ADR-010): admin writes throw `mirror_mode` until `feature_flag cutover_catalog` flips; only the M19 import path writes. Service-only (no `catalog.controller.ts`; `app.module.ts` registers no catalog routes). Schema parity gaps vs legacy: package `priority`/coupon-eligibility absent, `package_for_type` missing Friday-off-day/new-customer flags, no update/deactivate lifecycle ops. Nutrition macros never existed in legacy (GAP-DQ-02) and have no entry surface; `routing_rule` is zero-row pending DEC-006.

### Reports — C
M15 deliberately covers **operational** visibility (intake-funnel, daily-ops, kitchen-day-list) — not the legacy **finance** report set (monthly/daily sales, sales-by-payment with gateway txn refs, customer revenue accrual, expiration, cashback). Endpoints are live and RBAC-gated; export is JSON-only where legacy exported CSV. Projections rebuild from `outbox_event` only, so migrated legacy history produces no report rows without backfill events. Five-report finance parity is parked behind a DEC-003 amendment (strangler Phase 5); finance can keep reading legacy until then.

### Settings — C
The M16 engine satisfies GAP-ADM-02 (validation/preview/audit) and is live with 4 endpoints + 13 seeded keys. Three findings: (1) `addMaster`/`addReasonCode` service methods have **no controller routes** — sections/areas/slots/methods cannot be administered over HTTP, contradicting the WP-03 scope line; (2) none of the seeded keys carries the legacy critical trio (checkout days gap, full-capacity date, WhatsApp contact), and `kitchen_cutoff_time` is seeded null; (3) the 12 content/social/push screens have **no new-system home and no recorded descope decision** — they stay on legacy regardless of order-ops cutover.

## Classification roll-up

| Class | Modules |
|---|---|
| A — fully implemented | *(none — no module is browser-operable end-to-end yet)* |
| B — backend complete, UI missing | Orders |
| C — partially implemented | Customers, Packages, Products, Reports, Settings |
| D — not implemented | Subscribers (marketing list; explicitly deferred, off the order-ops critical path) |

**Cross-cutting modules already at "A-equivalent" for their slice (context, not core-7):** Kitchen (M08 — board UI live since WP-10/WP-UI-01), Auth/RBAC/Staff (API complete; staff UI pending), Payments-lite (API complete; queue UI pending WP-UI-02).
