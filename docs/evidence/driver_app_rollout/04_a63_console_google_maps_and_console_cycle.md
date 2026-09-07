# 04 — A63: خريطة الـ console على Google Maps + إثبات الدورة الكاملة حتى اللوحة — 2026-09-07

## 1) الدورة الكاملة سائق ← تطبيق ← backend ← console — Verified
طلب تجريبي `NUT1693817570KW` (`order_zYwGtfMcAk`, internal `A62-CONSOLE-TEST-1`, meta `a62_console_test`) مسند لـ Arsad Ali ومدفوع Dispatched في 13:50 الكويت. من تليفون السائق (Navigator 1.0.12): Start Order ← `started` ← Update Activity ← "Delivered / تم التسليم" ← `completed` في 13:53، اختفى من قائمة السائق (116 ← 115)، `drivers.current_job_uuid` أُفرغ. أحداث الـ API بالترتيب: `order.dispatched` ← `order.updated` ← `order.completed`. **المالك رأى الطلب Completed في ops.nutreeze.com/fleet-ops** (صورة شاشة من المالك). ما إذا كان التحديث وصل بلا Refresh: بانتظار تأكيد المالك.

## 2) علامة "API KEY REQUIRED" على الخريطة — السبب والحل
- السبب (Verified): الـ console (`@fleetbase/fleetops-engine` 0.6.56) يستخدم خرائط CARTO المجانية بعنوان ثابت في الكود بلا مفتاح؛ CARTO تشترط الآن مفتاح API وتضع العلامة على البلاطات بدون مفتاح. لا إعداد بيئة عندنا يتحكم في العنوان.
- الحل المطبّق (config only، بدون تعديل كود): Fleetbase يدعم مزوّد Google Maps في اللوحة. المفتاح موجود بالفعل عند المالك (نفس مفتاح تطبيق السائق، بصمته `4455…9574`، على الـ VPS في `geocode-compare/keys.env`) واختبار Maps JavaScript API بمرجع `https://ops.nutreeze.com/` نجح قبل التطبيق.
- الكتابة عبر نموذج `Setting` نفسه (artisan tinker، المفتاح مُمرَّر كمتغير بيئة ولم يُطبع):
  - `system.services.google_maps` = `{api_key, locale: us}` (يُدمج في `services.google_maps` عند الإقلاع وكل طلب عبر `EnvironmentMapper`).
  - `fleet-ops.map-settings` = `{mapProvider: google}` (نظام) و `company.2db920aa….fleet-ops.map-settings` = `{mapProvider: google, roadmap, بلا طبقات}`.
- نسخة احتياطية: `/opt/fleetbase/backups/a63-pre/settings-20260907T1108Z.sql`. الحاويات الأربع أُعيد تشغيلها (restart) في 14:08 الكويت خارج نافذة المستورد؛ التحقق: `config('services.google_maps.api_key')` = set، `mapProvider` = google، console/API 200.
- الرجوع: استعادة جدول `settings` من النسخة ثم restart للحاويات الأربع.

## مفتوح
- المالك يعيد تحميل اللوحة ويؤكد ظهور خريطة Google بلا علامة.
- قيد مفتاح Google (HTTP referrer) يجب أن يشمل `ops.nutreeze.com` إن كان مقيّداً — الاختبار بالمرجع نجح.
- حذف الطلب التجريبي `order_zYwGtfMcAk` ومكان التسليم بعد إذن المالك.
