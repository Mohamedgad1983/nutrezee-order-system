# 08 — Fleet manager (Sulayman) onboarding: phone, console role, update duty

**Date:** 2026-09-23. **Owner:** confirmed the fleet manager is the existing console user **Sulayman** (Sulayman@nutreeze.com, invited 2026-09-05 under A58, never logged in yet); phone given by the owner.

## Applied — Verified
| Item | Before | After | How |
|---|---|---|---|
| `users.phone` (user_t4yIdr31mO) | NULL | `+96597404017` | tinker `User::save()`, no collision with any other user |
| Console role | none (no `model_has_roles` row, no policies) | **Operations Manager** = DispatchManager + OrderCoordinator + FleetManager policies (drivers, vehicles, fleets, orders, dispatch) | `assignSingleRole("Operations Manager")` → row on his `CompanyUser` (53421c4b…) for company Nutreeze |
| Backup | | `/opt/fleetbase/backups/a64-pre/sulayman-pre-20260923T1549Z.sql` (users, company_users, model_has_roles) | mysqldump |

Not chosen: `Administrator` (AdministratorAccess, too broad) and `Fleet Supervisor` (FleetManager + ServiceAreaManager, no order/dispatch rights).

## Message for the owner to send Sulayman (WhatsApp/email; the assistant does not send)

> أهلاً سليمان، من بكره أنت مسؤول تطبيق السواقين ولوحة المتابعة.
>
> **1) لوحة المتابعة:** https://ops.nutreeze.com — ادخل بإيميلك Sulayman@nutreeze.com. لو ما عندكش كلمة سر: افتح إيميل الدعوة اللي وصلك يوم 5 سبتمبر، أو اضغط "Forgot password" في صفحة الدخول. دورك Operations Manager: تشوف وتعدّل السواقين والسيارات والطلبات والتوزيع.
>
> **2) تطبيق السواقين:** https://ops.nutreeze.com/driver-app — الصفحة فيها زرار التحميل وخطوات التثبيت ورمز QR. ابعت الرابط ده لجروب السواقين، وكل سائق يثبّت وياخد كود الدخول على واتساب.
>
> **3) أي تحديث بعد كده:** لما يوصلك إصدار جديد، هيتحط على نفس الصفحة، وأنت تبعت رسالة واحدة للسواقين: "افتحوا الرابط واضغطوا تحميل ثم تثبيت". التطبيق بيتحدث فوق القديم وهم فاضلين مسجّلين دخول. مش محتاج تلف على التليفونات.
>
> **4) لو سائق مش عارف يدخل:** رقم تليفونه في اللوحة (Fleet-Ops ← Drivers) هو اللي بيتبعت عليه الكود. تأكد إن الرقم صح وإن واتساب شغال على نفس الرقم.

## Left with the owner [NC]
- Sulayman has to complete his first login (invitation or password reset) before tomorrow; his console access was never exercised.
- If Sulayman should also publish APKs himself (not just message drivers), he needs SSH/scp access to the VPS folder — not granted; today the assistant/owner publishes and Sulayman announces.

---

## Addendum 2026-09-23 — driver login codes now go to Sulayman's mailbox (A65.2)

**Finding:** the WhatsApp sender for login codes (Evolution instance `nutreeze-otp`, number +965 67645642) has been **logged out since 2026-08-21 03:58** (`WAMonitoringService … LOGOUT`); `verification_codes` had zero `driver_login` rows in 30 days. The custom_http SMS provider returns `success:false` without throwing, so Fleetbase reported "sent" while nothing arrived. The owner has no WhatsApp on that number and chose: **code by email to Sulayman, who relays it to the driver.**

**Applied — Verified**
- Backup `/opt/fleetbase/backups/a64-pre/users_settings-otp-email-20260923T1627Z.sql`.
- 9 driver users' emails changed from undeliverable `driver.<hash>@nutreeze.local` to plus-addresses of the fleet manager's mailbox (`users.email` index is non-unique, but distinct addresses were used so the recipient identifies the driver):
  naseer, feroz, amandeep, vineesh, arsad, ibrahim, salato, nicholas, ravi → `Sulayman+<slug>@nutreeze.com`.
- No settings changed: SMS default provider is `twilio` with no credentials, `+965` has no routing rule, so `SmsService` throws and `DriverController::loginWithPhone` falls through to `generateEmailVerificationFor` (synchronous `Mail::send`, Office 365 SMTP from hello@nutreeze.com).
- Test: `POST /v1/drivers/login-with-sms {"phone":"+96550133727"}` (Ravi) → `{"status":"OK","method":"email"}`; `verification_codes` row `driver_login` for `Sulayman+ravi@nutreeze.com`, created 16:30:53Z, **expires after 60 minutes**; no ERROR in laravel.log at that time, so SMTP accepted the message. Mail subject = `<code> is your … verification code`, so the code is visible in the inbox list and the To-address names the driver.
- Mailbox receipt at Sulayman@nutreeze.com not observable from the VPS → **owner/Sulayman to confirm** the test mail arrived [NC]. If Exchange plus-addressing were disabled the mail would bounce to hello@nutreeze.com.

**Daily routine:** driver types phone in app → within seconds Sulayman gets "123456 is your … verification code" addressed to Sulayman+<driver>@ → he sends the 6 digits to that driver (any channel) → driver enters it. Valid 60 min; a driver can tap "resend" to get a fresh one.

**Upgrade path (2 minutes when Sulayman has WhatsApp on his phone):** link his WhatsApp to the `nutreeze-otp` instance with a pairing code (`GET /instance/connect/nutreeze-otp?number=<his number>`); codes then reach drivers directly and email stays as fallback. Old pairing code `ND3F-WJ9D` was issued for the owner's number and is void.
