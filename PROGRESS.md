# PROGRESS.md — Partner feed: admin-panel DB discovery (READ-ONLY)

**Task:** Understand where the partner order/meal feed will be stored. **Discovery only** — no
design, no schema changes, no partner API calls. All queries were read-only (identity check +
`SELECT`/catalog metadata), run as a **read-only role**. PII masked in every sample below.

- **Date:** 2026-07-09 · **Status:** ✅ discovery complete, handed back to owner
- **Evidence labels:** Verified = queried live this session. Inferred = read from schema/config.

---

## 1. Identity check — WHICH DB (Verified)

Positively confirmed **before** any query. This is the Nutrezee admin-panel DB and nothing else:

| Check | Result |
|---|---|
| Database | `nutrezee` |
| Server | `127.0.0.1:5432` inside container `nutrezee-postgres-1` (image `postgres:16-alpine`) |
| Engine | **PostgreSQL 16.14** (not MySQL — the feed's `SHOW TABLES` phrasing is generic) |
| Connected role | `hermes_ro` (**read-only** Postgres role) |
| Signature | `schema_migrations` present, **22 applied**; latest = `0023_address_block`, `0022_address_structured_fields`, `0021_analytics_subscription_expiry` — these match this repo's `app/db/migrations/` exactly |
| Not applied here | `0024_fleetbase_dispatch` (consistent with it being gated / not live) |

**Explicitly NOT touched:** `fleetbase-database-1` (MySQL/driver app), `evolution-postgres`
(WhatsApp), ERPNext (host MySQL). Ignored as instructed.

### How we connect (for the record — credentials redacted)
```
nutrezee-vps MCP  →  SSH to VPS (13.140.159.201)
  →  docker exec -i nutrezee-postgres-1 psql "$HERMES_RO_DATABASE_URL"
      (URL sourced from /opt/nutrezee/hermes_ro.env, never printed)
      HERMES_RO_DATABASE_URL = postgres://<REDACTED_CREDS>@127.0.0.1:5432/nutrezee
```
App/superuser role is `nutrezee`; we deliberately used the **read-only** `hermes_ro` role so a
mutation is physically impossible.

---

## 2. Table map (Verified — 81 relations, `public` + `analytics`)

Schema is a modular monolith in **one `public` schema** (not schema-per-module). Est. rows from
catalog stats (no scans). Grouped by purpose; **bold = overlaps the partner feed.**

**Customers & contact** — `customer` (19.5k), `customer_phone` (19.4k), **`address` (9.5k)**,
**`area` (127)**, `customer_allergy`, `allergen`, `preference`, `tag`, `diet_status`, `merge_record`.

**Orders** — **`customer_order` (20.1k)**, `order_item`, `order_status_history`, `draft_order`,
`draft_item`, `change_request`, `transition_config` (48 — the seeded state machine).

**Catalog / menu** — **`product` (1.3k)**, **`meal_type` (2)**, `package` (9), `package_for_type`,
`section_master` (5), `product_component`, `product_ingredient`, `ingredient`, `nutrition_facts`,
`product_allergen`.

**Meal history** — **`customer_meal_history` (5.0k)**, **`customer_meal_history_items` (68k)**,
`customer_meal_history_exceptions`, `customer_meal_history_import_runs`, `legacy_meal_history_raw`,
`fulfillment_day` (528k — per-day expansion of every order).

**Delivery / driver (mostly empty stubs)** — `driver`, `driver_area`, `driver_shift`,
`driver_assignment_history`, `delivery_route`, `delivery_route_order`, `delivery_slot`,
`delivery_method`, `routing_rule`, `kitchen_ticket`, `packing_*`.

**Payments** — `payment_record` (11.5k), `payment_review_item`.

**Import / sync plumbing** — `import_batch` (420), `import_row_result` (112k), **`sync_record`
(52k — legacy↔live id map)**, `migration_exception_review`, `reconciliation_run`, `outbox_event`,
`audit_event*`, `idempotency_key`.

**Platform** — `session`, `staff_user`, `role`, `permission`, `role_permission`, `feature_flag`,
`setting`, `reason_code`, `notification_template`, `whatsapp_message_ref`.

**Views** — `analytics.customer_subscription_status`, `analytics.order_subscription_periods`.

---

## 3. Partner feed → existing tables (the core question)

**First read: this is NOT greenfield.** The schema already models all three feed shapes. The
partner feed's value is largely **filling content that exists as empty skeleton**, not creating
parallel structures. Details:

### 3a. Partner `orders` → `customer_order` (+ `address` + `area`)
| Partner field | Maps to | Notes |
|---|---|---|
| order_id | `customer_order.id` (text ULID) | ✓ |
| order_number | `customer_order.order_number` | ✓ heterogeneous: legacy numeric (`24625`) vs new (`N-…`) |
| status | `customer_order.status` | ⚠ different vocabulary (see §4) |
| customer_ref | `customer_order.customer_id` | ✓ |
| area_ar/en | `area.name_ar` / `area.name_en` | via `address.area_id`; also `customer_order.delivery_area_frozen` (frozen text snapshot) |
| location_pin | `address.location_pin` (jsonb) | ⚠ **exists but 0/9,542 populated** |
| address_text | `address.address_text` | ⚠ linked to **customer**, not order (no `order.address_id` FK) |
| created_at / updated_at | `customer_order.created_at` / `updated_at` | ✓ |

**Sample** (`customer_order`, ids truncated):
```
order_number | status   | total  | ccy | delivery_area_frozen | origin | created
24625        | active   | 153000 | KWD | Siddiq               | legacy | 2026-06-15
N-N34E9T58WS | approved |  35000 | SAR | (blank)              | new    | 2026-06-13
```
Distribution (Verified): 20,203 orders — expired 11,699 / rejected 5,805 / cancelled 1,545 /
active 1,153 / approved 1. Currency 20,202 KWD + 1 SAR (synthetic). Money is **minor units**.

### 3b. Partner `meal-catalog` → `product` (+ `meal_type`)
| Partner field | Maps to | Notes |
|---|---|---|
| meal_id | `product.id` | ✓ |
| name_ar/en | `product.name_ar` / `name_en` | ✓ populated |
| category_ar/en | `meal_type.name_ar` / `name_en` via `product.meal_type_id` | ⚠ **0/1,298 products have meal_type_id** |
| category_type | `meal_type` / `section_master` (5) | thin — only 2 meal_types exist |

**Sample** (`meal_type` = the whole category dimension): `Lunch/غداء`, `Dinner/عشاء`.
`product` fill rate (Verified): 1,298 rows, `meal_type_id` 0, `code` 0, `price` 2. Names exist;
**category + pricing essentially unpopulated.**

### 3c. Partner `meal-history` → `customer_meal_history_items` (+ header)
| Partner field | Maps to | Notes |
|---|---|---|
| customer_ref | header `customer_id` / `legacy_customer_id` | ✓ |
| order_number | header `legacy_order_number` (+ live `order_id`) | ✓ |
| delivery_date | `customer_meal_history_items.meal_date` | ✓ populated |
| status | `customer_meal_history_items.delivery_status` | ⚠ **0/68k populated** |
| meal_id | `customer_meal_history_items.meal_ref` | ⚠ **0/68k populated** |
| meal_name_* | `customer_meal_history_items.meal_name` | ⚠ single column (no _ar/_en); **0/68k populated** |
| qty | **— no column —** | schema delta |
| updated_at | **— no column —** (only `created_at`) | schema delta |

**Verified fill rate:** 67,983 items, ALL linked to a live `order_id`, but `meal_name` 0,
`meal_ref` 0, `delivery_status` 0 — **only the date rows exist, the dish content is empty.**
This confirms the known finding that per-day dish selection was never in the legacy export.
**The partner meal-history feed is exactly what fills this** ("capture forward").

---

## 4. First read: mirror vs. map onto existing

- **Map onto existing canonical tables — don't build a parallel schema.** `product`,
  `customer_order`, `address`, `customer_meal_history_items` already model the three feeds.
- **But land the raw feed first, then govern it in** — the repo's established pattern
  (`import_batch` → `sync_record` id-map → dry-run → apply → probe, à la M19). Partner data
  should hit a raw/staging landing (like `legacy_meal_history_raw`) before touching canonical
  tables, keyed through `sync_record`. Do **not** write canonical tables directly from the feed.
- **The feed's real payoff is content, not structure:** it fills empty dish content (68k history
  items), empty catalog categories, and — if the partner supplies coordinates — the 0% geo pins
  the driver app needs.
