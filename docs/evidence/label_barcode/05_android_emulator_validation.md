# 05 — Android emulator validation (WP-LBL-04)

> Driver app driven on a real Android 14 emulator against the running Nutrezee API.
> 2026-07-27. Screenshots in `shots/android-*.png`.

## 1. Environment

| Piece | Value |
|---|---|
| Emulator | AVD `nutreeze_handover`, Android 14, 1080×2400, arm64 |
| Build | `./gradlew installDebug` → **BUILD SUCCESSFUL**, "Installed on 1 device" |
| App | `com.nutreeze.driver` / `io.fleetbase.navigator.MainActivity`, v1.0.1 #2 |
| API | local Nutrezee API via `NUTREZEE_API_HOST=http://10.0.2.2:5199` |

Cleartext to the host is permitted because `android/app/src/debug/res/xml/network_security_config.xml`
already sets `cleartextTrafficPermitted="true"` for debug builds — **no Android resource was edited.**

## 2. Two defects found by running it — neither visible in tests

### 2.1 The build was broken by duplicate files in `node_modules`

`:react-native-fbsdk-next:compileDebugJavaWithJavac` failed:

```
FBAppEventsLoggerModule 3.java:117: error: class FBAppEventsLoggerModule is public,
    should be declared in a file named FBAppEventsLoggerModule.java
```

**117** file-manager duplicates (`… 2.java`, `… 3.java`) existed under `node_modules` — a Java file
named `X 2.java` declaring `public class X` can never compile. Every one was verified to have its
legitimate original alongside it (117 with an original, **0 orphans**) before removal.
`node_modules` is gitignored and disposable, so nothing tracked was touched.

The same pollution exists in the repo itself as untracked junk — `src/contexts/LocationContext 2.tsx`,
`src/utils/currencies 2.js`, `src/components/InstanceLinkHandler 2.tsx`, and three
`.github/workflows/… 2.yml`. They are inert (nothing imports them) and pre-date this work, so they
were left alone, but they are worth cleaning up.

### 2.2 The Collect tab did not appear

The first emulator run showed only **Dash | Orders | Reports | Chat | Account**. Registering the tab
in `DriverNavigator.tsx` is not enough: `navigatorConfig('driverNavigator.tabs')` always resolves a
value from `config/default.js`, so the fallback list inside `DriverNavigator.tsx` is **never
reached**. Fixed by declaring the tab list in `navigator.config.ts`, the sanctioned override point
(and in the MAY-edit list); the change was added to the A27 predeclaration in `PLAN.md`.

A test could not have caught this — it only appears when the real config chain is resolved.

## 3. What was verified on the device

| # | Check | Result |
|---|---|---|
| 1 | App builds and installs | ✅ BUILD SUCCESSFUL |
| 2 | App launches (Nutreeze splash → dashboard) | ✅ `android-01/02` |
| 3 | **Collect My Orders** tab present with its own icon | ✅ `android-03` |
| 4 | Screen opens, renders title + sign-in prompt in Nutreeze branding | ✅ `android-04-collect-screen` |
| 5 | Sign-in with a Nutreeze **staff** account (`driver` role) | ✅ session established |
| 6 | Manifest loads from the live API | ✅ `For: 2026-07-27 · Driver A1` |
| 7 | Counts render | ✅ **3 Assigned today · 2 Collected · 1 Remaining** |
| 8 | Remaining list renders with order/area/time | ✅ `Order 26497 · Salmiya · From 5 AM to 4 PM` |
| 9 | **Customer name is masked for the driver role** | ✅ shows `***`, not the name |
| 10 | Scan button opens the camera modal | ✅ `android-07-scanner` |
| 11 | Live camera feed renders with the bilingual prompt + Cancel | ✅ VisionCamera active |
| 12 | Session survives an app and emulator restart | ✅ returned straight to the manifest |

Item 9 is the masking rule working end to end on a real device: the driver identifies the stop by
order number, area and delivery time, never by name.

## 4. What could NOT be verified here, and why

**A live Code 128 decode through the camera.** The emulator's back camera renders a synthetic
"virtual scene" (a living room). Injecting a custom barcode image into that scene via the
documented `<avd>/Toren1BD.posters` mechanism was attempted twice — absolute path and
AVD-relative filename, with `hw.camera.back=virtualscene` set in `config.ini` — and this emulator
build ignored the poster file both times (the scene loaded `Toren1BD.obj` but logged no poster).

So the camera **path** is proven (permission granted, feed live, scanner configured for
`code-128`, prompt and cancel rendering), but a real decode is not. That requires a physical
device, and it is exactly what the plan already assigns to the operational pilot — print ten
labels, scan them from paper.

What is proven without a camera:

- the printed barcode is genuinely scannable: the rendered label's SVG is decoded back to its
  printed text by an **independent** decoder (admin validation, 50/50 checks);
- every scan outcome, end to end over HTTP, including idempotent retry and the audit trail
  (`03_collection_scan_verification.md`);
- all seven outcomes render distinctly and bilingually (15 unit tests, including a check that the
  Arabic strings contain real Arabic and the EN/AR namespaces have identical leaf keys).

## 5. Configuration note

`NUTREZEE_API_HOST` in the driver app's `.env` is a **local-validation override only** and must be
left unset for release builds, so the API base is derived as `FLEETBASE_HOST + /nz`
(`https://ops.nutreeze.com/nz`). `.env` is gitignored, so this never ships.
