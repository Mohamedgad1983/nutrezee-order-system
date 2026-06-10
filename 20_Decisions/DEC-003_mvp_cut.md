# DEC-003 — MVP Cut
Status: **SIGNED — 2026-06-10** · Owner/Sponsor: Project Sponsor · Recorded via sponsor instruction of 2026-06-10 (this repository's decision log; not workshop minutes)

Decision: The MVP scope defined in `13_Architecture/mvp_architecture_cut.md` (recommendation ADR-009)
is signed as the Release-1 contract for Phase 5 build execution, WP-01 onward.

Scope signed (summary — the cut document is authoritative):
- IN: foundation (M13 RBAC, M14 audit, M16 settings, M12 staff), customers + dedup + import
  (M04/M19), catalog mirror with routing metadata (M05), intake + review + order lifecycle
  (M01/M02/M03, M17 manual mode), kitchen thin slice (M08), payment record-only (M07),
  internal notifications (M11-lite), 3 reports (M15-lite), P1 bridge (M18).
- OUT, with documented return phases (cut §2): dispatch/driver app, labels/packing,
  WhatsApp Business API, gateway/refunds, chef personal app, customer notifications,
  analytics suite, AI features, cart/checkout.
- MVP success criteria = cut §7, verbatim — the acceptance contract for WP-14.

Consequences: the codex sequence stop-rules and the dormant-module prohibition are now
contractual; any scope addition or removal requires a sponsor amendment to this decision.

Cross-references: ADR-009 (Proposed → realized by this signature), DEC-011 (stack),
gate ② of `19_Roadmap/phase_5_master_prompt.md` STEP 0 — satisfied by this file.
