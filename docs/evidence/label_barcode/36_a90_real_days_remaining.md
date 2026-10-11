# A90 — Days Remaining prints the real count (2026-10-11)

**Owner's report:** label of order 27902 (delivery 2026-10-11) printed `Days Remaining 10`; the customer app showed 25.

**Finding (Verified, Partner API):** subscription 26950 — 30 days + 25 added = 55 delivery days, 34 delivered before the 11th → **21 left**. End date 2026-11-04, Friday off, 12 frozen days (11 past, one on 2026-10-17).

| Source | Figure | How |
|---|---|---|
| Customer app | 25 | calendar days to the end date |
| Label (A80, legacy rule) | 10 | delivery days to the end date (22) minus **all** frozen days (12) |
| Real | 21 | delivery days to the end date minus the freezes still ahead (1) |

The end date already carries the past freezes; the legacy rule takes them off a second time. Owner's decision 2026-10-11: **print the real count** (replaces the A80 "same as legacy, negatives kept" decision for this field).

**Change:** `partner-label-profile.ts` — `daysRemaining()` = delivery days (not an off weekday) from the label date to `end_date`, minus the non-reverted freezes in that range. Freezes come from Partner `subscription-changes?change_type=freeze` (≈47 pages, ~20 s): one full read at boot and every 24 h, only `since=` changes at each 20-minute refresh. If the freeze list was never read, the label prints the count without them (never blocks printing); a failed read is not repeated for every label of a batch.

**Checks (Verified):**
- Partner `frozen_days` equals the sum of live freeze records for 5,559 of 5,562 subscriptions that have any.
- Day 2026-10-12 with image `nutrezee-api:a90-8772bec`: 960 labels, 0 without a count, 0 negative; 245 orders have frozen days (the ones whose figure changes). Order 27902 → 20 (21 on the 11th).
- Sample of 40 orders with freezes against "days bought − boxes delivered" (subscription-schedule + days_added): 36 equal. The 4 that differ (30572, 23242, 27462, 20975) are subscriptions where Partner's own lists disagree with the end date (long subscriptions with 23–88 frozen days, or a schedule that starts late); the label follows the end date. **[NC]** which one the owner considers right for those.
- Unit tests `ts-u-partner-label-profile` 9/9.

**Deployed:** API `nutrezee-api:a90-8772bec`, rollback `nutrezee-api:pre-a90-20261011`, env fingerprint unchanged. Console unchanged.

**Not ours:** the customer app's figure (calendar days) — its code is not in this program.

---

# A91 — "Pickup Qurain" prints no driver (2026-10-11)

**Owner:** when the notes say `Pickup Qurain`, the customer collects the box from the central kitchen — do not put a driver on it.

**Change (API only):** `isKitchenPickup(notes)` — "pick up / pickup [from] [Al] Qurain" or "استلام من القرين". For those labels the driver box prints `CAR / سيارة PICKUP` and `Customer pickup - Kitchen / استلام العميل من المطبخ`, no driver phone, no driver colour.

**Verified on 2026-10-12 (960 labels):** 2 pickup labels — 27902 (`Pickup Qurain/100c/180p`) and 27903 (`Pickup Qurain branch`). Left with their driver on purpose: 30255 (`pick up from jahra branch`) and 26131 (`qurain branch`, no pickup word) — **[NC]** owner to say whether these are kitchen pickups too.

**Not changed:** the order still belongs to the legacy driver in Fleetbase (Arsad Ali for both), so it prints inside that driver's batch, shows in the driver app, and the night check against the legacy screen stays equal. Removing it from the driver in Fleetbase needs the owner's decision (it would differ from the legacy screen).

**Deployed:** API `nutrezee-api:a91-23eac53`, rollback `nutrezee-api:pre-a90-20261011`. Not yet seen on paper.
