# A102 — Kitchen Stickers: Active / Not active tabs (2026-11-09)

**Request (owner):** separate non-active subscriptions into a different tab on Kitchen Stickers.

**Before (Verified, staging DB 2026-11-09):** 24 stickers — 12 have an end date before the print day, 4 are stopped. The list showed every not-stopped sticker together (ended ones included), with a small "Show N stopped" link.

**Printing already stops at the end date (Verified):** `wa_manual_stickers.py` skips a sticker when the print day is after its end date (A97.2). Checked the merged rows for 2026-11-10 (`/root/a71/wa-20261110.json`, 57 rows): none of the 12 ended stickers is in them. An earlier statement to the owner that the 11 ended stickers "still print every day" was wrong — they only looked active in the list.

**Change (console only, extension 0.3.33):**
- Two tabs above the list: **Active / شغال (n)** and **Not active / مش شغال (n)**.
- Active = not stopped AND the print day (`delivery_date`) is not after the end date — the same rule the print merge uses. Not active = stopped OR end date passed.
- Search works inside the chosen tab. The "show stopped" link is removed.
- Owner decision 2026-11-09: ended stickers stop on their own (already true) and the kitchen must be able to bring any of them back at any time. **Print again / رجعه للطباعة** now shows on every not-active sticker: it un-stops it (restore) and, if the end date has passed, clears the end date and saves, so it prints every day until someone stops it. A note in the editor explains it, and that a new end date can be typed instead.
- No API or schema change: an empty end date was already allowed; both calls are the existing audited restore/update.

**Tests:** ts-u-kitchen-stickers-page (tabs, counts, switching, ended-sticker note, Print again = restore + clear end date), extension version 0.3.33. TS-U 236 pass, lint clean.

**Release:** console image `fleetbase-console:a102-1` (CONSOLE_RELEASE 0.7.48-a102.1) → gate → swap; rollback to `fleetbase-console:pre-a102-<date>`.

## Console release (2026-11-09) — Verified
- Image `fleetbase-console:a102-1` (CONSOLE_RELEASE 0.7.48-a102.1, extension 0.3.33); gate **13/13 PASS**.
- Rollback tag `fleetbase-console:pre-a102-20261109` (= a101-1, 4b385bfe7623).
- Live container image 952a03848ce9; live engine bundle contains `pickTab`; ops.nutreeze.com 200.
- Rollback: `docker tag fleetbase-console:pre-a102-20261109 fleetbase-console:latest && (cd /opt/fleetbase && docker compose up -d --no-deps --no-build console)`.
