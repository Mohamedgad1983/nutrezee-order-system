# Nutreeze MDM Setup Runbook (for an agent with browser access)

2026-09-23 · owner: Mohamed. Live copy (editable): https://claude.ai/code/artifact/92359d30-8053-4ecb-8155-fe7e19a535da

Enrol the 9 new driver phones as company-owned (Android Enterprise, fully managed) in ManageEngine MDM Plus Cloud so the Nutreeze driver app installs and updates on all of them from one console. Estimated 2 hours for the first phone, then about 10 minutes per phone.

## 1. Ground rules for the executing agent

The agent drives the browser; the owner types every credential and clicks every consent. Stop and hand over the keyboard at each of these points, then continue.

- **Owner only:** typing any password or 2-factor code, signing in to Google (it@nutreeze.com), accepting ManageEngine or Google terms of service, entering payment details (none should be needed for the free edition).
- **Agent:** navigation, form filling with the facts in section 2, uploading the APK, building the profile, generating the QR, reading back every screen.
- **Never** enrol the owner's personal phone, factory-reset any phone that already holds data, or delete anything in the console.
- Work one phone through end to end (Step F) before enrolling the other eight.
- At the end, fill section 10 and report the enterprise ID, the enrollment QR location, and the device list.
- ManageEngine screen names below are the standard ones; if a menu is named differently in the current build, use the nearest equivalent and note it in section 10.

## 2. Facts and inputs

| Item | Value |
| --- | --- |
| Google account for Android Enterprise | it@nutreeze.com (company domain; owner signs in) |
| MDM product | ManageEngine Mobile Device Manager Plus, Cloud edition, free tier (up to 25 devices) |
| App APK (download) | https://ops.nutreeze.com/driver-app/nutreeze-driver-1.0.12.apk |
| App info page | https://ops.nutreeze.com/driver-app/ |
| Package name | com.nutreeze.driver |
| Version | 1.0.12, versionCode 13, 94,451,882 bytes |
| SHA-256 of the APK | 309a6ce26f5971d7200b4fcef0bbeb97a7bdd67c9216195a1507868482c80bca |
| Second app to install from Play | WhatsApp Messenger (com.whatsapp) |
| Phones | 9 new Android phones (Realme, RMX3760 family), never set up, boxed, with the driver's SIM |
| Device naming | Driver's first name + plate, e.g. `Arsad 24-40452` |
| Fleet-Ops console (cross-check drivers) | https://ops.nutreeze.com |
| Support contact on the enrolment screen | Sulayman, +965 97404017 |

Driver list (name, phone, plate) is in Fleet-Ops > Drivers; the nine are Naseer, Shaik Feroz, Amandeep, Vineesh, Arsad, Ibrahim, Salato, Nicholas, Ravi.

## 3. Step A — Create the MDM account (about 15 minutes)

1. Open https://www.manageengine.com/mobile-device-management/ and choose **Cloud** > **Sign up / Free trial**.
2. Fill the form: email it@nutreeze.com, company Nutreeze, country Kuwait, phone of the owner. **Owner** clicks the terms checkbox and Sign up.
3. Owner opens the confirmation mail in it@nutreeze.com and completes the account (sets the password himself).
4. Sign in at https://mdm.manageengine.com (region URL may differ; use the one in the confirmation mail). Skip the guided tour.
5. **Admin** > **Trial / License**: note the plan name and device limit in section 10. The free edition activates automatically when the trial ends; nothing to buy.
6. If asked to choose a **Data center / region**, pick Europe.

Done when: the dashboard opens, shows 0 devices, and the top bar shows it@nutreeze.com.

## 4. Step B — Bind Android Enterprise (about 15 minutes)

