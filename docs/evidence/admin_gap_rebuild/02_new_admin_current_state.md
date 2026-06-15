# New Admin Current State Matrix

Date: 2026-06-15
Baseline: current branch `build/wp-ui-customers-list`.

| New Admin Area | Route | Exists? | Backend API Exists? | CRUD Works? | Browser Tested? | Issues |
|---|---|---|---|---|---|---|
| Login | `/app/login` | Yes | `/auth/login`, `/auth/me`, `/auth/logout` | Login/logout | Existing Playwright spec | E2E credentials missing in this shell, so not rerun yet. |
| Dashboard | `/app/dashboard` | Yes | `/reports/overview`, review/payment queues | Read-only | Existing Playwright screenshot/spec | Good operational overview; finance parity not included. |
| Intake | `/app/intake` | Yes | `/drafts`, `/customers`, `/catalog`, `/settings/masters` | Draft create/update/submit | Existing Playwright spec | Full production-ready values still depend on workshop/settings/import data. |
| Drafts | `/app/drafts` | Yes | `/drafts` | Read-only list | Existing shell spec | Action work happens in intake/review. |
| Review queue | `/app/review-queue` | Yes | `/review-queue`, `/drafts/:id/decisions`, reason codes | Claim/approve/return/reject | Existing Playwright spec | Needs real UAT values for warning overrides. |
| Orders | `/app/orders` | Yes | `/orders`, `/orders/:id`, fulfillment days, transitions, exceptions, payments | Search/filter/detail/status/change/exception/payment request | Existing spec updated this session | Current branch adds feature-rich legacy-style list and modal actions. |
| Customers | `/app/customers` | Yes | `/customers`, merge, address, allergy APIs | List/search/create/edit/merge/add address | Existing spec extended this session | This session adds address add and profile order history. Allergy edit UI still absent. |
| Payments | `/app/payments` | Yes | `/payment-reviews`, `/orders/:id/payments/*` | Finance decisions; per-order requests | Existing Playwright specs | Refund endpoints remain `not_enabled`. |
| Kitchen board | `/app/kitchen` | Yes | `/kitchen/board`, ticket transitions | Board/ticket actions | Existing Playwright specs | Routing content DEC-006 still blocks full section parity. |
| Exceptions | `/app/exceptions` | Yes | `/orders/exceptions`, resolve endpoint | Resolve | Existing Playwright spec | Complaint/support inbox parity is broader than exceptions. |
| Catalog | `/app/catalog` | Yes | `/catalog/products`, packages, masters, nutrition/allergens | Read; product nutrition/allergen enrich | Existing Playwright specs | Mirror mode blocks core catalog CRUD; routing editor blocked on workshop. |
| Reports | `/app/reports` | Yes | `/reports/:name`, `/exports` | Read/export JSON | Existing Playwright spec | Legacy finance reports are not fully replaced. |
| Staff & roles | `/app/staff` | Yes | `/staff`, `/rbac/*` | Staff create/deactivate/grant/revoke | Existing Playwright spec | Deny-mode/RBAC matrix sign-off remains workshop-owned. |
| Settings | `/app/settings` | Yes | `/settings`, masters, reason codes | Masters/reason-code add | Existing Playwright spec | Critical legacy settings values still need workshop/sponsor values. |
| Audit log | `/app/audit` | Yes | `/audit` | Read-only filters/details | Existing Playwright spec | Good baseline for sensitive action review. |
| Drivers/dispatch | None | No | Only roles/status enums | No | Not tested | Dormant/deferred by current OS rules; old unsafe routes documented. |
| Coupons/cashback | None | No dedicated API | Coupon fields only in orders/import assumptions | No | Not tested | Legacy admin parity gap, not current order-ops engineering frontier. |
| Dietician requests | None | No | No | No | Not tested | Health-sensitive gap; needs scope/decision. |
| Content/gallery/push/social | None | No | No | No | Not tested | Deferred off daily-order cutover path. |
| Import/migration tools | API only | `/imports/*`, `/bridge/*` | Dry-run/apply/rollback/reconciliation | API tested historically | Not browser-admin surfaced | Real legacy data blocked by access/export. |

## API Surface Verified By Repo Inspection

| Domain | Endpoint Examples |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Draft intake | `GET/POST/PATCH /drafts`, `POST /drafts/:id/submit`, `POST /drafts/:id/whatsapp-ref` |
| Review | `GET /review-queue`, `POST /review-queue/:draftId/claim`, `POST /drafts/:id/decisions` |
| Orders | `GET/POST /orders`, `GET /orders/:id`, `GET /orders/:id/fulfillment-days`, `POST /orders/:id/transitions`, `POST /orders/:id/change-requests`, `POST /orders/:id/exceptions` |
| Customers | `GET/POST /customers`, `GET/PATCH /customers/:id`, `POST /customers/:id/addresses`, `POST /customers/:id/allergies`, `POST /customers/merge`, `POST /customers/merge/:id/undo` |
| Catalog | `GET /catalog/products`, `GET /catalog/packages`, `GET /catalog/masters/:kind`, `POST /catalog/products/:id/nutrition`, `POST /catalog/products/:id/allergens` |
| Payments | `GET /orders/:id/payments`, `POST /orders/:id/payments/link-sent`, `POST /orders/:id/payments/status-requests`, `GET /payment-reviews`, `POST /payment-reviews/:id/decisions` |
| Kitchen | `GET /kitchen/board`, `POST /kitchen/generate-tickets`, `POST /tickets/:id/transitions` |
| Reports/audit | `GET /reports/overview`, `GET /reports/:name`, `POST /exports`, `GET /audit` |
| Settings/staff | `GET/POST /settings/*`, `GET/POST/PATCH /staff`, `POST /rbac/grants`, `POST /rbac/revoke` |
| Migration/bridge | `POST /imports/:type/dry-run`, `POST /imports/:type/apply`, `POST /imports/:batchId/rollback`, `GET/POST /bridge/reconciliations`, `GET/POST /bridge/cutover-flags` |
