# Legacy-First Section Alignment Audit

**Date:** 2026-06-10
**Mode:** Discovery Mode, audit-only
**Audit result:** **PASS_WITH_GAPS**
**Baseline rule:** **Verified** - the old admin dashboard is the current business baseline for section coverage. The new MVP must reproduce the relevant business flow section by section, improve weak areas, and continue to run beside the legacy dashboard until an explicit cutover decision is made. This report does not treat the new MVP as a full replacement for the old system.

## 1. Executive Summary

**Verified:** WP-00 through WP-06 are recorded DONE in `19_Roadmap/build_progress_register.md`, and the latest main-branch GitHub Actions CI run `27284490353` completed successfully for lint, typecheck, build, TS-U, TS-I, TS-M, TS-R, TS-A, TS-C, TS-E, TS-S, boundary-scan, and no-get-mutation-scan.

**Verified:** The current build is foundation-heavy. It has platform services, RBAC/staff backend, settings and transition engine, customer services, catalog services, import tooling, SQL migrations through wave 2, and test coverage for those areas. It does not yet contain intake drafts, review queue, order core, kitchen tickets, payment records, operational reports, WhatsApp message refs, or business UI beyond an admin shell.

**Verified:** The old system evidence includes 46 confirmed old admin routes, 4 unstable routes, and 1 skipped unsafe route. Evidence covers customers, admin/staff users, drivers, products, packages, orders, coupons, cashback, master data, settings, notifications, reports, finance, pre-kitchen check, dietician requests, and content modules.

**Needs Confirmation:** The exact mandatory intake field set remains unresolved. This is the hard WP-07 blocker recorded in the build register. Continuing into WP-07 without this decision would risk inventing the order intake contract rather than aligning to the legacy order-create flow.

## 2. Current Build Status

### Work Package Status

| WP | Status | Current Evidence | Coverage Notes |
|---|---|---|---|
| WP-00 Environment standup | **Verified DONE** | `19_Roadmap/build_progress_register.md`; merge `e704eca`; app scaffold under `app/`; CI workflow under `.github/workflows/ci.yml` | Environment scaffold, Docker files, CI skeleton. |
| WP-01 Platform foundation | **Verified DONE** | Register row; merge `569dfe1`; migrations `app/db/migrations/0001_wave1_foundation.sql`, `0002_wave1_seeds.sql`; platform code under `app/apps/api/src/platform/` | Foundation tables, seeds, audit, outbox, sessions, staged RBAC, idempotency, masking, scans. |
| WP-02 RBAC and staff admin | **Verified DONE** | Register row; merge `2091f7c`; `app/apps/api/src/platform/staff/`, `app/apps/api/src/platform/rbac/` | Backend/API controllers for staff and auth exist. Full admin SPA screens do not yet exist. |
| WP-03 Settings and transition engine | **Verified DONE** | Register row; merge `4906fbc`; `app/apps/api/src/platform/settings/`, `transition/transition-engine.ts` | Backend settings API and generated transition tests exist. Business content values remain workshop-owned. |
| WP-04 Customers | **Verified DONE** | Register row; merge `0e40e07`; `app/db/migrations/0003_wave2_masters_customers.sql`; `app/apps/api/src/modules/m04-customers/` | Customer tables and services exist. No customer admin UI and no public customer controller in `AppModule` yet. |
| WP-05 Catalog | **Verified DONE** | Register row; merge `112de01`; `app/db/migrations/0004_wave2_catalog.sql`; `app/apps/api/src/modules/m05-catalog/` | Catalog tables and services exist in mirror mode. No catalog UI; routing content still zero-row/workshop-owned. |
| WP-06 Import tooling | **Verified DONE** | Register row; merge `4460c33`; `app/apps/api/src/modules/m19-migration/`, `m18-bridge/`; `app/tests/integration/ts-m-import.test.ts` | Synthetic import tooling exists. Real legacy apply remains blocked on legacy access/export. |
| WP-07 Intake and WhatsApp panel | **Verified BLOCKED** | Register row; `19_Roadmap/codex_implementation_sequence.md` WP-07 | Hard blocker: mandatory intake-field set, workshop S3 Q8. |
| WP-08 through WP-14 | **Verified NOT STARTED** | Register rows | Depend on WP-07 or later hard gates. |

### Implementation Inventory

