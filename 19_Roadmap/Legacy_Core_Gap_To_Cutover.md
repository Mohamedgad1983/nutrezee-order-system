# Legacy Core — Gap to Cutover

**Date:** 2026-06-13 · **Companion to:** `Legacy_Core_Coverage_Matrix.md` (evidence + classifications) · **Goal:** the **shortest path from the current implementation to replacing the legacy daily operational order system** — not MVP theory.
**Operating model (unchanged, per `13_Architecture/legacy_transition_architecture.md`):** strangler cutover — the new system takes over daily *order operations* (intake → review → orders → payments → kitchen); legacy stays read-only for history and remains system of record for off-path modules (marketing/content/finance-report parity) until their own later phases.

## 1. What is actually missing — by category

### 1.1 Missing UI (largest gap; backend already done for all of these)

| # | Screen | Replaces legacy | Backend/API state |
|---|---|---|---|
| U1 | Intake draft form (customer search, package/items, dates, address, slot/method, payment method, completeness feedback, WhatsApp ref panel) | `/orders/create` | API live (M01 + M17) — **but customer search needs A1 below** |
| U2 | Review queue actions: claim + approve/return/reject with warning overrides | (legacy had no review stage — improvement, WF-03..06) | API live (M02) |
| U3 | Order detail: timeline, fulfillment days, transitions, cancellation request/ack, change request w/ impact | `/orders/list/*` row operations | API live (M03) |
| U4 | Payment review queue (Finance) + per-order payment panel | `/confirm-payment` | API live (M07) |
| U5 | Customers: list/search, profile (PII/health-gated panels), guided create w/ dup block/warn, merge review w/ undo | `/users/list/3`, `/users/newuser/9` | Service done; **needs A1** |
| U6 | Packages/Products read screens (mirror-mode browse; enrichment editors later) | `/products`, `/package`, `/packageFor`, masters | Service done; **needs A2** |
| U7 | Reports screens for the 3 MVP reports + export | `/summary` (operational slice) | API live (M15) |
| U8 | Settings + masters admin (sections/areas/slots/methods, reason codes, setting keys w/ preview) | `/settings` (operational slice) | Engine live; **needs A3** |
| U9 | Exceptions case capture + escalations view | `/contact_us` (complaint slice, WF-14) | API live (M03 exceptions, M08 escalations) |
| U10 | Staff & roles admin + audit query view (restricted) | (RBAC is new; WF-16) | API live (staff/rbac controllers) |
| U11 | Dashboard stat cards (counts from the 3 projections) | `/dashboard` cards | API live (M15) |

### 1.2 Missing API surface (small, well-defined — services exist and are tested)

| # | Endpoint set | Why blocked today | Evidence |
|---|---|---|---|
| A1 | **M04 customers controller**: search-by-phone, profile, guided-create, update, address, allergy, merge+undo | `m04-customers/` is service-only; "consolidates at WP-07" never delivered | alignment audit L28; matrix §Customers |
| A2 | **M05 catalog read controller**: products/packages/masters list+detail (read-only while mirror mode holds) | no `catalog.controller.ts`; only M19 imports touch catalog over HTTP | matrix §Packages/Products |
| A3 | **Masters + reason-code admin routes** on settings: expose existing `addMaster`/`addReasonCode` | service methods have no routes despite WP-03 scope line | matrix §Settings |

### 1.3 Data migration (machinery built and deployed; never fed real data)

- **Path is fully designed and coded** (`10_Data_Model/migration_execution_plan.md`; `m19-migration` batch-runner with dry-run-before-apply enforcement, quality gates, rollback; `m18-bridge` reconciliation + cutover flags): Batch 1 catalog → Batch 2 customers → Batch 3 active plans (cutover weekend), history stays in legacy.
- **Never run against a single real legacy row** (ASM-036). Staging DB is empty.
- **Hard blocker — sponsor-owned:** legacy access/exports still missing (the 12 access items: DB schema/backup, export formats, source code, API docs — `modules/11_undiscovered_surfaces_access_needed.md`; bridge pattern P1/P2/P3 still unchosen pending access disposition). *Every apply is blocked by this; nothing in engineering can substitute for it.*
- Field mappings are screen-evidence-only ("TBD-pending-access", `10_Data_Model/migration_mapping.md`) — first real export will refine them.
- Catalog schema parity gaps to close before/with Batch 1: package `priority` + coupon fields, `package_for_type` Friday-off/new-customer flags.

### 1.4 Rule content (workshop/sponsor-owned; engines built, values empty)

