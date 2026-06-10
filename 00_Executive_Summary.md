# Nutrezee Order System — Executive Summary

**Document type:** Phase 8 deliverable — consolidation of completed discovery
**Date:** 2026-06-10
**Status:** Baseline v1.0 — for stakeholder review
**Source of evidence:** `nutrezee-step-1-discovery/` (Steps 0–2C + Phase 3 module analysis, completed 2026-06-09)
**Strategic direction:** Improve and extend the existing operation — not a big-bang replacement. The existing admin dashboard, workflows, staff, and delivery process are treated as the running baseline to be enhanced incrementally.

---

## 1. Current State Summary

Nutrezee is a live healthy-food meal-plan subscription business operating on a production admin dashboard (`https://nutreeze.com/dashboard`). Discovery confirmed **46 of 50 admin routes** with full screen inventories; 4 routes are unstable (timeouts) and 1 was skipped as unsafe (an action-like GET that appears to auto-assign drivers).

What runs today, verified:

- Customer/driver/admin/dietitian user management; product, package, and subscription catalogs.
- Order lifecycle lists (pending, active, pause, expired, canceled) with payment status and transaction metadata.
- Staff-assisted order creation at `/orders/create` including payment-link generation.
- Healthy-food masters: ingredients, allergies, meal types, diet status, tags; dietician requests.
- Delivery slots/methods, driver records, coupons/cashback/offers, content/notifications.
- Finance reports: monthly sales, daily sales, sales by payment method, customer revenue, expirations.

What runs today **outside** the system (manual): WhatsApp order intake (copy/paste into admin forms), kitchen section coordination, chef assignment, box-label printing, packing verification, driver assignment, and management KPI compilation.

What was **not** discoverable: source code, framework, database schema, API contracts, the customer app/website, the driver app, any kitchen/chef app, payment gateway internals, RBAC configuration, audit logs, staging environment.

## 2. Major Gaps

| # | Gap | Severity |
|---|-----|----------|
| 1 | No RBAC or audit logs — authenticated admin sees all customer PII, payment, and health data ungated | Critical |
| 2 | WhatsApp orders manually transcribed — the single largest source of errors, delays, and duplicate data | Critical |
| 3 | No kitchen execution layer — no section routing, chef tasks, or production board | Critical |
| 4 | No staging environment, no source/schema access — blocks safe change of any kind | Critical |
| 5 | Manual labels and packing — no checklist, no traceability from kitchen to box to driver | High |
| 6 | Manual driver dispatch — no capacity rules, no driver app, unstable driver-orders route | High |
| 7 | Payment confirmation route unstable; no refund/reconciliation workflow visible | High |
| 8 | Order state machine incomplete — no delivered/completed state observed | High |
| 9 | No structured nutrition data (calories/macros) or allergen-safety enforcement | High |
| 10 | Production security hygiene: mutating GET route, leaked SQL/framework exceptions, no visible logout | High |
| 11 | Analytics gaps — no kitchen throughput, chef productivity, or delivery performance KPIs | Medium |
| 12 | Notifications lack templates, approval, and delivery history | Medium |

Full register: `03_Gap_Analysis/gap_analysis.md` (52 gaps across 14 dimensions).

## 3. Top Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Discovery repo exists only on one machine (no git remote) | Certain today | Total loss of project knowledge | Push to private remote immediately |
| R2 | Source/staging access never granted → "extend" strategy impossible to validate | Medium | Forces rebuild-adjacent path; timeline slip | Make access a Phase 0 gate; decide DEC-001 |
| R3 | Requirements unvalidated by operations staff (single-day, desk-based discovery) | High | Building the wrong workflows | Verification workshop before any modeling |
| R4 | Production incident from existing unsafe surfaces (mutating GET, leaked exceptions) | Medium | Data corruption, breach exposure | Quick-win remediation with owner of old system |
| R5 | Scope overload — 34 of 44 requirements marked P0, 51 catalog modules | High | Nothing ships | Force an MVP cut (DEC-003) |
| R6 | Privacy/health-data exposure during transition (no RBAC in old system) | Medium | Regulatory and trust damage | RBAC + audit in earliest build phase |
| R7 | WhatsApp Business API feasibility unknown (account status, costs, templates) | Medium | Flagship automation blocked | Spike in Phase 0; phased manual-assisted fallback |
| R8 | Kitchen/dispatch rules undocumented (sections, capacity units, areas) | High | Automation built on wrong rules | Stakeholder interviews are a Phase 1 entry gate |

Full register: `21_Risks/` (to be maintained as living document).

## 4. Highest-Value Enhancements