| Area | Exists Now | Missing / Not Yet Built | Evidence |
|---|---|---|---|
| API platform | **Verified:** Nest app, health/auth/staff/settings controllers; audit, outbox, idempotency, masking, sessions, RBAC, settings, transition engine services. | Business controllers for M01/M02/M03/M05/M07/M08/M11/M15/M17 are not present. | `app/apps/api/src/app.module.ts`, `app/apps/api/src/platform/` |
| Admin UI | **Verified:** React/Vite shell only. | No legacy-section business screens yet: intake, customers, catalog, review, order, kitchen, payment, reports, settings UI. | `app/apps/admin/src/App.tsx` |
| Shared package | **Verified:** minimal shared health type only. | Contract-rich shared types are not yet mirrored for business modules. | `app/packages/shared/src/index.ts` |
| SQL migrations | **Verified:** wave 1 foundation and wave 2 masters/customers/catalog/sync. | No wave 3 intake/review/WhatsApp tables; no wave 4 order/payment tables; no wave 5 kitchen/notifications/reconciliation tables. | `app/db/migrations/*.sql` |
| Customers | **Verified:** customer, phone, address, allergy, preference, merge tables; services for guided create, duplicate handling, merge/undo. | No customer UI; no intake linkage UI; legacy real customer import not applied. | `app/db/migrations/0003_wave2_masters_customers.sql`, `app/apps/api/src/modules/m04-customers/` |
| Catalog and nutrition foundation | **Verified:** product, component, ingredient, allergen, ingredient_allergen, product_allergen, nutrition_facts, package, routing_rule tables; mirror-mode service. | No catalog UI, no legacy catalog import run, no complete nutrition content, no section routing content. | `app/db/migrations/0004_wave2_catalog.sql`, `app/apps/api/src/modules/m05-catalog/` |
| Import tooling | **Verified:** batch runner, importers, dry-run/apply/rollback tests. | No real legacy source/export available; no active plan import applied. | `app/apps/api/src/modules/m19-migration/`, `app/tests/integration/ts-m-import.test.ts` |
| CI/tests | **Verified:** latest main CI run `27284490353` successful. | TS-C and TS-E are still placeholder-level; TS-S only has implemented customer merge scenario plus placeholders. | `.github/workflows/ci.yml`, `app/tests/` |

## 3. Old System Section Inventory

Path shorthand in the tables: `modules/...` means `nutrezee-step-1-discovery/docs/modules/...`.

