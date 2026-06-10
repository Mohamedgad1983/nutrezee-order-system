# Decision Register

**Status:** Living document · One row per decision; promote to its own `DEC-nnn_*.md` file when context grows. Decisions are made by the named owner and recorded with date + approver. No build work may assume an OPEN decision.

| ID | Decision | Options under consideration | Owner | Needed by | Status |
|---|---|---|---|---|---|
| DEC-001 | Build strategy | (a) Extend old codebase — requires source access · (b) Strangler-fig: new modules beside old dashboard, retire screen-by-screen · (c) Full rebuild | Sponsor + Tech Lead | End Phase 0 | **OPEN** — leaning (b); Step 2A's "from scratch" superseded by extend-and-improve mandate (2026-06-10); (a) feasibility unknown until source access dispositioned |
| DEC-002 | WhatsApp intake approach | Business API automation · manual-assisted structured entry · phased (manual → API) | Sponsor + Ops | Phase 0 workshop | OPEN |
| DEC-003 | MVP cut | DECIDED — see DEC-003_mvp_cut.md (signs `13_Architecture/mvp_architecture_cut.md` / ADR-009 as the Release-1 contract for WP-01+) | Sponsor + PM | Before Phase 1 build | **SIGNED 2026-06-10** |
| DEC-004 | Customer identity source of truth | Phone · account · WhatsApp ID | Ops + Tech Lead | Phase 1 | OPEN |
| DEC-005 | Order state machine | Full lifecycle incl. delivered/completed; transition rules; side effects | Ops + PM | Phase 1 | OPEN |
| DEC-006 | Kitchen model | Section list, item→section routing, chef shift rules | Kitchen Manager | Phase 2 entry (G2) | OPEN |
| DEC-007 | Label specification | Fields, printer hardware, size, QR/barcode, trigger point | Packing + Ops | Phase 3 entry | OPEN |
| DEC-008 | Dispatch model | Area definitions; capacity unit (orders/boxes/weight/route time); override rules | Dispatch + Ops | Phase 3 entry | OPEN |
| DEC-009 | Payment & refund rules | Methods; confirmation timing vs kitchen start; refund/credit policy | Finance | Phase 1 | OPEN |
| DEC-010 | Day-one KPIs | P0 management analytics set | Management | Phase 4 entry (G3) | OPEN |
| DEC-011 | Hosting & stack | DECIDED — see DEC-011_stack_hosting.md | Tech Lead + Sponsor | End Phase 0 | **SIGNED 2026-06-10 — TypeScript/NestJS modular monolith + PostgreSQL (managed) + React/Vite admin & PWAs; SQL-first migrations; server-side sessions; GitHub Actions CI/CD; staging+prod containers. PostgreSQL posture of Phase 4 confirmed unchanged.** |
| DEC-012 | Data migration approach | Scope of old data migrated; timing; validation method | Tech Lead + Ops | Phase 1 | OPEN |
