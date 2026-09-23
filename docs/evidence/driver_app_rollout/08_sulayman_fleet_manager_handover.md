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