| Section | Old Purpose | Users / Roles | Main Old Flow | Key Fields / Required Fields Known | Reports / Exports | Pain Points | Evidence |
|---|---|---|---|---|---|---|---|
| Orders / Intake | **Verified:** staff-assisted order creation and lifecycle lists. | **Inferred:** admin, intake/customer service, operations, finance. | Search/select customer, choose package/sub-package/package-for, dates, address, slot/method, notes, payment fields, create order/payment link; monitor pending/active/pause/expired/cancel lists. | **Verified fields:** customer, package, sub-package, package-for, start/end dates, address/area, delivery slot/method, notes, coupon, paid/gateway/amount, transaction/payment/order status. **Needs Confirmation:** required vs optional fields, source/channel, review rules, delivered/completed states. | **Verified:** order list exports, expiration report, birthday orders, tomorrow route unstable. | No draft/incomplete queue, manual WhatsApp transcription, unverified state machine, no audit, unstable tomorrow route. | `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md`; `admin_route_screen_inventory.md`; `02_Current_State/current_state_assessment.md` |
| Customers | **Verified:** customer/user list, contact concepts, DOB/order totals/status; customer search in order create. | **Inferred:** customer service, admin, operations, finance limited, dietician limited. | Staff searches/reviews customers, creates orders for them, views contact messages/subscribers/birthday/dietician request related data. | **Verified:** identity/contact/DOB/order totals/status. **Needs Confirmation:** identity SoT, required customer create fields, address structure, allergy/preference capture, consent. | **Verified:** birthday report, contact list, subscribers. | Duplicate customers, repeated data entry, ambiguous add-user route, broad PII exposure. | `modules/07_customers_whatsapp_intake.md`; `admin_route_screen_inventory.md` |
| Catalog / Menu / Items / Packages | **Verified:** products, packages, package-for, meal types, tags, diet status, ingredients, allergies. | **Inferred:** product admin, operations, nutrition/dietitian, kitchen manager. | Admin maintains products and packages; orders reference package/sub-package/package-for and delivery/calendar concepts. | **Verified:** bilingual product/package names, category/package filters, package priority/coupon flag, package-for Friday off-day/new-customer flag, master names/status. **Needs Confirmation:** price rules, package duration/meals, availability, components, required nutrition fields. | **Verified:** package/order usage appears in order and finance reports. | Nutrition/macros not structured in evidence, routing missing, package lifecycle rules unknown. | `modules/02_products_menu_packages.md`; `old_to_new_feature_map.md` |
| Kitchen / Production | **Verified:** pre-kitchen meal shortage check and date-wise/tomorrow route hints. | **Inferred:** kitchen manager, operations, chefs. | Admin can choose date for pre-kitchen shortage check; rest appears manual/verbal. | **Verified:** date selector, product/package/ingredient upstream inputs. **Needs Confirmation:** sections, chefs, shifts, routing, statuses, shortages/substitution approvals. | **Verified partial:** pre-kitchen check; tomorrow route unstable. | No section routing, no task board, no chef accountability, no kitchen handoff. | `modules/03_kitchen_pre_kitchen.md`; `current_state_assessment.md` |
| Labels / Packing | **Verified absence:** no label or packing route observed. | **Inferred:** packing staff, kitchen, dispatcher. | **Needs Confirmation:** assumed manual labels and packing checks outside old admin. | **Needs Confirmation:** label fields, printer, box model, packing checklist, reprint rules, barcode/QR. | Not observed. | Manual labels, missing checklist, unclear kitchen-to-packing-to-dispatch handoff. | `modules/04_labels_packing_gaps.md`; `current_state_assessment.md` |
| Delivery / Drivers | **Verified:** drivers, delivery slots, delivery methods, driver-wise route exists but times out, unsafe auto-assign route skipped. | **Inferred:** dispatcher, drivers, operations, admin. | Admin maintains driver records and delivery config; assignment workflow not safely verified. | **Verified:** driver identity/contact/status, slot names/start/end, delivery method names. **Needs Confirmation:** area, capacity, shifts, vehicle, driver statuses, failure reasons. | **Verified partial:** `/driverOrders` route but unstable. | Manual assignment, no capacity enforcement, unsafe GET assignment, no driver app verified. | `modules/05_delivery_drivers.md`; `nutrezee_step_1b_dashboard_audit.md` |
| Payments | **Verified:** payment fields on orders, payment link action, sales/payment/revenue reports, cashback, confirm-payment route unstable. | **Inferred:** finance, operations, management, customer service limited. | Orders carry payment status and transaction/gateway concepts; reports show sales/revenue/payment; confirm-payment not loaded. | **Verified:** payment status, transaction ID, gateway transaction, paid amount, package amount, coupon, cashback balance. **Needs Confirmation:** methods, payment gate, manual proof, refund/credit rules, gateway sandbox. | **Verified:** monthly sales, daily sales, sales by payment, customer revenue, expiration, cashback; export controls. | Unstable confirm-payment route, unclear refunds, no audit/reconciliation. | `modules/06_payments_finance_reports.md`; `admin_route_screen_inventory.md` |
| Reports / Dashboards | **Verified:** dashboard cards, monthly/daily sales, payment, revenue, expiration, birthday, summary route unstable. | **Inferred:** management, finance, operations, report viewers. | Dashboard cards link to module counts/shortcuts; reports use date filters and exports. | **Verified:** date/month filters, order/customer/payment/package/revenue fields. **Needs Confirmation:** KPI definitions and accounting rules. | **Verified:** finance/report exports exist; export behavior not tested. | Summary/tomorrow routes unstable; disconnected reports; no role-gated export/audit. | `old_to_new_feature_map.md`; `modules/06_payments_finance_reports.md` |
| Users / Roles / Permissions | **Verified:** admin login, admin user list, drivers, dietitians; no permission matrix or audit log found. | **Inferred:** system admin, admin, drivers, dietitians, customer-service roles. | Admin logs in and can access broad modules; row operation controls appear widely. | **Verified:** user identity/contact/status. **Needs Confirmation:** role set, field visibility, approvals, audit retention. | Not observed except admin/user lists. | No confirmed RBAC, no audit log, broad access to PII/payment/health. | `modules/09_rbac_audit_logs_gaps.md`; `full_admin_app_discovery.md` |
| Branches / Operations Settings | **Verified:** general/contact settings, WhatsApp number, checkout gap, full-capacity date, slots/methods, package-for rules. **Needs Legacy Review:** branch/central kitchen dispatch not observed. | **Inferred:** admin, operations, management. | Admin edits settings and masters; save actions skipped. | **Verified:** WhatsApp, checkout days gap, full capacity date, social/contact fields, slots/methods. **Needs Confirmation:** branches, sites, areas, capacity rules, setting owners. | Not a report section. | Settings broad, not visibly scoped, validated, or audited. | `modules/10_settings_content_notifications.md`; `nutrezee_step_1b_dashboard_audit.md` |
| WhatsApp / Communication | **Verified:** WhatsApp contact setting, push notification list/send form, contact messages, subscribers. **Assumed:** WhatsApp is primary order channel from pain points. | **Inferred:** intake staff, support, marketing, operations. | Staff receive WhatsApp orders outside structured old admin; admin has contact/settings and push notification tools. | **Verified:** WhatsApp number/settings, push title/message/audience concepts, contact/subscriber fields. **Needs Confirmation:** message content storage, consent, API vs manual-assisted, mandatory message ref. | Push history list observed. | Manual transcription, no templates/approval, no structured source capture. | `modules/07_customers_whatsapp_intake.md`; `modules/10_settings_content_notifications.md`; `operational_pain_points.md` |
| Nutrition / Allergens / Health Notes | **Verified:** ingredients, allergies, diet status, tags, dietitian users, dietician requests. | **Inferred:** nutrition/dietitian, product admin, customer service, kitchen limited. | Admin maintains nutrition-adjacent masters and dietician request list; no confirmed link to order/kitchen validation. | **Verified:** ingredient/allergy names/status, diet status/tags, dietician request health fields. **Needs Confirmation:** macros, severities, consent, restriction logic, label/customer visibility. | Dietician requests list; product/order reports may include package concepts. | Allergen safety not systematic; health data broadly visible; macros not structured in evidence. | `modules/08_nutrition_allergens_dietician.md` |
| Imports / Exports | **Verified:** exports visible on order/finance reports. **Needs Confirmation:** legacy source/schema/export format unavailable. | **Inferred:** admin, finance, operations, migration owner. | Staff can export some reports; old source/database/API not available. | **Verified:** export controls on order and finance lists. **Needs Confirmation:** export formats, field names, legacy keys, data quality, active plan export. | Order and finance exports observed but not clicked. | Export privacy/audit unknown; real migration blocked by access/export. | `full_admin_app_discovery.md`; `modules/11_undiscovered_surfaces_access_needed.md` |
| Content / Marketing / Promotions | **Verified:** coupons, cashback, advertisements/offers, gallery, video, static pages, terms, return policy, social, subscribers, push notifications. | **Inferred:** marketing/content, admin, finance for cashback/coupons. | Admin manages list/form content and promotion modules; send/save actions skipped. | **Verified:** coupon code/limits/dates/discount/category/package fields, media/content fields, subscriber email/status. **Needs Confirmation:** current business usage and approval rules. | Coupon usage hints, notification history, exports not tested. | Lower priority for MVP except promotions/coupons affecting intake; approvals/versioning missing. | `modules/10_settings_content_notifications.md`; `old_system_preserve_improve_replace.md` |