1. **Structured WhatsApp intake + draft-order review queue** (BR-001–005) — attacks the #1 pain point; removes transcription errors at the source.
2. **Customer profile with phone matching and address book** (BR-006–007) — eliminates duplicate customer records; prerequisite for intake automation.
3. **RBAC + audit logs** (BR-032, BR-033, BR-043) — converts a critical compliance exposure into a foundation every other module reuses.
4. **Kitchen section routing + chef task app** (BR-009–015) — turns confirmed orders into accountable production work; unlocks labels and packing.
5. **Automated label generation + packing checklist** (BR-016–019) — traceability from kitchen to box; large error reduction for small build cost once kitchen tasks exist.
6. **Dispatch board + driver app** (BR-020–024) — replaces the unsafe auto-assign route and manual driver coordination.
7. **Payment review queue** (BR-029–030) — replaces the unstable confirm-payment screen with a controlled, audited workflow.
8. **Management analytics** (BR-025–028) — daily visibility for management; mostly derived data once the above emit events.

## 5. Recommended Priorities

1. **Now (Week 1):** Secure the repo (remote backup); request the 12 access items; schedule the verification workshop; remediate production quick wins with the old-system owner.
2. **Phase 0 gate:** Access granted + workshop answers to the 22 open questions + DEC-001 (extend vs. strangler-rebuild) decided.
3. **Build order:** Security/identity foundation → customer/catalog data quality → order intake → kitchen/packing → dispatch/delivery → payments/analytics → AI features.
4. **Defer:** Inventory dependency (BR-040), freshness windows (BR-041), route optimization, customer-facing redesign — until core operational chain is live.

## 6. Suggested Development Sequence

```
Phase 0  Foundation        → access, staging, CI/CD, auth, RBAC, audit, env hygiene
Phase 1  Critical Fixes    → security remediation, customer dedup, order state machine, payment review
Phase 2  Operational Impr. → structured intake + review queue, catalog enrichment (routing + nutrition)
Phase 3  Automation        → kitchen tasks + chef app, labels + packing, dispatch board + driver app
Phase 4  Advanced Features → analytics suite, notifications center, exceptions, refunds/wallet
Phase 5  AI Features       → WhatsApp NLP intake assist, demand forecasting, dispatch optimization, nutrition copilots
```

Each phase has entry/exit gates — see `19_Roadmap/implementation_roadmap.md`.

## 7. Architecture Considerations

- **Strangler-fig over big-bang.** The mandate is to extend a running operation. New modules should go live beside the old dashboard, take over one workflow at a time (intake first), and retire old screens only when their replacement is proven. The Step 2A "from scratch" decision is superseded by this mandate — recorded as DEC-001.
- **The old system is a functional blueprint, not a technical one.** Module coverage (50 screens) is the regression checklist; its UI, schema, and security model must not be copied.
- **Event-backbone early.** Kitchen tasks, labels, dispatch, analytics, and audit all consume order events. Defining the order/payment/delivery event model in Phase 0–1 prevents rework in Phases 3–4.
- **Identity and RBAC first.** Ten distinct roles (BR-032) touch the system; least-privilege and field-level privacy (BR-043) are cheaper built-in than retrofitted.
- **Mobile-lite for chefs and drivers.** Chef task app and driver app can ship as responsive PWAs before native apps; both are status-driven, low-bandwidth surfaces.
- **Integration surface is wide:** WhatsApp Business API, payment gateway, label printers, maps/geocoding, push/SMS/email. Isolate each behind an adapter from day one (`14_Integrations/`).
- **Unknowns to resolve before final architecture:** old stack and schema (access pending), customer app existence/shape, gateway capabilities, printer hardware.

## 8. Key Decisions Required

| ID | Decision | Options | Owner | Needed by |
|----|----------|---------|-------|-----------|
| DEC-001 | Build strategy | Extend old codebase (needs source access) vs. strangler-fig new services beside old dashboard vs. full rebuild | Sponsor + Tech Lead | End of Phase 0 |
| DEC-002 | WhatsApp intake approach | Business API automation vs. manual-assisted structured entry vs. phased (manual → API) | Sponsor + Ops | Phase 0 workshop |
| DEC-003 | MVP cut | Which of the 34 P0 requirements ship in first release | Sponsor + PM | Before Phase 1 build |
| DEC-004 | Customer identity source of truth | Phone vs. account vs. WhatsApp ID | Ops + Tech Lead | Phase 1 |
| DEC-005 | Order state machine | Full lifecycle incl. delivered/completed, transition rules, side effects | Ops + PM | Phase 1 |
| DEC-006 | Kitchen model | Section list, item→section routing, chef shift rules | Kitchen Manager | Phase 2 entry |
| DEC-007 | Label spec | Fields, printer hardware, size, QR/barcode, trigger point | Packing + Ops | Phase 3 entry |
| DEC-008 | Dispatch model | Area definitions, capacity unit (orders/boxes/weight/time), override rules | Dispatch + Ops | Phase 3 entry |
| DEC-009 | Payment & refund rules | Methods, confirmation timing vs. kitchen start, refund/credit policy | Finance | Phase 1 |
| DEC-010 | Day-one KPIs | P0 management analytics set | Management | Phase 4 entry |
| DEC-011 | Hosting & stack | Platform, language/framework, database for new modules | Tech Lead | End of Phase 0 |
| DEC-012 | Data migration approach | What old data migrates, when, and how it's validated | Tech Lead + Ops | Phase 1 |

Decision log lives in `20_Decisions/` — one file per decision, with context, options, choice, and consequences.
