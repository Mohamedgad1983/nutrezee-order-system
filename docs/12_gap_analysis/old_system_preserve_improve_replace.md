# Nutrezee Old System Preserve / Improve / Replace Matrix

Date: 2026-06-09
Phase: Step 2B Old-System-to-New-System Feature Mapping
Scope: docs only

## Purpose

This matrix classifies old dashboard functions and new required capabilities into four decisions:

- Preserve: existing useful function that should remain functionally available.
- Improve: same business function, modernized for the new system.
- Replace: old risky/manual/unstable function replaced by safer automation.
- Add: missing capability required for the advanced new system.

## Matrix

| Area | Old Coverage | Decision | New-System Direction | Priority | Rationale |
| --- | --- | --- | --- | --- | --- |
| Dashboard home | Dashboard cards and shortcuts. | Improve | Live operations home with KPIs, alerts, queues, next-day readiness. | P0 | Old overview is useful but insufficient for management analytics. |
| Customer/user list | Users. | Improve | Customer profile, phone matching, addresses, preferences, allergies, order history. | P0 | Core customer function must remain and support WhatsApp intake. |
| Add user route | Add New User route looked like listing. | Replace | Explicit customer creation and duplicate detection. | P0 | Old route is ambiguous. |
| Driver records | Drivers. | Improve | Driver profile, shift, area, vehicle, capacity, availability. | P0 | Needed for app-based assignment. |
| Admin users | Admin Users. | Improve | Staff management with RBAC and section/department assignment. | P0 | Old admin list did not confirm role control. |
| Video content | Video Categories, User's Video, Video Tutorial. | Preserve | Keep as optional content/media management if business still uses it. | P2 | Not part of core operations. |
| Product catalog | Products. | Improve | Product/menu catalog with nutrition, allergen, category, package, and kitchen routing metadata. | P0 | Catalog drives orders, kitchen tasks, labels, and nutrition. |
| Ratings | Ratings. | Preserve | Keep product feedback/reporting. | P2 | Useful but not first dependency. |
| Cashback | Cashback. | Improve | Wallet/cashback ledger with audit and finance controls. | P1 | Financial balances require stronger traceability. |
| Packages | Packages. | Improve | Meal plan/subscription catalog with lifecycle and calendar rules. | P0 | Core Nutrezee business model. |
| Active orders | Customer Active Orders. | Improve | Active order queue with timeline, payment, kitchen, dispatch, audit. | P0 | Must be cloned functionally and connected to automation. |
| Pending orders | Customer Pending Orders. | Improve | Draft/review queue with validation and WhatsApp source handling. | P0 | Critical for manual order intake replacement. |
| Paused orders | Customer Pause Orders. | Improve | Pause/resume lifecycle with calendar and downstream recalculation. | P0 | Needed for subscriptions. |
| Expired orders | Customer Expired Orders. | Improve | Expiration and renewal management. | P1 | Useful for retention and operations. |
| Canceled orders | Customer Cancel Orders. | Improve | Cancellations with reason, finance impact, refund/credit workflow. | P0 | Needed for accountability. |
| Driver-wise orders | Orders Driver Wise route unstable. | Replace | Dispatch board with auto-assignment by area/location/time slot/capacity. | P0 | Old route did not reliably support future dispatch needs. |
| Birthday orders | Birthday Orders. | Preserve | Occasion/customer report with privacy controls. | P2 | Nice-to-have marketing/support function. |
| Pre-kitchen meal check | Pre-Kitchen Meal Check. | Improve | Kitchen planning, shortage detection, production readiness. | P0 | Old function is useful seed for kitchen operations. |
| Coupons | Coupon Master. | Improve | Coupon rule engine with usage, eligibility, audit. | P1 | Preserve promotion function with stronger controls. |
| Coupon categories | Coupon Category. | Preserve | Coupon segmentation/categories if still used. | P2 | Lower priority. |
| Advertisements/offers | Advertisements / Offer. | Preserve | Promotion scheduler and placement management. | P1 | Useful marketing module. |
| Gallery | Common Gallery. | Preserve | Media library. | P1 | Supports product/content media. |
| Ingredients | Ingredients. | Improve | Ingredient master with nutrition and allergen relationships. | P0 | Required for healthy-food credibility and kitchen planning. |
| Allergies | Allergies. | Improve | Allergen master with warnings across order, kitchen, customer profile. | P0 | Allergy safety risk. |
| Meal types | Meal Types. | Improve | Meal type model tied to products, schedule, routing, and labels. | P1 | Useful for catalog and kitchen. |
| Diet status | Diet Status. | Improve | Dietary program/status model tied to customer and product constraints. | P1 | Needed for nutrition workflow. |
| Tags | Tags. | Improve | Dietary/product tags with filtering and customer-facing visibility. | P1 | Improves discoverability and dietary labeling. |
| Package-for types | Package For Types. | Improve | Package eligibility/rule engine. | P0 | Needed for package lifecycle and new-customer rules. |
| Delivery time | Delivery Time. | Improve | Delivery slots with area capacity, cutoffs, kitchen dependency. | P0 | Required for dispatch automation. |
| Delivery methods | Delivery Methods. | Improve | Delivery methods tied to rules, availability, pricing if needed. | P1 | Preserve operational configuration. |
| General settings | General/Contact Setting. | Improve | Business settings with validation and audit. | P0 | Old settings must not be broad unaudited controls. |
| Static pages | About Us, Why Us. | Preserve | Static content management with preview. | P2 | Lower priority after core operations. |
| Terms | Terms and Conditions. | Improve | Versioned legal content. | P1 | Legal changes should be traceable. |
| Return policy | Return Policy. | Improve | Versioned return/refund policy tied to finance workflow. | P1 | Connect content to operational rules. |
| Contact messages | Contact Us. | Improve | Support inbox/ticket workflow. | P1 | Old list should become owned support workflow. |
| Subscribers | Subscribers. | Preserve | Subscriber management with consent controls. | P2 | Useful marketing data. |
| Social links | Social Media. | Preserve | Channel/social settings. | P2 | Low-risk settings. |
| Push notifications | Push Notification. | Improve | Notification center with templates, approvals, delivery history. | P1 | Prevent accidental sends and improve targeting. |
| Report summary | Report Summary route unstable. | Replace | Reliable analytics/reporting hub. | P0 | Old route was unstable and insufficient. |
| Monthly sales | Monthly Sales report. | Improve | Finance analytics with filters and controlled exports. | P0 | Must preserve finance reporting. |
| Daily sales | Daily Sales report. | Improve | Daily finance report with reconciliation and privacy controls. | P0 | Core finance report. |
| Sales by payment | Sales by Payment (New). | Improve | Payment analytics and gateway reconciliation. | P0 | Critical for payment visibility. |
| Customer revenue | Customer Revenue (New). | Improve | Revenue analytics with accrual model and cohort filters. | P0 | Useful management report. |
| Confirm payment | Confirm Payment route unstable. | Replace | Payment review queue with safe approve/reject/hold and audit. | P0 | Old route cannot be trusted as-is. |
| Expiration report | Today Expiration. | Improve | Expiration and renewal queue/report. | P1 | Supports customer retention and operations. |
| Dietician requests | Dietician Requests. | Improve | Privacy-aware dietician request and appointment workflow. | P1 | Health data needs controlled workflow. |
| Tomorrow orders card | Total Of Tommorow New route timed out. | Replace | Tomorrow production and dispatch readiness board. | P0 | Core daily operating plan should be reliable. |
| WhatsApp order intake | Not observed. | Add | Structured WhatsApp draft order intake and review. | P0 | Known current manual pain point. |
| Kitchen section routing | Not observed. | Add | Automatic order-item-to-section task routing. | P0 | Required for multi-section kitchen. |
| Chef task app | Not observed. | Add | Section-scoped chef task app. | P0 | Required so chefs see only assigned work. |
| Label printing | Not observed. | Add | Automated box labels, batch printing, QR/barcode support if confirmed. | P0 | Known manual pain point. |
| Packing checklist | Not observed. | Add | Verify all section tasks before dispatch. | P0 | Needed between kitchen and delivery. |
| Driver app | Not observed. | Add | Driver assignment list and delivery status updates. | P0 | Required for dispatch execution. |
| RBAC | Not confirmed. | Add | Role-permission matrix and enforcement. | P0 | Must protect operations, finance, customer, health data. |
| Audit logs | Not observed. | Add | Audit all important operational and financial changes. | P0 | Required for accountability. |
| Nutrition macros | Not observed. | Add | Calories, protein, carbs, fat per item/meal/package. | P0 | Needed for healthy-food platform. |
| Inventory dependency | Not observed. | Add | Ingredient availability and production dependency if confirmed. | P1 | Important for kitchen planning. |

## Top Preserve Decisions

- Preserve old dashboard coverage for products, packages, customers, drivers, orders, coupons, promotions, media/content, delivery methods, notifications, and reports.
- Preserve lower-priority content and marketing modules after operational foundations.

## Top Improve Decisions

- Improve customer management into customer profiles with WhatsApp matching.
- Improve products/packages into a menu, nutrition, and kitchen-routing catalog.
- Improve orders into a full lifecycle with validation, audit, kitchen, dispatch, and finance linkage.
- Improve reports into management analytics with role-based exports.
- Improve settings, notifications, and finance workflows with validation and audit trails.

## Top Replace Decisions

- Replace unstable or risky driver assignment routes with a dispatch board.
- Replace payment confirmation route with a controlled finance review queue.
- Replace next-day order card with a tomorrow production and dispatch board.
- Replace ambiguous add-user route with clear customer creation and duplicate detection.

## Top Add Decisions

- Add WhatsApp order intake.
- Add kitchen section routing and chef task app.
- Add label printing and packing checklist.
- Add driver app.
- Add RBAC and audit logs.
- Add nutrition macros and allergy safety warnings.