## 4. Section-by-Section Gap Matrix

| Old System Section | Old Flow / Purpose | Current Build Coverage | Missing Gap | Improvement Needed | Priority | Owner WP / Future Package | Decision Needed | Evidence |
|---|---|---|---|---|---|---|---|---|
| Orders / Intake | Staff creates orders from customer/package/address/payment fields; order lifecycle lists. | **Foundation Only** - customers, catalog, settings, transition engine exist; no draft/order tables. | No M01 drafts, M17 refs, M02 review, M03 order core, order UI. | Reproduce `/orders/create` business fields as draft intake, then improve with completeness, review, source, audit. | **P0** | WP-07, WP-08, WP-09 | Mandatory intake-field set; DEC-002, DEC-004, DEC-005 inputs. | `modules/01_order_intake_lifecycle.md`; `codex_implementation_sequence.md` |
| Customers | Customer/user list and customer search for order creation. | **Partially Covered** - tables/services/tests, no UI/public customer controller. | No old-screen parity UI, no real import, identity SoT open. | Guided profile creation, duplicate detection, address/allergy reuse. | **P0** | WP-04 done foundation; WP-07 uses it; WP-13 real import | DEC-004 identity, customer required fields. | `modules/07_customers_whatsapp_intake.md`; `app/apps/api/src/modules/m04-customers/` |
| Catalog / Menu / Packages | Products/packages/masters feed order creation and production. | **Partially Covered** - tables/services/mirror mode; no UI/content import. | No real catalog data, package rule confirmation, routing content, catalog UI. | Mirror legacy catalog first; enrich with nutrition, allergens, routing. | **P0** | WP-05 done foundation; WP-07 uses package data; WP-10 routing; WP-13 import | Catalog owner, package rules, DEC-006 sections, nutrition required set. | `modules/02_products_menu_packages.md`; `app/db/migrations/0004_wave2_catalog.sql` |
| Kitchen / Production | Pre-kitchen shortage/date planning only; section work manual. | **Foundation Only** - section/routing tables exist; no kitchen tickets/board. | No ticket generation, kitchen PWA, sections content, status workflow. | Reproduce pre-kitchen/day planning, then generate section tickets and readiness. | **P2** | WP-10 | DEC-006 sections and shared-device model. | `modules/03_kitchen_pre_kitchen.md`; `codex_implementation_sequence.md` |
| Labels / Packing | No old route; manual labels/packing assumed. | **Not Covered** | Label/packing module is excluded from signed MVP. | Preserve as future baseline gap; do not build before DEC-007/future package. | **Later** | Future labels/packing package after MVP cut amendment or post-pilot | DEC-007 label spec/hardware; packing process review. | `modules/04_labels_packing_gaps.md`; `13_Architecture/mvp_architecture_cut.md` |
| Delivery / Drivers | Driver records, slots/methods, unstable driver-wise route, unsafe auto-assign. | **Out of Scope / Later** for dispatch; **Foundation Only** for slots/methods. | No driver profile extension, dispatch board, driver app, assignments. | Keep legacy dispatch untouched; later replace unsafe assignment with audited dispatch board. | **Later** | Future M09/M10 package; not WP-07-WP-12 MVP build | DEC-008 area/capacity/driver workflow. | `modules/05_delivery_drivers.md`; `AGENTS.md` dormant-module rule |
| Payments | Payment fields, link generation, reports, unstable confirmation. | **Foundation Only** - payment transition config and setting; no payment tables/module yet. | No M07 tables/services/UI; no finance queue; refund dormant. | Record-only payment machine and finance review queue. | **P1** | WP-11 | DEC-009 payment/refund rules, payment methods, gateway/sandbox. | `modules/06_payments_finance_reports.md`; `module_api_contracts.md` |
| Reports / Dashboards | Dashboard, sales/payment/revenue/expiration reports; summary unstable. | **Not Covered** - no report projections/UI. | No intake funnel, daily ops sheet, kitchen day-list, exports. | Start with MVP's 3 reports; preserve five legacy finance reports for later parity. | **P2** | WP-12 for MVP reports; future analytics/report parity | DEC-010 KPI set; export/privacy rules. | `mvp_architecture_cut.md`; `modules/06_payments_finance_reports.md` |
| Users / Roles / Permissions | Admin login/user lists; no confirmed RBAC/audit. | **Partially Covered** - backend auth/staff/RBAC/audit exists; no full UI. | Staff/role admin UI incomplete; matrix content awaiting sign-off. | Least-privilege roles, field masking, audit, export logging. | **P1** | WP-02 foundation done; UI consolidation with business screens | Matrix sign-off S8; role ownership details. | `modules/09_rbac_audit_logs_gaps.md`; `app/apps/api/src/platform/` |
| Branches / Operations Settings | General settings, slots, methods, capacity date; branch not observed. | **Partially Covered** - settings API, areas/slots/methods/sections tables. | No settings UI; branch/site model not confirmed; content zero-row. | Scoped settings with validation, preview, audit. | **P1** | WP-03 done foundation; each later WP consumes settings | Branch/site review, setting owners, values for cutoffs/capacity. | `modules/10_settings_content_notifications.md`; `physical_schema_design.md` |
| WhatsApp / Communication | WhatsApp setting plus manual assumed intake; push/contact/subscriber tools. | **Not Covered** for WhatsApp panel; feature flag only. | No M17 `whatsapp_message_ref` table yet; no panel; no webhook. | Manual-assisted source capture first; WhatsApp API later only if DEC-002 selects it. | **P0** | WP-07 M17 manual message-ref panel; future WhatsApp API package | DEC-002, message-ref fields, privacy/consent. | `modules/07_customers_whatsapp_intake.md`; `module_api_contracts.md` |
| Nutrition / Allergens / Health | Ingredients/allergies/diet statuses/dietician requests. | **Partially Covered** - masters, allergen resolver, customer_allergy, nutrition_facts table. | No dietician workflow, no complete macros, no intake/kitchen conflict UI. | Allergy conflict chain in intake/review/kitchen; structured nutrition completeness. | **P0** | WP-05 foundation; WP-07 conflict checks; WP-10 ticket marker; future dietician workflow | Allergen severity scale, nutrition required fields, consent. | `modules/08_nutrition_allergens_dietician.md`; `app/tests/integration/ts-u-catalog.test.ts` |
| Imports / Exports | Order/finance exports visible; legacy source/schema/export unavailable. | **Partially Covered** for import tooling; **Not Covered** for new exports. | No real legacy export; no active-plan apply; no export audit UI. | Use dry-run/import review once export is provided; exports via audited report APIs later. | **P2** | WP-06 tooling done; WP-13 real bridge/cutover; WP-12 exports | Legacy access/export, P1/P2 format, active plan fields. | `modules/11_undiscovered_surfaces_access_needed.md`; `app/tests/integration/ts-m-import.test.ts` |
| Content / Marketing / Promotions | Coupons, offers, gallery, pages, terms, return policy, subscribers, push. | **Mostly Not Covered**; coupon fields only as intake settings/content concepts. | No content/marketing modules in MVP; no coupon engine beyond settings modes. | Preserve later; only build coupon validation slot if needed for intake. | **Later** | Future content/marketing package; coupon slot in WP-07 if required | Which modules remain active; coupon validation strictness; approval rules. | `modules/10_settings_content_notifications.md`; `old_system_preserve_improve_replace.md` |

