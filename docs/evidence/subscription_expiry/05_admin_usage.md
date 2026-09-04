# 05 — Admin / API Usage

**Date:** 2026-06-20 · **Status:** **IMPLEMENTED** (API + admin UI) — code committed; takes effect on staging at the next API/admin deploy (deploy is gated, not performed here).

---

## What was implemented

Subscription-expiry fields were added to the customer **list** and **profile** API read paths, and surfaced in the admin Customers UI. The fields are **non-PII** (dates/status/flags) and pass through the existing masking layer untouched.

### API (`m04-customers`)

`customer.service.ts`:
- New `subscriptionForCustomers(ids: string[])` → `Map<customer_id, CustomerSubscriptionInfo>`. **Read-only, non-PII.** It is the **customer-scoped equivalent** of `analytics.customer_subscription_status` (migration 0021), kept logically identical (Asia/Kuwait business date, latest-expire pick with the same tie-breaker, same status thresholds). It is **not** a query against the global view — see "Why scoped, not the view" below.
- `getProfile(...)` now returns a `subscription` object.
- `listCustomers(...)` now enriches each row with `subscription_status`, `subscription_expire_date`, `days_remaining`, `is_expired`, `is_expiring_soon`.

No controller change was required: `maskFields` is an allowlist (only named PII/health fields are masked), so the new fields flow through `customer.controller.ts` automatically.

**Response fields added:**

| Field | Type | Notes |
|---|---|---|
| `subscription_expire_date` | `YYYY-MM-DD` \| null | null ⇒ `subscription_status = 'unknown'` |
| `days_remaining` | int \| null | signed; negative = expired N days ago |
| `subscription_status` | enum | active / expiring_soon / expired / future / unknown |
| `is_expired` | bool | |
| `is_expiring_soon` | bool | active and ≤7 days left |
| `source_confidence` (profile only) | enum | `low` ⇒ pick is a cancelled/rejected order |

### Admin UI (`apps/admin/src/pages/Customers.tsx`)

- Customer list: new **Subscription** column (`expire · status (Nd)`, or `—`).
- Customer profile: new **Subscription expires** row.
- Degrades gracefully to `—` when the field is absent (e.g. before the API redeploy).

## Why scoped, not the global view (performance)

Querying `analytics.customer_subscription_status` for a single customer **seq-scans `fulfillment_day` (527K rows, twice) → ~725ms** (the planner cannot push a single-customer filter through the global aggregation; measured via `EXPLAIN ANALYZE` on staging). The customer-scoped query filters to the customer's orders first (`customer_order_customer` index + `fulfillment_day` index-only scan) → **~15ms**. For the hot profile/list endpoints the scoped query is required. Its output was verified **byte-identical** to the view for sample customers ([04](04_validation_report.md)). The global view remains the source-of-truth definition and the analytics/reporting interface.

## Safety / conventions honored

- Read-only; no GET-side mutation (`scan-no-get-mutation` green).
- Cross-schema **read** of analytics (a read, like the existing `allergen` join) — does not trip `scan-cross-module-writes` (green).
- Non-PII; no masking needed; existing PII masking unaffected.
- RBAC unchanged: fields ride on the existing `customer.read` grant; no new permission.
- typecheck + lint green across api/shared/admin.

## Remaining (not done here)

- **Deploy** the rebuilt API + admin images to staging (gated behind `STAGING_DEPLOY_ENABLED`; not triggered by this pass). Until then the running staging API serves the old shape; the UI shows `—`.
- A Playwright e2e asserting the expiry column/row on staging is a recommended follow-up once deployed.
- CI (Postgres 16, `freshDb()` re-runs all migrations incl. 0021) validates the API change on push.
