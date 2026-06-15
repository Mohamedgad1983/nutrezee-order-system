# Legacy Admin Baseline Matrix

Date: 2026-06-15

Evidence labels:
- Verified: directly present in repository discovery docs or current code.
- Inferred: reasonable from old route names/module docs, not directly exercised.
- Needs Confirmation: requires legacy credentials/source/database or workshop decision.

| Legacy Area | Legacy Route / Evidence | Business Purpose | New Admin Equivalent | Status | Priority | Notes |
|---|---|---|---|---|---|---|
| Dashboard | `/dashboard`; route inventory | Admin operations home, cards for users/orders/assignment | `/app/dashboard` | Partial | P1 | Verified: new live dashboard exists. Needs confirmation: old card semantics, tomorrow cards. |
| Order create | `/orders/create`; order module analysis | Staff-assisted order entry with customer/package/delivery/payment fields | `/app/intake` | Built for order-ops path | P0 | Verified: new draft intake exists. Payment link generation is replaced by manual link record/request flow. |
| Order lifecycle lists | `/orders/list`, `/orders/list/Active`, `/orders/list/pending`, `/orders/list/Pause`, `/orders/list/Expire`, `/orders/list/cancel` | Monitor order lifecycle by state | `/app/orders` | Built and improved on current branch | P0 | Verified: new unified orders page has search, status tabs, CSV, modal detail/actions. |
| Order detail / row operations | Operation columns on order lists | Inspect/change order state, schedule, exceptions | `/app/orders` modal | Built and improved on current branch | P0 | Verified: view, schedule, status change, change request, exception, payment tabs. |
| Review queue | Old pending list, no explicit safe workflow | Approve/return/reject intake before order conversion | `/app/review-queue` | Built | P0 | Inferred improvement over old pending route. |
| Customers | `/users/list/3`, `/users/newuser/9`; customer module docs | Customer list/profile/order entry source | `/app/customers` | Built and improved this session | P0 | Verified: list/search/create/edit/merge. This session adds address add and order history. |
| Customer addresses | `/orders/create` address fields; customer docs | Delivery address capture and reuse | `/app/customers` profile + `/app/intake` | Built this session for profile add | P0 | Verified: backend existed; UI add-address now added. Area remains optional until workshop values. |
| Customer order history | `/users/list/3` operation, old table order totals | Customer profile operational context | `/app/customers` profile | Built this session | P0 | Verified: `/orders?customer_id=` filter added. |
| Drivers | `/users/drivers/2` | Driver master records | None, only RBAC driver role/fulfillment statuses | Gap | P2/P0 if dispatch enters cutover | Deferred by current OS rules | Current project forbids dormant dispatch/driver UI without new amendment. |
| Driver assignment | `/driverOrders`, `/orders/AutoAssignMealToDrivers` | Driver-wise/auto assignment | None | Gap, unsafe legacy route | P2/P0 if dispatch enters cutover | `AutoAssignMealToDrivers` is action-like and skipped as unsafe. |
| Products/meals | `/products` | Product/menu catalog | `/app/catalog` | Partial | P1 | Read/enrichment exists; full CRUD/publish/availability not built. |
| Packages/meal plans | `/package`, `/packageFor` | Meal-plan catalog, package-for rules | `/app/catalog` | Partial | P0/P1 | Read-only mirror-mode; real import and cutover flag required. |
| Ingredients | `/ingredients`, `/ingredients/add` | Ingredient master | `/app/catalog` masters tab | Partial | P1 | Read-only via catalog masters; no admin CRUD surface for catalog masters yet. |
| Allergies | `/allergies`, `/allergies/add` | Allergen master and safety data | `/app/catalog` + product allergen declare | Partial | P1 | Product allergen declaration exists. Customer allergy write API exists, no profile UI editor. |
| Meal types | `/mealsType`, `/addMeal` | Meal category/type | `/app/catalog` masters tab | Partial | P1 | Read-only catalog master browse. |
| Diet statuses | `/dietstatuslist` | Dietary program/status metadata | `/app/catalog` masters tab | Partial | P1 | Read-only; customer diet-status editing not built. |
| Tags | `/tagslist` | Product labels/filtering | `/app/catalog` masters tab | Partial | P1 | Read-only. |
| Delivery times | `/timeSlots` | Delivery slot master | `/app/settings` masters | Partial | P0 | View/add slot exists in settings; advanced capacity/cutoff rules still workshop-owned. |
| Delivery methods | `/deliveryMethod`, `/deliveryMethod/addDeliveryMethod` | Delivery method master | `/app/settings` masters | Partial | P0 | View/add method exists; dispatch rules absent. |
| Coupons | `/coupon`, `/coupon/category`, `/coupon/addcoupon` | Promotions and coupon validation | Coupon code captured in intake/import only | Gap | P1 | Coupon validation mode is warning by assumption; no coupon admin module. |
| Cashback | `/cashback/list` | Wallet/cashback finance ledger | None | Gap | P2 | Deferred off daily-order cutover path by current plan. |
| Advertisements/offers | `/advertise` | Marketing promotions | None | Deferred | P3 | Explicitly off daily-order critical path. |
| Gallery/video/content pages | `/gallery`, `/about_us`, `/why_us`, `/terms`, `/return-policy`, video routes | CMS/media/legal content | None | Deferred | P3 | Explicitly off daily-order critical path. |
| Contact messages | `/contact_us` | Customer support inbox | `/app/exceptions` for operational exceptions only | Partial | P2 | Full support inbox not built. |
| Subscribers | `/subscribers` | Marketing email subscribers | None | Deferred | P3 | Verified: marketing list, not meal-plan subscriptions. |
| Social media | `/socialmedia` | Channel links | None | Deferred | P3 | Off order-ops path. |
| Push notifications | `/pushnotification`, `/addpushnotification` | Customer notification send/history | Internal/email-capable notification log only | Gap/deferred | P2/P3 | Customer push sending is deliberately dormant. |
| Sales reports | `/salesreport`, `/singledaysalesreport` | Finance sales reports | `/app/reports` operational reports only | Gap | P1 | Finance-report parity deferred unless MVP cut amended. |
| Payment report | `/sales-report-by-payment` | Payment-method/gateway sales report | `/app/payments`, `/app/reports` | Partial | P1 | Payment review exists; finance report parity not built. |
| Customer revenue report | `/customer-revenue-report` | Accrual/customer revenue | None equivalent | Gap | P1/P2 | Needs accounting rule confirmation. |
| Confirm payment | `/confirm-payment` | Payment confirmation | `/app/payments` finance review queue | Built for safer flow | P0 | Old route timed out; new queue uses audited decisions. |
| Package expiration | `/packageexpirestoday` | Renewal/expiration follow-up | Reports/orders filters only | Gap | P1 | Renewal queue not built. |
| Dietician requests | `/dietician_requests`, `/diet-customer-service/dietactive-users` | Health/dietitian request workflow | None | Gap | P1/P2 | Health-sensitive and not in current order-ops cutover path. |
| Kitchen/pre-kitchen | `/orders/short-meals-check`, `/orders/getMealsDateWiseFilter` | Kitchen readiness and date-wise meals | `/app/kitchen`, reports | Partial | P0/P1 | Kitchen board exists; routing content still workshop-gated. |

## Risky Or Unstable Legacy Routes

| Route | Evidence | Handling |
|---|---|---|
| `/orders/AutoAssignMealToDrivers` | Route inventory marks as action-like and skipped | Do not execute. Replace with audited POST dispatch workflow only after scope amendment. |
| `/driverOrders` | Timed out/unstable | Do not rely on behavior without safe staging/source access. |
| `/summary` | Timed out/unstable | Replace with explicit report endpoints. |
| `/confirm-payment` | Timed out/unstable | New system uses payment review queue. |
| `/orders/getTotalOrdersNew/tommorow` | Timed out/typo route | Replace with tomorrow readiness report/board. |
| `/orders/getMealsDateWiseFilter` | Direct navigation exposed framework/SQL error | New reports must validate inputs and avoid error leakage. |