## 5. Problems and Improvements Mapped to Sections

| Problem / Gap | Section | Current Build Position | Improvement Path |
|---|---|---|---|
| GAP-OM-01 no draft/incomplete queue | Orders / Intake | Not built | WP-07 draft intake and incomplete queue, driven by confirmed field set. |
| GAP-AUT-01 manual WhatsApp transcription | Orders / WhatsApp | Not built | WP-07 manual message refs; future API only after DEC-002. |
| GAP-DQ-01 duplicate customers | Customers | Foundation built | Use WP-04 dedup in WP-07 intake; confirm DEC-004 identity. |
| GAP-OPS-01 no section routing | Kitchen / Catalog | Catalog foundation only | WP-10 after DEC-006, using routing rules from WP-05. |
| GAP-SEC-01 no RBAC | Users / Permissions | Backend foundation built | Add UI and switch modes per role after matrix sign-off. |
| GAP-AUD-01 no audit | Cross-section | Foundation built | Keep cumulative TS-A and add audit to each future write path. |
| GAP-AUD-02 payment confirmation untraceable | Payments | Not built | WP-11 finance review queue; refunds stay dormant. |
| GAP-REP-01 unstable summary/tomorrow routes | Reports / Kitchen | Not built | WP-12 MVP reports; WP-10 day board replaces production-readiness need. |
| GAP-DQ-02 nutrition macros missing | Catalog / Nutrition | Schema foundation built | Confirm fields, populate legacy import/enrichment, use in intake/kitchen. |
| GAP-DEL-01 unsafe/manual driver assignment | Delivery | Dormant by MVP | Do not build now; future dispatch package after DEC-008. |

