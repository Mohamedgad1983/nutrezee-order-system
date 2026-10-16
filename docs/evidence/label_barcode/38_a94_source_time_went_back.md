# A94 — one order with an older Partner stamp stopped a whole day's sync (2026-10-16)

**Found while answering the owner's "how is printing now":** the upcoming-days check had reported Monday 2026-10-19 as different since 2026-10-15 21:47 Kuwait (Batch Labels stuck at 667 while the legacy screen grew to 716). Every automatic repair logged "Fleetbase re-synced to the screen: FAILED".

**Cause (Verified):** the Fleetbase write stopped with `fleetbase_stale_source`. Order 31059 (subscription 30107) is stored with `source_updated_at` 2026-10-15T19:55:00+03:00 (its meal lines' time); Partner now gives 19:42:05 for it. `assertOrderOwned` refused a source time older than the stored one and aborted the whole day — 49 orders that arrived later never got a label.

**Fix:** `ops/fleetbase/nutreeze-orders.php` — the older time is logged (`daily_source_time_went_back`) and the live row is taken. Every run reads Partner live (dry-run digest a minute earlier), so its row is the current truth; the legacy screen stays the reference.

**Deployed:** repo copy was byte-identical to the live file before the change (sha256 cae74def…). Live file replaced, backup `nutreeze-orders.php.bak-a94`; `php -l` clean.

**Verified:** Monday 2026-10-19 after the change: `[OK] Batch Labels 716 = legacy screen 716 (172 without a driver yet) + WhatsApp 32`; repair round 1 "re-synced: done".

**Print days already printed (from `label_print_check` and the sent status emails):** 10, 11, 12, 13, 14, 15 and 17 Oct all `[OK]` (Batch Labels = legacy screen); 16 Oct is a Friday (0 orders). Earlier `differences` rows on those days were all on days still ahead and were followed by `ok`.
