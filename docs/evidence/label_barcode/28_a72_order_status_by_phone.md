# 28 — A72: order status by customer phone in the Fleet-Ops console

Date: 2026-10-06 (Kuwait) · Owner directive: "في الادمن (ops.nutreeze.com) محتاج بحث عن حالة الطلب عن طريق تليفون
العميل… وقدامه قد ايه علشان يوصل للعميل تقريبا: مسافة ووقت وطلبات قبله".

## What it is
A read-only page `Order Status` in the console's Resources sidebar (same place as Batch Labels).

- **API** `GET /fleet-ops/order-status?phone=&delivery_date=` (`m25-label`): verified Fleetbase operator only; day
  window is the Batch Labels window (yesterday … +7, default today). The phone is matched on its last digits
  (`55123456`, `+965 5512 3456`, `0096555123456`, Arabic digits). The customer's orders are matched against the
  day's Fleetbase set with the same code Batch Labels uses, so Partner and WhatsApp-system customers both appear.
- **Per delivery**: customer name, order number, area, state (delivered / on the way / with the driver / not sent
  out), driver name, phone and plate, the driver's delivered count of the day, label printed or not.
- **Estimate** (pure rules in `order-status.ts`, TS-U `ts-u-order-status`): straight-line distance from the driver's
  last app position × 1.35, time at 28 km/h + 4 min per order before it; "orders before it" = the driver's other
  undelivered orders that are nearer to the driver than this customer. Given only when the position is ≤ 15 minutes
  old and the customer has a pin (exact Partner pin, else the area centre, stated on the page). Otherwise the page
  says why: app never sent a location / app not open now / customer has no location.

## Facts that limit it today (Verified on staging, 2026-10-06)
- No driver has an app position newer than 2026-10-05 13:11; today all 948 orders are `dispatched`, none started.
  So distance / time / orders-before will read "driver's app is not open" until the drivers use the app.
- Yesterday's orders are all `completed` by the 02:00 closing job, not by drivers: for a past day "delivered" means
  the day was closed. For today it is true only once drivers complete orders in the app.
- About 30% of Partner orders have no exact pin (area centre is used and labelled as such).

## Tests
TS-U `ts-u-order-status` 5/5, TS-I `ts-i-label-barcode` 25/25 (phone lookup, day pin, candidate status/pin),
TS-U extension boundary test (page registered, GET only, no `<select>`), all TS-U 199 passed; typecheck, lint,
no-GET-mutation scan clean.
