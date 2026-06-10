# Phase 2H — Legacy Transition Architecture (Strangler-Fig)

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (approach) / pattern selection [NC — access disposition, Phase 0]
Implements ADR-002/008. Constraint baseline: **assume no access to legacy internals** (R2) — every mechanism below works at access level 0 and gets cheaper if access arrives.

## 1. Coexistence principles

1. **One workflow lives in exactly one system at a time** (R10). Cutover is per-workflow, dated, with a flag in M16 — never "use either."
2. **Legacy is never modified by the new system.** The bridge is read-only toward legacy (the only legacy changes are the independent quick wins ENH-QW-02/03/04, done by the legacy owner).
3. **New system is born as source of truth for what it owns** (ADR-010); legacy remains source of truth for what hasn't moved yet.
4. **Every bridge element carries a retirement date** tied to a migration-phase exit — the bridge must shrink, not ossify.
5. **No business disruption:** each cutover has a rollback runbook rehearsed on staging before go-live (`16_Deployment/`).

## 2. What stays / what moves

| Stays in legacy temporarily | Until |
|---|---|
| Existing active subscriptions created pre-cutover (run to natural expiry, or one-time import per DEC-012) | Phase 2 exit / plan expiry |
| Payment-link generation [V capability] if gateway access absent | Gateway access or Phase 5 |
| Coupons, cashback, ads, gallery, videos, static/legal pages, subscribers, social, push broadcasts (Preserve-class, Step 2B) | Phase 5+ (own mini-cutovers, low risk) |
| 5 finance reports (read-only reference) | Phase 5 parity sign-off |
| Dietician requests module [V] | Post-MVP module decision |
| **Moves first:** order intake + review + customer profiles (ADR-003) | Phase 2 go-live |

**First new module built:** M13+M14+M16 foundation, then M01/M02 (intake/review) as the first user-facing slice — exactly the prompt's mandate.

## 3. Bridge patterns (escalating by granted access)

| Pattern | Access required | Mechanism | Cost/risk |
|---|---|---|---|
| **P1 — Manual reconciliation (baseline)** | None (read-only dashboard login, as in discovery [V]) | Daily checklist: counts of new orders/customers per system; weekly CSV-style manual compare of order lists; cutover flags enforced by process + training | Cheap to build, ongoing labor; tolerable only while volumes moderate [A] |
| **P2 — Export/import sync** | Report exports or DB dumps provided by owner | Scheduled import into M18 SyncRecords; automated diff/reconciliation reports; customer/catalog refresh into M04/M05 mirrors | Medium; depends on export availability [NC] |
| **P3 — DB/API read-replica** | Schema or API access (access items 2–4) | Read-replica or API poll → near-real-time mirror; enables automatic divergence alarms | Best fidelity; only if access granted; never write-back |

Decision point: end of Phase 0 access disposition → record chosen pattern in ADR-008 addendum.

## 4. Data sync requirements (whichever pattern)

| Data | Direction | Purpose | Frequency |
|---|---|---|---|
| Customers | legacy → new (one-time import + delta until intake cutover) | Dedup base (DEC-012, M19) | Import + weekly delta |
| Catalog (products/packages/masters) | legacy → new mirror | Valid intake references | Weekly or on-change until catalog cutover |
| Orders created in legacy (pre-cutover) | legacy → new (reference only) | Duplicate-plan warnings at review; reporting overlap | Daily |
| Orders created in new system | **never** pushed to legacy | One-system rule; kitchen/dispatch were never in legacy anyway [V-absence] — the physical operation reads the new day-list from cutover day | — |
| Payment statuses | legacy → new reference while links generated in legacy | Finance reconciliation report | Daily |

## 5. Avoiding double entry

- Cutover day for intake: legacy `/orders/create` is **decommissioned by policy** for new orders (and set read-only if the owner can; otherwise staff policy + daily P1 reconciliation catches strays).
- The new intake is the only path that produces kitchen day-lists — physical operations follow the new system, making bypass self-defeating.
- Reconciliation report flags any order appearing only in legacy after cutover → Ops Manager follow-up, audited.

## 6. Avoiding business disruption

- Pilot scope first: one intake agent + one kitchen section + a 2-week parallel period where the manual KPI sheet (ENH-QW-06) doubles as cross-check.
- Cutovers scheduled on lowest-volume day [NC — workshop identifies]; kitchen cutoff times honored so no day is half-in-each-system: **the FulfillmentDay date is the cutover unit**.
- Training per role before each phase gate (roadmap change-management track).

## 7. Rollback per slice

| Slice | Rollback |
|---|---|
| Intake/review (Phase 2) | Flag off → agents revert to legacy `/orders/create` (kept dormant-functional until Phase 2 exit +30 days); drafts preserved; day-lists regenerable from legacy practice (manual) |
| Kitchen routing (Phase 3) | Board off → printed day-list from M03 (degraded mode) or full revert to pre-system manual practice; tickets are derived data — no loss |
| Dispatch (Phase 4) | Board off → manual assignment as today; driver app optional per driver during ramp |
| Reports (Phase 5) | Legacy reports remain reference until parity sign-off; rollback = keep using them |
| Foundation (RBAC/audit) | No rollback — additive, no legacy dependency |

## 8. Retirement criteria (when an old workflow may be switched off)

A legacy workflow retires only when ALL hold for 30 consecutive days:
1. 100% of the workflow's volume flows through the new module (reconciliation report clean).
2. Success criteria of the corresponding roadmap phase met (e.g., intake time ≤ baseline; zero queue-bypass).
3. No open Critical/High defects on the slice.
4. Rollback rehearsed and documented.
5. Sign-off recorded in `20_Decisions/` (one DEC per retirement) — satisfies BO-5 no-regression duty against the 50-screen checklist.

## 9. Migration phases (aligned to roadmap, refined for strangler execution)

| Phase | Content | Bridge state | Exit gate |
|---|---|---|---|
| **0 — Access, backup, safety** | Remote backup (R1!), access disposition, staging, workshop, quick wins ENH-QW-01…07 | None yet | G0: DEC-001/002/011 signed |
| **1 — Quick fixes + foundation** | Legacy quick wins live; M13/M14/M16/M12 built; customer+catalog import (M19) with dedup | P1 reconciliation starts | Foundation acceptance tests (audit §MVP tests) |
| **2 — Order intake + review** | M01/M02/M03/M17(manual)/M07-lite/M11-lite/M15-lite live; intake cutover; legacy order-create retired-by-policy | Daily order reconciliation | 100% intake via new system 30 days; G2 criteria |
| **3 — Kitchen routing** | M08 tickets+board; pilot section → all sections; (labels/packing module follows, DEC-007) | Day-list is system-generated | All sections on board; unrouted queue empty |
| **4 — Delivery assignment** | M09/M10 dispatch board + driver app; legacy `/driverOrders`+auto-assign formally retired [V routes] | Dispatch reconciliation vs manual log | ≥95% driver-recorded outcomes |
| **5 — Reporting + automation** | M15 full: 5-report parity + reconciliation month; notifications customer-facing; remaining Preserve-class mini-cutovers; legacy decommission plan | Bridge dismantles | Parity sign-off; legacy retirement DECs |
