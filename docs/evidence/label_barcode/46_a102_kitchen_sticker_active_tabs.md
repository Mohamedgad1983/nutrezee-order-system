# A102 — Kitchen Stickers: Active / Not active tabs (2026-11-09)

**Request (owner):** separate non-active subscriptions into a different tab on Kitchen Stickers.

**Before (Verified, staging DB 2026-11-09):** 24 stickers — 9 printing and in date, 11 still printing with end date passed, 4 stopped (1 of them also past end). The list showed every printing sticker together, with a small "Show N stopped" link.

**Change (console only, extension 0.3.33):**
- Two tabs above the list: **Active / شغال (n)** and **Not active / مش شغال (n)**.
- Active = printing (not stopped) AND end date not passed (or no end date). Not active = stopped OR end date passed.
- Search works inside the chosen tab. The "show stopped" link is removed.
- Printing is unchanged: a sticker past its end date that is not stopped still prints (A97 rule). Whether ended stickers should stop printing automatically is an owner decision — **[NC]**.

**Tests:** ts-u-kitchen-stickers-page (tabs, counts, switching), extension version 0.3.33. TS-U 235 pass, lint clean.

**Release:** console image `fleetbase-console:a102-1` (CONSOLE_RELEASE 0.7.48-a102.1) → gate → swap; rollback to `fleetbase-console:pre-a102-<date>`.