- **Owning modules:** m19-migration (import/landing), m03-orders (`customer_order`),
  m05-catalog (`product`), m24-fleetbase (dispatch/geo). Any write must go through the owning
  module — the cross-module single-write-path rule applies.

Open design questions and risks are in **BLOCKERS.md**. No schema was designed or changed here.

---

# PROGRESS — Fleetbase SMTP verification-code delivery (2026-07-09)

**Goal:** make Fleetbase actually deliver driver-login verification codes (currently generated but never sent).

## Access finding (resolved — Verified)
- Tool inventory by host: `nutrezee-vps` MCP → **13.140.159.201** (public IP verified via `checkip.amazonaws.com`); this is the Fleetbase host. `mcp__98f98e00…` (ERPNext / "Milagro") → accounting server 161.97.134.110 — **not touched**.
- Working path to Fleetbase: **YES** — `nutrezee-vps` MCP shell reaches the box and the `fleetbase-*` containers at `/opt/fleetbase`. No secret access file needed.

## Root cause (Verified)
- `/opt/fleetbase/api/.env` line 33: **`MAIL_MAILER=log`**. Laravel's `log` mailer writes the rendered email to `storage/logs/laravel.log` instead of sending → codes never leave the box.
- Delivery path (read from image source): `VerificationCode::generateEmailVerificationFor()` → `VerificationMail` → `Mail::to($user)` on the **default mailer**. `VerificationMail` and `VerificationCode` are **synchronous** (no `ShouldQueue`) → sent by the **`application`** container, which mounts `./api/.env`. Subject line carries the code: `"<CODE> is your Fleetbase verification code"`.
- The `queue` worker does **not** mount `api/.env` and is **not** on the OTP path — no need to touch it.
- Compose `application.environment:` sets only `MAIL_FROM_NAME` (no `MAIL_MAILER`/`MAIL_HOST`), so `api/.env` is the effective, minimal place to fix. Images already pinned to `fleetbase/fleetbase-api:v0.7.48` in `docker-compose.override.yml`.

