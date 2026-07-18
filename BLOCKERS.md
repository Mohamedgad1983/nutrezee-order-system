# BLOCKERS.md — Partner feed integration (open questions & risks)

Raised during read-only DB discovery on 2026-07-09. These need owner/design decisions **before**
any integration work. Nothing here was resolved; discovery was read-only. Labels: [NC] = Needs
Confirmation, [RISK] = safety/correctness hazard.

## RESOLVED — Driver password import required an admin session (2026-07-18)

**Resolved 2026-07-18.** Mohamed restored the Administrator account and signed into the
canonical console. Fleetbase IAM reset all 11 driver passwords through the standard admin
flow; server-side checks found 11/11 password matches, 11/11 matching phones, and 11/11
drivers in `available` status. The credential-safe guide is
`docs/evidence/driver-password-guide/README.md`.

Historical blocker evidence follows.

Eleven unique workbook drivers were created through the standard Fleetbase API and are
`available`, but 0/11 generated passwords were set:

- Public `POST/PUT /v1/drivers` silently drops `password` because the upstream
  `Fleetbase\Models\User` model guards it from mass assignment.
- A valid driver bearer token receives HTTP 401
  `User is not authorized to create user` from
  `POST /int/v1/users/change-password`; Fleetbase's generic users-resource middleware blocks
  the route before the password controller runs.
- The correct admin endpoint, `POST /int/v1/auth/change-user-password`, rejects the company
  API credential as unauthenticated and requires an admin console session.
- The connected Chrome profile reaches `https://ops.nutreeze.com/auth` but has no active
  Fleetbase session or autofilled credentials.

**Unblock:** Mohamed signs into `https://ops.nutreeze.com` in the connected browser and leaves
the session open. Codex then resumes at the existing console reset flow, verifies 11/11
password logins, and continues the approved app/emulator/documentation work. Vendor code and
direct DB password writes remain forbidden. See the private app repo `BLOCKERS.md` #6 for full
runtime evidence.

### Follow-up — console password-reset email is broken

Read-only diagnosis on 2026-07-18 confirmed four password-reset requests for
`it@nutreeze.com` were accepted but never sent:

- `UserForgotPassword` implements `ShouldQueue`; all four notification jobs remain pending
  in Redis alongside 109 other jobs.
- The application writes to Redis prefix `nutreeze_database_`, while
  `fleetbase-queue-1` listens on `fleetbase_database_` and therefore sees no jobs.
- The application has working `smtp` mail configuration, but the queue container does not
  mount `/opt/fleetbase/api/.env`; it defaults to `ses` with no SES key or secret.
- Result: no mail-send attempt and no SMTP error occurred. Even after the queue-prefix issue
  is fixed, the worker must receive the same SMTP configuration before queued mail can work.

**Operational requirement:** repair the queue prefix and worker mail configuration, then
prove the console forgot-password flow delivers end-to-end. This is a follow-up blocker for
real administration; it does not authorize a live queue/config change in the current
read-only recovery task.

## Structural gaps (schema deltas the feed may force)
1. **[NC] Order ↔ address linkage.** Partner `orders` pairs an address + `location_pin` *per
   order*, but the DB has **no `customer_order.address_id`** — addresses attach to the
   **customer** (`address.customer_id`), and one customer can have 0..N addresses. Decide how a
   feed order binds to a specific address (add a per-order delivery-address link? use the frozen
   `delivery_area_frozen` snapshot? require the feed to send address inline?).
2. **[NC] Meal-history missing columns.** `customer_meal_history_items` has **no `qty`** and
   **no `updated_at`** (only `created_at`), and a single `meal_name` (not bilingual `_ar`/`_en`).
   If the partner feed carries qty / update timestamps / bilingual names, a forward migration is
   required — and migrations are a **gated** step (0024 isn't even applied yet).
3. **[NC] Catalog category dimension is thin/empty.** Only 2 `meal_type` rows (Lunch/Dinner) and
   **0/1,298 products** carry `meal_type_id`. Partner `category_ar/en` + `category_type` have
   nowhere fully populated to map to. Decide whether the feed defines the category taxonomy.

## Data-quality gaps (independent of the feed)
4. **[RISK] 0% geo pins.** `address.location_pin` is populated on **0 of 9,542** rows. The
   driver-app use case needs coordinates regardless of the feed's source — geocoding (Google/HERE)
   is a hard prerequisite. If the partner supplies pins, validate them; if not, this is a separate
   workstream.
5. **[NC] Meal-history content is empty.** 68k history items have dates but **0** meal_name /
   meal_ref / delivery_status. AI trend analysis and auto-meal both depend on content that does
   not yet exist — the feed must supply it going forward; it cannot be backfilled from legacy.

## Integration-discipline risks
6. **[RISK] Status vocabulary + transition engine.** Order statuses are `expired / rejected /
   cancelled / active / approved` and **all state changes must go through the seeded transition
   engine** (`transition_config`, 48 rows) — never a direct `UPDATE ... SET status`. Partner
   statuses must be mapped to legal transitions, not written raw.
7. **[RISK] Single write path / cross-module rule.** A CI guard fails if one module writes another
   module's tables. Feed ingestion must route through owning-module services (m19 landing → m03 /
   m05 / m24), not foreign-table SQL.
8. **[RISK] Money & currency normalization.** Amounts are **minor units**; data is ~all KWD
   (3-decimal). Any partner amounts must be normalized to minor units with the correct currency
   scale before storage.
9. **[RISK] Writing the live DB is a HARD STOP class.** This task stayed read-only. Any future
   write follows the mandatory sequence: `pg_dump` snapshot → M19 dry-run → apply (idempotent via
   `sync_record`) → correctness probe. No exceptions.

## Not yet done (out of scope for this discovery)
- Partner API not called — its real payload shapes/field types are **assumed** from the brief,
  not Verified. Confirm against a live sample before mapping is finalized.
- No decision yet on raw-landing table design vs. reusing `legacy_meal_history_raw` / `import_batch`.

---

# BLOCKER — Fleetbase SMTP credentials needed (2026-07-09)

**[BLOCKS] Verification-code delivery.** Root cause found: `/opt/fleetbase/api/.env` has `MAIL_MAILER=log`. The fix (switch to `smtp`) requires SMTP credentials for the `nutreeze.com` sending account — these are **secrets Mohamed must place himself**; never requested/printed in chat.

Need from Mohamed:
1. **Provider** for `nutreeze.com` mail → determines `MAIL_HOST`, `MAIL_PORT` (587 TLS / 465 SSL), `MAIL_ENCRYPTION`.
2. **`MAIL_USERNAME`** (the sending account, usually the full email — non-secret, can be in chat).
3. **`MAIL_PASSWORD`** = the SMTP **app password** — the SECRET. Placed by Mohamed directly into `/opt/fleetbase/api/.env` (mode 600), or dropped in a mode-600 file for me to merge without printing.

Not blocking access: shell path to 13.140.159.201 works (no access-secret file needed). This is purely the mail-credential hand-off listed as an expected stop.
