# 35 — WP-OPS-A88: the barcode never covers the phone line; evening checks prepare the right day

**Date:** 2026-10-10 · **Console:** `fleetbase-console:a88-1`, extension 0.3.25 (rollback `pre-a88-20261010`) · check script backup `print-status.py.bak-a88`

## First full night from Batch Labels

Owner, Saturday 2026-10-10: the print for Sunday came out 100% correct. Server record for delivery day 2026-10-11: 106 checks, all `ok` after repair, 0 failed, 19 of them asked for by the page itself; one email (00:45).

## Label: phone line under the barcode (owner's photo, order 27097)

Cause (reproduced locally with the real template and stylesheet): the customer column has a fixed 45.2 mm above the barcode. A plan name that wraps to three lines plus an address that wraps pushed the last lines (Phone) below it, where the barcode is printed. On the print PC the colon of "Days Remaining :" and "Delivery Method :" also dropped to its own line, costing two more lines.

Change:
- the column is clipped to its own area (it can no longer paint over the barcode);
- `fitLabels()` — after the labels are on the page and again right before printing, each label whose column is taller than its area is tightened one level at a time (three levels: smaller address/plan type, tighter rows) until it fits, measured in the browser that prints; labels that already fit keep the approved design;
- field labels no longer wrap (label column 19 mm, `nowrap`).

Checked on four cases in a real browser (the photographed label with and without a note, and a worst-case address with a long area, block text, street name, flat and direction): overflow 0 / 3 / 14 / 33 px before; 0 on all four after, at level 1 at most, Phone visible on all. Unit test of the fit rule; release gate 13/13; candidate booted before the swap. **Not yet printed on paper.**

## Evening checks watched the wrong day

Friday evening the follow-ups targeted "tomorrow" = Saturday, already printed, while Sunday's drivers were being set in legacy: 218 orders without a driver at 16:46, 0 at 00:04, no check of Sunday in between. From 12:00 Kuwait the follow-up now prepares the day of the coming 01:00 print (the day after tomorrow, skipping Friday), and the hourly three-day sync runs until 23:40.

## Partner API vs legacy screen (147 simultaneous comparisons, 2026-10-09/10)

Equal in 139. In 8 the API differed by 1–2 orders (membership) or 1–2 drivers, including 23:46 and 01:11 — the minutes when legacy is being edited. The API is close to live but not exact at print time, so the legacy screen stays the reference.
