# Module Analysis: Undiscovered Surfaces And Access Needed

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Admin Dashboard Evidence

| Surface / Evidence | Finding |
| --- | --- |
| Old admin dashboard | Discovered and analyzed as the current business baseline. |
| Customer app | Not discovered. |
| Driver app | Not discovered. |
| Kitchen/Chef app | Not discovered. |
| Packing/label app | Not discovered. |
| Source code | Not available in this worktree. |
| API docs or route/controller map | Not available. |
| Database schema or backup | Not available. |
| Payment sandbox/gateway docs | Not available. |
| Staging environment | Not available. |

## Current Purpose

This document prevents over-claiming. Phase 3 analyzes the old admin dashboard only. It does not prove how customer ordering, driver execution, kitchen/chef tasks, source code, APIs, database, payment gateway, or mobile apps currently work.

## Current Workflow Inferred From Admin Screens

1. Admin users can manage and inspect many back-office modules.
2. Admin order creation and lifecycle lists exist.
3. Driver, pre-kitchen, payment, and notification concepts exist in old admin.
4. Separate apps or APIs may exist, but they were not discovered.
5. Source/database behavior cannot be validated from admin UI alone.

## Data Shown Or Needed

- Shown: old-admin route inventory and screen structures.
- Needed: customer app screens, driver app screens, kitchen/chef screens, mobile app builds, source code, API routes, database schema, payment gateway docs, staging credentials, role/permission configuration.

## Visible Actions

No actions were performed for undiscovered surfaces. No production app, mobile app, API, source, database, or payment sandbox was accessed.

## State-Change Risks

- Assuming app/API/database behavior from admin screens can produce wrong workflows and wrong data models.
- Payment, driver assignment, kitchen status, and customer app behavior are high-risk if inferred without source/staging evidence.
- Mobile app and API discovery may expose credentials, tokens, customer data, or payment data if not done in staging or sanitized environments.

## Current Pain Points

- Customer app not discovered.
- Driver app not discovered.
- Kitchen/Chef app not discovered.
- Label printing not present in old admin.
- Packing checklist not present in old admin.
- RBAC/permissions unclear.
- Audit logs not found.
- Source/API/database not available.
- Payment route unstable.
- Auto assign driver route unsafe.

## Preserve Decisions

- Preserve old-admin evidence as the current business baseline only.
- Preserve module coverage from old admin as a checklist for later app/source/API discovery.

## Improve Decisions

- Improve discovery process by separating confirmed old-admin behavior from assumptions and required access.
- Improve next-phase planning by requiring staging/source/API access before final workflow or architecture decisions.

## Replace Decisions

- Replace assumptions about undiscovered apps with verified evidence from test logins, staging, source, and API docs.
- Replace production-only discovery with staging/sandbox-first discovery.

## Add Decisions

- Add an access checklist before final workflow/data modeling.
- Add a discovery pass for customer app, driver app, kitchen/chef app, source/API/database, and payment sandbox.
- Add a risk register for any module still based on assumptions.

## Automation And AI Opportunities

- Generate route/API inventory from source once available.
- Compare admin dashboard routes to API/mobile routes.
- Generate database entity map from sanitized schema.
- Create permission matrix draft from source routes and UI screens.
- Detect undocumented routes and high-risk actions automatically in staging.

## Required New System Capabilities

- Discovery evidence register.
- Access request tracker.
- Staging-first test plan.
- Source/API/database inventory process.
- Sensitive-data handling rules for future discovery.
- Traceability from each requirement to evidence type.

## Required Data Entities And Fields

- `DiscoverySurface`: name, status, owner, access type, evidence path, risk.
- `AccessRequest`: surface, needed credentials/tooling, requester, status, due date.
- `EvidenceItem`: source, date, module, sensitivity, summary, limitations.
- `Assumption`: module, statement, confidence, risk, validation method.
- `DiscoveryRisk`: impact, likelihood, blocker, mitigation.

## Required APIs High Level Only

- Not applicable to the old system from this phase.
- For the new project process, a discovery/evidence tracker API could track access requests, evidence items, assumptions, and validation status.

## Role And Permission Needs

- Project owner approves access to staging, apps, source, database, and payment sandbox.
- Technical lead reviews source/API/database evidence.
- Product/operations owner validates workflow assumptions.
- Security owner reviews handling of credentials, tokens, customer data, health data, and payment data.

## Reports And KPIs

- Discovery surfaces confirmed vs partial vs inaccessible.
- Open access requests by owner.
- Assumptions by module and risk.
- Requirements lacking evidence.
- High-risk modules blocked by missing access.

## Open Questions For Nutrezee

1. Is there a customer mobile app or web ordering app available for test access?
2. Is there a driver app available for test access?
3. Is there a kitchen/chef app available for test access?
4. Is there a packing or label printing tool outside the old admin dashboard?
5. Can staging access be provided?
6. Can source code and API docs be provided?
7. Can a sanitized database schema be provided?
8. Can payment sandbox and gateway docs be provided?
9. Which discovered old-admin modules are still actively used?

## Assumptions Marked

- Any customer, driver, kitchen, chef, source, API, database, payment-gateway, label, or packing behavior not visible in old admin is not confirmed.
- Future workflow/data modeling must label those areas as assumptions until direct access or stakeholder confirmation is available.

## Recommended Build Order

1. Secure staging and source/API/database access.
2. Discover customer app/website ordering.
3. Discover driver app.
4. Discover kitchen/chef and packing/label surfaces.
5. Discover payment gateway sandbox and finance workflow.
6. Reconcile discoveries with old-admin module analysis.
7. Only then finalize workflow diagrams, data model, and architecture.
