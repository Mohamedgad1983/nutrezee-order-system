# A98 — Thursday double box: two stickers, BOX 1 OF 2 / BOX 2 OF 2 (2026-10-21)

**Owner:** "I always have a problem printing Thursday: customers with a double box on Thursday instead of Friday." Photos (order 30145, Thursday 2026-10-22): legacy prints two stickers, "BOX 1 OF 2" and "BOX 2 OF 2", Days Remaining 6; ours printed one sticker with 9 meal lines, Days Remaining 5.

**Data (Verified, Partner API, 2026-10-22):** a double-box order has two delivery rows that day (one per box); `order-items` lists both boxes' lines in delivery order and each delivery row gives its `meal_item_count` (17/17 add up). 16 of the 17 two-row orders have `delivery.thursday_double_box = true`; 31013 has two rows but no flag (left as before).

**Our bug found (Verified):** the A92 fold (one copy when the lines repeat) also folded double boxes whose two boxes have the same dishes — 13 of 17 on the 22nd printed only one box's meals.

**Change:**
- profile: `doubleBox` (subscription flag + 2 delivery rows), `boxItemCounts` per delivery; `mealsPerBox()` splits the lines; the A92 fold never applies to a double box.
- label document: `boxes: [{index, total, meals, totals}]`; Batch Labels prints one sticker per box with "BOX n OF 2" in place of the logo mark, each with its own meals and totals; the heading shows the sticker count.
- Days Remaining of a double-box customer counts Friday (its box goes out on Thursday) — 30145: 6, as legacy.
- Batch Labels → Delivery orders → Filter by "Thursday double box": the double boxes as their own batch.

**Verified on 2026-10-22 (same day built with old and new API):** 873 labels → 889 stickers (16 double boxes × 2). 30145: box 1 = 5 meals / 986 kcal (the legacy BOX 1 total), box 2 = 5 meals / 1058 kcal; days 6. 30536: 3 + 3 meals (was folded to 3). Every other label unchanged.

**[NC]:** legacy's BOX 2 OF 2 for 30145 repeats box 1's dishes; Partner lists different dishes for the second delivery (e.g. tabbouleh quinoa). Ours prints Partner's lines per box — owner to confirm which the kitchen packs.

**Deployed:** API `nutrezee-api:a98-b20bc33` (rollback `pre-a98-20261021`), console `0.7.48-a98.1`.
