# A92 — a delivery legacy holds twice printed its meals twice (2026-10-12)

**Owner's photo (print for Monday 2026-10-12, order 30781, "only this sticker"):** our label listed ten meal rows running over the barcode, no totals; the legacy label lists six meals, total 1608 kcal.

**Cause (Verified, Partner API):** legacy holds two delivery rows for this order on this day (`delivery_id` 411359 and 411360, same `updated_at`), and `order-items` lists the six meal lines twice (item_ref 2325138–2325149). It is the only order with two rows among 959 that day; `order-items` carries no delivery id.

**Fix (API only):** the profile source counts the distinct delivery rows per order and day; `mealsOfOneDelivery()` keeps one copy only when the meal lines are that many exact copies (same dish, same quantity, same order). A customer with one delivery row who has a dish twice keeps both lines.

**Verified on 2026-10-12 (958 labels), running API before → after:** meals per label `{2:19, 3:87, 4:358, 5:457, 6:33, 7:3, 12:1}` → `{2:19, 3:87, 4:358, 5:457, 6:34, 7:3}`; order 30781: 12 lines / 3216 kcal → 6 lines / 1608 kcal (the legacy label's total). No other label changed.

**Deployed:** API `nutrezee-api:a92-ec3031b`, rollback `nutrezee-api:pre-a92-20261012`, env fingerprint unchanged.

**Same photo, Days Remaining 25 (ours) vs 28 (legacy):** subscription 29829 — 26 days from 2026-10-11 to 2026-11-09, Friday off, no freezes → 25 delivery days from the 12th (A90 real count). Legacy's 28 is not explained by its usual rule either (that gives 25). **[NC]**

**Not fixed at the source:** the doubled delivery row is in legacy; whether the kitchen prepares one box or two for it is legacy's own behaviour.

---

# A93 — a label printed with "No dish detail recorded" although legacy had the meals (2026-10-13)

**Owner's photo:** order 27903 (pickup label) for Tuesday 2026-10-13 printed with an empty meals table.

**Findings (Verified):** Partner lists four meal lines for that order and day (item_ref 2342532–2342535, created about 18:05 on 11 Oct, a day before the print); all four are in the catalog with nutrition; the running API builds the label with 4 meals / 1378 kcal now; no order of the 13th lacks meals in Partner. So the data was there at print time.

**Cause (Inferred):** the meal source refetches the catalog and the day's items every 60 s and had no retry and no fallback — one failed or slow Partner answer during a preview made `mealRows` return "no dish source" for every label in it, without any message. The API does not log these failures, so the exact preview cannot be shown.

**Fix (API only):** `PartnerLabelSource.dateSnapshot` tries a failed read once more and, if Partner still fails, serves the day's last good copy instead of nothing.

**Checked:** unit test `A93` (retry, then last good copy); 2026-10-14 built with the new image: 943 labels, meals `{0:1, 2:16, 3:97, 4:352, 5:437, 6:37, 7:3}` — the single empty one is order 30509, which has no meals in legacy yet (`meal_item_count` 0).

**Deployed:** API `nutrezee-api:a93-83da798`, rollback `nutrezee-api:pre-a93-20261013`.

**Open:** the page gives no warning when a label has no meals; **[NC]** how many stickers of the 13th came out empty.
