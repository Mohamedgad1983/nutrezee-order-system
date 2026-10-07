# 30 — WP-OPS-A78: the customer part of the label read from Partner

**Date:** 2026-10-07 · **Branch:** `build/wp-ops-a78-label-partner-profile` · **API image:** `nutrezee-api:a78-d93f010` (rollback tag `pre-a78-20261007`) · **Console:** `fleetbase-console:a78-1`, extension 0.3.21 (rollback tag `pre-a78-20261007`)

## Trigger

The owner printed the same customer and day twice — legacy label and Batch Labels — and sent both photos (order 29203, Wednesday 7 October 2026).

| Field | Legacy label | Batch Labels before | Batch Labels after |
|---|---|---|---|
| User ID | 1119 | +96698992558 | 1119 |
| Phone | 98992558 | +96698992558 | 98992558 |
| Block / Street / Building | 3 / 314 / 13 | - / - / - | 3 / 314 / 13 |
| Plan line | Arabic plan name (Meal: 3) (Snacks: 2) | - (Meal: -) (Snacks: -) | Arabic plan name (Meal: 3) (Snacks: 2) |
| Days Remaining | 4 | 4 | 4 |
| Delivery time / method, dishes, totals | same | same | same |

## Causes (Verified)

1. **Address:** the daily-deliveries mirror carries one free-text line (`2, 314, 13, …`); the label reads the local `address` table, which has no row for Partner customers. The text line is `building, street, house_no[, landmark], extra_directions` and does not contain the block at all.
2. **User ID:** the label printed `sync_record.legacy_key` of the customer, which for imported customers is the normalized phone.
3. **+966:** the staging setting `default_phone_country_code` is `+966`; every 8-digit Partner phone was stored with it (1,716 customer phones; 773 of them also exist as a second customer under `+965`). The label printed the stored value.
4. **Plan line:** Partner orders have no local package.

## Source found

Partner integration endpoints `subscriptions`, `customer-addresses`, `customers` (same key, read-only). Checked on the whole day 2026-10-07 (941 deliveries):

- `daily.order_id` = `subscription_id`: 941/941; its `delivery.delivery_address_id` resolves: 941/941, same customer: 941/941.
- `daily.customer.code` = `customers.customer_code`: 941/941.
- address `name` is the block (910 plain numbers, 29 texts such as `block 1`, 2 empty); legacy "Building" = `house_no`.
- plan `name_ar`, `meals_per_day`, `snacks_per_day` present: 941/941.
- Days remaining of the sample: subscription ends 2026-10-11, Friday off → 7, 8, 10, 11 = 4, equal to the legacy label.

## Change

- `m25-label/partner-label-profile.ts` — `PartnerLabelProfileSource`: per day one `daily-deliveries` read (5 min cache) plus the two lists (19 + 13 pages, about 11 s, 20 min cache, refreshed in the background, last good copy kept, empty answer refused). Any failure returns null — the label prints with its previous fields (A70: printing never stops).
- `label.service.ts` — order of precedence for the address: the order's own source address (WhatsApp subscribers) → Partner profile → stored address. Phone always printed as the local number. A phone is never printed as User ID.
- `nutreeze-wa-orders.php` — WhatsApp subscribers: house number goes to "Building" (was "Flat").
- No migration, nothing written to Partner or legacy.

## Verification

- Unit `ts-u-partner-label-profile` 6/6, integration `ts-i-label-barcode` 26/26, typecheck, lint, both scans.
- Real day, built by the deployed `LabelService` from the real Fleetbase rows (`/root/a78/verify-a78.sh`):

| Day | Partner labels | block | building | User ID numeric | phone local 8 digits | plan + meals + snacks | `+` phones | phone as User ID |
|---|---|---|---|---|---|---|---|---|
| 2026-10-07 before | 943 | 7 | 0 | 0 | 0 | 9 / 0 / 0 | 943 | 943 |
| 2026-10-07 after | 943 | 938 | 937 | 940 | 941 | 940 | 0 | 0 |
| 2026-10-08 after | 908 | 905 | 904 | 908 | 906 | 908 | 0 | 0 |

  WhatsApp labels 2026-10-08: 32/32 with block, street and building; phone local 32/32.
- 943 labels build in about 13 s including the first load of the lists.
- Deploy: env fingerprint identical, health 200, 0 restarts.

## A78.2 — notes (same day)

Owner: "notes are written often — is the existing part clear?" It was not:

- **No note was printed at all**: the label read `customer.notes`, empty for every Partner customer (0 of 937 on 2026-10-08), while Partner's `daily-deliveries.driver_instructions` carries a note for 267 of 927 deliveries that day (median 10 characters, longest 164, 15 with line breaks). Examples: "Thursday Double Box", "85G CARBS", "call number …".
- **No room**: the info column is a fixed 45.2 mm above the barcode with one free line; a longer note would have been painted over the barcode.

Change: the note of the day comes from Partner with the rest of the profile; a written note prints bold in a boxed area beside the barcode (footer split 44 mm barcode / rest notes, box clipped to its own area, smaller type above 100 characters — room for about 215 characters). Without a note the label is unchanged (`Notes: -`, barcode centred). The barcode's size and bar width are unchanged.

Checked: local render of the real template + stylesheet with a short, a 57-character, a 160-character and an Arabic note, and a long block text; release gate 13/13; candidate booted in a real browser before the swap ("Nutreeze | Fleet-Ops", no missing module); live console loads. Deployed labels 2026-10-08: **251 of 908 carry a note**, longest 159 characters, 10 above 100.

[Inferred] that legacy "Notes" is this field — the sample label has none on both sides. Not yet seen on paper.

## Open (Needs Confirmation)

- **Direction** is mapped to the address `landmark` — [Inferred]; the sample has none on both labels. `extra_directions` (the address nickname, e.g. "home") and `building` (mostly `0`) are not printed, as on the legacy sample. A legacy label of a customer with a landmark and a flat would confirm.
- **`+966` in the database** is not changed here. Correcting the setting alone would create second customers (and second barcodes) for existing ones; it needs its own pass with a merge rule.
- WhatsApp labels still have no User ID, meals, snacks.
