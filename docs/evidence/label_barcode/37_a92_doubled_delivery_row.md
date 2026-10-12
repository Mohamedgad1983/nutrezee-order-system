# A92 — a delivery legacy holds twice printed its meals twice (2026-10-12)

**Owner's photo (print for Monday 2026-10-12, order 30781, "only this sticker"):** our label listed ten meal rows running over the barcode, no totals; the legacy label lists six meals, total 1608 kcal.

**Cause (Verified, Partner API):** legacy holds two delivery rows for this order on this day (`delivery_id` 411359 and 411360, same `updated_at`), and `order-items` lists the six meal lines twice (item_ref 2325138–2325149). It is the only order with two rows among 959 that day; `order-items` carries no delivery id.

**Fix (API only):** the profile source counts the distinct delivery rows per order and day; `mealsOfOneDelivery()` keeps one copy only when the meal lines are that many exact copies (same dish, same quantity, same order). A customer with one delivery row who has a dish twice keeps both lines.

**Verified on 2026-10-12 (958 labels), running API before → after:** meals per label `{2:19, 3:87, 4:358, 5:457, 6:33, 7:3, 12:1}` → `{2:19, 3:87, 4:358, 5:457, 6:34, 7:3}`; order 30781: 12 lines / 3216 kcal → 6 lines / 1608 kcal (the legacy label's total). No other label changed.

**Deployed:** API `nutrezee-api:a92-ec3031b`, rollback `nutrezee-api:pre-a92-20261012`, env fingerprint unchanged.

**Same photo, Days Remaining 25 (ours) vs 28 (legacy):** subscription 29829 — 26 days from 2026-10-11 to 2026-11-09, Friday off, no freezes → 25 delivery days from the 12th (A90 real count). Legacy's 28 is not explained by its usual rule either (that gives 25). **[NC]**

**Not fixed at the source:** the doubled delivery row is in legacy; whether the kitchen prepares one box or two for it is legacy's own behaviour.