## Prepared change (keys only — NO secret values written)
Target `/opt/fleetbase/api/.env` (mode 600, root):
```
MAIL_MAILER=smtp
MAIL_HOST=<provider smtp host>     # from Mohamed (e.g. smtp.gmail.com / smtp.zoho.com / smtp.office365.com)
MAIL_PORT=<587 or 465>
MAIL_USERNAME=<sending account>    # from Mohamed (usually the full email)
MAIL_PASSWORD=<SECRET>             # Mohamed places this himself (app password) — never in chat/commit
MAIL_ENCRYPTION=<tls or ssl>
MAIL_FROM_ADDRESS=it@nutreeze.com  # replaces current no-reply@13-140-159-201.sslip.io for deliverability
MAIL_FROM_NAME=Fleetbase
```
Restart plan: **only `fleetbase-application-1`** (`docker compose up -d application` picks up the .env remount + config reload). No other service restarted.

## Live-service health gate (to run AFTER the change)
- All 8 `fleetbase-*` containers still Up + healthy (note: `scheduler` was already `unhealthy` BEFORE this task — pre-existing, unrelated).
- Fleetbase API responds; nutrezee/evolution/hermes stacks untouched.

## State: BLOCKED on SMTP secret (defined hand-off, not a failure)
No config changed yet. Awaiting Mohamed's SMTP provider details + password (see BLOCKERS.md). Once provided → restart `application`, verify health, run the login test (phone +96560000010 → code to it@nutreeze.com → enter → logcat login). **Login becomes testable the moment SMTP is live.**

