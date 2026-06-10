# Phase 2D — Workflow Architecture (16 Future-State Workflows)

**Date:** 2026-06-11 · **Status:** Proposed (gated on DEC-005 status model sign-off)
Statuses per `order_lifecycle_status_model.md`. Modules per `module_blueprint.md` (M01…M19). Audit events per `audit_architecture.md`. Workflows WF-09…11 build at migration Phase 4; all others MVP unless noted.

## Master flow

```
WF-01/02 INTAKE        WF-03 REVIEW            WF-07/08 KITCHEN           WF-09..11 DELIVERY
┌────────────────┐    ┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────────────┐
│ message/call   │    │ queue → examine  │    │ cutoff → tickets    │    │ packed → assign → route  │
│ → DraftOrder   ├───►│ → WF-04 approve  ├───►│ → per-section prep  ├───►│ → delivered / failed     │
│ (incomplete OK)│    │ → WF-05 reject   │    │ → ready_to_pack     │    │      │                   │
└────────────────┘    │ → WF-06 edit     │    └─────────────────────┘    └──────┼───────────────────┘
        ▲             └──────────────────┘                                      ▼
        │                                          WF-12 cancel · WF-13 payment fail/refund
   WF-14 complaint ◄── customer ──────────────     WF-15 admin correction · WF-16 audit (wraps ALL)
```

Format per workflow: **Trigger / Actors / Pre-conditions** → numbered **Steps** (system actions inline) → **Data / Status / Notifications / Exceptions / Audit / Success criteria**.

---

### WF-01 — Manual Order Intake (phone, walk-in, staff-assisted) — MVP
- **Trigger:** Customer contact via phone/in-person/other non-WhatsApp channel [A — channels beyond WhatsApp assumed minor; workshop S3].
- **Actors:** Order Agent. **Pre-conditions:** Agent authenticated; catalog and slots loaded.
- **Steps:** 1) Agent searches customer by phone (M04) — match found → profile loaded (addresses, allergies, history); no match → guided creation with duplicate check (GAP-ADM-01). 2) Agent selects package/items; system validates against catalog + package rules. 3) System shows allergy conflicts from profile (BR-039). 4) Agent sets address, slot, dates, notes; system validates slot capacity [NC capacity rules]. 5) Save as DRAFT (incomplete allowed, BR-003) or submit → PENDING_REVIEW.
- **Data:** DraftOrder + DraftItems created; Customer possibly created. **Status:** — → DRAFT → (PENDING_REVIEW).
- **Notifications:** Aging-draft alert if DRAFT idle > threshold (M11). **Exceptions:** duplicate customer suspicion → merge-review flag; item unavailable → substitution note.
- **Audit:** order.draft_created, customer.created (if any). **Success:** time-per-order ≤ legacy `/orders/create` baseline; zero free-text customers.

### WF-02 — WhatsApp Order Intake (manual-assisted MVP; API future) — MVP
- **Trigger:** WhatsApp message with order intent arrives on business number [A — primary channel].
- **Actors:** WhatsApp Agent (may = Order Agent [NC]). **Pre-conditions:** as WF-01.
- **Steps (MVP):** 1) Agent opens intake with WhatsApp panel (M17): records sender phone, message timestamp/reference (BR-002). 2) Phone auto-searches customer (M04). 3) Agent transcribes into structured fields — *same screen, no second system*. 4) Missing info → DRAFT parked in incomplete queue (BR-003); agent requests details in chat; resumes later by phone search. 5) Complete → submit to PENDING_REVIEW. **(Future, DEC-002:** steps 1–3 prefilled by API capture + AI parse ENH-F-06, agent confirms.)
- **Data:** DraftOrder + WhatsAppMessageRef. **Status:** — → DRAFT → PENDING_REVIEW.
- **Notifications:** incomplete-queue aging alert. **Exceptions:** unknown phone + refused details → draft flagged `unverified-customer`; order via group/forwarded message → manual ref entry.
- **Audit:** order.draft_created with channel=whatsapp + message ref. **Success:** 100% of WhatsApp orders carry message reference; transcription error rate measured via review returns (target: falling).

