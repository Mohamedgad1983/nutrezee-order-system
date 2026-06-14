# UAT Pack — Order-Ops Cutover Slice

**Date:** 2026-06-14 · **Status:** Ready to run on staging; workshop-gated values flagged `[NC]` · **Owner:** Ops Manager (UAT lead) + QA
**Environment:** `https://13-140-159-201.sslip.io` (staging, LIVE) · **Seed account:** `uat-seed@nutrezee.local` (ops_manager + order_agent) · seeded chain: catalog (M19 mirror) + 1 customer + draft→approved→fulfillment-day→payment-review (memory `staging-uat-seed-data`)
**Scope:** the daily order-operation workflows that cut over first — WF-01..08, 12–16. Dispatch (WF-09/10/11) is Phase 4, **not** in this pack (`Legacy_Core_Gap_To_Cutover.md §1.6`).
**Source of truth:** workflow definitions `13_Architecture/workflow_architecture.md`; suite design `15_Testing/test_strategy.md`; automated coverage `tools/e2e-staging/*.spec.ts` (15 specs, each cited per case below).

> **How to run.** Each case = one persona, preconditions (staging seed), numbered steps, expected result, and a pass/fail acceptance line. Run in order within a workflow. Record outcomes in `15_Testing/uat_execution_log.md`. A `[NC]` tag marks a value the **workshop must supply** (cutoff times, mandatory-field set, reason-code wording) — until set, test the *behavior* with the seeded placeholder and note the value as provisional. UAT **passes** when every non-`[NC]` case passes and every `[NC]` case passes behaviorally with its placeholder.

---

## 0. Personas (pilot-minimum roster)

| Persona | Role(s) | Screens | UAT account |
|---|---|---|---|
| **Agent** | order_agent | intake, order detail, exceptions | `uat-seed@` (has order_agent) |
| **Reviewer / OM** | ops_manager | review-queue, orders, customers/merge, exceptions, staff | `uat-seed@` (has ops_manager) |
| **Finance** | finance | payment review queue, per-order payment | provision 1 (`/app/staff` grant) |
| **Kitchen** | kitchen_user | kitchen board | provision 1 (`/app/staff` grant) |
| **Admin** | super_admin | settings, staff/RBAC, audit, dashboard, reports | bootstrap super-admin |

Pre-UAT setup: from `/app/staff` (Admin), grant a Finance and a Kitchen test account so all five personas exist. One-time.

---

## 1. Intake & review (Agent + Reviewer)

### WF-01 — Manual order intake (Agent)
- **Pre:** seeded catalog + ≥1 customer; areas/slots/methods present (seed has 1 each).
- **Steps:** `/app/intake` → search existing customer (or create unverified) → pick package + items → set dates → area/slot/method → payment method → WhatsApp ref (optional) → Create → observe completeness feedback → Submit.
- **Expected:** draft created; completeness panel lists any missing mandatory field `[NC mandatory-field set]`; submit blocked until complete `[NC submit-block rule]`; on submit → PENDING_REVIEW.
- **Acceptance:** ☐ draft persists ☐ completeness accurate ☐ submit gating behaves ☐ allergy warning shows when customer has a flagged allergen.
- **Auto-cover:** `wpui-intake.spec.ts`.

### WF-02 — WhatsApp order intake (Agent)
- **Steps:** same as WF-01 but populate the **immutable** WhatsApp reference panel (message id/text).
- **Expected:** reference captured verbatim; field is read-only after save; raw content masked per role.
- **Acceptance:** ☐ ref immutable ☐ draft flows to review like WF-01.
- **Auto-cover:** `wpui-intake.spec.ts` (ref panel).

### WF-03 — Draft review (Reviewer/OM)
- **Pre:** ≥1 PENDING_REVIEW draft (create via WF-01 or use seeded review-queue item).
- **Steps:** `/app/review-queue` → claim item → inspect detail + SLA timer + allergy/warning display.
- **Expected:** claim locks the item to the reviewer; warnings render; SLA timer visible.
- **Acceptance:** ☐ claim works ☐ warnings/allergy visible ☐ second reviewer cannot double-claim.
- **Auto-cover:** `wpui-review.spec.ts`.

