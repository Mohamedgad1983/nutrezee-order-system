# Nutrezee Step 1B Dashboard Audit

Date: 2026-06-09
Dashboard: `https://nutreeze.com/dashboard`
Mode: Browser/Playwright read-only audit

## 1. Executive Summary

The dashboard is an authenticated admin system for Nutrezee operations. It exposes modules for users, products, packages, orders, coupons, cashback, delivery configuration, content/settings, reports, payment reporting, and dietician requests.

The dashboard has meaningful operational coverage for an existing healthy-food subscription/order business, but it also shows important readiness gaps:

- No visible logout control was found.
- Several operational routes are hidden in the sidebar while still discoverable by URL.
- Some routes timed out or were unstable: `/driverOrders`, `/summary`, `/confirm-payment`, and `/orders/getTotalOrdersNew/tommorow`.
- A dashboard card links to `/orders/AutoAssignMealToDrivers`, which was skipped because it appears action-like and may mutate production data.
- Nutrition support is present through ingredients, allergies, diet status, tags, meal types, and dietician requests, but calories/macros and food production windows were not visible.
- Payment reporting exists, but payment confirmation and refunds were not verified.

No production data was changed.

## 2. Login Audit

| Item | Observation |
| --- | --- |
| Login URL | Visiting `/dashboard` while unauthenticated redirected to `https://nutreeze.com/admin`. |
| Page title | `Nutrezee`. |
| Form action | POST `/logincheck`. |
| Email field | `input[name="email_address"]`, type `text`, placeholder `Email Address`, no HTML `required`, no `autocomplete`. |
| Password field | `input[name="password"]`, type `password`, placeholder `Password`, no HTML `required`, no `autocomplete`. |
| Submit label | `SIGN IN`. |
| Validation behavior | Client-side HTML validation appears minimal. Invalid/empty submission was not tested to avoid creating failed production authentication events. |
| Successful session | After login, landed on `https://nutreeze.com/dashboard`, title `Nutrezee - Dashboard`. |
| Session reload | Reloading `/dashboard` stayed authenticated. |
| Logout behavior | No logout/sign-out link or button was found in visible or hidden DOM links/buttons. Logout was not clicked because no unambiguous control existed. |

## 3. Navigation Inventory

Visible sidebar/top-level items:

- Dashboard
- Users
- Products
- Ratings
- Cashback
- Packages
- Orders
- Coupon Module
- Advertisements / Offer
- Common Gallery
- Masters
- Contact Us
- Subscribers
- Social Media
- General Setting
- Push Notification
- Reports

Collapsed or hidden routes found in the sidebar:

- Users: `/users/list/3`, `/users/newuser/9`, `/users/drivers/2`, `/users/drivers/admin`
- Video section: `/userVideoCategory`, `/userVideo/list`, `/tutorialvideolist`
- Orders: `/orders/list/Active`, `/orders/list/pending`, `/orders/list/Pause`, `/orders/list/Expire`, `/orders/list/cancel`, `/driverOrders`, `/birthdayOrders`, `/orders/short-meals-check`
- Coupons: `/coupon`, `/coupon/category`
- Masters: `/ingredients`, `/allergies`, `/mealsType`, `/dietstatuslist`, `/tagslist`, `/packageFor`, `/timeSlots`, `/deliveryMethod`, `/settings`, `/about_us`, `/why_us`, `/terms`, `/return-policy`
- Reports: `/summary`, `/salesreport`, `/singledaysalesreport`, `/sales-report-by-payment`, `/customer-revenue-report`, `/confirm-payment`, `/packageexpirestoday`, `/dietician_requests`

Dashboard cards observed:

- Unique Registered Users
- Active Subscriptions
- Week of Nutrezee
- Total Of Tommorow New
- Assign Driver to Meal

The `Assign Driver to Meal` card links to `/orders/AutoAssignMealToDrivers` and was skipped for safety.

## 4. Full Screen Inventory