### WF-03 — Draft Order Review — MVP
- **Trigger:** Order enters PENDING_REVIEW. **Actors:** Operations Manager (approver), Order Agent (observer).
- **Pre-conditions:** Mandatory fields complete; price computed.
- **Steps:** 1) Queue ordered by SLA timer + delivery-start proximity. 2) Reviewer opens order: customer panel (profile, history, allergy flags), item panel (catalog validation), logistics panel (slot capacity, area), payment panel (expected method). 3) System displays hard warnings: allergy conflict (BR-039), duplicate active plan, slot overcapacity. 4) Reviewer chooses → WF-04 / WF-05 / WF-06.
- **Data:** ReviewQueueItem timestamps. **Status:** stays PENDING_REVIEW until decision. **Notifications:** SLA breach alert to Ops Manager.
- **Exceptions:** reviewer = creator [NC — allow with audit, or block? RBAC open question]. **Audit:** review.opened (lightweight). **Success:** median review time tracked; zero orders bypass queue (hard rule, GAP-OM-01).

### WF-04 — Order Approval — MVP
- **Trigger:** Reviewer approves. **Actors:** Operations Manager.
- **Pre-conditions:** No unresolved hard warnings (allergy conflict requires explicit override + reason).
- **Steps:** 1) System validates transition PENDING_REVIEW→APPROVED (role + validation). 2) Generates PlanCalendar + FulfillmentDays (SCHEDULED) honoring off-days (BR-036). 3) Applies payment gate per Settings (DEC-009 [NC], default: warn-only). 4) Emits order.approved; ACTIVE on start date.
- **Data:** Order, FulfillmentDays, OrderStatusHistory. **Status:** PENDING_REVIEW → APPROVED (→ ACTIVE by schedule).
- **Notifications:** Customer confirmation (BR-035 — future channel); internal: kitchen visibility on day-list. **Exceptions:** calendar generation failure (invalid dates) → back to review with error.
- **Audit:** order.approved (decision, warnings overridden, reason). **Success:** every ACTIVE order has full FulfillmentDay calendar; approval decision + overrides reconstructable from audit alone.

### WF-05 — Order Rejection — MVP
- **Trigger:** Reviewer rejects. **Actors:** Operations Manager.
- **Steps:** 1) Mandatory reason code + free-text. 2) PENDING_REVIEW → REJECTED (terminal). 3) Creating agent notified with reason. 4) "Clone to new draft" available (carries data, new identity, link to rejected original).
- **Data:** ReviewDecision(reject). **Status:** → REJECTED. **Notifications:** agent in-app. **Exceptions:** —. **Audit:** order.rejected. **Success:** rejection reasons aggregable (feeds intake training, M15 report).

### WF-06 — Order Edit Before Approval — MVP
- **Trigger:** Reviewer returns order, or agent recalls own submission. **Actors:** Operations Manager (return), Order Agent (recall, edit).
- **Pre-conditions:** Order in PENDING_REVIEW.
- **Steps:** 1) Return/recall moves PENDING_REVIEW → DRAFT with return-reason. 2) Agent edits; all field changes diffed. 3) Resubmit → PENDING_REVIEW (review restarts, SLA timer resets).
- **Data:** DraftOrder revision. **Status:** PENDING_REVIEW ⇄ DRAFT. **Notifications:** agent notified of return. **Exceptions:** edit after approval is NOT this workflow → WF-15. **Audit:** order.edited (field-level before/after). **Success:** zero silent post-submission edits.

### WF-07 — Kitchen Routing (ticket generation) — MVP
- **Trigger:** Kitchen cutoff time reached for date D [NC cutoff — Settings]. **Actors:** System; Kitchen User views.
- **Pre-conditions:** FulfillmentDays SCHEDULED for D; RoutingRules present.
- **Steps:** 1) For each FulfillmentDay: expand items/components → map to sections via RoutingRules (BR-009/010). 2) Create KitchenTickets per section, grouped by item type. 3) FulfillmentDay → KITCHEN_QUEUED. 4) Allergy-flagged meals carry a visible warning marker on the ticket (BR-039). 5) Day board renders per section.
- **Data:** KitchenTickets. **Status:** SCHEDULED → KITCHEN_QUEUED. **Notifications:** kitchen day-list ready (M11).
- **Exceptions (WF-07-E):** item with no routing rule → ticket to "Unrouted" queue + alert to Kitchen Manager + catalog fix task — **never silently dropped**. **Audit:** kitchen.ticket_generated (count per day per section). **Success:** 100% of day-D items on tickets; unrouted queue empty by end of pilot.

