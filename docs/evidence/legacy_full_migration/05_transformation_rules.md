# Transformation Rules

Date: 2026-06-16

## General Rules

- Preserve legacy IDs in `sync_record`.
- Preserve raw text in Arabic/English exactly.
- Do not translate notes.
- Normalize dates to ISO `YYYY-MM-DD` or ISO timestamp where applicable.
- Normalize phone numbers while keeping `phone_raw`.
- Normalize money to minor units for new-system DB fields; keep decimal-string source values in normalized metadata when present.
- Do not merge duplicate customers automatically.
- Unknown or unmapped values must be retained and flagged for review.
- Do not drop unmapped fields; keep them in normalized metadata/export reports until database support is confirmed.

## Order Status Mapping

| Legacy Status | New Status | Rule | Risk |
| --- | --- | --- | --- |
| active | active | Import as active plan | Needs confirmation of legacy exact spelling |
| pause | paused | Import as paused plan | Needs confirmation |
| paused | paused | Import as paused plan | Needs confirmation |
| pending | pending_review or manual re-key | Current migration mapping excludes pending from active-plan import | High |
| expired | expired or excluded | Current mapping excludes history from active-plan import | High |
| cancel | cancelled or excluded | Current mapping excludes cancelled history from active-plan import | High |
| cancelled | cancelled or excluded | Same as above | High |
| unknown | UNKNOWN_LEGACY_STATUS | Preserve source value and block/flag | High |

## Payment Status Mapping

Verified in code:
- Existing M07 importer maps known normalized legacy payment statuses through `LEGACY_PAYMENT_STATUS_MAP`.
- Unknown payment statuses create an unpaid payment record and a finance review item.

Needs Confirmation:
- Full legacy payment vocabulary from DB/export/API.

| Legacy Status | New Status | Rule |
| --- | --- | --- |
| paid | paid | Map if exact normalized value is supported by code |
| unpaid | unpaid | Map if exact normalized value is supported by code |
| pending | unpaid or link_sent | Needs finance decision |
| gateway_pending | unpaid + finance review | Existing synthetic test covers this pattern |
| unknown | unpaid + finance review | Preserve source in review request |

## Delivery Status Mapping

Needs Confirmation:
- Legacy delivery statuses are not available in this session.

Proposed safe default:
- Known delivered values map to `delivered`.
- Known failed values map to `failed`.
- Known rescheduled values map to `rescheduled`.
- Unknown values become `UNKNOWN_LEGACY_STATUS` and block import or require review.

## Package Mapping

- Resolve by legacy package ID through `sync_record` first.
- Fallback to exact name match only for dry-run review.
- Parent/sub-package links must be resolved before child package apply.
- Package cycle guard is enforced by the database.

## Branch Mapping

Current assumption:
- Single-site intake remains active in the current MVP.
- `site_ref` is nullable on `customer_order`.

Needs Confirmation:
- Whether legacy branch/site values exist and must be preserved.
- Whether branch should map to a future site table or remain `site_ref` metadata.

## Fields Not Mapped Today

- Driver assignment records.
- Coupon master data beyond `coupon_code_frozen` on orders.
- Dietician requests.
- Marketing subscribers.
- Content/legal/gallery/social/push data.
- Raw per-record payload storage in database.
- First-class legacy IDs for address, order detail, delivery, driver, coupon, dietician request.

## Fields Requiring Business Decision

- Full payment status vocabulary.
- Delivery status vocabulary.
- Full clone scope: daily order operation only vs all legacy modules.
- Whether deferred modules should remain legacy-owned or be migrated now.
- Whether raw legacy payloads may be committed as repo evidence if they contain PII.
