# Nutrezee Old-To-New Feature Map

Date: 2026-06-09
Phase: Step 2B Old-System-to-New-System Feature Mapping
Scope: docs only, no production access

## Purpose

The old Nutrezee dashboard is the functional blueprint for baseline module coverage. The new advanced Nutrezee system must cover the same business modules first, then improve or replace weak/manual/risky workflows with modern automation.

This map uses Step 1 dashboard audit evidence and Step 2A operational requirements. The "Required APIs" column describes conceptual new-system API capabilities, not confirmed old production APIs.

## Decision Key

- Preserve: clone useful function in the new system with equivalent business coverage.
- Improve: keep the business function but modernize UX, data model, permissions, analytics, or workflow.
- Replace: replace risky/manual/unclear old behavior with safer automated workflow.

## Old Dashboard Screen Map

| Old Screen | Current Purpose | New Module | Preserve/Improve/Replace | Required Data | Required APIs | Required UI | Roles | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | Operations landing page with cards, date disable form, subscription/order shortcuts. | Admin Operations Home | Improve | Live order counts, active subscriptions, kitchen load, delivery load, alerts, disabled dates. | Dashboard metrics API, operations alert API, capacity calendar API. | Role-based home dashboard with live KPIs and action queues. | Management, admin, operations. | P0 | Clone functional overview, replace static cards with live operations dashboard. |
| Users | Customer/user listing with identity, contact, DOB, order totals, status, operations. | Customer Management | Improve | Customer profile, phone, addresses, preferences, allergies, order history, status. | Customer API, profile match API, order history API, audit API. | Customer list/detail, search, filters, profile merge/review. | Admin, customer service, management. | P0 | Clone customer listing; improve with WhatsApp identity matching and privacy controls. |
| Add New User | Route labeled add user but observed as user listing. | Customer Creation / Intake | Replace | New customer draft, phone, address, preferences, allergies, source. | Customer create API, validation API, duplicate detection API. | Guided customer creation from order intake. | Customer service, admin. | P0 | Replace ambiguous old route with explicit customer creation and duplicate prevention. |
| Drivers | Driver/user listing with contact, status, operations. | Driver Management | Improve | Driver profile, area, vehicle, capacity, availability, shift, status. | Driver API, capacity API, availability API, audit API. | Driver list/detail, capacity schedule, availability controls. | Dispatcher, admin, management. | P0 | Clone driver records; improve for dispatch automation. |
| Admin Users | Admin user listing. | Staff And Admin Management | Improve | Staff identity, role, department, section, permissions, status. | Staff API, RBAC API, audit API. | Staff directory, role assignment, access review. | System admin, management. | P0 | Clone staff/admin listing; add RBAC and least privilege. |
| Video Categories | Hidden video category management. | Content / Education Media | Preserve | Category name, language, image, status. | Content category API, media API. | Category list/editor. | Marketing, content admin. | P2 | Preserve if business still uses video content. |
| User's Video | Hidden user video listing. | Content / User Media | Preserve | Video title, media, category, status. | Video API, media API. | Video list/editor. | Marketing, content admin. | P2 | Preserve only if current content workflow is still needed. |
| Video Tutorial | Hidden tutorial video listing. | Content / Tutorial Media | Preserve | Tutorial title, video ID/link, category, status. | Tutorial API, media API. | Tutorial list/editor. | Marketing, content admin. | P2 | Preserve optional training/content capability. |
| Products | Product/menu listing with English/Arabic names, category, package association, status. | Menu And Product Catalog | Improve | Item names, category, package links, price, availability, images, nutrition, allergens, routing sections. | Product API, category API, package API, nutrition API, kitchen routing API. | Product catalog, product editor, availability and routing tabs. | Product admin, nutrition, kitchen manager. | P0 | Clone product coverage; improve with macros, allergens, and section routing. |
| Ratings | Product ratings and average rating summary. | Product Feedback | Preserve | Product, package, average rating, rating count, comments if available. | Rating API, product API, report API. | Ratings list, product feedback report. | Product admin, management. | P2 | Preserve as quality feedback after core order flows. |
| Cashback | Active cashback balance and entries by customer. | Customer Wallet / Cashback | Improve | Customer, wallet balance, ledger entries, reason, expiry, status. | Wallet API, ledger API, customer API, audit API. | Wallet ledger, adjustment workflow, export. | Finance, customer service, management. | P1 | Preserve business function; improve ledger integrity and audit. |
| Packages | Package/subscription catalog with English/Arabic names, priority, coupon, operations. | Meal Plans And Packages | Improve | Package, sub-package, duration, price, meals, off days, coupon eligibility, status. | Package API, pricing API, calendar API, coupon API. | Package catalog, plan builder, pricing and delivery calendar. | Product admin, management, finance. | P0 | Clone packages; improve lifecycle and subscription rules. |
| Customer Active Orders | Active order list with package, dates, transaction, payment, status, coupon, amounts. | Order Management | Improve | Order, customer, plan, dates, payment, status, coupon, amounts, source, assignments. | Order API, payment API, status API, export API, audit API. | Active order queue, filters, detail, status history. | Operations, customer service, management. | P0 | Clone active orders; improve with intake source, audit, kitchen/dispatch linkage. |
| Customer Pending Orders | Pending order list with same order structure. | Order Review Queue | Improve | Draft/pending order, missing fields, payment hold, review owner, reason. | Order review API, validation API, status API, audit API. | Pending queue with validation blockers and review actions. | Operations, customer service, finance. | P0 | Clone pending coverage; improve with WhatsApp order review workflow. |
| Customer Pause Orders | Paused order list. | Subscription Pause Management | Improve | Pause dates, reason, impacted deliveries, customer confirmation, audit. | Subscription API, calendar API, pause API, audit API. | Pause queue, calendar impact preview, resume controls. | Customer service, operations. | P0 | Clone pause state; improve downstream kitchen/delivery recalculation. |
| Customer Expired Orders | Expired package/order list. | Expiration And Renewal Management | Improve | Expiry date, remaining days/meals, renewal status, customer contact state. | Subscription API, renewal API, notification API, report API. | Expiration queue and renewal follow-up. | Customer service, sales, management. | P1 | Clone expiration visibility; improve renewal workflow. |
| Customer Cancel Orders | Canceled order list. | Cancellation Management | Improve | Cancellation reason, date, refund/credit impact, actor, audit. | Cancellation API, payment/refund API, audit API. | Cancellation queue, reason capture, finance impact view. | Customer service, finance, management. | P0 | Clone canceled state; improve reason and financial traceability. |
| Orders Driver Wise | Driver-wise order route was unstable. | Delivery Assignment Board | Replace | Orders, drivers, routes, area, location, capacity, time slot, handoff status. | Dispatch API, driver assignment API, geocoding API, capacity API. | Dispatch board with auto-assign, manual override, map/list views. | Dispatcher, operations, drivers, management. | P0 | Replace unstable old route with safe dispatch automation. |
| Birthday Orders | Birthday-related order/customer report. | Customer Occasion Report | Preserve | Customer DOB/occasion, order, contact preference, date filter. | Customer report API, order API. | Occasion report and optional campaign queue. | Marketing, customer service. | P2 | Preserve if used for campaigns; protect sensitive DOB access. |
| Pre-Kitchen Meal Check | Date-based pre-kitchen shortage check. | Kitchen Planning / Shortage Check | Improve | Date, planned meals, ingredients, sections, shortages, substitutions. | Kitchen plan API, shortage API, inventory API, exception API. | Pre-kitchen planning board and shortage exception queue. | Kitchen manager, operations. | P0 | Clone shortage check; improve into full kitchen planning workflow. |
| Coupon Master | Coupon listing with code, usage counts, status. | Coupon Management | Improve | Coupon code, type, limits, eligibility, usage, status, expiry. | Coupon API, validation API, usage API, audit API. | Coupon list/editor, rule builder, usage report. | Marketing, finance, admin. | P1 | Clone coupons; improve validation and audit. |
| Coupon Category | Coupon category list. | Coupon Segmentation | Preserve | Category name, description, status. | Coupon category API. | Category list/editor. | Marketing, admin. | P2 | Preserve if coupon grouping remains useful. |
| Advertisements / Offer | Offer/advertisement management with images, dates, sort, type, status. | Promotions And Banners | Preserve | Offer content, media, start/end date, placement, language, status. | Promotion API, media API. | Promotion scheduler and media editor. | Marketing, content admin. | P1 | Preserve marketing function with better scheduling. |
| Common Gallery | Media gallery. | Media Library | Preserve | Media file, type, usage, language, metadata. | Media API, upload API. | Media library, picker, usage references. | Marketing, content admin, product admin. | P1 | Preserve as shared media foundation. |
| Ingredients | Ingredient master. | Ingredient And Nutrition Master | Improve | Ingredient names, language, allergen links, nutrition, availability. | Ingredient API, nutrition API, allergen API. | Ingredient list/editor and relationships. | Nutrition, product admin, kitchen manager. | P0 | Clone ingredients; improve for nutrition and inventory dependency. |
| Allergies | Allergy/allergen master. | Allergen Management | Improve | Allergen names, language, severity, linked ingredients/products. | Allergen API, product-allergen API, warning API. | Allergen master and product/customer warning views. | Nutrition, product admin, customer service. | P0 | Clone allergies; improve allergy safety across ordering and kitchen. |
| Meal Types | Meal type master. | Meal Type Management | Improve | Meal type, image, language, schedule rules, product links. | Meal type API, product API, calendar API. | Meal type master and menu assignment UI. | Product admin, nutrition, kitchen manager. | P1 | Preserve and improve with schedule/routing rules. |
| Diet Status | Diet status master. | Dietary Program Management | Improve | Diet status/program, language, eligibility, product/plan links. | Diet program API, customer profile API, product API. | Diet program list/editor and assignment controls. | Nutrition, customer service. | P1 | Clone dietary tags/status; improve with customer restrictions. |
| Tags | Product tags. | Dietary And Product Tags | Improve | Tags, language, product links, filters, customer-facing visibility. | Tag API, product-tag API, search/filter API. | Tag master and product assignment UI. | Product admin, nutrition. | P1 | Preserve tags; improve filtering and dietary labeling. |
| Package For Types | Package audience/type config with Friday off and new-customer flags. | Package Rules And Eligibility | Improve | Audience type, off-day rules, customer eligibility, active flags. | Eligibility API, package rule API, calendar API. | Package rules editor. | Product admin, operations. | P0 | Clone package rules; improve lifecycle and eligibility logic. |
| Delivery Time | Delivery time slot master. | Delivery Slot Management | Improve | Slot name, start/end, area availability, capacity, cutoff. | Time slot API, capacity API, cutoff API. | Slot master, capacity calendar, cutoff controls. | Operations, dispatcher, admin. | P0 | Clone slots; improve for dispatch capacity and kitchen timing. |
| Delivery Methods | Delivery method master. | Delivery Method Management | Improve | Method name, area, price/rule if any, availability, status. | Delivery method API, pricing/rule API. | Delivery method list/editor. | Operations, dispatcher, admin. | P1 | Preserve and tie to dispatch and checkout. |
| General/Contact Setting | General settings including social links, WhatsApp, checkout gap, capacity date. | System Settings | Improve | Business settings, channels, checkout rules, capacity rules, social/contact info. | Settings API, config audit API, validation API. | Settings panels with audit and validation. | System admin, management. | P0 | Clone required settings; improve with scoped permissions and audit. |
| About Us | Static content editor. | Content Management | Preserve | Page content, language, image, status, publish metadata. | CMS API, media API. | Static page editor with preview. | Content admin, marketing. | P2 | Preserve if customer site content remains in scope. |
| Why Us | Static content editor. | Content Management | Preserve | Page content, language, image, status, publish metadata. | CMS API, media API. | Static page editor with preview. | Content admin, marketing. | P2 | Preserve content capability. |
| Terms and Conditions | Terms editor. | Legal Content Management | Improve | Terms content, language, version, effective date, acceptance tracking. | Legal content API, version API. | Versioned legal content editor. | Admin, legal/management. | P1 | Preserve terms; improve versioning. |
| Return Policy | Return/refund policy editor. | Legal / Policy Content | Improve | Policy content, language, version, effective date. | Policy API, version API. | Versioned policy editor. | Admin, legal/management. | P1 | Preserve policy; improve versioning and relation to refund rules. |
| Contact Us | Contact message listing. | Customer Support Inbox | Improve | Contact message, source, customer link, status, owner, response notes. | Support ticket API, customer API, notification API. | Support inbox with assignment and status. | Customer service, management. | P1 | Clone contact review; improve into ticket workflow. |
| Subscribers | Subscriber listing. | Subscriber Management | Preserve | Email/contact, status, consent, source, timestamps. | Subscriber API, consent API. | Subscriber list and export with permission controls. | Marketing, admin. | P2 | Preserve with consent and privacy controls. |
| Social Media | Social link management. | Channel Settings | Preserve | Channel, title, URL, status. | Channel settings API. | Social/channel link editor. | Marketing, admin. | P2 | Preserve as low-risk settings function. |
| Push Notification | Push notification form/list. | Notification Center | Improve | Audience, title, message, channel, schedule, delivery status, audit. | Notification API, audience API, template API, audit API. | Notification composer with preview, approval, history. | Marketing, operations, management. | P1 | Clone notification capability; improve approval and audit to prevent accidental sends. |
| Report Summary | Summary report route was unstable. | Management Reports Overview | Replace | Aggregated KPIs, filters, report links, role access. | Analytics API, report API, export API. | Reports home with reliable widgets and filters. | Management, finance, operations. | P0 | Replace unstable summary with reliable analytics hub. |
| Monthly Sales report | Monthly sales report. | Finance Reports | Improve | Month, purchases, purchase value, payment status, channel, package. | Finance report API, export API. | Monthly sales dashboard and export. | Finance, management. | P0 | Clone financial reporting; improve reconciliation and filters. |
| Daily Sales report | Daily sales report with customer/payment columns and export. | Finance Reports | Improve | Date, order, customer reference, paid amount, package amount, payment method. | Daily sales API, export API, privacy filter API. | Daily sales table with role-based sensitive fields. | Finance, management. | P0 | Clone report; improve privacy and reconciliation. |
| Sales by Payment (New) | Payment-method sales report. | Payment Analytics | Improve | Order date, order, customer reference, plan, payment method, gateway ID, paid amount. | Payment report API, gateway reconciliation API, export API. | Payment method report and reconciliation view. | Finance, management. | P0 | Clone and strengthen payment analytics. |
| Customer Revenue (New) | Accrual-style customer revenue report. | Revenue Analytics | Improve | Order, plan window, paid amount, active days, per-day revenue, revenue period. | Revenue API, subscription calendar API, export API. | Revenue accrual report and cohort filters. | Finance, management. | P0 | Clone revenue report; improve with consistent accounting model. |
| Confirm Payment (New) | Payment confirmation route timed out. | Payment Review And Confirmation | Replace | Payment proof/status, gateway record, order, amount, reviewer, decision, audit. | Payment review API, gateway API, status API, audit API. | Payment review queue with approve/reject/hold in safe workflow. | Finance, operations, management. | P0 | Replace unstable route with controlled payment lifecycle. |
| Today Expiration | Package expiration report. | Expiration And Renewal Reports | Improve | Customer reference, order, days left, package, renewal status. | Expiration report API, renewal API, notification API. | Expiration queue/report with follow-up status. | Customer service, sales, management. | P1 | Clone report; improve renewal workflow. |
| Dietician Requests | Dietician request table with health fields. | Dietician / Nutrition Requests | Improve | Request profile, appointment date, status, nutrition notes, consent, owner. | Dietician request API, appointment API, privacy API. | Dietician request inbox and appointment workflow. | Dietician, customer service, management. | P1 | Clone request tracking; improve privacy and workflow status. |
| Total Of Tommorow New | Dashboard-card route for tomorrow orders, timed out. | Tomorrow Production And Dispatch Plan | Replace | Next-day orders, kitchen tasks, labels, routes, capacity, exceptions. | Production planning API, dispatch API, label API, analytics API. | Tomorrow planning board with kitchen and delivery readiness. | Operations, kitchen manager, dispatcher, management. | P0 | Replace broken card route with core next-day operating plan. |

## Functional Clone Baseline

The new system must functionally cover these old business areas before adding advanced automation:

- Dashboard/operations overview.
- Customers/users.
- Staff/admin users.
- Drivers.
- Products/menu.
- Packages/subscriptions.
- Orders and order states.
- Coupons/cashback/promotions.
- Media/content/settings.
- Ingredients, allergens, meal types, diet status, tags.
- Delivery slots/methods.
- Notifications.
- Reports for sales, payments, revenue, expiration, and dietician requests.

## Improvement Overlay

The new system must improve or replace old coverage in these P0 areas:

- WhatsApp order intake.
- Kitchen section routing.
- Chef task app.
- Box label printing.
- Driver assignment by area/location/time slot/capacity.
- Management analytics.
- RBAC and audit logs.
- Nutrition/macros/allergen safety.
- Payment confirmation, reconciliation, refunds, and finance reports.