### WF-08 — Order Preparation — MVP
- **Trigger:** Kitchen staff start work. **Actors:** Kitchen User (MVP shared board; per-chef later, BR-013).
- **Steps:** 1) Section ticket: QUEUED → IN_PROGRESS (first tap moves FulfillmentDay → IN_PREPARATION). 2) Shortage/issue → ticket BLOCKED with reason → escalation (BR-015) to Kitchen Manager + Ops (WF-14 feed). 3) Done → PREPARED. 4) Last section ticket PREPARED → FulfillmentDay READY_TO_PACK (system rollup). 5) MVP packing step: Kitchen User confirms box complete → PACKED [packing checklist module post-MVP, DEC-007].
- **Data:** TicketStatusEvents. **Status:** ticket machine + fulfillment rollups. **Notifications:** READY_TO_PACK alert; blocked-ticket alert.
- **Exceptions:** substitution needed → escalation with proposed substitute; Ops approves (allergy-checked). **Audit:** fulfillment.status_changed per transition (actor = badge/login [NC shared-device login model — workshop S4]). **Success:** single-section blocking visible in real time (closes pain point 7).

### WF-09 — Driver Assignment — migration Phase 4
- **Trigger:** FulfillmentDays PACKED for delivery window. **Actors:** Fleet Supervisor; system suggests.
- **Pre-conditions:** DEC-008 rules configured; drivers with availability (M10).
- **Steps:** 1) Dispatch board lists PACKED by area/slot. 2) System suggests assignment per area/slot/capacity rules — **suggestion only, human confirms** (replaces legacy unsafe auto-assign [V], ADR guardrail). 3) Confirm → DriverAssignment + manifest; FulfillmentDay → ASSIGNED_TO_DRIVER. 4) Driver notified (app).
- **Data:** DriverAssignment, Manifest. **Status:** PACKED → ASSIGNED_TO_DRIVER. **Notifications:** driver push; over-capacity warning blocks confirm (override = Ops Manager + audit).
- **Exceptions:** no eligible driver → exception case to Ops (WF-14 feed); unassign returns to PACKED. **Audit:** dispatch.assigned / dispatch.reassigned (suggested-vs-chosen recorded — feeds ENH-F-08 later). **Success:** zero unsanctioned auto-mutations; capacity violations require explicit override.

### WF-10 — Out for Delivery — migration Phase 4
- **Trigger:** Driver departs. **Actors:** Driver (app).
- **Steps:** 1) Driver marks manifest departed → each FulfillmentDay OUT_FOR_DELIVERY. 2) Customer notified (BR-035, channel per DEC-002 [NC]). 3) Stop list with address/notes/contact rules (BR-023).
- **Status:** ASSIGNED_TO_DRIVER → OUT_FOR_DELIVERY. **Exceptions:** departure without all boxes scanned/confirmed → warning [NC scan capability, DEC-007]. **Audit:** fulfillment.status_changed. **Success:** dispatch-to-departure time measurable.

### WF-11 — Delivered — migration Phase 4
- **Trigger:** Handover at customer. **Actors:** Driver; Fleet Supervisor (override).
- **Steps:** 1) Driver marks DELIVERED (+optional proof [NC]) — or FAILED with mandatory reason code (BR-024). 2) DELIVERED → customer notification; plan completion check (all days terminal → Order COMPLETED, closes GAP-OM-02). 3) FAILED → exception to dispatcher → WF-14/reschedule path (RESCHEDULED day created, linked).
- **Status:** OUT_FOR_DELIVERY → DELIVERED | FAILED (→ RESCHEDULED). **Audit:** fulfillment.status_changed; dispatch.reassigned if rescheduled. **Success:** ≥95% of deliveries carry driver-recorded terminal status (roadmap criterion).

### WF-12 — Cancellation — MVP
- **Trigger:** Customer request (via agent) or business decision. **Actors:** Order Agent (request), Operations Manager (execute).
- **Pre-conditions:** Order not COMPLETED; reason code.
- **Steps:** 1) Agent files cancellation request (scope: whole plan or specific days). 2) Ops Manager reviews: same-day days already KITCHEN_QUEUED+ require explicit acknowledgment (food in production). 3) Execute: Order → CANCELLED; future FulfillmentDays → CANCELLED_DAY atomically (BR-037). 4) Refund decision recorded per DEC-009 [NC — refunds may not exist, workshop Q20]; if applicable → WF-13.
- **Data:** Exception/cancellation record; refund request. **Notifications:** customer confirmation; kitchen alert for same-day. **Audit:** order.cancelled (scope, reason, refund decision). **Success:** zero cancelled-but-cooked boxes after cutoff alerting works.

