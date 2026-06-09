# Nutrezee Discovery Gaps And Assumptions

Date: 2026-06-09
Phase: Step 2B.1 Discovery Coverage Verification
Scope: docs only, no production login

## Purpose

This document lists what was not fully discovered, what was inferred from old dashboard evidence, and what must be confirmed with Nutrezee before Step 2C workflow and data modeling.

The old dashboard is a functional blueprint for baseline business modules, but it is not complete coverage of the future system.

## What Can Be Used As Blueprint

The following old dashboard areas can be used as business-function blueprint coverage:

- Dashboard operations overview.
- Customer/user listing.
- Driver listing.
- Admin user listing.
- Product/menu listing.
- Package/subscription listing.
- Order lists by active, pending, pause, expired, and canceled states.
- Coupon and coupon-category management.
- Advertising/offer management.
- Gallery/media management.
- Ingredients, allergies, meal types, diet status, tags, package-for types.
- Delivery time slots and delivery methods.
- General/contact settings.
- Static content pages.
- Contact messages.
- Subscribers.
- Social media links.
- Push notifications, excluding send/delete behavior.
- Monthly sales report.
- Daily sales report.
- Sales by payment report.
- Customer revenue report.
- Package expiration report.
- Dietician requests.

Use these as:

- Business coverage checklist.
- Module inventory.
- Starting point for data fields and role questions.
- Evidence of existing operational concepts.

Do not use these as:

- Final UX design.
- Backend architecture.
- Database schema.
- API design.
- Security model.
- Permission model.
- Complete workflow model.

## What Cannot Be Used As Blueprint Yet

These areas were not verified enough to be treated as blueprint:

- Customer-facing app.
- Website ordering, cart, and checkout.
- WhatsApp intake workflow.
- Kitchen/chef task app.
- Packing and label printing.
- Driver app.
- Driver assignment workflow.
- Backend/API contracts.
- Database schema.
- Payment gateway integration.
- Refund workflow.
- RBAC/permissions.
- Audit logs.
- Mobile apps.
- Hidden role-specific screens.
- Integrations: WhatsApp, payment, maps/geocoding, notification providers, printers, SMS/email.
- Inventory or ingredient stock dependency.
- Branch dispatch or central kitchen dispatch.
- Calories/macros and complete nutrition facts.

## Unsafe Or Skipped Routes

| Route / Area | Status | Why Skipped Or Unsafe | Step 2C Handling |
| --- | --- | --- | --- |
| `/orders/AutoAssignMealToDrivers` | Unsafe/skipped | Dashboard card route name indicates automatic assignment and may mutate production via GET. | Treat as replace candidate. Design safe dispatch workflow with POST/action confirmation, audit, and override rules. |
| Invalid login submission | Skipped | Would intentionally create failed production auth events. | Confirm validation behavior in staging only. |
| Row-level actions across lists | Skipped | Could edit, delete, approve, cancel, refund, status-change, assign, or save production data. | Model required actions from stakeholder workflows, not production clicks. |
| Save/submit buttons on settings/content/forms | Skipped | Could modify production settings/content/data. | Confirm behavior in staging or source code later. |
| `/driverOrders` | Skipped/unstable | Repeated timeout or DOM extraction failure during read-only audit. | Replace with dispatch board requirements; confirm any old business reports with operations. |
| `/summary` | Skipped/unstable | Timed out or changed navigation context during audit. | Replace with reliable analytics hub requirements. |
| `/confirm-payment` | Skipped/unstable | Timed out/stalled; payment actions are high risk. | Replace with controlled payment review workflow; validate in staging/source only. |
| `/orders/getTotalOrdersNew/tommorow` | Skipped/unstable | Timed out; dashboard card route only; no action submitted. | Replace with tomorrow production and dispatch readiness board. |

## Major Coverage Gaps

### Customer App And Website Ordering

Gap:

- Customer app, website ordering, cart, checkout, account, and customer order tracking were not audited.

Assumption:

- The new system will need a customer-facing or staff-assisted ordering surface, but exact scope is unknown.

Questions:

- Is there an existing customer website or mobile app?
- Is customer self-ordering required in first release?
- Should WhatsApp remain primary while website/app ordering is phased later?
- What account fields, address fields, payment steps, and order status views are required?

### WhatsApp Order Intake

Gap:

- Old dashboard did not show WhatsApp intake.

Assumption:

- Staff manually turn WhatsApp messages into orders today.

Questions:

- Which WhatsApp number(s) or groups receive orders?
- Should intake integrate with WhatsApp Business API or start with staff-assisted manual entry?
- What fields must be captured from each message?
- What order types arrive through WhatsApp: new order, renewal, pause, change, cancellation, complaint?
- Should original message text be stored, linked, or excluded for privacy?

### Kitchen And Chef App

Gap:

- Old dashboard only showed a pre-kitchen date check, not a full kitchen board or chef app.

Assumption:

- Kitchen has multiple sections and tasks must route automatically to chefs by section.

Questions:

- What are all kitchen sections?
- Which menu items/components route to each section?
- What are the chef roles, shifts, and section assignments?
- What task statuses should chefs use?
- Who can reassign or override kitchen tasks?
- What happens when a section is blocked or short?

### Packing And Label Printing

Gap:

- Old dashboard did not show packing checklist or automated labels.

Assumption:

- Labels are currently printed manually and need automation.

Questions:

- What fields must appear on each label?
- What label size and printer models are used?
- Are QR codes or barcodes required?
- When should labels print: on order confirmation, kitchen readiness, packing, or dispatch?
- Who can reprint labels?
- What audit trail is needed for reprints?

