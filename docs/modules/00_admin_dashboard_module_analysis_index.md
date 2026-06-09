# Nutrezee Phase 3 Old Admin Dashboard Module Analysis Index

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Scope: docs only; old admin dashboard baseline only; no app code; no production changes; no final architecture

## Purpose

This index organizes the Phase 3 module-by-module analysis of the discovered old Nutrezee admin dashboard. Only the old admin dashboard has been discovered. Customer app, driver app, kitchen/chef app, source code, APIs, and database are not discovered yet.

The old admin dashboard is the current business baseline, not the full system and not the final UX, architecture, database schema, API contract, or security model.

## Source Evidence

- `docs/01_discovery/full_admin_app_discovery.md`
- `docs/01_discovery/admin_route_screen_inventory.md`
- `docs/01_discovery/module_discovery_depth_matrix.md`
- `docs/02_requirements/old_to_new_feature_map.md`
- `docs/02_requirements/new_system_module_catalog.md`
- `docs/02_requirements/business_requirements_backlog.md`
- `docs/02_requirements/operational_pain_points.md`
- `docs/12_gap_analysis/old_system_preserve_improve_replace.md`

## Analysis Files

| # | Module Document | Main Scope | Priority | Recommended Build Position |
| ---: | --- | --- | --- | --- |
| 1 | `01_order_intake_lifecycle.md` | Admin order creation, WhatsApp/admin review, order states, subscription lifecycle. | P0 | First detailed business analysis. |
| 2 | `02_products_menu_packages.md` | Products, menu, packages, meal types, package-for rules, catalog data. | P0 | Before order automation and kitchen routing. |
| 3 | `03_kitchen_pre_kitchen.md` | Pre-kitchen, section routing, chef assignment, chef task app, production planning. | P0 | After catalog and confirmed order model. |
| 4 | `04_labels_packing_gaps.md` | Label/packing gaps from old admin dashboard; proposed label generation, packing checklist, box readiness, handoff. | P0 | After kitchen task generation. |
| 5 | `05_delivery_drivers.md` | Driver records, delivery slots/methods, dispatch, driver app. | P0 | After packing readiness and order lifecycle. |
| 6 | `06_payments_finance_reports.md` | Payment status, payment review, refunds, cashback, finance reports, revenue. | P0/P1 | In parallel with order lifecycle; deeper after payment access. |
| 7 | `07_customers_whatsapp_intake.md` | Customer profiles, WhatsApp intake, support, customer-facing gaps. | P0 | In parallel with order intake. |
| 8 | `08_nutrition_allergens_dietician.md` | Ingredients, allergens, diet status, tags, nutrition/macros, dietician requests. | P0/P1 | Before customer order validation and kitchen labels. |
| 9 | `09_rbac_audit_logs_gaps.md` | RBAC/permission/audit gaps from old admin dashboard; proposed roles, field visibility, audit events, privacy. | P0 | Foundation; must run in parallel with all modules. |
| 10 | `10_settings_content_notifications.md` | Settings, content, legal pages, gallery, videos, social, push notifications. | P1/P2 | After core operations, except critical settings/notifications. |
| 11 | `11_undiscovered_surfaces_access_needed.md` | Explicit gap register for customer app, driver app, kitchen/chef app, source/API/database, and other inaccessible surfaces. | P0 | Before final workflows/architecture. |
| 12 | `phase_3_pm_review_pack.md` | PM summary, key decisions, gaps, recommended next phase. | P0 | Phase closeout. |

## Cross-Module Decisions

| Decision Type | Strongest Phase 3 Direction |
| --- | --- |
| Preserve | Preserve old admin coverage for customers, orders, products, packages, drivers, coupons, cashback, content, settings, notifications, ingredients, allergens, delivery methods, and finance reports. |
| Improve | Improve old lists and forms into audited workflows with validation, timelines, ownership, role-based access, and analytics. |
| Replace | Replace unstable/risky routes such as driver auto-assignment, confirm-payment, report summary, and tomorrow-order card with controlled workflows. |
| Add | Add WhatsApp intake, admin order review, kitchen section routing, chef task app, labels, packing checklist, dispatch board, driver app, RBAC, audit logs, nutrition macros, operational analytics, and discovery access for unavailable surfaces. |

## Dependency Summary

1. RBAC, audit logs, auth, privacy, and core settings.
2. Customers, WhatsApp intake, and admin order review.
3. Products, menu, packages, nutrition, allergens, and routing metadata.
4. Order lifecycle and subscription calendar.
5. Kitchen sections, chef assignments, task generation, and pre-kitchen planning.
6. Labels, packing checklist, and dispatch handoff.
7. Delivery dispatch and driver app.
8. Payment status, finance review, refunds, reports, analytics.
9. Content, promotions, notifications, and lower-risk marketing modules.

## Phase 3 Safety Notes

- No production login was required for this phase.
- No production data was changed.
- No credentials, customer data, payment data, tokens, cookies, or secrets are included.
- All APIs listed in module docs are high-level new-system capabilities, not confirmed old production APIs.
- Assumptions are marked where the old admin dashboard did not directly verify behavior.
