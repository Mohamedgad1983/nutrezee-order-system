# Assumption Register

**Date opened:** 2026-06-10
**Status:** Active build-control register
**Authority:** Sponsor/user directive in this thread: continue WP execution as far as technically possible using explicit, traceable assumptions. This register does not close any OPEN DEC item; it records Assumed-for-build values that remain sponsor-review-required and reversible.

## Operating rule

1. Any missing business decision that would previously block a WP is captured here as an explicit assumption.
2. Active assumptions are allowed for implementation until replaced by a signed decision or register amendment.
3. Every assumption is sponsor-review-required.
4. Implementation must keep assumptions config-driven where the Phase 1-4 architecture says values are workshop-owned.
5. If a later signed decision contradicts an assumption, update this register, log the impact in `19_Roadmap/build_progress_register.md`, and implement the smallest corrective migration/code change in the owning WP/fix branch.
6. Assumptions do not permit forbidden scope: no dormant dispatch/driver app, cart/checkout, refunds, WhatsApp webhook, customer notifications, labels/packing module, production write-back, or real legacy apply without required access/export.

Risk scale:
- **Critical:** wrong assumption can block pilot, require data migration, or violate MVP boundary/security/privacy.
- **High:** wrong assumption can require workflow/schema/API/test changes before pilot.
- **Medium:** wrong assumption can be changed mostly through settings, seed data, UI labels, or validation rules.
- **Low:** wrong assumption has limited technical blast radius.

## Active assumptions