---

# 2026-07-18 — OTP via WhatsApp: Fleetbase custom_http → Evolution API (config-only)

## Step 1 — SMS_THROW_ON_ERROR finding (Verified, independently spot-checked)
- **Verdict: NO / dead config.** `CustomHttpSmsService` returns `success:false` on non-2xx with NO throw (its 5 `throw`s are config-validation only). `throw_on_error` (`core-api/config/sms.php:52`) is consumed nowhere in the send path. DriverController's email fallback fires only on transport/config exceptions.
- Consequence: a failed WhatsApp send still returns `{"status":"OK","method":"sms"}` to the driver app. **Accepted for now**; live test (Step 6) therefore verifies on the Evolution side, never trusting the API response. `SMS_THROW_ON_ERROR` NOT set.

## Step 2 — Network bridge (DONE, zero disturbance)
- Runtime: `docker network connect nutrezee_default fleetbase-application-1` — live attach, no restart. In-container probe `http://evolution-api:8080/` → **200**.
- Persistence: `/opt/fleetbase/docker-compose.yml` — `application` service now lists `networks: [default, nutrezee_default]` + top-level `nutrezee_default: {external: true}`. Backup: `docker-compose.yml.bak-2026-07-18`. Validated with `compose config --quiet` only — **not applied** (no recreate).
- Fingerprint: 16 running containers, same IDs, zero restarts (`fleetbase-scheduler-1` unhealthy = pre-existing since 06-26).

## Steps 3+4 — Config written, INERT until reload (placeholders only)
- Merge semantics (Verified): `EnvironmentMapper` merges DB setting `system.services.sms.providers` into `config('sms.providers')` via **shallow** `array_merge` — a DB `custom_http` entry replaces the whole env-built array. No partial override → DB row carries the FULL provider array.
- `.env` (`/opt/fleetbase/api/.env`, mode 600, backup `.env.bak-2026-07-18` mode 600): added `SMS_DEFAULT_PROVIDER`, `CUSTOM_HTTP_SMS_ENABLED/_METHOD/_URL/_AUTH_HEADER/_AUTH_TOKEN` (token = placeholder). All 8 MAIL_* keys untouched.
- DB: `settings` row id 5, key `system.services.sms.providers` — full custom_http array, body remapped to `{"number":"{{to}}","text":"{{text}}"}`, `auth_token` = placeholder. Round-trip verified.
- Provider selection (Verified): explicit arg → routing prefix (`+976→callpro` only, +965 unaffected) → `sms.default_provider`. `enabled` flag never consulted; `isConfigured()` = nonempty url.

## State: ⏸ HUMAN PAUSE — awaiting Mohamed
Place the Evolution API key (per-instance token of `nutreeze-otp` preferred) replacing `__PLACEHOLDER_SET_BY_MOHAMED__` in BOTH:
1. `/opt/fleetbase/api/.env` → `CUSTOM_HTTP_SMS_AUTH_TOKEN` (fallback path)
2. Fleetbase MySQL: `settings` row `system.services.sms.providers` → `custom_http.auth_token` (the LIVE path — the DB row wholesale-replaces the env config)
Then: graceful `octane:reload` → config verify → ONE live OTP test (Steps 5–6). Nothing reloaded yet; config inert.

## Rollback (2-minute)
`DELETE FROM settings WHERE \`key\`='system.services.sms.providers';` + set `SMS_DEFAULT_PROVIDER=` back to previous (unset) in `/opt/fleetbase/api/.env` (or restore `.env.bak-2026-07-18`) + `octane:reload` → OTP flow returns to email path.

