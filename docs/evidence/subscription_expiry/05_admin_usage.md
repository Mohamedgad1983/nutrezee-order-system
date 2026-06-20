# 05 — Admin / API Usage

**Date:** 2026-06-20 · **Status:** API exposure **documented, not implemented** (Step 3 deliberately deferred — see rationale).

---

## Decision: do NOT modify the customer API in this pass

Step 3 says to add subscription-expiry fields to the customer read model **only if it does not require risky refactoring**. It does, so this pass documents the change instead of making it. Reasons:

1. **Depends on the views being live.** The analytics views are **not yet applied to staging** (the migrate runner would also apply the deliberately-skipped `0020` — see [06](06_limitations_and_next_steps.md)). Wiring the API to read non-existent views would break the customer endpoints.
2. **Cross-cutting change.** It touches `customer.service.ts` (two read paths), the shared contract types, masking config, and tests — beyond an additive analytics foundation.
3. **Module-boundary care.** The customer module reading from the `analytics` schema is a new dependency that should be reviewed deliberately (it is a read, so it does not trip `scan-cross-module-writes`, but it is still a new coupling).

The expiry **data and validated counts are already delivered** via the views + [04](04_validation_report.md); API surfacing is a low-risk follow-up.

---

## Exact change needed (for a future WP)

**Target read paths** (`app/apps/api/src/modules/m04-customers/customer.service.ts`):
- `listCustomers(limit, offset)` — the paginated customer list (`@Get()` on `customer.controller.ts`).
- `getProfile(actor, customerId, includeHealth)` — the customer profile (`@Get(':id')`).

**Add a LEFT JOIN to the per-customer view** and select the non-PII expiry fields:

```sql
-- in listCustomers / getProfile, joined on c.id
LEFT JOIN analytics.customer_subscription_status css ON css.customer_id = c.id
-- select:
--   css.subscription_expire_date,
--   css.days_remaining,
--   css.subscription_status,
--   css.is_expired,
--   css.is_expiring_soon
```

**Fields to add to the customer read model / API response:**

| Field | Type | Notes |
|---|---|---|
| `subscription_expire_date` | date (nullable) | null ⇒ `subscription_status = 'unknown'` |
| `days_remaining` | int (nullable, signed) | negative = expired N days ago |
| `subscription_status` | enum | active / expiring_soon / expired / future / unknown |
| `is_expired` | bool | |
| `is_expiring_soon` | bool | active and ≤7 days left |

**Masking:** these fields are **not PII** (dates/status/flags) — no masking required; they sit alongside the already-masked customer fields. Add them to the shared contract types (`app/packages/shared/src`) mirroring `11_API_Design/module_api_contracts.md`, and update the admin customer page (`app/apps/admin/src/pages/Customers.tsx`) to show an "Expires / status" column.

**Tests to add:** a TS-I case asserting the list/profile responses include the expiry fields and that an `unknown` (no-orders) customer returns null expiry + `subscription_status = 'unknown'`.

**Optional convenience:** a thin read endpoint `GET /analytics/subscription-status?customer_id=…` (or `/customers/:id/subscription`) returning the per-customer row, if a dedicated lookup is preferred over enriching the list.

---

## Prerequisites before implementing the above

1. Apply `0021` (and resolve the `0020` apply decision) to the target DB — see [06](06_limitations_and_next_steps.md).
2. Confirm RBAC: expiry fields ride on existing `customer.read` / `order.read` visibility; no new permission needed.
3. Keep it read-only (no GET-side mutation — `scan-no-get-mutation` must stay green).