| ID | Missing business decision | Assumption-for-build | Risk | Sponsor-review-required | Applies to | Revision hook |
|---|---|---|---|---|---|---|
| ASM-001 | WP-07+ unresolved business questions | Build may continue using active assumptions in this register; unresolved questions move to sponsor review instead of blocking unless implementation becomes technically impossible or forbidden scope is reached. | High | Yes | WP-07 to WP-13 | Replace with signed DEC/workshop minutes. |
| ASM-002 | DEC-001 build strategy final wording | Strangler-fig beside legacy remains the active implementation strategy; old system stays read-only until explicit cutover. | Medium | Yes | All WPs | DEC-001 or cutover note. |
| ASM-003 | DEC-002 WhatsApp approach | WP-07 implements manual-assisted WhatsApp reference capture only. No webhook/API, no automated sending, and no raw chat-content table. | High | Yes | WP-07, WP-12 future comms | DEC-002. |
| ASM-004 | WhatsApp reference fields | For channel `whatsapp`, draft submit requires sender phone and message timestamp; optional ref note is allowed. | High | Yes | WP-07 | DEC-002 / intake signoff. |
| ASM-005 | Mandatory WP-07 submit field set | Draft submit requires customer matched or unverified-justified, channel, WhatsApp ref when channel is WhatsApp, at least one package or item, start/delivery date, address, area, delivery slot/time, delivery method, expected payment method, and authenticated staff actor. | High | Yes | WP-07 | Replace through `setting`/completeness config. |
| ASM-006 | Draft-save vs submit-block behavior | Open drafts may save with missing P0 fields. Invalid supplied phone, invalid supplied address, invalid date order, and negative money values block save. WhatsApp ref blocks submit, not save. | High | Yes | WP-07 | Completeness engine config/test update. |
| ASM-007 | DEC-004 customer identity key | Normalized phone is the first matching key for intake; customer ID remains the internal primary identity. | High | Yes | WP-07, WP-13 | DEC-004. |
| ASM-008 | Multiple phones and family-shared numbers | One customer may have multiple phones. Duplicate normalized phones across customers are allowed only as soft conflicts and merge-review candidates, not hard DB uniqueness. | High | Yes | WP-04, WP-07, WP-13 | DEC-004 / import QA. |
| ASM-009 | Exact and fuzzy duplicate behavior | Exact normalized-phone match blocks creating a new customer and links staff to the existing record. Fuzzy match warns and requires confirmation. OA cannot force duplicates; OM can create/merge with reason. | High | Yes | WP-07, WP-13 | DEC-004. |
| ASM-010 | Allergy capture requirement | Allergy notes are not mandatory for draft submit. Existing customer allergy profile drives conflict checks. Blank allergy means unknown, not "no allergy." | High | Yes | WP-07, WP-08, WP-10 | Nutrition/privacy review. |
| ASM-011 | Allergy severity scale | Use `note`, `avoid`, `severe` as the configurable severity scale until sponsor replaces it. | Medium | Yes | WP-07, WP-08, WP-10 | Settings/seed update. |
| ASM-012 | Allergy conflict handling | Intake shows computed allergy conflicts as warnings. Review approval requires conflicts resolved or OM override with reason; overrides are HIGH audit. | High | Yes | WP-07, WP-08, WP-10 | Nutrition/privacy review. |
| ASM-013 | Package/subscription capture in WP-07 | WP-07 captures package/sub-package/package-for where data exists, but subscription calendar generation and active-order creation wait for WP-09. | High | Yes | WP-07, WP-09 | Package rule review. |
| ASM-014 | Item quantity | Draft item quantity defaults to 1 when staff adds a single item/package line and must remain positive. | Medium | Yes | WP-07 | Intake signoff. |
| ASM-015 | Date capture | Start/delivery date is required for submit. End date is optional in WP-07 and may be derived later from package duration in WP-09. No backdated start unless OM override. | High | Yes | WP-07, WP-09 | Package/calendar review. |
| ASM-016 | Delivery fields | Address, area, delivery slot/time, and delivery method are required for submit. Pickup is not a separate mode unless represented by an active delivery method. | High | Yes | WP-07, WP-09 | DEC-008 / intake signoff. |
| ASM-017 | Branch/site behavior | Assume single-site intake for WP-07; branch/site is hidden and nullable until sponsor confirms multi-branch rules. | Medium | Yes | WP-07, WP-09 | Operations settings review. |
| ASM-018 | Slot capacity mode | Slot capacity is warning-only by default. Null capacity means warn, not block. | Medium | Yes | WP-07, WP-09 | DEC-008. |
| ASM-019 | Payment method capture | Expected payment method is required at draft submit. Allowed seed values are configurable; initial values are `online_link`, `cash`, `bank_transfer`, and `card_gateway`. | High | Yes | WP-07, WP-11 | DEC-009. |
| ASM-020 | Unpaid order submit | Unpaid drafts may be submitted to review with warning. Payment confirmation does not block WP-07 submit. | High | Yes | WP-07, WP-09, WP-11 | DEC-009. |
| ASM-021 | Payment link boundary | WP-07 must not generate payment links. It may capture expected payment method and payment notes only. | Medium | Yes | WP-07, WP-11 | DEC-009 / gateway sandbox. |
| ASM-022 | Coupon behavior | Coupon code is optional. Default validation mode is warn; invalid or unknown coupon does not block WP-07 submit. | Medium | Yes | WP-07, WP-11 | Coupon rules review. |
| ASM-023 | Draft and creation states | New draft state is `open`; submit moves to `submitted`; review/approval creates later queue/order states. Old order-created default remains unverified. | Medium | Yes | WP-07, WP-08, WP-09 | DEC-005. |
| ASM-024 | Edit-after-submit | OA cannot edit a submitted draft directly. Submitted drafts must be returned/reopened by OM/review flow with reason before staff correction. | Medium | Yes | WP-07, WP-08 | Review workflow signoff. |
| ASM-025 | Reviewer equals creator | Reviewer=creator is allowed in MVP but logged/audited; stricter separation can be configured later. | Medium | Yes | WP-08 | RBAC/review signoff. |
| ASM-026 | DEC-005 status model finals | Use the proposed status model and `transition_config` seeds as active build values; do not hard-code transitions outside the engine. | High | Yes | WP-09, WP-10, WP-11 | DEC-005. |
| ASM-027 | Kitchen cutoff value | Use configurable `kitchen_cutoff_time`; seed/testing default is 10:00 local business time until sponsor changes it. | High | Yes | WP-09, WP-10 | Operations signoff. |
| ASM-028 | DEC-006 pilot kitchen sections | For technical implementation, seed pilot sections as configurable content: `hot`, `cold`, `bakery`, `prep`, and `unrouted`. Unrouted items remain visible and alerting. | Critical | Yes | WP-10 | DEC-006. |
| ASM-029 | Shared kitchen device model | Kitchen board uses role session plus lightweight actor/name tap on ticket transitions; personal chef app is out of scope. | High | Yes | WP-10 | DEC-006 / RBAC review. |
| ASM-030 | Ticket status flow | Use proposed ticket statuses `queued`, `in_progress`, `prepared`, `blocked`; blocked requires reason. | Medium | Yes | WP-10 | DEC-006. |
| ASM-031 | Payment status values | Use configurable payment statuses from the proposed machine: unpaid, link_sent, paid, failed, cod_pending, collected. Refund statuses remain dormant. | Medium | Yes | WP-11 | DEC-009. |
| ASM-032 | Refunds/credits | Refund and credit workflows stay `not_enabled` in MVP implementation. | Medium | Yes | WP-11 | DEC-009/Q20. |
| ASM-033 | Notification channels | WP-12 implements internal alerts and email-capable logging only. WhatsApp/push/SMS/customer notifications remain dormant. | Medium | Yes | WP-12 | DEC-002/notification review. |
| ASM-034 | Trigger map content | Use proposed trigger-map seeds for aging draft, queue SLA, unrouted items, ticket blocked, ready to pack, payment failed, reconciliation divergent, and dormant-role grant. | Medium | Yes | WP-12 | DEC-010/ops review. |
| ASM-035 | DEC-010 MVP reports | Implement MVP reports only: intake funnel, daily ops, and kitchen day-list. Legacy finance report parity remains later unless sponsor amends MVP cut. | Medium | Yes | WP-12 | DEC-010. |
| ASM-036 | DEC-012 migration posture | Build bridge/import tooling with synthetic fixtures and reviewable dry-runs. Real legacy apply remains technically blocked until sanitized export/source access exists. | High | Yes | WP-13 | DEC-012 / access tracker. |
| ASM-037 | Legacy payment vocab mapping | Unknown legacy payment statuses map to review-needed records rather than failing import. Known statuses map to proposed payment machine values. | High | Yes | WP-13 | DEC-009/DEC-012. |
| ASM-038 | Legacy off-days mapping | Unknown legacy off-day/calendar values import with `off_days_unverified=true` and review notes rather than blocking synthetic tooling. | High | Yes | WP-13 | Package/calendar review. |
| ASM-039 | Labels and packing | Label/packing specs remain out of MVP scope; no WP may create a labels/packing module unless DEC-003 is amended. | Medium | Yes | WP-10, WP-12 future | DEC-007. |
| ASM-040 | Dispatch and drivers | Dispatch/driver app remains dormant/out of scope. Delivery fields may be captured, but assignment execution is not built in WP-07 through WP-12. | Medium | Yes | WP-07 to WP-12 | DEC-008. |
| ASM-041 | Branch and area master content | Area and branch/site content can remain zero-row/configurable in implementation; tests use synthetic seed data only. | Medium | Yes | WP-07, WP-09, WP-13 | Ops settings review. |
| ASM-042 | Staging and pilot gate | Lack of cloud credentials/staging cannot be assumed away. WP-14 remains blocked until staging is provisioned, live, and smoke-tested. | Critical | Yes | WP-14 | Cloud provisioning. |

## Revision log

| Date | Change |
|---|---|
| 2026-06-10 | Initial assumption register created from sponsor/user directive to continue WP execution as far as technically possible. |