### Delivery, Dispatch, And Driver App

Gap:

- Old dashboard had drivers, delivery slots, and delivery methods, but driver assignment route was unstable and no driver app was observed.

Assumption:

- New system should assign drivers by area/location/time slot/capacity and support driver execution.

Questions:

- How are delivery areas defined?
- What makes a driver eligible for an order?
- What is driver capacity measured in: orders, boxes, bags, route duration, vehicle volume, or another unit?
- Is map/geocoding integration required for first release?
- What delivery statuses are required?
- What data can drivers see?
- Who can override assignments?

### Backend/API And Database

Gap:

- No application source code, API documentation, or database schema is available in the worktree.

Assumption:

- New system architecture and data model will be designed from requirements and stakeholder confirmation, not from old source.

Questions:

- Is old source code available for reference only?
- Is a sanitized old database schema available?
- Which old data must be migrated into the new system?
- What historical data must remain searchable?
- What external IDs must be preserved?

### Payments And Finance

Gap:

- Payment reports were observed, but payment gateway, confirmation, refund, and reconciliation workflows were not verified.

Assumption:

- New system must handle online and manual payment statuses for WhatsApp and website/app orders.

Questions:

- What payment methods are used today?
- Is payment captured before kitchen production?
- How are manual transfers confirmed?
- Who can confirm payment?
- What refund, credit, and cancellation rules apply?
- Which gateway/webhook events are required?

### RBAC And Audit Logs

Gap:

- Admin users were observed, but no detailed role/permission or audit-log module was observed.

Assumption:

- New system needs RBAC and audit logs from day one.

Questions:

- What roles exist today?
- What roles are needed for management, admin, customer service, kitchen manager, chef, packing, dispatcher, driver, finance, dietician?
- Which actions require approval?
- Which data fields should be hidden by role?
- What actions must be audited?

### Reports And Analytics

Gap:

- Old dashboard had sales/payment/revenue reports, but management analytics for kitchen, delivery, chefs, exceptions, and live operations were not verified.

Assumption:

- New system must include management analytics across orders, kitchen, delivery, chefs, and revenue.

Questions:

- Which KPIs are required on day one?
- Which reports must be exportable?
- Who can export sensitive reports?
- What time periods and filters are required?
- How should live operations dashboards differ from historical reports?

### Nutrition, Allergens, And Health Data

Gap:

- Ingredients, allergies, diet status, tags, meal types, and dietician requests were observed. Calories/macros and product-level nutrition facts were not verified.

Assumption:

- New system needs calories, protein, carbs, fat, allergens, dietary labels, and allergy warnings.

Questions:

- Which nutrition fields must be stored per item/meal/package?
- Which nutrition fields are customer-facing?
- How should allergy conflicts be detected?
- Who can edit nutrition data?
- Should dietician request data connect to customer profiles or remain separate?

### Hidden Role Screens And Mobile Apps

Gap:

- Hidden sidebar routes were found, but no role-specific menus, mobile apps, or alternate dashboards were verified.

Assumption:

- There may be existing workflows outside the audited admin dashboard.

Questions:

- Are there separate kitchen, driver, customer, finance, or branch dashboards?
- Are any workflows handled in mobile apps, spreadsheets, WhatsApp groups, or paper forms?
- Which teams currently do not use the old dashboard?

### Integrations

Gap:

- No integrations were technically verified.

Assumption:

- New system may need WhatsApp, payment gateway, maps/geocoding, notification, printer, SMS/email, and analytics integrations.

Questions:

- Which WhatsApp provider/account is used?
- Which payment gateway is used?
- Which maps/geocoding provider is preferred?
- Which notification channels are required?
- Which printers are used for labels?
- Are integrations required in first release or phased?

## Assumption Register

| Assumption | Confidence | Risk If Wrong | Confirmation Needed |
| --- | --- | --- | --- |
| Old dashboard modules represent core business coverage. | Medium | New system may miss modules outside old dashboard. | Confirm with management and department leads. |
| WhatsApp is the dominant order channel. | High | Intake design could target wrong channel priority. | Confirm volume by channel. |
| Phone number is a likely customer matching key. | Medium | Duplicate or wrong customer matches. | Confirm identity rules. |
| Kitchen tasks can be routed from item/component metadata. | Medium | Chef app routing may fail. | Confirm menu-component-section mapping. |
| Driver assignment can use area/location/time slot/capacity. | High | Dispatch algorithm may be too simple/complex. | Confirm exact rules and constraints. |
| Labels can be generated from order/box/delivery data. | Medium | Label design may miss operational fields. | Confirm label specs and printer hardware. |
| RBAC and audit logs are required from day one. | High | Security/privacy risk if delayed. | Confirm roles and audited actions. |
| Calories/macros are required for new system. | Medium | Nutrition scope may be too broad or incomplete. | Confirm product and customer-facing nutrition needs. |
| Old reports should be preserved as business outputs. | High | Management may lose familiar metrics. | Confirm report list and KPIs. |

## Recommendation Before Step 2C

Do not start detailed data modeling until Nutrezee confirms:

1. Missing app surfaces: customer, kitchen/chef, driver.
2. WhatsApp intake process and channel strategy.
3. Kitchen sections, chefs, and routing rules.
4. Label printing specs.
5. Driver assignment rules.
6. Payment/refund lifecycle.
7. RBAC and audit requirements.
8. P0 management KPIs.
9. Whether any hidden systems or spreadsheets are outside the old dashboard.
