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

---

## ملحق — اختبار A إلى Z على تليفون سائق حقيقي (2026-09-07، 11:05–11:20 الكويت) — Verified

الجهاز: realme RMX3760 عبر adb، التطبيق Nutreeze Navigator 1.0.11 (#12)، مسجّل دخول كسائق حقيقي **Arsad Ali** (`driver_mW76oeHnja`، 115 طلباً حقيقياً اليوم). لم يُلمس أي طلب عميل؛ أُنشئ طلبان تجريبيان بالـ API (`meta.a61_test=true`, dropoff = موقع الهاتف) وأُسندا للسائق ثم dispatched.

| الخطوة | التطبيق | الـ backend |
|---|---|---|
| فتح الطلب A ← **Start Order** | الحالة Started، الزر تحوّل إلى Update Activity | `started=1`, صف STARTED، `current_job` = الطلب |
| Update Activity | قائمة 6 خيارات: Delivered + 5 أسباب (العناوين الطويلة كانت تُقتطع ← A61.2 قصّرها) | `GET next-activity` |
| اختيار "غائب ولا يوجد صندوق" | الحالة **Not Delivered**، الطلب ما زال مفتوحاً | `status=not_delivered`, صف NOT_DELIVERED، لا إكمال |
| Update Activity مرة أخرى | خياران: Delivered / Returned to kitchen | — |
| اختيار Returned to kitchen | الحالة **Returned To Kitchen** | `status=returned_to_kitchen`, صف RETURNED_TO_KITCHEN |
| الطلب B ← Start ← Update Activity ← **Delivered** | توست "Order status updated to: Delivered"، الطلب اختفى من القائمة (100 ← 99) | `completed`, صف COMPLETED (complete=1), `current_job` أُفرغ |
| سكربت الإقفال على الطلب A (بعد نقل موعده إلى أمس، نطاق = 1) | بعد التحديث اختفى الطلب من القائمة | `expired` + صف EXPIRED "Closed without delivery" tag `a61_returned_closed` |

النصوص العربية مخزّنة utf8mb4 سليمة. لوج التطبيق بلا exceptions. الطلبان التجريبيان ومكانا التسليم حُذفا (soft delete) بعد الاختبار.

### A61.2 (PR #81, merged a9027c8, CI 29/29) — نتيجة الاختبار
- عناوين الأنشطة ≤ 48 حرفاً (مثل "Not delivered — absent, no bin / غائب ولا صندوق") حتى لا تُقتطع في ورقة الاختيار. مطبّقة live.
- سكربت الإقفال يفرّغ `drivers.current_job_uuid` عند إقفال طلب غير مكتمل (Fleetbase لا يفرّغه إلا عند الإكمال). مركّب على الـ VPS.

### اكتشاف جانبي مهم (خارج نطاق هذه الوحدة) — Verified
**التطبيق يعرض 100 طلب كحد أقصى.** الـ API يقطع الصفحة عند 100 (`limit=200` يعيد 100)، والتطبيق يطلب `limit=50` بلا ترقيم صفحات. Arsad له 115 طلباً اليوم ← **15 طلباً غير مرئية له في التطبيق**. الحل في التطبيق (ترقيم/تحميل المزيد) أو تقسيم القائمة حسب المنطقة — وحدة منفصلة قبل التسليم للسائقين الذين يتجاوزون 100 طلب (اليوم: Nicholas 116، Arsad 115، Ibrahim 109، Amandeep 107).
