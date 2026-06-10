# Sponsor Review Package - Unresolved Business Questions

**Date:** 2026-06-10
**Status:** Active sponsor-review package
**Source of active build assumptions:** `ASSUMPTION_REGISTER.md`

This package collects unresolved questions in one place. The build may continue using active assumptions, but every item below remains sponsor-review-required. A signed answer replaces the linked assumption and may trigger a focused change later.

## Review priorities

| Priority | Area | Linked assumptions | Why it matters |
|---|---|---|---|
| P0 | WP-07 intake submit contract | ASM-003 to ASM-024 | Defines what staff can save, submit, warn on, or block during order intake. |
| P0 | Customer identity and duplicates | ASM-007 to ASM-009 | Determines customer matching, duplicate prevention, merge behavior, and import risk. |
| P0 | Allergy/health safety | ASM-010 to ASM-012 | Determines whether unsafe meals are blocked, warned, or overridden. |
| P0 | Payment capture and unpaid policy | ASM-019 to ASM-022, ASM-031 to ASM-032 | Determines payment readiness and finance workflow. |
| P1 | Order status, review, kitchen | ASM-023 to ASM-030 | Determines downstream lifecycle and operational handoffs. |
| P1 | Reports, notifications, migration | ASM-033 to ASM-038 | Determines reporting scope, trigger content, and bridge behavior. |
| P1 | Out-of-scope boundaries | ASM-039 to ASM-042 | Keeps dormant modules and WP-14 staging gate explicit. |

## Questions for sponsor/user

### Intake and WhatsApp

1. Should WP-07 remain manual-assisted for WhatsApp, with no webhook/API and no raw message content storage?
2. For WhatsApp orders, are sender phone and message timestamp enough, or is a message URL/reference/agent note also mandatory?
3. Confirm the draft submit blocker set: customer, channel, WhatsApp ref when WhatsApp, package/item, date, address, area, slot, method, expected payment method, staff actor.
4. Which fields may be missing in an open draft, and which invalid supplied values must block saving?
5. Should staff be allowed to submit an unpaid draft to review?
6. Should invalid coupons warn, block, or be ignored during MVP intake?

### Customer identity

1. Is normalized phone the primary matching key for intake?
2. Can one customer have multiple phones?
3. Can one phone belong to multiple customer records or family accounts?
4. Should exact phone match hard-block new customer creation?
5. Should fuzzy match warn only, or require OM approval?
6. Can staff force-create a duplicate? If yes, which role and reason code?
7. Is OM the correct merge authority?

### Allergy and health

1. Is allergy status required for every new order, every new customer, or only when known?
2. Does blank allergy mean unknown, or no allergy?
3. Are `note`, `avoid`, and `severe` acceptable severity levels?
4. Should allergy conflicts block draft submit, warn at intake, or block only review approval?
5. Who can override an allergy conflict and what reason/evidence is required?
6. Which health fields may OA, OM, kitchen, finance, and reports see?

### Package, date, delivery, and branch

1. Which exact package/sub-package/package-for fields are mandatory in intake?
2. Is quantity needed for package orders, item orders, or both?
3. Is end date captured in intake or derived from package duration later?
4. What are the rules for backdated starts, same-day starts, and off-days?
5. Are address, area, slot, and method all mandatory before submit?
6. Is pickup a separate mode or just a delivery method?
7. Is Nutrezee single-site for MVP, or does order intake need branch selection?
8. Should slot capacity warn, block, or be disabled in MVP?

### Review, order core, and kitchen

1. Can the same user create and review a draft?
2. Can OA edit a submitted draft directly, or only after OM returns/reopens it?
3. Confirm final order status model and whether delivered/completed exists.
4. What is the business kitchen cutoff time?
5. Confirm pilot kitchen sections and item-to-section routing ownership.
6. Is shared tablet with name tap acceptable for kitchen transitions?
7. Confirm ticket statuses and blocked reasons.

### Payment, reports, notifications, migration

1. Confirm payment method values and which are in real use.
2. Does payment need to be confirmed before kitchen production starts?
3. Are refunds/credits excluded from MVP?
4. Are internal/email alerts enough for MVP, with customer WhatsApp/push/SMS dormant?
5. Confirm the day-one report set: intake funnel, daily ops, kitchen day-list.
6. What legacy export/source access will be provided for real bridge/migration apply?
7. How should unknown legacy payment status and off-day values be mapped?

### Boundaries and gates

1. Confirm labels/packing remain out of MVP unless DEC-003 is amended.
2. Confirm dispatch/driver execution remains dormant through WP-12.
3. Confirm no customer cart/checkout or customer notifications in MVP implementation.
4. Provide cloud credentials and target details for staging before WP-14; this remains a hard technical gate.

## Signoff recording rule

When an answer is accepted:

1. Update or append the relevant `ASM-*` row in `ASSUMPTION_REGISTER.md`.
2. If the answer closes a formal decision, record it in the proper `20_Decisions/DEC-*` file/register.
3. Log any implementation impact in `19_Roadmap/build_progress_register.md`.
4. Implement corrections in the owning module branch with tests.