### WF-04 — Order approval (Reviewer/OM)
- **Steps:** on a claimed draft → resolve each warning override (with reason) → Approve.
- **Expected:** PENDING_REVIEW → APPROVED; fulfillment days generated; payment gate applied `[NC payment-on-submit policy]`; agent notified.
- **Acceptance:** ☐ status transitions ☐ fulfillment days appear (order detail) ☐ override requires reason ☐ audit row written same-transaction.
- **Auto-cover:** `wpui-review.spec.ts` (approve + overrides).

### WF-05 — Order rejection (Reviewer/OM)
- **Steps:** on a claimed draft → Reject → pick reason code `[NC reason-code set]` → confirm.
- **Expected:** PENDING_REVIEW → REJECTED; reason recorded; agent notified; clone-to-new-draft offered.
- **Acceptance:** ☐ reject needs reason code ☐ agent notified ☐ clone option present.
- **Auto-cover:** `wpui-review.spec.ts` (reject path).

### WF-06 — Edit before approval (Agent ⇄ Reviewer)
- **Steps:** Reviewer returns/recalls a draft → it moves PENDING_REVIEW ⇄ DRAFT → Agent re-edits a field → resubmits.
- **Expected:** field diffs audited; re-submit returns to queue.
- **Acceptance:** ☐ return works ☐ field-level diff in audit ☐ re-submit re-queues.
- **Auto-cover:** `wpui-review.spec.ts` + `wpui-intake.spec.ts`.

## 2. Kitchen (Kitchen + OM)

### WF-07 — Kitchen routing / ticket generation (Kitchen/OM)
- **Pre:** ≥1 APPROVED order with a fulfillment day at/after cutoff; **`kitchen_cutoff_time` is seeded null → set a placeholder `[NC MG-D4]`**.
- **Steps:** reach cutoff (or trigger generation) → `/app/kitchen` board → observe tickets per section; unrouted items land in the unrouted lane (DEC-006 routing rules are zero-row until workshop → expect unrouted lane to work).
- **Expected:** day → KITCHEN_QUEUED; tickets created; unrouted queue + alert present when no routing rule matches.
- **Acceptance:** ☐ tickets generate ☐ unrouted lane functions ☐ day status advances. **Note `[NC]`:** routing-to-section content (MG-D3) deferred to workshop — UAT validates the *engine + unrouted fallback*, not section routing.
- **Auto-cover:** `wpui-shell.spec.ts` (kitchen board integration).

### WF-08 — Order preparation (Kitchen)
- **Steps:** ticket IN_PROGRESS → PREPARED; optionally raise a shortage → escalation.
- **Expected:** day rolls up READY_TO_PACK → PACKED as tickets complete; shortage escalates to OM.
- **Acceptance:** ☐ ticket states advance ☐ day rollup correct ☐ shortage → escalation case.
- **Auto-cover:** `wpui-shell.spec.ts` (board) + `wpui-exceptions.spec.ts` (escalation).

## 3. Payments & cancellation (Finance + OM)

### WF-12 — Cancellation (Agent files, OM reviews)
- **Steps:** Agent on `/app/orders/<id>` → file cancel request (whole plan or specific days) with reason `[NC reason-code]` → OM reviews → confirm.
- **Expected:** atomic CANCELLED (plan or day-scoped); refund decision captured `[NC refund policy]`; future fulfillment days cancelled.
- **Acceptance:** ☐ request→review→confirm chain ☐ day-scoped vs whole-plan both work ☐ audit complete.
- **Auto-cover:** `wpui-orders.spec.ts` (cancel request).

