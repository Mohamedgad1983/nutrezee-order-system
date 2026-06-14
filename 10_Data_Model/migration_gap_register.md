# Migration Gap Register — Legacy → New Cutover

**Date:** 2026-06-14 · **Status:** Living · **Owner of file:** Planner
**Purpose:** the single consolidated list of everything that stands between *machinery built* and *real data migrated + reconciled*. Each gap has a stable `MG-id`, an owner, what it blocks, and the exact unblock. This register replaces the scattered gap notes in `Legacy_Core_Gap_To_Cutover.md §1.3/§1.4`, `migration_mapping.md` (NC register), and `migration_execution_plan.md §7` — those remain the design source; this is the operational tracker.

**Reading rule:** a gap is `OPEN` until its unblock is recorded done with evidence. `[S1]` = blocked on sponsor legacy access; `[S2]` = blocked on workshop pack; `[ENG]` = engineering can close it now; `[SEED]` = closeable on first real export.

---

## A. Access gaps (sponsor-owned — the S1 wall)

| ID | Gap | Owner | Blocks | Unblock | Status |
|---|---|---|---|---|---|
| MG-A1 | Legacy admin URL + read-only credentials not provided (`LEGACY_BASE_URL`/`LEGACY_ADMIN_EMAIL`/`LEGACY_ADMIN_PASSWORD`) | sponsor | every real extraction, every compare, every apply | Provide the 3 env vars to the operator running `tools/legacy-migration` | OPEN `[S1]` |
| MG-A2 | Bridge pattern P1/P2/P3 not chosen (manual-reconcile vs export/import vs DB/API read) | sponsor + architect | source-format of extraction; reconciliation cadence | Disposition the 12 access items (`modules/11_undiscovered_surfaces_access_needed.md`); record in ADR-008 addendum | OPEN `[S1]` |
| MG-A3 | Legacy DB schema / export format unknown (screen-evidence only) | sponsor | field-level mapping fidelity (types/nullability), off_days source, item-level order data | Provide DB dump, export sample, or API docs (access items 3–4) | OPEN `[S1]` |
| MG-A4 | New-staging extraction account for compare (`NEW_*` env vars) | operator | the `compare` half of the toolkit pipeline | Provide a read-scoped staging login to the operator (exists: `uat-seed@nutrezee.local` can be reused or a read-only clone created) | OPEN `[ENG]` — closeable now |

## B. Entity calibration gaps (engineering, but gated by MG-A1)

All 12 toolkit entities ship `calibrated:false` and are skipped before any navigation. Calibration = tuning `config.json` `path`/`rowSelector`/`nextPageSelector`/`columns` against the **real** legacy DOM, then flipping `calibrated:true`. Procedure: `migration_entity_calibration_playbook.md`. Until MG-A1 lands, every row below is `BLOCKED-ON-S1` but pre-scaffolded (default selectors + expected columns already authored from screen evidence).

| ID | Entity | Toolkit path (default) | Calibrated | Cutover batch | Status |
|---|---|---|---|---|---|
| MG-B1 | customers | `/users/list/3` | false | Batch 2 | scaffolded, awaits S1 |
| MG-B2 | orders (active plans) | `/orders` | false | Batch 3 | scaffolded, awaits S1 |
| MG-B3 | subscriptions | `/subscribers` | false | NOT on path (§1.6) | scaffolded, low priority |
| MG-B4 | products | `/products` | false | Batch 1 | scaffolded, awaits S1 |
| MG-B5 | packages | `/packages` | false | Batch 1 | scaffolded, awaits S1 |
| MG-B6 | areas | `/masters/areas` | false | Batch 1 | scaffolded, awaits S1 |
| MG-B7 | delivery_slots | `/masters/slots` | false | Batch 1 | scaffolded, awaits S1 |
| MG-B8 | delivery_methods | `/masters/delivery-methods` | false | Batch 1 | scaffolded, awaits S1 |
| MG-B9 | payment_methods | `/masters/payment-methods` | false | Batch 1 | scaffolded, awaits S1 |
| MG-B10 | coupons | `/coupons` | false | NOT on path (text-frozen only) | scaffolded, low priority |
| MG-B11 | settings | `/general-setting` | false | reference only (critical trio → MG-D4) | scaffolded, low priority |
| MG-B12 | reports | `/reports` | false | reference only (parity check) | scaffolded, low priority |