## Steps 5–7 — LIVE and tested (2026-07-18)
- Token placement: Mohamed authorized self-placement in chat; token fetched server-side from Evolution's own DB (never printed anywhere), prefix-matched Mohamed's paste, placed in `.env` + DB row. Pre-verified: authenticated `connectionState` call from inside fleetbase-application-1 → 200. **Mohamed intends to rotate this token later** — after rotation, update BOTH locations and `octane:reload`.
- Reload: `php artisan octane:reload` only (no config cache existed, none introduced). Container NOT restarted (StartedAt unchanged 2026-07-13T11:51:14Z).
- Config verified live via tinker: `default_provider=custom_http`, correct url/method/auth_header, token len 36, **body `{"number":"{{to}}","text":"{{text}}"}`** → DB row confirmed as the live source.
- **Live E2E test PASSED** (one send, test number +9655144****):
  - Found: all 7 demo drivers' `drivers` rows were soft-deleted (07-12 importer session) — driver login requires an active profile. Temporarily restored ONE (Salmiya, uuid 63ce6f7f…), pointed its user at the test number.
  - `POST /v1/drivers/login-with-sms` (needs org API key, Bearer) → `{"status":"OK","method":"sms"}`.
  - Evolution `Message` record: fromMe=true → 96551447806@s.whatsapp.net, 09:36:38Z, "Your Nutreeze verification code is …". WhatsApp delivery confirmed.
  - `POST /v1/drivers/verify-code` → HTTP 200, driver auth token issued. Full login E2E ✅.
  - Reverted exactly: phone → +96560000010, drivers.deleted_at → '2026-07-12 07:13:29' (both read back).
- Final gates: `docker diff` shows **0 changed files under vendor/fleetbase**; 16 containers, ALL restarts=0, StartedAt unchanged; `nutreeze-otp` state **open**.
- Known accepted gap (from Step 1): a failed WhatsApp send does NOT fall back to email and still reports `method:"sms"` — monitor Evolution logs if drivers report missing codes.
- Operational note: real drivers need ACTIVE `drivers` rows (all 7 are currently soft-deleted) before driver-app login can work in production use.