### WF-13 — Failed Payment / Refund — MVP-lite (refund path post-workshop)
- **Trigger:** Payment FAILED, or refund request from WF-12/WF-14. **Actors:** Finance (Finance role via M07 queue), Operations Manager (request).
- **Steps (failed payment):** 1) payment.status_changed=FAILED → order flagged; payment gate per Settings decides whether fulfillment continues [NC DEC-009]. 2) Agent re-sends link / arranges alternative; finance confirms PAID via review queue — never auto in MVP.
- **Steps (refund — only if workshop confirms refunds exist):** 1) Ops files REFUND_REQUESTED with reason + amount. 2) Finance approves/declines in queue. 3) Approved → REFUNDED recorded (execution via gateway is outside MVP [NC gateway access]; system records evidence ref).
- **Data:** PaymentRecord, PaymentReviewItems. **Notifications:** finance queue alert; customer notification on refund decision [future]. **Audit:** payment.status_changed, payment.refund_requested, payment.refunded — all with before/after + actor (closes GAP-AUD-02). **Success:** every payment status change attributable to a person with evidence.

### WF-14 — Customer Complaint — MVP-lite
- **Trigger:** Complaint via WhatsApp/phone (wrong box, late, quality, missing item). **Actors:** Support Agent / Order Agent; Ops Manager (resolution authority).
- **Steps:** 1) Agent creates Exception case linked to Customer + Order + FulfillmentDay (closes "support disconnected from orders" — Support journey [I]). 2) Categorize (mandatory taxonomy: wrong-item / missing-item / late / quality / allergy-incident / payment / other). 3) **Allergy-incident auto-escalates to Ops Manager immediately** (health risk). 4) Resolution action: apology / redelivery (creates RESCHEDULED-type day) / credit-refund request (→ WF-13) — all recorded. 5) Close with resolution code.
- **Data:** Exception(case). **Notifications:** escalation alerts; customer resolution message [future channel]. **Audit:** exception lifecycle events. **Success:** complaint-to-resolution time measurable; allergy incidents have a named accountable resolver.

### WF-15 — Admin Correction (post-approval change) — MVP
- **Trigger:** Change request after APPROVED/ACTIVE (address, slot, items, dates, pause) — today done as silent edits [A]. **Actors:** Order Agent (request), Operations Manager (apply; minor-change auto-apply rules [NC]).
- **Steps:** 1) Agent files ChangeRequest with diff. 2) System computes impact: affected FulfillmentDays, kitchen cutoff conflicts, price delta. 3) Ops approves → atomic apply + cascade (BR-037): future days regenerated, KITCHEN_QUEUED+ days require explicit same-day acknowledgment. 4) Price delta → payment adjustment record (→ WF-13 if refund/extra charge [NC]).
- **Data:** ChangeRequest, regenerated FulfillmentDays. **Notifications:** kitchen alert on same-day changes; customer confirmation [future]. **Audit:** order.edited with field-level before/after + impact summary — **no un-audited mutation of an approved order, ever**. **Success:** zero divergence between plan calendar and kitchen day-lists after changes (pain points 12–13).

### WF-16 — Audit Event Recording (cross-cutting) — MVP
- **Trigger:** Every state-changing action in WF-01…15 + logins + settings/permission changes + sensitive reads.
- **Actors:** System (M14); all roles generate events.
- **Steps:** 1) Acting module composes AuditEvent (schema in `audit_architecture.md`: actor, action, entity refs, before/after, timestamp, source). 2) Written in the same transaction as the business change (guardrail 7) — business write fails if audit write fails. 3) Sensitive reads (PII/HEALTH/PAYMENT views, exports) logged async-tolerant (read must not block on audit outage — queued, alarmed). 4) Query UI restricted (Super Admin, Ops Manager read; no delete for anyone — immutable).
- **Exceptions:** audit store degradation → system enters restricted mode for write operations [Proposed — confirm tolerance with business]. **Success:** any order's full history reconstructable from audit alone; spot-check drill passes at MVP acceptance (closes GAP-AUD-01).

---

## Workflow → module → status traceability

| WF | Modules | Statuses touched | Gaps closed |
|---|---|---|---|
| 01/02 | M01, M04, M17 | →DRAFT→PENDING_REVIEW | GAP-AUT-01, DQ-01/03 |
| 03–06 | M02, M03 | PENDING_REVIEW⇄DRAFT→APPROVED/REJECTED | GAP-OM-01 |
| 07/08 | M08, M03, M16 | SCHEDULED→…→PACKED | GAP-OPS-01/02/05 |
| 09–11 | M09, M10, M03 | PACKED→…→DELIVERED/FAILED | GAP-DEL-01/02/03, OM-02 |
| 12/15 | M03, M02 | →CANCELLED; change cascades | GAP-OM-03 |
| 13 | M07 | payment machine | GAP-AUD-02 |
| 14 | M03(Exception), M11 | — | GAP-OM-04, CX-05 |
| 16 | M14 (all) | all | GAP-AUD-01/03 |
