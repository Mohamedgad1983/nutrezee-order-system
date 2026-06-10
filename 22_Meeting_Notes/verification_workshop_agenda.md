# Verification Workshop — Agenda (Phase 0 gate)

**Purpose:** Convert Assumed-grade discovery findings into confirmed facts; collect answers required by DEC-002…010. Use `../nutrezee-step-1-discovery/docs/01_discovery/meeting_notes/meeting_template.md` for minutes.
**Attendees needed:** Owner/sponsor, operations manager, intake/customer-service lead, kitchen manager, one chef, packing lead, dispatcher, one driver, finance, dietician, anyone with old-system vendor contact.
**Format:** Half-day plenary (sessions 1–2), then 45-min department breakouts (sessions 3–8).

## Session 1 — Scope & surfaces (plenary)
1. Are there customer-facing website/app ordering screens beyond the admin dashboard? Driver, kitchen, chef, packing, or finance screens we haven't seen?
2. Which of the 50 old dashboard modules are mandatory for first release? Which are no longer used (video modules, birthday orders)?
3. Which spreadsheets, WhatsApp groups, paper forms, or other manual logs run the operation today?
4. Who owns/maintains the old system? Can we get source, schema, staging, vendor contact? (drives DEC-001)

## Session 2 — Order lifecycle (plenary) → DEC-005
5. Walk one real order end-to-end: WhatsApp message → delivery. Capture every step, actor, tool, and failure mode.
6. Full state machine: what states exist after "active"? Is there delivered/completed? What triggers pause/expire/cancel and what are the side effects?
7. Payment confirmation: required before kitchen starts, or after packing? (→ DEC-009)

## Session 3 — Intake & customers → DEC-002, DEC-004
8. Required fields per WhatsApp order and order type; current message patterns (collect anonymized samples).
9. WhatsApp Business API account status; appetite for API vs manual-assisted phase.
10. Customer identity: is phone number the reliable key? Multiple numbers per family? Address habits.

## Session 4 — Kitchen → DEC-006
11. Exact list of kitchen sections; chefs per section; shift pattern; can chefs cross sections?
12. Which menu items/components route to which sections? Multi-section meals?
13. Task statuses chefs would actually use; current shortage/substitution handling.

## Session 5 — Packing & labels → DEC-007
14. Is packing a separate team? Current packing procedure and error types.
15. Exact label fields; printer model(s), label size; print trigger (confirmation / kitchen-ready / packing / dispatch); reprint rules; QR/barcode appetite.

## Session 6 — Dispatch & drivers → DEC-008
16. How are delivery areas defined (geography vs customer segment)? Slot structure.
17. Driver capacity unit (orders/boxes/weight/route time); current assignment heuristics; override needs.
18. Delivery statuses and failed-delivery reasons that matter; is route optimization needed at launch?

## Session 7 — Finance → DEC-009
19. Payment methods in real use (gateway/link/cash/transfer) and their shares.
20. Do refunds/credits exist today? Process? Reconciliation practice against gateway?

## Session 8 — Management, nutrition, privacy → DEC-010, RBAC inputs
21. Day-one KPIs management will actually use; current report consumers of the 5 legacy reports.
22. Mandatory nutrition fields (internal vs customer-facing); allergen handling expectations; who may see customer health/payment data (seed the 10-role RBAC matrix); which actions must be audit-logged; is ingredient inventory needed in release 1 (BR-040)?

## Outputs checklist
- [ ] Minutes per session in this folder (template-based)
- [ ] DEC-002/004/005/006/007/008/009/010 drafted in `20_Decisions/`
- [ ] Requirements backlog statuses updated (21 "Needs Confirmation" items resolved)
- [ ] New/changed pain points appended to backlog
- [ ] Access commitments with named owners and dates → `01_Discovery/` access tracker