## 2026-07-18 OTP delivery failure — diagnosis (first send + ONE controlled retest)
- Mohamed did NOT receive OTP #1 despite Evolution 201. Phase 1 (read-only): JID exact match digit-by-digit; Message status stuck PENDING + one ERROR MessageUpdate; Baileys logged "Closing session: SessionEntry" then error status 0 / stub 463 ~1s after send. No disconnect loop; instance processed inbound events minutes later → session healthy gate PASSED.
- Phase 2 (ONE retest, after Mohamed restored the host phone's internet): same temp-driver method (drivers 63ce6f7f deleted_at NULL↔'2026-07-12 07:13:29', user 93f7572d phone ↔ test number — armed and REVERTED, before/after read back). Result: **identical instant failure** (ERROR stub 463, PENDING through +120s). Dead-session-due-to-phone-offline theory REFUTED.
- Deeper DB analysis (read-only): device-originated messages (key AC…) deliver fine incl. to the test number (07-17 11:44 DELIVERY_ACK). API-originated (Baileys 3EB0…) sends succeeded in Dec-2025 to @lid JIDs, but ALL 4 sends ever to 96551447806@s.whatsapp.net (PN JID; first attempt 07-17 11:51) failed instantly the same way. → Root cause (Inferred): broken/absent per-contact Signal session — consistent with WhatsApp LID-migration addressing issues in Baileys when targeting PN JIDs; NOT instance-wide, NOT internet-related.
- Next (owner actions): (1) Mohamed sends any WhatsApp message FROM the test number TO the instance number (+96567645642) to prime session/LID mapping → ONE more retest. (2) If still failing: Evolution upgrade (LID fixes post-2.3.7) or targeted stale-session cleanup — both owner-gated (container/session changes forbidden by default).
- Final state: all mutations reverted, 16 containers zero restarts, nutreeze-otp open, exactly one send fired.

## 2026-07-18 ROOT CAUSE FOUND — WhatsApp error 463 (reach-out time-lock), upstream Baileys issue
- LID diagnostic send (owner-approved) ALSO failed identically → NOT addressing, NOT per-contact session, NOT internet. onWhatsApp probe: number exists, resolves normally.
- **Verified root cause:** Baileys stub/ack **463 = NackCallerReachoutTimelocked** — WhatsApp server-side anti-spam: outgoing API messages missing `tctoken`/`cstoken` privacy tokens are counted as "reaching out" and time-locked (Baileys issues #2441, #2698; waha #1992). Explains everything: device-originated sends deliver (real client attaches tokens); API sends worked Dec-2025 (before enforcement); ALL 5 API sends Jul-17/18 fail instantly regardless of PN/LID JID or session priming.
- Upstream status: **open/unresolved** — tctoken/cstoken PRs landed in newer Baileys but warm-contact 463 still reported (#2698). Evolution v2.3.7 (Dec-2025, current = latest STABLE) predates all of it; newer = 2.4.0-rc2 (May-2026) / `homolog` (Jul-2026) only.
- Decision: **STOP all API test sends** (repeated 463s risk further flagging the +96567645642 account). 5 sends total today, all reverted/logged.
- Options (owner decision pending): (a) upgrade Evolution → `homolog`/2.4-rc (newer Baileys, may fix, not guaranteed; container recreate, instance data persists in evolution-postgres + instances volume, worst case QR re-scan); (b) stopgap: rollback WhatsApp OTP config (documented 2-min rollback) + finish SMTP (still blocked on owner's MAIL_PASSWORD) → OTP via email — note email fallback only triggers when custom_http is UNCONFIGURED (throws) since non-2xx never throws; (c) long-term: official WhatsApp Cloud API with an approved authentication template (likely still config-only via custom_http body remap, but needs Meta business setup).
- All infra work from today remains valid: network bridge, config plumbing, body remap all function correctly end-to-end up to WhatsApp's server rejection.

## 2026-07-18 Evolution upgrade (463 fix attempt) — Phase A prep DONE, awaiting owner go
- **ROLLBACK digest (current v2.3.7):** `evoapicloud/evolution-api@sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339`
- **TARGET digest (homolog, built 2026-07-14):** `evoapicloud/evolution-api@sha256:1e656f95aa1a2b7c2455a6a36d654637ddc2658c263794a5074ada798412a549`
- Snapshots (mode 600): `/root/backups/evolution-pg-2026-07-18-preupgrade.dump` (221,716 B, pg_restore -l validated — **this holds the WhatsApp session**: Session table 1 row/3049 B creds, DATABASE_SAVE_DATA_INSTANCE=true) + `/root/backups/evolution-instances-2026-07-18-preupgrade.tar.gz` (132 B — volume near-empty by design, not a gap).
- Baseline: 16 containers fingerprinted (scheduler unhealthy pre-existing), nutreeze-otp `open`, Caddy wa.* route 200.
- **ROLLBACK PROCEDURE (written before execution):**
  1. Edit /opt/evolution/docker-compose.yml: `image: evoapicloud/evolution-api@sha256:1bd8afc4…f4d339`
  2. `docker compose -f /opt/evolution/docker-compose.yml up -d evolution-api` (recreates api only)
  3. If DB damaged by target's migrations: `docker exec -i evolution-postgres pg_restore -U <user> -d <db> --clean --if-exists < /root/backups/evolution-pg-2026-07-18-preupgrade.dump`
  4. (Volume restore normally unnecessary — near-empty: untar evolution-instances tar into the volume if ever needed.)
  5. Verify: / returns 200 with version 2.3.7, connectionState nutreeze-otp = `open`, Caddy route 200.
  6. Worst case: instance shows `close`/`connecting` → re-pair by QR scan on the +96567645642 phone (~2 min, owner).

## 2026-07-18 Evolution upgrade attempt — CONCLUDED: rolled back by owner choice (license gate)
- Attempt 1 (Codex): homolog boot FAILED — `datasource.url property is required`; clean rollback, DB untouched.
- Attempt 2 (Codex): added `DATABASE_URL` alias to /opt/evolution/.env (value-blind, kept DATABASE_CONNECTION_URI) — STILL failed: Prisma 7 ignores env-based URLs entirely; clean rollback.
- Root cause + fix (PM): homolog = 2.4.0 on Prisma 7 — url must live in `prisma.config.ts` (schema `url`/`env()` removed in v7). Pre-flighted risk-free in a throwaway container (`prisma migrate status`): mechanism PROVEN + enumerated exactly 2 pending migrations.
- Attempt 3 (PM): mounted /opt/evolution/prisma.config.ts (no secrets; reads process.env.DATABASE_URL) → **v2.4.0 BOOTED**: 2 migrations applied (20251216_increase_token_length, 20260506_add_runtime_config — additive), Baileys **7.0.0-rc13** (the 463-fix version; note 2.4.0-rc2 still ships rc.9 = pointless), session reconnected WITHOUT QR.
- **BLOCKER: Evolution Foundation licensing** — 2.4.0 refuses ALL API calls (`LICENSE_REQUIRED`, 503; global + instance keys both rejected: "invalid signature") until activated via /manager/login or a licensing key. Staging-build enforcement; terms/cost unknown.
- Owner chose ROLLBACK → v2.3.7 restored (compose .bak3), booted clean ("No pending migrations" — Prisma 6 tolerates the 2 newer rows; both migrations additive, left in place), session `open`, Caddy 200, 16 containers zero restarts. **ZERO test sends this task.** pg_restore not needed.
- Kept for the future retry (when a stable/community 2.4.x ships): /opt/evolution/prisma.config.ts (ready recipe), DATABASE_URL alias in .env (harmless under 2.3.7), snapshots in /root/backups/, digests above.
- Status: **463 remains unfixed** (upstream). OTP-over-WhatsApp stays configured but non-delivering; email fallback still requires SMTP completion + config rollback to trigger.

## 2026-07-18 (later) — Upgrade REOPENED per owner: v2.4.0 LIVE + license ACTIVATED; final blocker = WhatsApp account restriction
- Owner chose activation. Re-applied the proven recipe (target digest + prisma.config.ts mount, compose .bak4): v2.4.0 healthy, session survived again w/o QR.
- Manager login "Invalid credentials" was the license gate chicken-and-egg; during owner's email registration flow the license ACTIVATED (log: "License activated. Key: fe5aa4b3…8f81, tier: evolution-api" — licensing is FREE per Evolution Foundation docs, one-time registration + heartbeats). API gate now OPEN: per-instance token + global key both work (200).
- ONE test send (pre-approved temp-driver method, before/after logged, reverted exactly): still fails — **but Baileys rc13 surfaces the real reason: 463 + "Your account has been restricted"**. The +96567645642 WhatsApp ACCOUNT is under a WhatsApp-side restriction (reach-out time-lock family; matches upstream Baileys #2636). Infrastructure end-to-end is now proven correct; the blocker is account standing, which is time-based on WhatsApp's side.
- Current state kept (owner's activation): v2.4.0 licensed, session open, 16 containers zero restarts, all test data reverted. Fleetbase config unchanged and correct.
- Plan: NO API sends for 24–48h (each 463 reinforces the restriction); keep the account active organically from the phone (normal chats with real contacts); then ONE retest. If restriction persists → account-level remediation (WhatsApp support/appeal via the phone app) or switch OTP channel (Cloud API / email stopgap).

## 2026-07-18 (evening) — Driver app login WITHOUT OTP delivery: LIVE and E2E-verified
- Owner idea (password/FaceID in driver app) — discovery verdict (Codex, file:line evidenced): Navigator app has NO password/biometric UI (backend fully supports passwords + console "Reset User Credentials", but app UI is phone→code only) → IMPOSSIBLE without app-side changes. However: (1) **`SMS_AUTH_BYPASS_CODE`** exists natively (DriverController.php:626 checks it before stored codes), (2) **driver tokens never expire** (app-level sanctum.expiration=null) → login once = logged in until logout, (3) code screen opens whenever login-with-sms returns OK.
- Also discovered: **MAIL_MAILER=smtp is now configured** (was log) — the email fallback path DELIVERS: driver-login codes email to the driver user's email (test driver = it@nutreeze.com). Admin controls driver emails → this is already an admin-gated, WhatsApp-free OTP channel.
- Implemented (config/data only): DB setting `system.sms.default_provider=twilio` (unconfigured → throws → email fallback; REQUIRED because octane:reload does NOT re-read .env — changed keys keep master-process values; the earlier .env-only flip leaked one 463 send at 11:31 before this was understood). `.env` + bypass code (6-digit, comment-marked REMOVE after test phase); loaded via one `docker restart fleetbase-application-1` (~30s; network attach + DB row survive; container healthy).
- E2E verified: login-with-sms → {OK, method:email} (real email sent) → verify-code with BYPASS → 200 + non-expiring driver token. **whatsapp_sends=0** throughout.
- Test driver ARMED for the test day: drivers 63ce6f7f active, user 93f7572d phone=+96551447806 (revert values recorded above).
- Rollback/cleanup after test phase: remove SMS_AUTH_BYPASS_CODE line from /opt/fleetbase/api/.env + `docker restart fleetbase-application-1`; re-soft-delete demo driver (deleted_at='2026-07-12 07:13:29', phone +96560000010). To resume WhatsApp OTP later: set DB row system.sms.default_provider back to custom_http (tinker updateOrCreate) + reload.
- WhatsApp 463 track unchanged: v2.4.0 licensed+healthy, account restriction pending 24-48h organic-activity wait.
## 2026-07-18 — Driver password import blocked on Fleetbase admin session

- Workbook: 2 sheets, 20 source rows, 11 unique drivers after 9 cross-sheet phone merges;
  all phone cells normalized to `+965` E.164; zero invalid rows.
- Generated 20-character passwords remain private and mode 600; none was printed.
- Standard Fleetbase API created 11/11 driver records; all read back `available`.
- Password verification is 0/11. Runtime root cause: public driver CRUD ignores the guarded
  `password` attribute; driver self-service change-password returns HTTP 401 due the upstream
  users-resource create-user permission; the admin reset endpoint requires a real console
  admin session.
- Browser reached the Fleetbase sign-in screen but had no active admin session or autofill.
- No default/empty-password login succeeded. No vendor source or `/legacy` file changed.
- Private manifest/import material was removed from the VPS/container after the stop.
- `SMS_AUTH_BYPASS_CODE` is removed and proven dead: no environment copy or DB settings row
  remains, runtime config is unset after restart, the application is healthy, and a direct
  bypass-style verification probe returns HTTP 400.
- Resume point: Mohamed signs into `https://ops.nutreeze.com` in the connected browser; Codex
  continues with console password reset, 11/11 verification, app implementation, S1–S9,
  A/B/C gallery, then bypass removal.

## 2026-07-18 — Driver password import unblocked and verified

- Mohamed restored access to the Fleetbase Administrator account and signed into the canonical
  console at `https://ops.nutreeze.com`.
- Fleetbase IAM's standard **Change user password... → Reset User Credentials** flow set the
  generated password for all 11 imported drivers. Credential-email delivery was disabled for
  every final reset.
- A server-side, value-silent verification found 11/11 users, 11/11 matching password hashes,
  11/11 matching phones, and 11/11 driver records in `available` status.
- A controlled reset proof verified the previous password is rejected and the final password is
  accepted. Private verification files were deleted from the workstation, VPS, and application
  container immediately afterward.
- The credential-safe A1–A4, B1–B3, and C1–C2 operating gallery is at
  `docs/evidence/driver-password-guide/README.md`.
- Fleetbase vendor files and `/legacy` remain unchanged. The console password-reset email queue
  defect remains a separate operational follow-up.
- **MANDATORY: Mohamed must rotate all 11 driver passwords using the B1–B3 guide.**