## C. Data-quality / mapping gaps (refined on first real export)

| ID | Gap | Owner | Blocks | Unblock | Status |
|---|---|---|---|---|---|
| MG-C1 | Customer dedup thresholds unproven against real data (merge_review ≤10%, error ≤2% gates) | eng + ops | Batch 2 apply | Run Batch-2 dry-run on real export; review merge_review sample with Ops; tune normalizer | OPEN `[SEED]` |
| MG-C2 | Legacy payment-status vocabulary unknown (placeholder map `paid→paid`, else→finance review) | sponsor/finance | Batch 3 payment_record mapping | First export reveals values, or workshop S7 enumerates them | OPEN `[S1]`/`[S2]` |
| MG-C3 | `Order.off_days` source unverifiable; import default = none + `off_days_unverified=true` | eng | fulfillment-day correctness | First export shows off-day data, or accept default + intake correction | OPEN `[S1]` |
| MG-C4 | Item-level order composition may be absent in legacy; fallback = single frozen package-line + `item_detail_unverified` | eng | kitchen ticket granularity for migrated plans | First export shows line items, or accept package-line fallback | OPEN `[S1]` |
| MG-C5 | Address data availability in export unknown; customers may import address-less (intake fills on first contact, WF-01) | eng | none (acceptable degrade) | First export; else accept address-less import | OPEN `[S1]` |
| MG-C6 | Catalog schema parity columns missing: package `priority`, coupon fields, `package_for_type` Friday-off/new-customer flags | eng | Batch 1 fidelity | Add columns in a pre-Batch-1 migration once export confirms they exist | OPEN `[SEED]` |
| MG-C7 | Sub-package → `parent_package_ref` is inferred `[I]` from "sub-package" screen evidence; not schema-confirmed | eng + sponsor | Batch 1 package hierarchy | Confirm at workshop S1 or first export; cycle-check already enforced | OPEN `[S2]` |
| MG-C8 | Currency code default unconfirmed (money parsed to minor units; code assumed) | sponsor | amount correctness | Confirm currency at workshop | OPEN `[S2]` |

## D. Rule-content gaps (workshop-owned — the S2 wall)

| ID | Gap | Owner | Blocks | Unblock | Status |
|---|---|---|---|---|---|
| MG-D1 | L1 transition validators are registered no-ops (`same_day_ack`, `pause_window`, `plan_still_active`, `routing_rules_present`) | sponsor (DEC-005) | deny-mode flip; correct transition guards | Workshop defines semantics → implement (~hours each) | OPEN `[S2]` |
| MG-D2 | L2 cancel-cascade bypasses the engine; `ready_to_pack→cancelled_day` has no config row | sponsor (DEC-005) | cancel-day correctness | Workshop content decision → add transition_config row | OPEN `[S2]` |
| MG-D3 | DEC-006 kitchen sections content → `routing_rule` rows are zero-row (unrouted lane works meanwhile) | sponsor (DEC-006) | kitchen routing (WF-07); routing-rule editor 04c | Workshop section content → seed routing rules | OPEN `[S2]` |
| MG-D4 | Legacy critical settings trio not set: checkout-days gap, full-capacity date, WhatsApp contact; `kitchen_cutoff_time` seeded null | sponsor | kitchen go-live (cutoff), capacity logic | Workshop sets values → settings registry | OPEN `[S2]` |
| MG-D5 | RBAC matrix S8 not signed off → deny-mode not flipped (L3 hard-code still in place) | sponsor | RBAC fail-secure final posture | Workshop signs matrix → flip deny-mode, retire L3 hard-code | OPEN `[S2]` |
| MG-D6 | ASM-001..050 not sponsor-signed (package prepared in `22_Meeting_Notes/`) | sponsor | formal assumption closure (reversible until signed) | Workshop reviews assumption register; sign or amend | OPEN `[S2]` |
| MG-D7 | Cutover day-of-week not chosen (lowest-volume day) | sponsor | cutover-weekend scheduling | Workshop identifies lowest-volume day | OPEN `[S2]` |

