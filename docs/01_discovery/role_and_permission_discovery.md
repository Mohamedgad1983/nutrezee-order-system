# Nutrezee Role And Permission Discovery

Date: 2026-06-09
Phase: Step 2C Full Admin-Controlled Existing App Discovery
Scope: read-only role/permission discovery from the admin dashboard

## Executive Summary

The old dashboard exposes multiple user types and role-like routes, but it does not expose a confirmed permission matrix, role editor, access policy screen, or audit log. The authenticated admin account could see broad operational, financial, customer, and health-related areas. This means the old dashboard can identify role categories, but it cannot be used as a security blueprint for the new system.

## Role-Like Areas Observed

| Area | Route | Evidence | Coverage | Notes |
| --- | --- | --- | --- | --- |
| Customers/users | `/users/list/3` | User listing with identity/contact/status/order totals. | Confirmed | Customer/user distinction needs confirmation. |
| New user listing | `/users/newuser/9` | Route label implies creation but showed listing. | Confirmed, ambiguous | Do not treat as final create-user workflow. |
| Drivers | `/users/drivers/2` | Driver listing with identity/contact/status. | Confirmed | Driver profile exists but no delivery app permissions observed. |
| Admin users | `/users/drivers/admin` | Admin user listing. | Confirmed | No role/permission detail visible. |
| Dietitians | `/users/dietitians/8` | Hidden dietitian listing route. | Confirmed | Indicates dietitian role/user type. |
| Diet customer service | `/diet-customer-service/dietactive-users` | Hidden route hint; timed out. | Partial | Likely role-specific or health/customer workflow. |
| Dietician requests | `/dietician_requests` | Health-related request list. | Confirmed | Access to health data requires stricter new-system controls. |

## Permission Model Discovery

| Permission Concern | Observation | Status | New-System Requirement |
| --- | --- | --- | --- |
| Role definitions | No role definition/editor screen found. | Not verified | Define roles explicitly. |
| Permission assignment | No permission assignment matrix found. | Not verified | Build role-permission matrix from scratch. |
| Field-level visibility | Sensitive columns were visible in admin lists/reports. | Not verified | Add role-gated fields for customer, payment, and health data. |
| Row-level permissions | Operation/action columns visible across modules. | Not verified | Gate each action by role and state. |
| Export permissions | Exports visible on order/finance reports. | Partial | Restrict exports and audit each export. |
| Payment permissions | Payment reports visible; confirm-payment route unstable. | Partial | Separate finance review, refund, and reconciliation roles. |
| Notification permissions | Push send form exists. | Partial | Require send approval and audience permissions. |
| Settings permissions | General settings and content save forms exist. | Partial | Split settings by domain and require audit. |
| Audit logs | No audit-log module found. | Not verified | Add immutable audit log for operational, finance, and settings changes. |

## Inferred Role Categories For New System

These roles are inferred from old dashboard modules and required future workflows. They must be confirmed with Nutrezee.

| Role | Evidence | Likely Access | Open Questions |
| --- | --- | --- | --- |
| System Admin | Admin user list, settings, full dashboard access. | Staff, RBAC, settings, audit, all modules. | Who can create admins and grant permissions? |
| Management | Dashboard, finance reports, revenue reports. | KPIs, exports, reports, escalations. | Which reports are management-only? |
| Customer Service | Users, orders, contact messages, order create form. | Customer profile, intake, order changes, support. | Can customer service change payment/order statuses? |
| Operations Admin | Orders, package rules, delivery slots, dashboard. | Order lifecycle, capacity, exceptions. | Who owns daily operations cutoffs? |
| Product/Menu Admin | Products, packages, meal types, tags, ingredients. | Catalog and package configuration. | Who approves price/package changes? |
| Nutrition/Dietitian | Dietitian users, dietician requests, allergies, diet status. | Health data, diet requests, nutrition notes. | What health fields are restricted? |
| Kitchen Manager | Pre-kitchen meal check. | Production plan, section tasks, shortages. | Does old system have a separate kitchen login? |
| Chef | Not observed. | Assigned tasks only. | What data should chefs see? |
| Packing | Not observed. | Packing checklist, labels, handoff. | Does packing use dashboard, paper, or another tool? |
| Dispatcher | Drivers, delivery slots, driver-wise route, auto-assign route. | Dispatch board, assignment overrides. | Who can auto-assign and override drivers? |
| Driver | Driver records only. | Driver app/stops/statuses. | Is there an existing driver login/app? |
| Finance | Sales/payment/revenue reports, confirm-payment route. | Payment review, reconciliation, refunds, exports. | Who can confirm/refund payments? |
| Marketing/Content | Coupons, offers, gallery, subscribers, push notifications, static pages. | Promotions/content/notifications. | Who can send production notifications? |

## Security Risks

- Broad admin visibility appears to include customer, contact, payment, and health-related fields.
- No visible least-privilege model was confirmed.
- No audit-log screen was found.
- Row-level operations are common but were not safely inspectable in production.
- Export controls appear on sensitive reports.
- Push notification send form can target users; sending needs approval and audit.
- Direct add/update routes exist for master data and content.
- Framework/SQL error pages can expose internals on malformed direct routes.

## Required Access For Permission Discovery

1. Staging admin account with super-admin access.
2. Staging admin account with limited operations access.
3. Staging customer-service account.
4. Staging finance account.
5. Staging dietitian account.
6. Staging driver account or driver app login.
7. Staging kitchen/chef/packing accounts if they exist.
8. Source code or route/controller map.
9. Existing role/permission configuration, if any.
10. Audit log or database tables for security events, if any.

## New-System Permission Principles

- Start with explicit RBAC, not copied old access behavior.
- Separate customer service, operations, kitchen, packing, dispatch, driver, finance, dietitian, marketing, content, management, and system admin permissions.
- Use field-level controls for payment, health, contact, and DOB fields.
- Make exports role-gated and audited.
- Make all create/update/delete/status/payment/assignment/notification actions audited.
- Require reasons for sensitive order, payment, cancellation, refund, pause, dispatch override, and settings changes.
- Require approval or confirmation for irreversible or customer-visible actions.

## Conclusion

The old dashboard provides useful evidence of role categories but not a permission blueprint. Step 2D should build RBAC and audit requirements from stakeholder confirmation, source review, and staging tests, not from old admin visibility.
