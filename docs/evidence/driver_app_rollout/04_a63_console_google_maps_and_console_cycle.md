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

## ملحق 14:30 الكويت — Google رفض المفتاح: `ApiNotActivatedMapError` — Verified، ورجوع مؤقت
- بعد التبديل ظهرت في اللوحة "Oops! Something went wrong". إعادة الإنتاج بصفحة اختبار محلية بنفس المفتاح (متصفح التطبيق): `Google Maps JavaScript API error: ApiNotActivatedMapError`. أي أن **Maps JavaScript API غير مفعّلة على مشروع Google Cloud الخاص بالمفتاح** (المفتاح مفعّل لخرائط Android والجيوكود فقط). اختبار curl السابق كان يعيد سكربت التحميل فقط ولا يكشف التفويض — درس مسجّل.
- رجوع مؤقت (14:31): `mapProvider` أُعيد إلى `leaflet` على مستوى النظام والشركة، restart لحاوية `application` فقط؛ المفتاح باقٍ في `system.services.google_maps`. اللوحة عادت لخرائط CARTO مع العلامة المائية (تعمل).
- المطلوب من المالك (إجراء في حساب Google Cloud، لا يقوم به المساعد): تفعيل **Maps JavaScript API** على مشروع المفتاح، وإن كان المفتاح مقيّداً بواجهات API إضافة Maps JavaScript API إليه، وإن كان مقيّداً بمُحيلات إضافة `https://ops.nutreeze.com/*`. بعدها يُعاد التبديل إلى google بأمر واحد (نفس كتابة `Setting`).

## ملحق 16:10 الكويت — المالك فعّل Maps JavaScript API؛ التبديل إلى Google أُعيد — Verified
- المالك: الخدمة مفعّلة على المشروع وموجودة ضمن قيود API للمفتاح؛ Application restrictions = None.
- إعادة الإنتاج بنفس صفحة الاختبار المحلية: `MAP_CREATED` بلا `gm_authFailure`، الخريطة ظهرت (الكويت).
- `mapProvider` أُعيد إلى `google` (نظام + شركة)، restart لحاوية `application`، التحقق: provider google، المفتاح set، الحاوية healthy. صفحة الاختبار المحلية والخادم المؤقت حُذفا.
- المتبقي: تأكيد المالك أن اللوحة تعرض Google Maps بعد Reload.

## ملحق 16:30 الكويت — تنظيف وورقة التسليم
- الطلب التجريبي `order_zYwGtfMcAk` (`NUT1693817570KW`) ومكان التسليم `place_qRVMEXvArt` حُذفا (soft delete عبر API) بإذن المالك؛ الحالة النهائية المسجّلة `completed`.
- المالك أكد ظهور خريطة Google في اللوحة بعد Reload.
- الحقيقة التشغيلية: التطبيق لم يُوزَّع بعد على أي سائق سوى تليفون الاختبار (Arsad)؛ لذلك لا مواقع لباقي السائقين. ورقة تسليم السائقين (عربي/إنجليزي، 4 خطوات + قائمة فحص لكل تليفون) في `05_driver_handout_1_0_12.html` ومنشورة كـ Artifact للمالك.