## 6. WP-07 Unblock Checklist

**Verified blocker:** `19_Roadmap/build_progress_register.md` marks WP-07 BLOCKED on workshop S3 Q8, the mandatory intake-field set.

### Fields Needed Before WP-07

| Field Group | Candidate Fields From Legacy / Contracts | Status |
|---|---|---|
| Source/channel | channel, WhatsApp/manual source, intake owner, timestamp | **Needs Confirmation** |
| WhatsApp reference | sender_phone, message_at, ref_note or message reference; whether raw content is stored | **Needs Confirmation** |
| Customer identity | existing customer, unverified customer flag, name, phone/WhatsApp, language | **Needs Confirmation** - DEC-004 |
| Customer address | saved address or inline address, area, delivery notes, contact/address type if used | **Needs Confirmation** |
| Package/order selection | package, sub-package, package-for, products/items if needed, quantity, start date, end date/off-days | **Needs Confirmation** |
| Delivery | delivery slot, delivery method, area/capacity behavior, cutoff rules | **Needs Confirmation** |
| Payment | expected payment method, paid-already flag, gateway/link fields, paid amount, price estimate | **Needs Confirmation** - DEC-009 may affect later WP-11, but WP-07 needs capture posture |
| Coupon | coupon code and validation mode: off, warn, strict | **Needs Confirmation** |
| Allergies/health | customer allergy fields, conflict severity, override posture for intake | **Needs Confirmation** |
| Notes | admin/customer/driver/kitchen notes and which are required/visible | **Needs Confirmation** |
| Completeness | which fields block submit, which create warning, which can be unknown with justification | **Needs Confirmation** |

### Old Sections To Review Before WP-07

