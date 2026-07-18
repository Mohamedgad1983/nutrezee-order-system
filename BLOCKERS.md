# BLOCKERS.md — Partner feed integration (open questions & risks)

Raised during read-only DB discovery on 2026-07-09. These need owner/design decisions **before**
any integration work. Nothing here was resolved; discovery was read-only. Labels: [NC] = Needs
Confirmation, [RISK] = safety/correctness hazard.

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