1. **Enrollment** > **Android** > **Android Enterprise** (may be labelled *Managed Google Play* or *Android for Work*).
2. Choose **Managed Google Play Accounts** (not G Suite / Workspace). Click **Configure / Get started**.
3. A Google page opens. **Owner** signs in with it@nutreeze.com, enters company name Nutreeze (and the owner's name/email as Data Protection Officer if asked), clicks **Complete registration** / **Confirm**, and accepts the Managed Google Play agreement.
4. Back in ManageEngine the page shows *Configured*, an **Enterprise ID** (starts with `LC`), and organisation Nutreeze. Copy the Enterprise ID to section 10.
5. **Enrollment** > **Android** > **Google Play services / EMM token**: nothing to fill if it already says Configured.

If the page says the Google account is already bound to another EMM, stop and tell the owner; do not unbind anything.

Done when: Android Enterprise shows Configured with an Enterprise ID.

## 5. Step C — App repository (about 15 minutes)

**Nutreeze driver app (private APK, not on Play):**

1. Download the APK from https://ops.nutreeze.com/driver-app/nutreeze-driver-1.0.12.apk to the Mac (94 MB). Optional: `shasum -a 256` must equal the value in section 2.
2. **Device Mgmt** > **App Repository** > **Add App** > **Android** > **Enterprise App** (a.k.a. *Upload APK / In-house app*).
3. Upload the file. The console reads package `com.nutreeze.driver`, version 1.0.12 (13). Display name **Nutreeze Driver**, category Business, description `Driver app for Nutreeze deliveries`.
4. Under **Permissions / App configuration** (if offered): Location = *Allow, always*; Notifications = *Allow*; Camera = *Allow*. Save.
5. Save the app. It must appear as *Enterprise* with version 1.0.12.

**WhatsApp (from managed Google Play):**

6. **Add App** > **Android** > **Play Store app**. Search `WhatsApp Messenger`, open it, **Approve**, accept the permission list, **Add**.

Do not distribute either app yet.

Done when: the repository lists Nutreeze Driver 1.0.12 (Enterprise) and WhatsApp Messenger (Play).

## 6. Step D — Device profile (about 20 minutes)

**Device Mgmt** > **Profiles** > **Create Profile** > **Android**, name `Driver phone – v1`, description `Nutreeze delivery drivers`.

| Policy page | Setting | Value |
| --- | --- | --- |
| Restrictions > Device functionality | Factory reset by user | Not allowed |
| Restrictions > Device functionality | Safe mode | Not allowed |
| Restrictions > Device functionality | Developer options / USB debugging | Not allowed |
| Restrictions > Applications | Install from unknown sources | Not allowed |
| Restrictions > Applications | Uninstall apps (Nutreeze Driver, WhatsApp) | Not allowed |
| Restrictions > Applications | Force-stop / clear data of managed apps | Not allowed |
| Restrictions > Location | Location services | Always on, user cannot disable |
| Restrictions > Location | Location mode | High accuracy |
| Restrictions > Battery | Battery optimisation exemption for `com.nutreeze.driver` | Exempt (unrestricted) |
| Restrictions > Network | Mobile data | Allowed; data roaming not allowed |
| Restrictions > Security | Screen lock | PIN, minimum 4 digits, lock after 5 min |
| Restrictions > Security | Screen capture | Allowed |
| Restrictions > Account | Add / remove Google accounts | Not allowed |
| Restrictions > System | OS updates | Automatic, over Wi-Fi only |
| Kiosk (Android) | Mode | Multi-app kiosk: Nutreeze Driver, WhatsApp, Phone, Google Maps, Camera, Settings |
| Kiosk (Android) | Home / launcher | Nutreeze Driver as default app |
| Wi-Fi | Office network | Office SSID + password (owner types the password) |

Notes: if a setting does not exist on the current console build, skip it and list it in section 10; do not substitute a stricter one. Keep **Settings** in the kiosk allow-list so drivers can join a new Wi-Fi. Save; do not distribute yet.

Done when: profile `Driver phone – v1` is saved with restriction, kiosk and Wi-Fi sections configured.

## 7. Step E — Group, distribution and enrollment QR (about 15 minutes)

1. **Device Mgmt** > **Groups** > **Create Group**: name `Drivers`, platform Android.
2. **Profiles** > `Driver phone – v1` > **Distribute** > group `Drivers`.
3. **App Repository** > Nutreeze Driver > **Distribute** > group `Drivers`, install type **Silent / Mandatory**, **Auto-update** on. Repeat for WhatsApp Messenger.
4. **Enrollment** > **Android** > **Android Enterprise** > **Device Owner (Fully managed)** > **QR code**. Options: *Company-owned, fully managed*; skip user assignment (or a generic user `drivers@nutreeze.com` if required); auto-assign to group `Drivers`; Wi-Fi in QR = office SSID (owner types the password); **Skip setup wizard** on.
5. Generate the QR. Download the PNG to the Mac and print it, or keep it full-screen. Record where it is saved in section 10. The same QR enrols all 9 phones.

Done when: group `Drivers` has the profile and both apps assigned, and an enrollment QR exists.

## 8. Step F — Enroll the 9 phones (about 10 minutes each)

The phone must be **brand new or factory-reset**; enrollment only works from the first *Welcome / Hi there* screen. Do phone 1 (Arsad) fully and verify before the rest.

Per phone:

1. Insert the driver's SIM (the number registered in Fleet-Ops for that driver). Power on.
2. On the Welcome screen **tap the empty area 6 times** quickly; a *QR code setup* prompt appears. (If not, choose language, then tap 6 times on the next screen.)
3. Connect to Wi-Fi when asked (the QR may carry it). The phone downloads the QR reader.
4. Scan the enrollment QR. Accept *This device will be managed*. The phone installs the ManageEngine agent as device owner.
5. Wait on *Setting up your device*. When the kiosk home appears, wait 2 to 5 minutes for Nutreeze Driver and WhatsApp to install silently.
6. Console > **Devices**: rename the device `<First name> <plate>`; confirm group `Drivers` and profile *Applied*.
7. Phone: open **WhatsApp**, the driver verifies his own number (SMS code on the SIM). Add him to the drivers group.
8. Phone: open **Nutreeze Driver**, enter the driver's number. The login code arrives by email to Sulayman (subject `<code> is your … verification code`, To `Sulayman+<driver>@nutreeze.com`); Sulayman gives the driver the 6 digits.
9. Check location permission = *Allowed all the time* and battery = *Unrestricted* (profile should set both; if not, set by hand and note it).
10. Driver opens **Orders** and sees his orders; in Fleet-Ops he shows as online.

Troubleshooting:

- QR not recognised: no internet, or QR generated for another enrollment type. Regenerate as *Fully managed*.
- *Can't set up device – already has an account*: phone was set up before; factory reset and start again.
- Apps not arriving within 10 minutes: Devices > device > **Actions** > *Sync*, then *Install app* manually.
- No login code in Sulayman's inbox within 2 minutes: check the driver's number in Fleet-Ops > Drivers matches the SIM, then *Resend*.

Done when: all 9 devices are in the console, named, in group `Drivers`, profile Applied, both apps Installed, each driver logged in.

## 9. Step G — Publishing an app update later

1. Get the new signed APK (built on the owner's Mac; also published at https://ops.nutreeze.com/driver-app/ with `version.json`).
2. **App Repository** > Nutreeze Driver > **Update / Upload new version** > upload. The console must show the higher versionCode.
3. **Distribute** to group `Drivers` again if asked; keep *Silent* and *Auto-update*.
4. Within about 15 minutes every online phone installs it (Devices > device > **Apps** shows the new version). Phones that are off update when next online.
5. The download page stays as fallback for a phone that is not enrolled.

WhatsApp updates itself through managed Google Play.

## 10. Acceptance checklist and report

- [ ] MDM console URL and plan: `__________` (free edition, device limit `___`)
- [ ] Android Enterprise Configured, Enterprise ID: `LC__________`
- [ ] App repository: Nutreeze Driver 1.0.12 (13) Enterprise, WhatsApp Messenger (Play)
- [ ] Profile `Driver phone – v1` saved; settings skipped because the console lacks them: `__________`
- [ ] Group `Drivers` with profile + both apps distributed (silent, auto-update)
- [ ] Enrollment QR generated; saved at: `__________`
- [ ] Phone 1 (Arsad) enrolled, apps installed, driver logged in, online in Fleet-Ops
- [ ] Phones 2–9 enrolled; table below filled
- [ ] Owner has the console login in the company password store

| # | Driver | Plate | Device name in console | Enrolled (time) | App installed | Logged in |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Arsad Ali | 24-40452 |  |  |  |  |
| 2 | Naseer Ahmed | 21-79114 |  |  |  |  |
| 3 | Shaik Feroz | 21-79959 |  |  |  |  |
| 4 | Amandeep | 21-56792 |  |  |  |  |
| 5 | Vineesh Thanduthiyil | 21-79872 |  |  |  |  |
| 6 | Ibrahim Khaleelulla | 21-21412 |  |  |  |  |
| 7 | Salato Din Miya | 24-40125 |  |  |  |  |
| 8 | Nicholas Momanyi | 21-79349 |  |  |  |  |
| 9 | Ravi Bhardwaj | 24-40149 |  |  |  |  |

Report back to the owner: the filled table, the Enterprise ID, anything skipped or renamed, and any phone that failed with the exact error text.
