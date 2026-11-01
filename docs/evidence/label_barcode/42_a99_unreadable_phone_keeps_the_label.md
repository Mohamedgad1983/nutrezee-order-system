# A99 — a phone the app holds with a typo no longer costs a sticker (2026-11-01)

**Owner question:** "why is there always one difference between the two systems, yesterday and today?"

## What was found (Verified on the server)

1. **The night guard was down since 30 Oct 22:45 CET.** `print-status.py` (00:45 check, follow-ups, and the
   Batch Labels page self-check) crashed with `UnicodeDecodeError: 0xb7`: a Kitchen Stickers package text
   contains "·" (U+00B7); the `mysql` client inside `fleetbase-database-1` answers in latin-1 by default, so
   the two UTF-8 bytes came back as one 0xB7 byte. No email, no auto-repair, page checks stuck at `requested`
   for two days (one earlier crash on 20 Oct 02:56). **Fixed on the server** (`--default-character-set=utf8mb4`
   on every mysql call + `errors='replace'`; backup `print-status.py.bak-utf8-20261101`). This file is
   server-only (not in the repo).
2. **The difference itself: Partner order 31508** (customer_ref 25699, code 4847, subscription 1–30 Nov) —
   the app holds the phone as `k99…83` (a letter typed for a digit). The partner_daily importer rejected
   the row (`unparseable customer_phone`), so Fleetbase had the order (from the legacy screen) but the label
   database had no `customer_order` → Batch Labels printed nothing for it. The feed logged `failures: 0`
   (row errors are only in `errors[]`), so it stayed invisible. Manual check 2026-11-02 at 05:25 Kuwait:
   screen 1040, labels 1039, `no_label: [31508]`.

## Change (this PR)

- `m19-migration/importers.ts` (partner_daily): when the phone is missing or cannot be normalized, the
  customer is keyed by a placeholder `+96500<customer_ref digits>` (`+96500` can never start a real Kuwaiti
  number, so it cannot collide with a true phone), the raw phone is kept as typed in `customer_phone.phone_raw`,
  and the row carries `phone_unreadable:<raw>` + `customer_ref:<ref>` messages. The order, day and label
  identity are created as for any other row. The label's phone line comes from the Partner profile (A78), so
  the sticker shows the phone exactly as the app has it.
- `ops/sync/partner-daily-feed.mjs`: the per-date summary now lists `phone_unreadable` rows
  (row, order, customer_ref, phone as typed).
- Server-only: `print-status.py` `feed_labels()` appends "phone needs correction in the app …" to the night
  email so the call centre fixes the source.
- Tests: TS-U `ts-u-placeholder-phone` (key shape, no collision with real numbers); TS-I
  `ts-i-partner-daily-import` new case (typed phone + empty phone → created, flagged, placeholder reused on
  the next day without a duplicate customer).

## Deploy / verify

API image `nutrezee-api:a99-<sha>` built from a repo snapshot on the server (same path as a97/a98), previous
image tagged `pre-a99-<date>`; `/opt/nutrezee/sync/partner-daily-feed.mjs` replaced from the repo. After the
deploy: feed for 2026-11-02 applied → 31508 gets its label; `print-status.py 2026-11-02` → `[OK] 1040 = 1040`.
The app's phone for customer 4847 still needs correcting by the call centre (the placeholder key stays until
the customer is re-keyed by a real phone — a later correction creates the real-phone customer; the old
placeholder customer keeps the already printed days).