- **L1:** 4 transition validators are registered no-ops (`same_day_ack`, `pause_window`, `plan_still_active`, `routing_rules_present`) — DEC-005 semantics needed, then implement (~hours each once defined).
- **L2:** cancel-cascade bypasses the transition engine; `ready_to_pack→cancelled_day` has no config row — DEC-005 content decision.
- **DEC-006:** kitchen sections content → `routing_rule` rows (zero-row today; unrouted lane works meanwhile).
- **S8:** RBAC matrix sign-off → deny-mode flip (also retires L3 hard-code).
- **UAT values:** cutoffs, mandatory intake fields, reason codes (`kitchen_cutoff_time` seeded null — must be set pre-kitchen-go-live).
- **Settings keys:** add + value the legacy critical trio (checkout days gap, full-capacity date, WhatsApp contact).
- **ASM-001..050 sponsor sign-off** (package already prepared in `22_Meeting_Notes/`).

### 1.5 Operational readiness (WP-14 proper)

- Restore drill (dumps exist nightly since 2026-06-12; never restored) — last open gate-④ item.
- TS-S/TS-A full pass **on staging** with pilot data; missing scenario tails per review L6.
- Perf baseline (no harness/thresholds yet).
- Training per persona (go-live gate) + UAT with real staff (WF-01…08, 12–16).
- Pilot (1 agent + 1 kitchen section + OM + Finance) → exit review → cutover weekend per runbook §6 → 30-day reconciliation clock → legacy order-ops retirement check.
- Production environment decision (staging VPS posture vs managed PG — `environment_plan.md` §1; production "not before WP-14 gate").

### 1.6 Explicitly NOT on the daily-order cutover path

Subscribers (marketing email list), content/legal pages, gallery/video, advertisements, social media, push notifications, cashback/ratings/coupon-module, legacy **finance** report parity (five-report set), dispatch/driver (WF-09..11). All remain on legacy after order-ops cutover, by recorded plan (alignment audit L85; mvp cut §3/§5; strangler Phases 3–5). No engineering work required for these to cut over daily order operations.

## 2. Prioritized build list (shortest path)

| Priority | Item | Owner | Size | Unblocks |
|---|---|---|---|---|
| **P0** | **WP-API-01** — A1 customers + A2 catalog-read + A3 masters/reason-code routes (controllers over existing tested services; no schema change) | engineering | S (≈1 session) | U1 intake form (customer search), U5, U6, U8 |
| **P0** | **Sponsor: legacy export/DB access** (the 12 access items; pick bridge pattern P1/P2/P3) | **sponsor** | external | every real data run (1.3) |
| **P1** | **WP-UI-02** — U1 intake form + U2 review actions + U3 order detail/actions + U4 payment queue | engineering | M (≈2–3 sessions) | daily order flow in browser; UAT WF-01..06, 12, 13, 15 |
| **P1** | **Workshop pack** — L1/L2 semantics, DEC-005/006 content, S8 matrix, UAT values, settings trio, ASM sign-off (engineering drafts the decision pack; sponsor decides) | sponsor + eng | 1 workshop | validators (1.4), deny-mode, kitchen routing, WP-14 entry |
| **P2** | **WP-UI-03** — U5 customers + U6 catalog read + U7 reports + U8 settings/masters + U9 exceptions + U10 staff/audit + U11 dashboard cards | engineering | M (≈2 sessions) | full daily admin parity for ops slice; UAT WF-14, 16 |
| **P2** | **WP-DATA-01** — real Batch 1+2 dry-runs on staging from first real exports; refine `migration_mapping.md`; catalog parity columns (priority/coupon/package-for flags); reconciliation ritual rehearsal | engineering (after sponsor access) | S–M | Batch 3 readiness; cutover weekend |
| **P3** | **WP-14 execution** — restore drill, L1/L2 implementation post-workshop, TS-S/TS-A on staging, perf baseline, training, UAT, pilot | engineering + staff | M | go-live gate |
| **P3** | **Cutover weekend** — Batch 3 apply, `cutover_intake` ON (+2h), daily reconciliation, 30-day clock | joint, per runbook §6 | event | legacy order-ops retirement |

Deliberately excluded from the path: everything in §1.6.

## 3. Recommended WP sequence

```
WP-API-01 ──► WP-UI-02 ──► WP-UI-03 ──┐
   (S)          (M)           (M)      ├──► WP-14 ──► CUTOVER WEEKEND ──► 30-day clock ──► legacy order-ops retired
sponsor: legacy access ─► WP-DATA-01 ──┤
sponsor: workshop pack ─► L1/L2 impl ──┘
```

- **Engineering-only critical path:** WP-API-01 → WP-UI-02 → WP-UI-03 (≈4–6 build sessions) delivers a browser-complete daily order system on staging.
- **Sponsor-owned critical path (runs in parallel, gates the finish):** legacy export access (longest pole — nothing real can be migrated or reconciled without it) and the workshop pack (gates validators, deny-mode, kitchen routing content, WP-14 entry).
- **The two paths join at WP-14.** If sponsor items land while WP-UI-02/03 are being built, nothing ever waits on engineering.

**Single highest-leverage next action: WP-API-01** — it is small, has zero schema risk, fulfils two recorded-but-unfulfilled scope promises (WP-04 "consolidates at WP-07"; WP-03 masters admin), and without it the intake form (the heart of WP-UI-02) cannot search customers.