## E. Operational-readiness gaps (engineering / joint — WP-14)

| ID | Gap | Owner | Blocks | Unblock | Status |
|---|---|---|---|---|---|
| MG-E1 | Restore drill not yet documented as a repeatable procedure | eng | ops confidence | ✅ **CLOSED 2026-06-14** — drill executed (latest nightly dump → throwaway DB → 13/13 migrations + 62/62 tables verified → dropped; live untouched). Procedure now in `16_Deployment/operations_runbook.md §Backup/Restore` | CLOSED |
| MG-E2 | TS-S / TS-A full pass on staging with pilot data not yet run | QA + ops | go-live gate | Run mandatory e2e scenarios on staging once UAT seed + workshop values land (`15_Testing/uat_pack.md`) | OPEN `[S2]` (values) |
| MG-E3 | Perf baseline (no harness/thresholds) | eng | go-live gate (capacity confidence) | App-tier baselined 2026-06-14 (`16_Deployment/perf_baseline.md`: /health p50 4.2ms / p95 7.1ms, loopback). DB-tier + authed-endpoint + under-load passes pending explicit staging approval / a UAT credential / a pilot load target | PARTIAL `[ENG]` (app-tier done; rest needs approval/creds) |
| MG-E4 | Training per persona not executed | ops + staff | go-live gate | `16_Deployment/pilot_plan.md §Training`; per-role hands-on on staging | OPEN (joint) |
| MG-E5 | UAT not run with real staff | ops + staff | pilot entry | Execute `15_Testing/uat_pack.md` on staging; record results | OPEN `[S2]` (values) |
| MG-E6 | Production environment not provisioned / posture undecided (VPS pattern vs managed PG) | sponsor + eng | cutover target | Decide production posture (`16_Deployment/environment_plan.md §1`); provision before WP-14 gate | OPEN (sponsor decision) |
| MG-E7 | Monitoring / alerting not live (outbox lag, audit-queue depth, error rates, reconciliation divergence) | eng | go-live gate (observability) | Stand up the metrics in `16_Deployment/operations_runbook.md §Monitoring` | OPEN `[ENG]` — partial now (health endpoint exists) |
| MG-E8 | GitHub Actions billing-blocked → no live CI gate on PRs | user/ops | true CI gate (units admin-merged after local tests + staging Playwright) | Restore Actions billing on the GitHub org | OPEN (operational) |

---

## Roll-up by owner (what unblocks the most)

| Owner | Open gaps | Single highest-leverage unblock |
|---|---|---|
| **Sponsor — S1 (legacy access)** | MG-A1, A2, A3 + cascades B1–B12, C2–C5 | **Provide legacy read-only credentials + choose bridge pattern.** Unblocks all 12 calibrations + every real dry-run. The longest pole. |
| **Sponsor — S2 (workshop)** | MG-C7, C8, D1–D7, E2, E5 | **Hold the workshop** (one session): DEC-005/006 content, RBAC matrix, settings trio, cutover day, ASM sign-off. |
| **Engineering (now)** | MG-A4, C1*, C6*, E3, E7 | Stand up perf harness + monitoring; wire a read-scoped staging compare account. (*C1/C6 need first export to fully close.) |
| **Operational** | MG-E6, E8 | Production env decision; restore GitHub Actions billing. |
| **Joint (WP-14)** | MG-E4 | Persona training once UAT scripts are populated. |

**Closed this cycle:** MG-E1 (restore drill).

**The one-line truth:** engineering has built everything that does not require an external input. **MG-A1 (legacy credentials)** and the **S2 workshop** are the two gates; the consolidated ask is in `22_Meeting_Notes/SPONSOR_DECISION_PACK.md`.