| # | Screen | Path | Status | Visible structures and controls | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Dashboard | `/dashboard` | Audited | Dashboard cards; date disable form field `disable_package_date`; `Save Date` button. | Contains operational cards including assignment-related link. |
| 2 | Users | `/users/list/3` | Audited | User table: No, Unique ID, Username, Email, Mobile, Date Of birth, Total Orders / Amount Spent, Status, Operation; DataTables search/page length/pagination; POST filter/action form. | Contains PII columns; values were not captured. |
| 3 | Add New User | `/users/newuser/9` | Audited | Page showed a user listing table, not a clear add-user form. | Label and route imply creation, but audited structure looked like listing. No create action used. |
| 4 | Drivers | `/users/drivers/2` | Audited | Driver/user table with identity, contact, status, operation columns; search/page length/pagination. | Supports driver records. |
| 5 | Admin Users | `/users/drivers/admin` | Audited | Admin user listing table with identity, contact, status, operation columns. | Roles/permissions detail not visible. |
| 6 | Video Categories | `/userVideoCategory` | Audited | Video category table: image, English/Arabic names, operation; search/pagination. | Hidden video section. |
| 7 | User's Video | `/userVideo/list` | Audited | User video table: title, media, category, operation; search/pagination. | Hidden video section. |
| 8 | Video Tutorial | `/tutorialvideolist` | Audited | Tutorial video table: title, video ID, link, operation; search/pagination. | Hidden video section. |
| 9 | Products | `/products` | Partial | Product table: English/Arabic names, category, associate packages, status, operation; filter form for package/category; search/pagination. | Page loaded structure but hit navigation timeout warning. |
| 10 | Ratings | `/ratings` | Audited | Product ratings table: product, package, average rating, total ratings, action. | Product feedback module exists. |
| 11 | Cashback | `/cashback/list` | Audited | Cashback table: name, mobile, email, balance, entries, last activity, action; search/export/pagination. | Financial/customer data columns present. |
| 12 | Packages | `/package` | Audited | Package table: English/Arabic names, priority, coupon, operation; search/pagination. | Subscription/package catalog exists. |
| 13 | Customer Active Orders | `/orders/list/Active` | Audited | Order table with order number, customer, package, dates, transaction ID, order type, payment status, order status, coupon, amounts, operation; status filter; CSV/Excel export. | Core order management present. |
| 14 | Customer Pending Orders | `/orders/list/pending` | Audited | Same order table structure as active orders; status filter; export. | Pending lifecycle state present. |
| 15 | Customer Pause Orders | `/orders/list/Pause` | Audited | Same order table structure; search/export/pagination. | Pause lifecycle state exists, but sidebar entry was hidden. |
| 16 | Customer Expired Orders | `/orders/list/Expire` | Audited | Same order table structure; export. | Expiration lifecycle state present. |
| 17 | Customer Cancel Orders | `/orders/list/cancel` | Audited | Same order table structure; export. | Cancellation lifecycle state present. |
| 18 | Orders Driver Wise | `/driverOrders` | Skipped/unstable | Route was discovered but repeatedly timed out or failed DOM extraction. | No assignment actions were used. |
| 19 | Birthday Orders | `/birthdayOrders` | Audited | Order table with order number, customer, DOB, email; date filter. | Contains sensitive customer data columns. |
| 20 | Pre-Kitchen Meal Check | `/orders/short-meals-check` | Audited | Date selector form. | Indicates kitchen/pre-kitchen shortage checking, but no kitchen workflow board observed. |
| 21 | Coupon Master | `/coupon` | Audited | Coupon table: coupon name/code, usage counts, status, operation; category filter. | Coupon module exists. |
| 22 | Coupon Category | `/coupon/category` | Audited | Coupon category table: name, description, status, action. | Sidebar entry hidden. |
| 23 | Advertisements / Offer | `/advertise` | Audited | Advertise/offer table: English/Arabic names/images, start/end dates, sort order, type, status, operation. | Promotion/media placement exists. |
| 24 | Common Gallery | `/gallery` | Audited | Gallery table: media, media type, operation. | Media library exists. |
| 25 | Ingredients | `/ingredients` | Audited | Ingredients table: English/Arabic names, status, operation/action. | Healthy-food master data exists. |
| 26 | Allergies | `/allergies` | Audited | Allergies table: English/Arabic names, status, operation/action. | Allergen master data exists. |
| 27 | Meal Types | `/mealsType` | Audited | Meal type table: image, English/Arabic names, action. | Meal category/type support exists. |
| 28 | Diet Status | `/dietstatuslist` | Audited | Diet status table: English/Arabic names, operation. | Dietary status master exists. |
| 29 | Tags | `/tagslist` | Audited | Product tags table: English/Arabic names, operation. | Dietary/product tagging support exists. |
| 30 | Package For Types | `/packageFor` | Audited | Package-for table: English/Arabic names, type, Friday off day, active for new customers, action. | Package targeting/configuration exists. |
| 31 | Delivery Time | `/timeSlots` | Audited | Time slot table: English/Arabic names, start/end time, operation. | Delivery time windows exist. |
| 32 | Delivery Methods | `/deliveryMethod` | Audited | Delivery method table: English/Arabic names, operation. | Delivery method master exists. |
| 33 | General/Contact Setting | `/settings` | Audited | POST `/savesettings`; fields for social links, WhatsApp, checkout days gap, full capacity date; save button. | Save was not used. |
| 34 | About Us | `/about_us` | Audited | POST `/saveAboutUs`; language, description, image fields. | Save was not used. |
| 35 | Why Us | `/why_us` | Audited | POST `/saveWhyus`; language, description, image fields. | Save was not used. |
| 36 | Terms and Conditions | `/terms` | Audited | POST `/saveTermsconditionsmaster`; language, description, image fields. | Save was not used. |
| 37 | Return Policy | `/return-policy` | Audited | POST `/saveReturnpolicymaster`; language, description fields. | Save was not used. |
| 38 | Contact Us | `/contact_us` | Audited | Contact messages table: name, subject, email, mobile, message, created on, operation. | Contains PII/message data columns. |
| 39 | Subscribers | `/subscribers` | Audited | Subscriber table: email, status, operation; search/pagination. | Marketing subscriber data present. |
| 40 | Social Media | `/socialmedia` | Audited | Social media table: title, link, operation. | Social link management exists. |
| 41 | Push Notification | `/pushnotification` | Audited | Push notification form/table; notification title, message, send date, delete; search/pagination. | Sending/deleting was skipped. |
| 42 | Report Summary | `/summary` | Skipped/unstable | Route repeatedly timed out or changed navigation context. | No report filters were submitted. |
| 43 | Monthly Sales report | `/salesreport` | Audited | Monthly sales table; year/date filters. | Financial reporting exists. |
| 44 | Daily Sales report | `/singledaysalesreport` | Audited | Daily sales table: name, order ID, email, mobile, paid amount, package amount; date filter; export. | Contains customer/payment columns. |
| 45 | Sales by Payment (New) | `/sales-report-by-payment` | Audited | Payment-method sales table: order date, order number, customer, mobile, plan, method, gateway transaction ID, paid amount; date range filters. | Payment reporting exists. |
| 46 | Customer Revenue (New) | `/customer-revenue-report` | Audited | Revenue table: order, customer, mobile, plan window, off days, paid, active days, per-day, revenue; date range filters. | Accrual-style reporting exists. |
| 47 | Confirm Payment (New) | `/confirm-payment` | Skipped/unstable | Route timed out/stalled during read-only audit. | No payment confirmation action was attempted. |
| 48 | Today Expiration | `/packageexpirestoday` | Audited | Expiring package table: user ID, order, user name, phone, days left; date filter; export. | Contains customer data columns. |
| 49 | Dietician Requests | `/dietician_requests` | Audited | Dietician request table: email, name, phone, gender, height, weight, appointment date, status, created date. | Contains health-related personal data columns. |
| 50 | Total Of Tommorow New | `/orders/getTotalOrdersNew/tommorow` | Skipped/unstable | Route timed out during read-only audit. | Dashboard-card route only; no action submitted. UI label has typo. |