1. `/orders/create` field list and staff workflow.
2. `/users/list/3` customer search/list and `/users/newuser/9` ambiguity.
3. `/products`, `/package`, `/packageFor`, `/mealsType` because intake selections depend on these.
4. `/timeSlots`, `/deliveryMethod`, `/settings` for delivery/capacity/WhatsApp settings.
5. `/coupon` and coupon add form if coupon validation is part of intake.
6. `/allergies`, `/ingredients`, customer allergy expectations, and dietician request privacy rules.
7. Payment-link behavior on `/orders/create` and whether WP-07 stores payment intent only or creates no payment artifacts.

### Sponsor / Workshop Decisions Required

| Decision | Why It Blocks or Shapes WP-07 |
|---|---|
| Mandatory intake field set, S3 Q8 | Direct hard blocker for WP-07 completeness DoD. |
| DEC-002 WhatsApp approach | Confirms manual-assisted first vs API; WP-07 must not build webhook/API if not signed. |
| DEC-004 customer identity | Determines customer matching and duplicate behavior during intake. |
| Coupon validation posture | Determines completeness warning vs blocking behavior. |
| Slot/capacity posture | Determines whether slot capacity blocks, warns, or is off in intake. |
| Payment capture posture | Determines whether WP-07 stores expected method/status only or any payment-link reference. |
| Health/allergy severity scale | Determines conflict warnings and override shape. |

### Current Implementation Conflicts With Legacy Baseline

**Verified:** No direct business-flow conflict was found because WP-07+ business order flow has not been built yet.

**Verified:** Catalog mirror mode aligns with the legacy-first baseline.

**Inferred risk:** `app/README.md` is stale because it still says no business workflow code exists, while WP-04 through WP-06 services and migrations now exist. This is documentation drift, not a Phase 1-4 source-of-truth conflict.

**Needs Confirmation:** If WP-07 proceeds without old `/orders/create` required-field review, the new intake contract could diverge from the business baseline.

## 7. Risks If Build Continues Without Old-System Alignment

| Risk | Impact | Evidence |
|---|---|---|
| Invented intake fields | WP-07 may pass tests while failing staff order-entry reality. | WP-07 blocker in register; `/orders/create` field evidence in module analysis. |
| Legacy parity gaps hidden by backend-only work | UAT may discover missing old-screen behaviors late. | Admin SPA is shell only; old screen map has 50 routes. |
| Wrong customer identity model | Duplicate prevention and WhatsApp matching could be wrong. | DEC-004 open; customer module built soft-phone-ready. |
| Kitchen routing built before sections confirmed | Tickets could be routed to wrong sections or unusable boards. | DEC-006 open; WP-10 blocker. |
| Dormant scope creep | Dispatch, labels, refunds, webhook, or customer notifications could violate MVP cut. | `AGENTS.md`; `mvp_architecture_cut.md`. |
| Report parity misunderstood | MVP has exactly 3 reports, while old system has multiple finance reports needing later parity. | `mvp_architecture_cut.md`; old report evidence. |
| Legacy source/export absence | Real import and reconciliation may fail late if field mappings are assumed. | `modules/11_undiscovered_surfaces_access_needed.md`; WP-13 blocker. |

## 8. Recommended Next Sprint

### 1. Legacy Review Pack Before WP-07

Produce a short sponsor-reviewed pack, not code:

1. Sanitized `/orders/create` field inventory with required/optional classification.
2. Order-type matrix: new order, renewal, pause, cancellation, address change, special request, complaint.
3. Customer match/create rules: phone, WhatsApp number, email, unverified customer, duplicate warning/block.
4. Package/sub-package/package-for selection rules and date/off-day behavior.
5. Delivery slot/method/capacity behavior during intake.
6. Coupon and payment capture posture during draft intake.
7. WhatsApp reference/privacy rule: what is stored, what is not stored, and whether raw message content is excluded.
8. Allergy/health conflict fields and severity scale.
9. A 10-order sanitized legacy sample or workshop walkthrough to validate the field set.

### 2. WP-07 Unblock Decisions

After the Legacy Review Pack, record the mandatory field set and related decisions in the allowed decision/register location. Do not edit Phase 1-4 source-of-truth documents directly.

### 3. WP-07 Implementation Boundary

Build only the WP-07 row:

- M01 draft orders and draft items.
- Completeness engine and incomplete queue.
- Allergy conflict computation using M04/M05.
- M17 manual WhatsApp message reference panel.
- Aging alerts.

Do not build WhatsApp webhook/API, order approval/conversion, order core, kitchen, payment queue, dispatch, labels, refunds, customer notifications, or checkout.

### 4. WP-08 to WP-12 Legacy Alignment Checks

