# Manual Exception Review Foundation + Recomputed Segments

Date: 2026-06-16 · Staging only. Phase-1 accepted as `STORED_WITH_ACCEPTED_EXCEPTIONS`.

## 1. Exception review table (`migration_exception_review`)

Migration `0015_migration_exception_review.sql` (additive, staging) creates a manual-review table holding every legacy record that could not be safely auto-imported. **PII (phone/name) lives in staging only — never committed.** Populated by `tools/legacy-full-migration/populate-exceptions.mjs` (idempotent).

Columns: `id, legacy_customer_id, legacy_order_id, phone_original, normalized_phone, customer_name, reason, repairability, recommended_action, risk_level, review_status (pending|approved|rejected|resolved|wont_fix), reviewed_by, reviewed_at, resolution_notes, created_at`.

### Contents — 1,272 exceptions (806 customers + 466 orders)

| reason | risk | repairability | count |
| --- | --- | --- | ---: |
| duplicate_phone_deduped | medium | review | 621 |
| placeholder_phone (order) | high | review | 395 |
| placeholder_phone_blacklisted (customer) | high | review | 93 |
| invalid_or_missing_phone | high | partial | 91 |
| negative_amount | high | review | 46 |
| customer_not_found | medium | depends | 22 |
| reversed_dates | medium | review | 3 |
| no_name | low | no | 1 |

All rows `review_status='pending'`. These are **excluded from WhatsApp eligibility** and must not be auto-imported (wrong identity / wrong targeting / invalid finance risk).

## 2. Recomputed WhatsApp segments (post-recovery, with eligibility)

`tools/legacy-full-migration/segment-eligible.sql` — recomputes per-customer segments from the corrected staging DB and flags `whatsapp_eligible` (excludes customers whose legacy phone is a placeholder/blacklisted/invalid phone in the exception table).

| segment | total | **eligible** | excluded |
| --- | ---: | ---: | ---: |
| EXPIRED_90_PLUS | 4,114 | 4,114 | 0 |
| PENDING_PAYMENT | 1,124 | 1,124 | 0 |
| ACTIVE_FUTURE_NObot | 668 | 668 | 0 |
| EXPIRED_31_90_DAYS | 658 | 658 | 0 |
| CANCELLED_EXCLUDE | 559 | 559 | 0 |
| EXPIRED_8_30_DAYS | 438 | 438 | 0 |
| EXPIRED_1_7_DAYS | 140 | 140 | 0 |
| ACTIVE_RENEWAL_7_DAYS | 122 | 122 | 0 |
| ACTIVE_RENEWAL_3_DAYS | 46 | 46 | 0 |
| EXPIRES_TODAY | 33 | 33 | 0 |

**~7,902 order-holders; `excluded=0` everywhere** — the WhatsApp-targetable population contains no placeholder-phone contamination (the 94 distinct excluded phones do not belong to order-holders). Immediate renewal targets: **201** (today 33 + 3d 46 + 7d 122); recent win-back: 140. No messages sent.