## 5. Existing Dashboard Capabilities

Confirmed capabilities from visible UI:

- Admin authentication.
- User/customer listing.
- Driver listing.
- Admin user listing.
- Product/menu listing.
- Ratings.
- Cashback.
- Package/subscription catalog.
- Order lists by active, pending, pause, expired, and canceled states.
- Order exports.
- Coupons and coupon categories.
- Advertisements/offers.
- Gallery/media management.
- Ingredients.
- Allergies.
- Meal types.
- Diet status.
- Tags.
- Package-for types.
- Delivery time slots.
- Delivery methods.
- Contact/general settings.
- Static content management.
- Contact-message review.
- Subscriber review.
- Social media links.
- Push notification listing/form.
- Monthly and daily sales reports.
- Sales by payment method.
- Customer revenue report.
- Package expiration report.
- Dietician requests.

## 6. Missing Or Unconfirmed Dashboard Capabilities

Not confirmed in the audited dashboard:

- Customer-facing login/register.
- Cart and checkout UI.
- Payment gateway settings, callbacks, or transaction reconciliation internals.
- Refund flow.
- Fine-grained roles and permissions.
- Audit logs.
- Kitchen production board.
- Driver assignment workflow, because assignment-like routes were skipped and driver-wise route was unstable.
- Driver tracking.
- Inventory and stock dependency.
- Calories.
- Protein, carbohydrate, and fat macros.
- Per-product nutrition facts.
- Freshness windows.
- Prep windows.
- Shelf-life/expiry rules for individual meals.
- Special request handling.
- Branch dispatch.
- Central kitchen dispatch.
- Backup/restore controls.
- Deployment/staging controls.

