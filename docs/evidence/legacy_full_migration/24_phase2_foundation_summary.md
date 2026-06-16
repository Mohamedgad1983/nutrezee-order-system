# Phase-2 Foundation — Summary

Date: 2026-06-16 · Staging only · **no WhatsApp sent · cron NOT enabled · production untouched.**

Built on Phase-1 acceptance (`STORED_WITH_ACCEPTED_EXCEPTIONS`). Deliverables:

| # | Deliverable | Artifact | State |
| --- | --- | --- | --- |
| 1 | **Manual Exception Review** table + dataset | migration `0015_migration_exception_review.sql`; `populate-exceptions.mjs`; **1,272 rows** in staging (806 cust + 466 ord) with full review workflow | ✅ live |
| 2 | Exceptions **excluded from WhatsApp eligibility** | `segment-eligible.sql` (placeholder/invalid phones excluded) | ✅ |
| 3 | **Recomputed WhatsApp segments** (post-recovery) | `20_exception_review_and_segments.md` — ~7,902 order-holders, 0 excluded, 201 immediate renewals | ✅ |
| 4 | **Incremental sync (30-min)** — dry-run | `incremental-sync.mjs` + design `21_…` | ✅ dry-run; **disabled** |
| 5 | **Cron/systemd runbook** | `22_cron_systemd_runbook.md` (flock + timer, disabled by default) | ✅ |
| 6 | **Hermes WhatsApp foundation** — dry-run | `hermes-queue-preview.mjs` + architecture `23_…` | ✅ preview; **0 sends** |

## Accepted exception summary (1,272)

| reason | risk | count |
| --- | --- | ---: |
| duplicate_phone_deduped | medium | 621 |
| placeholder_phone (order) | high | 395 |
| placeholder_phone_blacklisted | high | 93 |
| invalid_or_missing_phone | high | 91 |
| negative_amount | high | 46 |
| customer_not_found | medium | 22 |
| reversed_dates | medium | 3 |
| no_name | low | 1 |

All `review_status='pending'` in `migration_exception_review` (manual review queue). None auto-imported.

## Updated WhatsApp segment counts (eligible)

EXPIRES_TODAY 33 · RENEWAL_3D 46 · RENEWAL_7D 122 · EXPIRED_1_7 140 · EXPIRED_8_30 438 · EXPIRED_31_90 658 · EXPIRED_90_PLUS 4,114 · PENDING_PAYMENT 1,124 · CANCELLED 559 · ACTIVE_FUTURE 668. **0 excluded** among order-holders.

## Incremental sync (dry-run)

Watermark = legacy order id **24630** (20,103 synced). **0 candidate new orders** (all safely-importable already synced). Overlap guard verified (lockfile). `applied:false, whatsapp_sent:false`. Design: `21_…`; runbook: `22_…`. **Not scheduled.**

## Hermes dry-run queue preview

**queued_preview 1,437** · **messages_sent 0** · live_sending false. No-offer renewals 201; offer win-backs 1,236 (all `requires_human_approval`). Excluded by policy: EXPIRED_90_PLUS, PENDING_PAYMENT, CANCELLED, ACTIVE_FUTURE. Guards: opt-in required, opt-out honored, 7-day frequency cap, offers need human approval. Architecture: `23_…`.

## Clear statement

**No WhatsApp messages were sent. No cron/timer is enabled. No production access. No destructive SQL. No raw PII or secrets committed.** All temporary super-admins were created with in-process passwords and deleted after use.
