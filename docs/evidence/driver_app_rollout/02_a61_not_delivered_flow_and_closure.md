# 02 — A61: حالات "لم يتم التسليم" للسائق + قاعدة إقفال يومية صادقة (LIVE 2026-09-07)

الطلب: المالك ("نفّذ البندين 1 و2 كوحدة واحدة") بعد تقرير [01](01_driver_full_cycle_scenarios.md). PR #80 (merged 09ad0cc, CI 29/29). لا تعديل vendor، لا schema، لا تعديل في تطبيق السائق.

## ما تغيّر

### 1. تدفّق أنشطة النقل (Order Config `order_config_zYjt2qXcAX`) — Verified live
```
created → dispatched → started ─┬→ completed            Delivered / تم التسليم
                                ├→ nd_no_answer         لا يرد على الاتصال
                                ├→ nd_no_bin            العميل غائب ولا يوجد صندوق
                                ├→ nd_wrong_address     العنوان خاطئ
                                ├→ nd_refused           العميل رفض الاستلام
                                └→ nd_postponed         العميل طلب التأجيل
      كل سبب (code = not_delivered) → completed (إعادة محاولة) | returned_to_kitchen
```
- `enroute` حُذف: ضغطة **Start** ثم **قرار واحد** (تم التسليم أو سبب عدم التسليم).
- `not_delivered` حالة مفتوحة أثناء اليوم (تظهر للسائق للمحاولة مرة أخرى). `returned_to_kitchen` نهاية المسار للسائق.
- لا `logic`/`events`، `require_pod=false` (الصورة قرار منفصل — البند 3)، الوحيد `complete:true` هو `completed`.
- الملف: `ops/fleetbase/driver-flow/a61/transport.flow.json`، طُبّق بـ `apply-transport-flow.php --apply --confirm=NUTREEZE` (dry-run أولاً). نسخة احتياطية: `/opt/fleetbase/backups/a61-pre/order_configs-20260907T0748Z.sql`.

### 2. cron الإقفال اليومي (`/etc/cron.d/nutreeze-complete-past-orders`, 01:00 Europe/Berlin = 02:00 الكويت صيفاً) — Verified installed
| الحالة عند 02:00 (طلب أمس) | تصبح | صف tracking | tag |
|---|---|---|---|
| dispatched (لم يلمسه السائق) | completed | COMPLETED | `a29_complete_past_orders` (انتقالي — مقياس التزام السائقين) |
| started (بدأ ولم يُقفل) | completed | COMPLETED | `a61_started_not_completed` |
| not_delivered | **expired** "Closed without delivery / أُقفل بدون تسليم" | EXPIRED | `a61_not_delivered_closed` |
| returned_to_kitchen | **expired** | EXPIRED | `a61_returned_closed` |

`expired` حالة Fleetbase أصلية غير نشطة (مستبعدة من فلتر `active` الذي يستعلم به التطبيق)، ومميّزة عن إلغاءات Partner (`canceled`) وعن التسليم (`completed`). صفوف NOT_DELIVERED / RETURNED_TO_KITCHEN تبقى في سجل الطلب.

## التحقق (Verified)
- `verify-transport-flow.php`: started → 6 خيارات، not_delivered → [completed, returned_to_kitchen]، returned_to_kitchen → []، getters سليمة.
- HTTP `GET /v1/orders/{id}/next-activity` لطلب dispatched حقيقي: 200 ويعيد `started` بالأبناء الجدد.
- `probe-rollback.php` على طلب حقيقي داخل transaction مرتجعة: dispatched → started → not_delivered (لا يُكمل الطلب) → returned_to_kitchen؛ صفوف CREATED, DISPATCHED, STARTED, NOT_DELIVERED؛ بعد الرجوع: dispatched / started=0 وصفوف CREATED, DISPATCHED فقط.
- إقفال v2 dry-run `--before=2026-09-07`: 0 في النطاق (لا أثر على طلبات اليوم). لوج التطبيق بلا أخطاء.
- TS-U `app/tests/unit/ts-u-fleetbase-driver-flow.test.ts`: 5/5.

## ما ينتظر المالك
- **اختبار على جهاز حقيقي** مع طلب واحد: Start ← (قائمة 6 خيارات) ← سبب عدم التسليم ← يظهر الطلب بحالة "لم يتم التسليم" ← إعادة محاولة أو مرتجع.
- في صباح اليوم التالي: `daily.log` في `/opt/fleetbase/backups/complete-backfill-2026-08-31/` يُظهر `by_status` والتاغات.
- البنود 3–8 من التقرير 01 قرارات مفتوحة (صورة إثبات، تنبيه الإلغاء بعد Start، webhook، مواقع السائقين).

## الرجوع
استعادة `order_configs` من النسخة الاحتياطية + نسخ السكربتين الأصليين من `/opt/fleetbase/backups/a61-pre/` (انظر README الوحدة).