## 7. Bugs And Errors Observed

- No logout/sign-out control found in visible or hidden DOM links/buttons.
- `/driverOrders` repeatedly timed out or failed DOM extraction.
- `/summary` repeatedly timed out or changed navigation context.
- `/confirm-payment` timed out/stalled during audit.
- `/orders/getTotalOrdersNew/tommorow` timed out during audit.
- `/products` loaded visible structure but produced a navigation timeout warning.
- Dashboard/card label typo: `Total Of Tommorow New`.
- UI text typos observed in headers: `Cutomer`, `Catgory`, `Opertation`, `Retun`.
- `Add New User` route appeared to display a listing instead of an obvious add-user form.
- Potential unsafe GET route: `/orders/AutoAssignMealToDrivers`.

## 8. Security And Privacy Observations

- Admin tables expose columns for customer names, emails, mobile numbers, DOB, order IDs, transaction IDs, payment amounts, and health-related dietician request fields.
- No screenshots containing sensitive data were captured or committed.
- Table row values were not documented.
- No role/permission module was confirmed beyond an admin-users list.
- No audit-log module was observed.
- The login form lacks HTML `required` attributes and does not use `autocomplete` attributes.
- The email input uses `type="text"` rather than `type="email"`.
- Hidden sidebar modules are visible in DOM and many hidden routes are accessible by direct navigation.
- State-changing operations appear available from admin screens; row-level action buttons and links were not clicked.

## 9. Recommended Next Action

Proceed to Step 2 Context Engineering only after the missing source-code and environment inventory are obtained.

Immediate next discovery items:

1. Obtain the source repository or code export.
2. Identify staging and production boundaries.
3. Inventory environment variables by name only.
4. Export or document the database schema without sensitive row data.
5. Document the real order lifecycle, payment lifecycle, kitchen lifecycle, and delivery assignment lifecycle.
6. Review auth, roles, permissions, audit logging, and production data access controls.
7. Confirm whether action-like GET routes mutate production data and redesign them if needed.