| WP | Required Legacy-First Check Before Build |
|---|---|
| WP-08 Review queue | Compare old pending order behavior and review responsibilities; confirm reviewer=creator rule and decision reasons. |
| WP-09 Order core | Compare active/pause/expired/cancel legacy lists; confirm DEC-005 lifecycle finals, cutoff, payment gate, off-day behavior. |
| WP-10 Kitchen | Review old pre-kitchen check and kitchen manual process; confirm DEC-006 sections/routing/shared-device workflow. |
| WP-11 Payments-lite | Review payment fields, payment-link behavior, finance reports, confirm-payment timeout context; confirm DEC-009 values. |
| WP-12 Notifications and reports | Map MVP's three reports to old report needs; confirm which legacy reports wait for later parity. |

### 5. Wait Until After MVP

Dispatch/driver app, labels/packing, WhatsApp Business API, customer notifications, cart/checkout, refunds/wallet, content/media/video, full marketing workflows, full analytics suite, five-report parity beyond MVP, inventory/freshness, and AI features should wait unless DEC-003 is explicitly amended.

### 6. Do Not Build Yet

Do not create tables, APIs, UI, or workflow logic for dormant dispatch M09, drivers M10, cart/checkout M06, refunds, WhatsApp webhook, customer notifications, labels/packing, or legacy write-back. Do not modify Phase 1-4 source-of-truth docs.

## 9. Evidence Index

| Evidence | What It Proves |
|---|---|
| `19_Roadmap/build_progress_register.md` | WP-00 through WP-06 done, WP-07 blocked, gates and run log. |
| `19_Roadmap/codex_implementation_sequence.md` | WP scopes, DoD, stop-rule blockers, sequencing. |
| `02_Current_State/current_state_assessment.md` | Current old-system workflow map, journey pain points, confidence summary. |
| `01_Discovery/discovery_consolidation.md` | Consolidated old-dashboard evidence and business objectives. |
| `nutrezee-step-1-discovery/docs/01_discovery/admin_route_screen_inventory.md` | Route-by-route old admin screen inventory. |
| `nutrezee-step-1-discovery/docs/01_discovery/full_admin_app_discovery.md` | Confirmed old admin capabilities, partial/unsafe routes, missing surfaces. |
| `nutrezee-step-1-discovery/docs/02_requirements/old_to_new_feature_map.md` | Old screen to new module baseline and preserve/improve/replace decisions. |
| `nutrezee-step-1-discovery/docs/12_gap_analysis/old_system_preserve_improve_replace.md` | Old-section decision matrix and priorities. |
| `nutrezee-step-1-discovery/docs/02_requirements/operational_pain_points.md` | Manual workflow and improvement evidence. |
| `nutrezee-step-1-discovery/docs/modules/*.md` | Per-section legacy purpose, fields, workflows, risks, questions. |
| `03_Gap_Analysis/gap_analysis.md` | 52 gap register and critical gaps. |
| `04_Enhancement_Blueprint/enhancement_blueprint.md` | Improvement packages and dependency spine. |
| `13_Architecture/mvp_architecture_cut.md` | Signed MVP boundary and exclusions. |
| `11_API_Design/backend_module_specs.md` | Module ownership, allowed cross-module calls, open NC items. |
| `11_API_Design/module_api_contracts.md` | Target operation contracts and dormant stubs. |
| `10_Data_Model/physical_schema_design.md` | Target schema waves and dormant table exclusions. |
| `15_Testing/test_strategy.md` | Required suite gates and placeholder meaning. |
| `app/apps/api/src/app.module.ts`, `app/apps/api/src/platform/`, `app/apps/api/src/modules/` | Current implementation modules and controller wiring. |
| `app/db/migrations/*.sql` | Current physical tables/seeds. |
| `.github/workflows/ci.yml`, `app/tests/` | Current CI/test suite structure. |

## 10. Open Questions for Sponsor / User

1. What exact fields are mandatory before an intake draft can be submitted for review?
2. Which old `/orders/create` fields are required at creation time vs optional or payment-only?
3. What is the customer identity source of truth: phone, WhatsApp number, email, account ID, or another key?
4. Should WP-07 store raw WhatsApp message content, a reference only, or a manually entered summary?
5. Which order types must WP-07 handle on day one: new, renewal, pause, cancellation, change, complaint, special request?
6. What coupon and slot-capacity behavior should be blocking vs warning?
7. Which payment data belongs in intake vs later finance review?
8. What allergy severity scale and override behavior should intake use?
9. Which old admin screens are still actively used and must be preserved before internal UAT?
10. Can a sanitized legacy order export or 10-order walkthrough be provided before WP-07?
