# Module Analysis: RBAC And Audit Logs Gaps

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/admin`, `/logincheck`, `/dashboard` | Admin login/session confirmed. |
| `/users/drivers/admin` | Admin user listing. |
| `/users/drivers/2` | Driver user listing. |
| `/users/dietitians/8` | Dietitian user listing. |
| `/users/list/3` | Customer/user listing. |
| Broad admin navigation | Authenticated admin could access many customer, payment, health, settings, content, and report screens. |
| No audit-log route found | Audit logs were not observed. |
| No permission matrix found | Role/permission editor was not observed. |

## Current Purpose

The old admin dashboard has authenticated users and role-like user types, but it does not provide confirmed RBAC, field-level permissions, approval rules, or audit logs. This module is therefore a gap analysis: the new system must treat security as a foundation rather than copying old admin visibility.

## Current Workflow

1. Admin logs into dashboard.
2. Admin can access broad modules.
3. Admin, driver, and dietitian user listing routes exist.
4. Row-level operations appear across modules.
5. No observed role-permission assignment workflow or audit review workflow.

## Data Shown Or Needed

- Existing: user identity/contact/status concepts for admins, drivers, dietitians, customers.
- Needed: roles, permissions, departments, kitchen sections, driver/chef assignments, field visibility rules, approval policies, audit events, session metadata, export logs, reason capture.

## Visible Actions

- Login and logout candidate.
- User row operation actions.
- Broad row operation actions across modules.
- Save/update/send/confirm/assign/export controls in different modules.

No destructive or state-changing action was clicked.

## State-Change Risks

- Overbroad admin access can expose customer, payment, and health data.
- Row operations may edit/delete/status-change records without confirmed permissions.
- Exports can leak sensitive data.
- Payment, notification, dispatch, and settings actions need strict approval/audit.
- No visible audit log means disputes and mistakes may be hard to trace.

## Current Pain Points

- Roles and permissions are not defined.
- Audit logs were not observed.
- Chef app must show assigned section tasks only.
- Drivers should see only delivery-needed data.
- Finance and health fields require restricted visibility.
- Settings, payment, notification, label, dispatch, and order actions require traceability.

## Preserve Decisions

- Preserve authenticated access.
- Preserve staff/admin/driver/dietitian user categories as evidence of role needs.
- Preserve logout/session controls as an authentication requirement.

## Improve Decisions

- Improve user management into staff directory with roles, departments, sections, shifts, active status, and access review.
- Improve broad admin visibility into least-privilege access.
- Improve exports and sensitive screens with permission checks and audit.

## Replace Decisions

- Replace implicit admin access with explicit RBAC.
- Replace untracked operations with audited action workflows.
- Replace generic row operations with named, role-gated actions.

## Add Decisions

- Add role-permission matrix.
- Add field-level data visibility.
- Add audit log for important actions.
- Add approval/reason rules for sensitive workflows.
- Add access review and permission change audit.
- Add integration secret handling and webhook validation audit.

## Automation And AI Opportunities

- Detect unusual access patterns or sensitive exports.
- Suggest permissions based on role templates.
- Flag missing audit reasons.
- Summarize audit history for an order/payment/dispatch event.
- Identify permission drift during periodic access review.

## Required New System Capabilities

- Authentication and session management.
- Role and permission management.
- Staff/user directory.
- Department, section, and assignment scoping.
- Field-level privacy controls.
- Action-level permissions.
- Audit event capture and search.
- Export audit.
- Sensitive action approval and reason capture.

## Required Data Entities And Fields

- `User`: identity, contact, status, auth provider, role assignments.
- `Role`: name, description, active status.
- `Permission`: resource, action, scope, sensitivity.
- `RolePermission`: role, permission, grant source.
- `UserAssignment`: user, department, kitchen section, driver area, shift.
- `AuditEvent`: actor, action, entity type/id, before/after, reason, timestamp, source IP/session if available.
- `ExportEvent`: report, filters, actor, purpose, timestamp.
- `ApprovalRequest`: action, requested by, approved by, status, reason.

## Required APIs High Level Only

- Auth/session API.
- User/staff API.
- Role API.
- Permission API.
- Assignment/scoping API.
- Field-visibility policy API.
- Audit event API.
- Export audit API.
- Approval workflow API.

## Role And Permission Needs

Baseline roles to confirm:

- System admin.
- Management.
- Customer service.
- Operations admin.
- Product/menu admin.
- Nutrition/dietitian.
- Kitchen manager.
- Chef.
- Packing.
- Dispatcher.
- Driver.
- Finance.
- Marketing/content.

Each role needs explicit screen, field, action, export, and approval permissions.

## Reports And KPIs

- Audit events by module/action/actor.
- Sensitive exports by user/report.
- Failed login and session anomalies.
- Permission changes.
- Access review status.
- High-risk actions by type.
- Orders/payments/dispatches changed after confirmation.

## Open Questions For Nutrezee

1. What roles exist today?
2. Which teams need separate dashboards or apps?
3. Which fields are sensitive by role: customer, payment, health, DOB, phone, address?
4. Which actions require approval?
5. What audit retention period is required?
6. Who can export finance/customer/health reports?
7. Should MFA be required for finance/admin roles?
8. What permission model is needed for chefs by section and drivers by route?

## Assumptions Marked

- RBAC is assumed missing from discovered admin evidence because no role/permission matrix or editor was found.
- Audit logs are assumed missing from discovered admin evidence because no audit-log route/screen was found.
- Role list is proposed from old-admin modules and target workflows; it is not confirmed as the current staff structure.

## Recommended Build Order

1. Define roles, permissions, and field visibility.
2. Build auth/session and staff directory.
3. Build audit event capture into the foundation.
4. Add role-gated navigation/actions.
5. Add export audit and approval rules.
6. Add access review and audit search.
