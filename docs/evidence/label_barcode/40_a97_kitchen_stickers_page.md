# A97 — Kitchen Stickers page (2026-10-19)

**Owner:** "a screen where the drivers' manager can generate stickers and edit them, the simplest way, like Microsoft Publisher."

**What it is:** Fleet-Ops → Resources → **Kitchen Stickers** (permission `fleet-ops update order`, same as Move Area). Three columns: the list (search by name / mobile / BOX / area, stopped ones hidden behind a link), the form (name, mobile, BOX, area with the next day's legacy areas as suggestions and the area's driver shown, block, street, house, direction, meals, snacks, breakfast, protein g, carb g, notes, start and end date), and the sticker drawn with the Batch Labels markup next to the form while typing (notes shrink to fit as on paper). Buttons: New sticker, Save, Copy as new, Stop printing / Print again, Close. Nothing is deleted: a stopped sticker stays as history.

**Where it lives:** table `kitchen_sticker` (migration `0035`, owned by m25-label, one live sticker per mobile), every create / edit / stop / restore audited in the same transaction (`label.kitchen_sticker_*`, changed field names only — no customer data in the audit). API `GET/POST /fleet-ops/kitchen-stickers`, `POST /:id`, `/:id/stop`, `/:id/restore`, Fleetbase bearer like the other pages (401 without it — verified).

**Printing:** a sticker prints every delivery day (not Friday) from its start date until it is stopped; the end date only sets Days Remaining. The WhatsApp sync reads the live rows (`wa-labels-sync.sh`), and `nutreeze-kitchen-stickers.timer` (every minute, installed) re-syncs the next two days when the table changed — a saved edit reaches Batch Labels → WhatsApp → Kitchen stickers within about two minutes. Driver by area as before. For a subscriber ERPNext already knows, ERPNext keeps its days left and address (unchanged behaviour).

**Moved from the Publisher list (Verified):** `pg_dump` first (`/root/a97/pre-0035.dump`); the 16 stickers of the A95 list (with Omar's 18 Oct notes) loaded through the service (`kitchen-stickers-seed.js`, 16 audit rows); four sheet end dates that were empty or past are left empty (8658, 8841, 6887, 8754). Tuesday 2026-10-20 re-synced from the table: all 49 WhatsApp labels identical to before, field by field (name, BOX, plan, notes, meals, snacks, days, address, driver). Wednesday 2026-10-21: 16 kitchen stickers.

**Tests:** `ts-i-kitchen-sticker` (rules, one per phone, audit), `ts-u-kitchen-stickers-page` (preview, search, days left), extension registry test.

**Deployed:** API `nutrezee-api:a97-7cb20be` (rollback `pre-a97-20261019`), console `0.7.48-a97.1`, scripts in `/opt/fleetbase/integrations/whatsapp-subscribers/` (backup `bak-a97/`). Not yet seen by the manager signed in — the assistant does not sign in.
