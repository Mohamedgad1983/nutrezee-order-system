# DEC-011 — Stack & Hosting
Status: **SIGNED — 2026-06-10** (sponsor approval; recommendation of 2026-06-10 applied verbatim) · Owner: Tech Lead + Sponsor

Context: Phase 4 designed the physical schema PostgreSQL-as-Proposed and left the
application layer open. Build is executed via AI-assisted work packages (WP-01..14);
future maintenance team unconfirmed [NC]. Three options compared (NestJS/TS,
Django/Python, Laravel/PHP) — analysis of 2026-06-10.

Decision: TypeScript end-to-end. NestJS modular monolith (modules = M01–M19,
lint-enforced boundaries); PostgreSQL 16 managed (confirms Phase 4 posture; region
pending data-residency check [NC]); SQL-first migrations in physical-schema wave
order; thin SQL-centric query layer; React/Vite admin SPA + kitchen-board PWA
(EN/AR, RTL-ready); server-side sessions (session table, httpOnly cookies,
argon2id) — no JWTs; container deployment with staging + production environments;
GitHub Actions CI/CD with the Phase 4 test suites as gates and manual prod promotion.

Options considered: (A) NestJS/TS — chosen: best fit to foundation-blueprint
enforcement points, one language across API/SPA/PWAs/import tooling, top AI-codegen
support. (B) Django/DRF — strongest built-in i18n and transactions, but two-language
stack and Django Admin accelerates only secondary surfaces. (C) Laravel/Filament —
fastest back-office CRUD and likely legacy-talent overlap [I], but weakest fit for
the custom SPA surfaces that dominate the MVP.

Consequences: WP-01 scaffolds Nest + SQL migrations + CI gates; module_api_contracts
become shared TS types; 16_Deployment owns environment/secrets/rollback standards.
*(Status note 2026-06-10: the repo/CI skeleton portion of this consequence is executed
by WP-00 per amendment A5 — phase_5_master_prompt.md; WP-01 retains the real CI-guard
implementations, SQL migrations, and deployment-standard content.)*

Reversal condition: if the sponsor confirms a PHP-centric maintenance team before
WP-01 starts, re-decide toward Option C; after WP-01, switching cost escalates.

Risks: transaction discipline (mitigated by TS-I CI gates), in-process outbox lag
(gauged, upgradeable), residency region [NC], ORM-vs-trigger friction (avoided via
SQL-first migrations).