### WF-13 — Failed payment / refund (Finance)
- **Pre:** seeded payment-review item (awaiting finance review).
- **Steps:** `/app/payments` → confirm or reject a payment; for refund → file refund request → FI review → REFUNDED.
- **Expected:** Finance-only; never auto; link-sent→FAILED or refund→FI→REFUNDED.
- **Acceptance:** ☐ only finance role can act ☐ confirm + reject paths work ☐ refund requires FI review.
- **Auto-cover:** `wpui-payments.spec.ts` + `wpui-order-payments.spec.ts` (per-order panel).

## 4. Exceptions, admin correction, audit (OM + Admin)

### WF-14 — Customer complaint / exception (Agent/OM)
- **Steps:** `/app/exceptions` → capture case linked to an order → for an allergy-incident, confirm auto-escalation to OM → resolve with escalation reason code `[NC]`.
- **Expected:** exception linked to order; allergy-incident auto-escalates; resolve needs reason.
- **Acceptance:** ☐ case links to order ☐ allergy auto-escalation ☐ resolve gated by reason code.
- **Auto-cover:** `wpui-exceptions.spec.ts`.

### WF-15 — Admin correction after approval (OM/Admin)
- **Steps:** on an APPROVED/ACTIVE order → raise a change request → review impact (future days regenerate) → apply.
- **Expected:** no un-audited mutation; impact cascade regenerates future fulfillment days; change audited.
- **Acceptance:** ☐ change request → impact preview → apply ☐ future days regenerate ☐ full audit trail.
- **Auto-cover:** `wpui-orders.spec.ts` (change request).

### WF-16 — Audit event recording (Admin)
- **Steps:** `/app/audit` → filter by entity/event/severity → open a state-changing action from the cases above → inspect before/after.
- **Expected:** every state change + login + settings edit produced an AuditEvent in the same transaction; immutable; before/after masked unless full pii∧health∧payment visibility.
- **Acceptance:** ☐ each UAT action above has a matching audit row ☐ masking enforced by role ☐ no gaps in the chain.
- **Auto-cover:** `wpui-audit.spec.ts`.

## 5. Admin parity (Admin/OM) — supporting screens

| Case | Screen | Quick check | Auto-cover |
|---|---|---|---|
| Customers | `/app/customers` | search, guided-create (dup block+warn), masked profile, edit, **merge + undo** | `wpui-customers.spec.ts`, `wpui-merge.spec.ts` |
| Catalog browse | `/app/catalog` | products/packages/masters read-only; nutrition + allergens on product detail | `wpui-catalog.spec.ts` |
| Reports + export | `/app/reports` | intake-funnel / daily-ops / kitchen-day-list render seeded rows; JSON export | `wpui-reports.spec.ts` |
| Settings/masters | `/app/settings` | view + add area/slot/method/section + reason codes | `wpui-settings.spec.ts` |
| Staff / RBAC | `/app/staff` | grant/revoke roles; deactivate; RBAC matrix | `wpui-staff.spec.ts` |
| Dashboard | `/app/dashboard` | stat cards = report projections + live queue counts | `wpui-dashboard.spec.ts` |

---

## 6. Mandatory scenario gate (TS-S — must pass on staging before pilot)

Per `test_strategy.md`, these non-negotiable end-to-end scenarios must be green on staging with pilot data (also tracked as MG-E2):
1. **Allergy chain 1→7** (the non-negotiable safety path) · 2. WhatsApp draft → review → approve · 3. Same-day cancel · 4. Change request impact cascade · 5. Payment confirm/reject · 6. Customer merge + undo · 7. Reconciliation divergence flagged.

These overlap the WF cases above; running this pack end-to-end exercises all seven. Record the TS-S gate result in the execution log §summary.

## 7. Exit criteria (UAT → pilot)

UAT is **complete** when: every non-`[NC]` case PASS · every `[NC]` case PASS behaviorally with placeholder (and the real value logged for the workshop) · TS-S 7/7 green on staging · all defects triaged (no open Critical/High on the slice — retirement criterion 3) · results signed by the OM in `uat_execution_log.md`. Then proceed to `16_Deployment/pilot_plan.md`.
