# Nutrezee Module Discovery Depth Matrix

Date: 2026-06-09
Phase: Step 2C Full Admin-Controlled Existing App Discovery
Scope: read-only discovery depth matrix

Coverage values:

- Confirmed: observed enough structure to use as existing-system baseline.
- Partial: route/surface observed but incomplete, unstable, or action behavior not verified.
- Skipped: intentionally not opened or not clicked for production safety.
- Inaccessible: no access or surface was available in this step.
- Assumption: inferred from business needs/docs, not confirmed in the old system.

| Module | Coverage | Evidence | Missing Info | Required Access | Risk If Assumed | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| Admin authentication/session | Confirmed | `/admin`, `/logincheck`, `/dashboard`, logout candidate. | Logout execution, password policy, timeout, MFA. | Staging auth tests, source. | Weak security assumptions. | Define auth/session requirements. |
| Admin operations home | Confirmed | Dashboard cards and disabled date form. | Real KPI formulas, card action effects. | Staging/source. | New dashboard may show wrong KPIs/actions. | Map metrics and safe action queues. |
| Customer/user management | Confirmed | `/users/list/3`, `/users/newuser/9`. | Detail/edit fields, duplicate handling, addresses. | Staging, source, schema. | Customer model incomplete. | Analyze customer profile and address model. |
| Admin order creation | Confirmed read-only | `/orders/create` form fields and payment-link action. | Validation, side effects, payment link behavior, created order state. | Staging, payment sandbox, source. | Intake workflow may miss critical fields. | First detailed module analysis. |
| Order lifecycle lists | Confirmed | `/orders/list`, `/orders/list/Active`, pending, pause, expire, cancel. | State transitions, reasons, permissions, downstream recalculation. | Staging/source/schema. | Broken order state machine. | Build lifecycle/state diagram. |
| Package/subscription lifecycle | Confirmed/Partial | `/package`, `/packageFor`, active/pause/expire reports. | Calendar rules, off days, pause/resume/renewal logic. | Source/schema/stakeholders. | Wrong subscription dates and kitchen load. | Model package calendar rules. |
| Product/menu catalog | Confirmed | `/products`, `/mealsType`, `/tagslist`. | Product detail fields, availability, nutrition, kitchen routing. | Staging/source/schema. | Catalog cannot drive kitchen/labels. | Analyze catalog data model. |
| Ingredients | Confirmed | `/ingredients`, `/ingredients/add`. | Nutrition values, ingredient-product links, inventory. | Staging/source/schema. | Nutrition/inventory design wrong. | Confirm ingredient relationships. |
| Allergens | Confirmed | `/allergies`, `/allergies/add`. | Severity, product/customer warning logic. | Staging/source/schema. | Allergy safety gaps. | Define allergen warning rules. |
| Nutrition/macros | Partial | Calories appear in package/product names; diet/allergy/ingredient masters exist. | Structured calories/protein/carbs/fat fields. | Product detail, schema, nutrition stakeholders. | Healthy-food requirements underbuilt. | Confirm nutrition facts model. |
| Dietitian/health requests | Confirmed/Partial | `/users/dietitians/8`, `/dietician_requests`, `/diet-customer-service/dietactive-users` timeout. | Workflow statuses, notes, permissions, consent. | Dietitian test account, staging/source. | Health-data privacy risk. | Analyze dietitian workflow. |
| Drivers | Confirmed | `/users/drivers/2`. | Capacity, area, shifts, vehicles, app login. | Staging/source/driver app. | Dispatch model incomplete. | Define driver profile and availability. |
| Delivery slots/methods | Confirmed | `/timeSlots`, `/deliveryMethod`, add delivery method form. | Area capacity, cutoffs, pricing/rules. | Staging/source/operations. | Invalid delivery capacity planning. | Model slots/areas/cutoffs. |
| Dispatch/driver assignment | Partial/Skipped | `/driverOrders` timeout; `/orders/AutoAssignMealToDrivers` skipped. | Assignment algorithm, override, manifest, audit. | Staging/source/dispatcher interview. | Production assignment workflow unsafe. | Replace with dispatch board requirements. |
| Driver app | Inaccessible | No driver app/login audited. | Stops, statuses, proof, failure/reschedule. | Driver test login/app build/API docs. | Driver workflow guessed. | Require driver app discovery. |
| Kitchen planning | Partial | `/orders/short-meals-check`, `/orders/getMealsDateWiseFilter` error. | Output, shortages, sections, production plan. | Staging/source/kitchen stakeholders. | Kitchen automation inaccurate. | Capture kitchen planning flow. |
| Chef task app | Inaccessible | No chef screen/app found. | Sections, task statuses, assignments, exceptions. | Chef/kitchen test login or app build. | Chef UX and data model guessed. | Require chef app discovery or design from stakeholder input. |
| Packing checklist | Inaccessible | No packing screen found. | Box readiness, scan/check, exceptions. | Packing stakeholder/staging/source. | Handoff gaps remain. | Define packing workflow. |
| Label printing | Inaccessible | No label route found. | Label fields, size, printer, QR/barcode, batch rules. | Printer specs/staging/source. | Labels fail in operations. | Gather label requirements. |
| Payment status/reporting | Confirmed | Order lists, `/sales-report-by-payment`, `/customer-revenue-report`. | Gateway reconciliation, payment state machine. | Payment sandbox/source/schema. | Finance reports mismatch gateway reality. | Model payment lifecycle. |
| Payment confirmation | Partial | `/confirm-payment` timed out. | Review queue, approval/reject/hold, permissions. | Staging/payment sandbox/source. | Unsafe finance workflow. | Replace with safe payment review queue. |
| Refunds/credits | Partial/Assumption | Cashback exists; refund route not found. | Refund rules, gateway refunds, credits, approvals. | Finance stakeholder/payment sandbox. | Refund handling omitted. | Define refund and credit workflow. |
| Cashback/wallet | Confirmed | `/cashback/list`. | Ledger details, adjustments, expiry. | Staging/source/schema. | Wallet balances lack traceability. | Design ledger model. |
| Coupons/promotions | Confirmed | `/coupon`, `/coupon/category`, `/coupon/addcoupon`, `/advertise`. | Validation rules, eligibility, usage, approvals. | Staging/source/schema. | Promotion bugs and leakage. | Analyze promotion rules. |
| Content/media/legal | Confirmed | Gallery, video routes, about, why us, terms, return policy, social media. | Versioning, preview, publishing workflow. | Staging/source/content stakeholders. | Content changes unaudited. | Preserve lower-priority CMS requirements. |
| Contact/support | Confirmed | `/contact_us`. | Ownership, response workflow, ticket statuses. | Staging/source/customer service. | Support remains untracked. | Design support inbox. |
| Subscribers/marketing | Confirmed | `/subscribers`, push notification routes. | Consent, source, segmentation, unsubscribes. | Staging/source/marketing. | Privacy/consent gaps. | Define consent-aware marketing. |
| Push notifications | Confirmed read-only | `/pushnotification`, `/addpushnotification`. | Audience rules, delivery history, approval. | Notification sandbox/source. | Accidental customer messages. | Build approval-based notification center. |
| Reports/analytics | Partial | Sales/revenue reports confirmed; `/summary` timed out. | Operational analytics for kitchen/delivery/chefs/exceptions. | Source/schema/stakeholders. | Management dashboard incomplete. | Define KPI/report catalog. |
| RBAC/permissions | Not verified | Admin/dietitian/driver users exist; no role matrix found. | Roles, permissions, field-level access. | Staging accounts/source/security review. | Privacy and control failure. | Build RBAC from scratch. |
| Audit logs | Not verified | No audit-log screen found. | Events, before/after, actor, reason. | Source/schema/stakeholders. | No accountability for sensitive changes. | Define audit event catalog. |
| Backend/API | Inaccessible | No source/API docs in repo. | Controllers, services, mobile APIs, integrations. | Source repo/API docs. | Technical model guessed. | Obtain source and route map. |
| Database/schema | Inaccessible | No schema/export in repo. | Tables, relations, migrations, data migration. | Sanitized DB schema/backup. | Data model/migration wrong. | Obtain sanitized schema. |
| Customer website/app | Inaccessible | No customer login/cart/checkout audited. | UX, API, payments, order tracking. | Test customer login/app build. | Customer workflow guessed. | Require customer surface discovery. |
| Mobile apps | Inaccessible | No app builds or mobile routes audited. | Customer/driver/chef apps, APIs, release channels. | App builds, API docs, test logins. | App scope missed. | Inventory apps. |
| Integrations | Not verified | WhatsApp settings, gateway report fields, notification routes. | WhatsApp API, payment gateway, maps, SMS/email, printers, accounting. | Integration docs/sandboxes/source. | Integration failures at launch. | Build integration inventory. |
| Error handling | Partial | SQL/framework errors observed on direct routes. | Global error handling and validation. | Source/staging. | Sensitive internals exposed. | Add safe error pages and validation. |

## Depth Summary

Confirmed admin modules are sufficient for baseline business coverage, but not for technical, security, API, mobile, payment, kitchen, or dispatch design. Step 2D should treat the old admin as the functional baseline and require staging/source access before finalizing workflows with side effects.
