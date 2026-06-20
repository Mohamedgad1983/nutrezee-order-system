# 03 — Validation Counts

**Date:** 2026-06-20 (re-verified this session, read-only).

---

## Object existence

| Object | `to_regclass` |
|---|---|
| `analytics.order_subscription_periods` | present ✅ |
| `analytics.customer_subscription_status` | present ✅ |
| `public.customer_dish_day` (0020) | **NULL (absent)** ✅ |

## Migration ledger

```
SELECT filename FROM schema_migrations WHERE filename LIKE '002%' ORDER BY filename;
 → 0021_analytics_subscription_expiry.sql        (ONLY — 0020 absent)
```

## Status distribution (customer-level)

| subscription_status | customers |
|---|---|
| unknown | 11,573 |
| expired | 6,904 |
| active | 694 |
| expiring_soon | 290 |
| future | 15 |
| **total** | **19,476** |

**Matches the original 0021 validation exactly** (no drift): 7,903 with expiry, 11,573 unknown.

## Expiring-in-3-days cross-check (feeds Part D)

For Kuwait today `2026-06-20`, target `2026-06-23`: **54** customers expire in exactly 3 days (134 within 1–3 days). Consumed by the daily email job (Part D), which reproduced 54 in its dry-run.

> All counts above are **DB-verified in this session**; they reconcile with the figures recorded when 0021 was first authored.
