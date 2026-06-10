# WP-07 Orders Create Legacy Review Pack

**Date:** 2026-06-10
**Scope:** Sponsor decision pack for `/orders/create`; documentation only.
**Result:** READY_FOR_SPONSOR_SIGNOFF, with WP-07 still blocked until sponsor accepts the P0 decisions below.

Evidence labels used here:
- **Verified:** directly supported by read-only legacy discovery notes or signed/current build registers.
- **Inferred:** supported by old-system shape or Phase 3/4 target contracts, but not directly observed as an old-system rule.
- **Needs Confirmation:** sponsor/workshop must decide before WP-07 build.

Role shorthand from target contracts: OA = Order Agent, OM = Ops Manager, SU = Support, FI = Finance, SA = Super Admin. Old-system RBAC was not verified, so role assignments below are target proposals unless explicitly marked Verified.

## 1. Executive summary

**Verified:** The old admin dashboard includes a staff-assisted order creation form at `/orders/create` with customer search, package/sub-package/package-for, start date, amount fields, coupon, address, area, delivery slot/method, notes, paid-already, gateway, paid amount, and a create/payment-link action. No order was submitted and no payment link was generated during discovery. Evidence: `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:11`, `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:28`, `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:53`, `nutrezee-step-1-discovery/docs/01_discovery/full_admin_app_discovery.md:12`.

**Verified:** The old system evidence does not prove which `/orders/create` fields were required, optional, conditional, draft-only, or warning-only. Required field behavior, duplicate customer behavior, WhatsApp reference behavior, allergy severity, coupon strictness, payment gate, slot capacity behavior, and edit-after-submit behavior all remain sponsor-owned decisions. Evidence: `19_Roadmap/legacy_first_section_alignment_audit.md:102`, `19_Roadmap/legacy_first_section_alignment_audit.md:132`, `22_Meeting_Notes/verification_workshop_agenda.md:18`.

**Verified:** WP-07 is currently blocked on the mandatory intake field set. This pack is decision-ready but does not unblock WP-07 by itself because no sponsor signature or Assumed-for-build acceptance is recorded. Evidence: `19_Roadmap/build_progress_register.md` WP-07 row, `19_Roadmap/legacy_first_section_alignment_audit.md:16`.

**Verified repo scan:** No screenshots, PDFs, spreadsheets, CSV/TSV exports, or image artifacts were found in the repository for `/orders/create`; the available old-system evidence is markdown discovery notes and read-only route inventories.

## 2. Evidence reviewed

| Evidence | What it contributes | Status |
|---|---|---|
| `19_Roadmap/legacy_first_section_alignment_audit.md` | Current build coverage, WP-07 blocker, field groups needed before WP-07, implementation boundary. | Verified |
| `19_Roadmap/build_progress_register.md` | Gate snapshot, WP-00 through WP-06 done, WP-07 blocked. | Verified |
| `07_BLOCKERS_AND_DECISIONS.md` | Live blocker orientation and WP-07+ workshop blockers. | Verified |
| `19_Roadmap/phase_5_master_prompt.md` | Binding build protocol and stop rules. | Verified |
| `11_API_Design/module_api_contracts.md` | Proposed M01/M04/M17 operations, roles, validations, and audit/event shape. | Inferred target contract |
| `11_API_Design/backend_module_specs.md` | M01/M17 open NC items and owned-table/service boundaries. | Inferred target contract |
| `10_Data_Model/physical_schema_design.md` | Proposed intake, customer, WhatsApp ref, order, payment, and settings fields. | Inferred target schema |
| `15_Testing/test_strategy.md` | Future suite discipline; not run for this doc-only pack. | Verified process |
| `08_Business_Rules/validation_rules_binding.md` | Proposed validation slots for phone, duplicate, WhatsApp ref, draft submit completeness, dates, coupon, slot, money, and allergy chain. | Inferred target rules; content still workshop-gated |
| `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md` | Strongest old `/orders/create` flow and field evidence. | Verified old behavior where noted |
| `nutrezee-step-1-discovery/docs/01_discovery/admin_route_screen_inventory.md` | Route-level old dashboard inventory including `/orders/create`, slots, methods, coupons, allergens, settings, reports. | Verified old behavior where noted |
| `nutrezee-step-1-discovery/docs/01_discovery/full_admin_app_discovery.md` | Safety controls, missing surfaces, and what can/cannot be used as blueprint. | Verified old behavior/gaps |
| `02_Current_State/current_state_assessment.md` | Current-state journey map, pain points, confidence summary. | Verified/Inferred as labeled there |
| `nutrezee-step-1-discovery/docs/modules/07_customers_whatsapp_intake.md` | Customer search, WhatsApp setting, duplicate/customer identity gaps. | Verified/Inferred as labeled |
| `nutrezee-step-1-discovery/docs/modules/02_products_menu_packages.md` | Package, package-for, products, ingredients, allergies, and catalog inputs. | Verified/Inferred as labeled |
| `nutrezee-step-1-discovery/docs/modules/06_payments_finance_reports.md` | Payment fields, payment-link action, reports, confirm-payment gap. | Verified/Inferred as labeled |
| `22_Meeting_Notes/verification_workshop_agenda.md` | Sponsor questions for intake, identity, lifecycle, labels, finance, nutrition/privacy. | Verified workshop plan |

## 3. Old `/orders/create` flow summary

1. **Verified:** Staff searches/selects a customer in `/orders/create`. Evidence: `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:28`, `nutrezee-step-1-discovery/docs/modules/07_customers_whatsapp_intake.md:26`.
2. **Verified:** Staff selects package, sub-package, package-for, start date, amount fields, coupon, address, delivery time, delivery method, notes, and payment fields. Evidence: `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:29`, `nutrezee-step-1-discovery/docs/01_discovery/admin_route_screen_inventory.md:32`.
3. **Verified:** The screen exposes Apply Coupon and Create Order / Generate Payment Link actions. These actions were not clicked. Evidence: `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:46`, `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:53`.
4. **Verified:** Orders appear in pending, active, pause, expired, and canceled lists, but the full state machine and created status are not verified. Evidence: `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:31`, `nutrezee-step-1-discovery/docs/modules/01_order_intake_lifecycle.md:68`.
5. **Inferred:** WhatsApp is a major/manual order channel and staff retype details into the admin flow, but structured WhatsApp intake was not an old admin screen. Evidence: `02_Current_State/current_state_assessment.md:13`, `02_Current_State/current_state_assessment.md:16`, `nutrezee-step-1-discovery/docs/modules/07_customers_whatsapp_intake.md:29`, `nutrezee-step-1-discovery/docs/modules/07_customers_whatsapp_intake.md:166`.
6. **Needs Confirmation:** Submit validation, required flags, default values, field-level permissions, draft save behavior, and downstream side effects were not observed because discovery was read-only and no create/payment-link action was executed.

## 4. Mandatory intake-field matrix

The "Classification" and "Blocks submit?" columns are sponsor decision candidates. A value marked `[NC]` must be signed or explicitly accepted as Assumed-for-build before WP-07 starts.

| Field name | Old system behavior | Classification | Blocks submit? | Warn only? | Default value, if any | Who can edit it? | Evidence source | Decision status |
|---|---|---|---|---|---|---|---|---|
| Customer phone | Customer/user list shows mobile/contact concept; `/orders/create` has customer search. Exact phone requirement was not observed. | Required `[NC]` for matched or unverified customer | Yes `[NC]` | No, except fuzzy match warning `[NC]` | None observed | OA/OM target; SU search/read target | `admin_route_screen_inventory.md:14`, `admin_route_screen_inventory.md:32`, `validation_rules_binding.md:10` | Needs Confirmation |
| Customer name | Customer/user identity exists; customer search exists. Required rule for new/unverified customer was not observed. | Conditional `[NC]`; required for new/unverified, profile-derived for existing | Yes for new/unverified `[NC]` | No `[NC]` | None observed | OA/OM target | `modules/07_customers_whatsapp_intake.md:34`, `module_api_contracts.md:47` | Needs Confirmation |
| Customer identity / duplicate rule | Old duplicate behavior not observed; duplicate data is a known pain point. Proposed target is normalized phone first, exact-phone block, fuzzy warn+confirm. | Hidden/process `[NC]` | Yes for unresolved exact duplicate `[NC]` | Yes for fuzzy candidate `[NC]` | Exact phone lookup first `[Inferred]` | OA/OM create; OM merge target | `current_state_assessment.md:45`, `module_api_contracts.md:46`, `module_api_contracts.md:50`, `validation_rules_binding.md:11` | Needs Confirmation, DEC-004 |
| Order source | Old `/orders/create` did not show structured source/channel; target M01 requires channel. | Required `[NC]` | Yes `[NC]` | No | None observed | OA/OM target | `modules/01_order_intake_lifecycle.md:42`, `module_api_contracts.md:10` | Needs Confirmation, DEC-002 adjacent |
| WhatsApp reference | Old dashboard has WhatsApp settings and manual WhatsApp pain, but no structured message ref field observed. Target M17 requires sender phone and message time for WhatsApp drafts. | Conditional `[NC]`; required when source = WhatsApp | Yes `[NC]` for WhatsApp submit | No | None observed | OA/OM attach; immutable after save target | `modules/07_customers_whatsapp_intake.md:17`, `modules/07_customers_whatsapp_intake.md:30`, `module_api_contracts.md:119`, `validation_rules_binding.md:12` | Needs Confirmation, DEC-002 |
| Branch | Branch/site selection was not observed in old `/orders/create`; later target schema has nullable `site_ref` on orders. | Hidden `[NC]` | No `[NC]` unless sponsor confirms multi-branch intake | No | None observed | OM/AD settings if later confirmed | `legacy_first_section_alignment_audit.md:62`, `physical_schema_design.md:89` | Needs Confirmation |
| Order date / intake timestamp | Old order lists show transaction date; creation/intake timestamp field not observed on form. Target platform has created_at and draft timestamps. | Hidden `[NC]` | No, system-supplied `[Inferred]` | No | System time `[Inferred]` | System only | `modules/01_order_intake_lifecycle.md:40`, `modules/01_order_intake_lifecycle.md:94`, `physical_schema_design.md:19` | Inferred; sponsor should confirm visibility/reporting |
| Delivery date/time | Old form has start date and delivery time/slot; order lists have date concepts. Required rule was not observed. | Required `[NC]` | Yes `[NC]` | Slot capacity may warn `[NC]` | None observed | OA/OM target; OM override for date exceptions target | `modules/01_order_intake_lifecycle.md:11`, `modules/01_order_intake_lifecycle.md:37`, `admin_route_screen_inventory.md:52`, `validation_rules_binding.md:13`, `validation_rules_binding.md:15` | Needs Confirmation |
| Delivery/pickup mode | Old form has delivery method; pickup mode was not observed. | Required `[NC]` for delivery method; pickup support Needs Confirmation | Yes `[NC]` | No `[NC]` | None observed | OA/OM target | `admin_route_screen_inventory.md:32`, `admin_route_screen_inventory.md:53` | Needs Confirmation |
| Address | Old form has address; old notes mention block/street/house, address type, contact. Required rule was not observed. | Required `[NC]` for submit; incomplete draft may save `[NC]` | Yes `[NC]` | No `[NC]` | Existing saved address may be selectable `[Inferred]`; no default verified | OA/OM target; customer profile owner later | `modules/01_order_intake_lifecycle.md:38`, `validation_rules_binding.md:13`, `validation_rules_binding.md:14` | Needs Confirmation |
| Area | Old form includes area; area is part of target address validation. Required rule was not observed. | Required with address `[NC]` | Yes `[NC]` | Capacity/slot warnings possible `[NC]` | None observed | OA/OM target | `admin_route_screen_inventory.md:32`, `physical_schema_design.md:50`, `validation_rules_binding.md:14` | Needs Confirmation |
| Driver/delivery assignment | Old driver-wise route timed out and auto-assign route was skipped as unsafe. Assignment is not WP-07 scope. | Hidden `[Verified for WP-07 boundary]` | No for WP-07 `[Inferred]` | No | None | Future dispatch/OM, not WP-07 | `modules/01_order_intake_lifecycle.md:20`, `full_admin_app_discovery.md:133`, `full_admin_app_discovery.md:147` | Verified gap; delivery assignment details Need Confirmation |
| Item/package selection | Old form has package, sub-package, package-for; products/packages feed order creation. | Required `[NC]`; at least one package/item | Yes `[NC]` | No `[NC]` | None observed | OA/OM target | `modules/01_order_intake_lifecycle.md:11`, `modules/02_products_menu_packages.md:30`, `validation_rules_binding.md:13` | Needs Confirmation |
| Quantity | Quantity was not observed in old `/orders/create`; target `draft_item.qty` requires > 0 if item lines are used. | Conditional `[NC]` | Yes if item line exists with invalid/missing qty `[NC]` | No | None observed | OA/OM target | `physical_schema_design.md:81` | Needs Confirmation |
| Modifiers/customizations | No structured modifiers were observed; notes exist. | Optional `[NC]` | No `[NC]` | Possible allergy/catalog conflict warning `[NC]` | Blank | OA/OM target | `modules/01_order_intake_lifecycle.md:41`, `modules/02_products_menu_packages.md:44` | Needs Confirmation |
| Notes | Old form includes notes for admin/driver. Required rule was not observed. | Optional `[NC]` | No `[NC]` | No `[NC]` | Blank | OA/OM target | `modules/01_order_intake_lifecycle.md:11`, `modules/01_order_intake_lifecycle.md:41` | Needs Confirmation |
| Allergy notes | Old allergen master exists; no order-create allergy note was observed. Missed allergy notes are a pain point. | Conditional `[NC]` | No at draft submit `[NC]`; review behavior below | Yes `[NC]` when profile/order conflicts exist | Blank vs explicit "no allergy" is not decided | OA/OM target; dietitian role later if confirmed | `admin_route_screen_inventory.md:45`, `current_state_assessment.md:45`, `validation_rules_binding.md:24` | Needs Confirmation |
| Allergy severity | Old severity levels were not observed. Target physical design proposes `note`, `avoid`, `severe` as unconfirmed scale. | Conditional `[NC]` | Needs Confirmation | Yes `[NC]` if missing or conflicting | None observed | OA/OM target | `physical_schema_design.md:61`, `physical_schema_design.md:65`, `validation_rules_binding.md:24` | Needs Confirmation |
| Nutrition/health warning | No order-create nutrition warning observed. Target computes allergy conflicts from customer allergies and catalog allergens. | Hidden/system computed `[NC]` | No at draft submit `[NC]`; approval may block or require OM override | Yes `[NC]` | Empty conflict set | System computes; OM override target | `validation_rules_binding.md:24`, `validation_rules_binding.md:26`, `modules/02_products_menu_packages.md:43` | Needs Confirmation |
| Payment method | Old form has gateway/paid fields; payment methods used today are unknown. Target has expected payment method `[NC values]`. | Required `[NC]` as expected payment method | Yes `[NC]` | No `[NC]` | None observed | OA/OM capture target; FI owns payment decisions later | `modules/06_payments_finance_reports.md:28`, `modules/06_payments_finance_reports.md:29`, `physical_schema_design.md:80` | Needs Confirmation, DEC-009 adjacent |
| Payment status | Old form has paid-already flag and paid amount; order lists show payment status. Confirm-payment route timed out. | Conditional `[NC]`; capture posture not decided | No for WP-07 if unpaid allowed `[NC]`; otherwise payment gate decides | Yes if unpaid and gate warns `[NC]` | Unpaid/default status not verified | OA/OM may capture intake evidence target; FI confirms later | `modules/06_payments_finance_reports.md:28`, `modules/06_payments_finance_reports.md:31`, `validation_rules_binding.md:37` | Needs Confirmation |
| Coupon/discount | Old form has coupon/apply coupon; coupon master has rich fields. Legacy validity rules unknown. | Optional `[NC]` | Per `coupon_validation_mode`: off/warn/strict `[NC]` | Per mode `[NC]` | Blank | OA/OM capture; SA controls validation mode target | `modules/01_order_intake_lifecycle.md:46`, `admin_route_screen_inventory.md:37`, `admin_route_screen_inventory.md:39`, `validation_rules_binding.md:16` | Needs Confirmation |
| Staff/user | Old admin has authenticated session; old permission matrix/audit was not observed. Target requires actor through sessions/audit. | Hidden required `[Inferred]` | Yes if no valid session `[Verified platform]` | No | Current session user | System/session; roles per target | `full_admin_app_discovery.md:30`, `full_admin_app_discovery.md:136`, `module_api_contracts.md:10` | Inferred target; final role matrix Needs Confirmation |
| Order status at creation | Old pending/active/pause/expired/cancel lists exist; exact create output state was not observed. Target draft state starts open and submit moves to submitted/review. | Hidden/system `[NC]` | No; status is derived from action | No | `open` draft target `[Inferred]`; old default not verified | System | `modules/01_order_intake_lifecycle.md:31`, `physical_schema_design.md:80`, `module_api_contracts.md:13` | Needs Confirmation |
| Kitchen visibility | Old pre-kitchen shortage check exists; no kitchen board/chef app was confirmed. WP-07 must not affect kitchen directly. | Hidden for WP-07 `[Verified boundary]` | No for WP-07 | No | Not visible until later WP | Future OM/Kitchen roles, not WP-07 | `current_state_assessment.md:62`, `full_admin_app_discovery.md:127`, `legacy_first_section_alignment_audit.md:190` | Verified boundary; kitchen rules Need Confirmation later |
| Label/packing needs | No old packing/label screen was confirmed; label fields are a workshop item. Not WP-07 scope. | Hidden for WP-07 `[Verified boundary]` | No for WP-07 | No | None | Future packing owner, not WP-07 | `full_admin_app_discovery.md:130`, `22_Meeting_Notes/verification_workshop_agenda.md:28`, `current_state_assessment.md:23` | Needs Confirmation, out of WP-07 |

## 5. Submit, block, warn, draft, edit, and notification rules

### 5.1 Proposed P0 submit blockers for sponsor signoff

These are not verified old required flags. They are the minimum proposed P0 completeness set derived from old field evidence plus target M01 validation slots. Sponsor must accept or amend them before WP-07.

| Rule | Proposed behavior | Evidence | Decision status |
|---|---|---|---|
| Customer identity | Submit requires matched customer or unverified-customer flag with justification. | `module_api_contracts.md:13`, `validation_rules_binding.md:13` | Needs Confirmation |
| Source/channel | Submit requires source/channel. If WhatsApp, WhatsApp reference rule also applies. | `module_api_contracts.md:10`, `modules/01_order_intake_lifecycle.md:42` | Needs Confirmation |
| WhatsApp reference | For WhatsApp source, sender phone and message timestamp are required to submit; raw content storage remains excluded unless DEC-002 signs it. | `module_api_contracts.md:119`, `validation_rules_binding.md:12` | Needs Confirmation |
| Package/item | Submit requires at least one package/item selection. | `modules/01_order_intake_lifecycle.md:11`, `validation_rules_binding.md:13` | Needs Confirmation |
| Date | Submit requires start/delivery date. End date/package duration derivation is not confirmed. | `modules/01_order_intake_lifecycle.md:37`, `validation_rules_binding.md:13` | Needs Confirmation |
| Address and area | Submit requires address plus area. Draft may save incomplete address if sponsor accepts incomplete queue behavior; invalid supplied address should not save. | `modules/01_order_intake_lifecycle.md:38`, `validation_rules_binding.md:14` | Needs Confirmation |
| Delivery slot/time | Submit requires delivery slot/time. Capacity mode is separate warn/block/off decision. | `admin_route_screen_inventory.md:52`, `validation_rules_binding.md:13`, `validation_rules_binding.md:17` | Needs Confirmation |
| Delivery method | Submit requires delivery method. Pickup mode is not verified. | `admin_route_screen_inventory.md:53`, `modules/01_order_intake_lifecycle.md:38` | Needs Confirmation |
| Expected payment method | Submit requires expected payment method, but not confirmed payment. | `modules/06_payments_finance_reports.md:29`, `physical_schema_design.md:80` | Needs Confirmation |
| Staff actor | Submit requires an authenticated staff session; actor is hidden and audited. | `full_admin_app_discovery.md:30`, `module_api_contracts.md:10` | Inferred target; final role matrix Needs Confirmation |

### 5.2 Proposed warning-only rules

| Warning | Proposed behavior | Evidence | Decision status |
|---|---|---|---|
| Fuzzy customer match | Warn and require staff confirmation/link decision; exact phone conflict should block until resolved. | `validation_rules_binding.md:11` | Needs Confirmation |
| Slot capacity | Warn by default when capacity is null or over capacity; sponsor may choose off/warn/block. | `validation_rules_binding.md:17`, `validation_rules_binding.md:42` | Needs Confirmation |
| Coupon validity | Coupon validation can be off/warn/strict; legacy rules unknown. | `validation_rules_binding.md:16`, `validation_rules_binding.md:41` | Needs Confirmation |
| Allergy conflicts at intake | Show warning at draft/intake; review approval must resolve or record OM override with reason. | `validation_rules_binding.md:24`, `validation_rules_binding.md:26` | Needs Confirmation |
| Unpaid order | If payment gate is `none`, unpaid should warn only; if sponsor chooses stricter payment gate, later WP-09/WP-11 rules apply. | `validation_rules_binding.md:37`, `modules/06_payments_finance_reports.md:161` | Needs Confirmation |

### 5.3 Proposed draft-save rules

| Draft-save case | Proposed behavior | Evidence | Decision status |
|---|---|---|---|
| Missing P0 fields | Save as open draft and expose incomplete queue; block submit only. | `module_api_contracts.md:15`, `physical_schema_design.md:80`, `validation_rules_binding.md:13` | Needs Confirmation |
| Invalid supplied phone | Block saving the invalid phone value; keep raw value if target rule accepted. | `validation_rules_binding.md:10` | Needs Confirmation |
| Invalid supplied address | Block saving an address record when address text or area is invalid; permit draft without address if sponsor accepts incomplete drafts. | `validation_rules_binding.md:14` | Needs Confirmation |
| WhatsApp source without message ref | Save draft allowed; submit blocked until sender phone and message timestamp exist. | `validation_rules_binding.md:12` | Needs Confirmation |
| Money/price fields | Negative money values block save. | `validation_rules_binding.md:18` | Inferred target |

### 5.4 Proposed edit-after-submit rules

| Edit type | Proposed behavior | Evidence | Decision status |
|---|---|---|---|
| Draft submitted to review | OA edits only if review returns draft or OM reopens/returns it with reason. | `module_api_contracts.md:24`, `module_api_contracts.md:25`, `backend_module_specs.md:16` | Needs Confirmation |
| Customer/profile edits | Audit every identity, phone, address, allergy, and merge change. | `module_api_contracts.md:48`, `module_api_contracts.md:49`, `module_api_contracts.md:50` | Needs Confirmation for role details |
| Package/date/address/payment changes after approval | Not WP-07. Later change-request/order-core rules must compute downstream impact and audit. | `module_api_contracts.md:36`, `module_api_contracts.md:37` | Needs Confirmation, later WP |
| WhatsApp message ref | Immutable once saved in target M17. | `module_api_contracts.md:119`, `physical_schema_design.md:82` | Needs Confirmation, DEC-002 |

### 5.5 Audit and notification rules

| Area | Proposed behavior | Evidence | Decision status |
|---|---|---|---|
| Audit | Audit draft create/edit/submit/cancel, customer create/update/merge, allergy changes, WhatsApp ref attach, coupon/payment/date/address changes, and every override/reason. | `module_api_contracts.md:10`, `module_api_contracts.md:14`, `module_api_contracts.md:47`, `module_api_contracts.md:50`, `modules/01_order_intake_lifecycle.md:148` | Inferred target; final role matrix Needs Confirmation |
| Kitchen notification | No kitchen notification in WP-07. Any kitchen-visible change waits for WP-09/WP-10 and DEC-006. | `legacy_first_section_alignment_audit.md:190`, `legacy_first_section_alignment_audit.md:196` | Verified WP-07 boundary |
| Customer notification | No customer notification in WP-07. Customer notifications are dormant/later unless explicitly signed. | `module_api_contracts.md:83`, `physical_schema_design.md:104` | Verified WP-07 boundary |

## 6. Customer identity decisions

| Question | Decision-ready answer | Evidence | Status |
|---|---|---|---|
| Is phone the primary identity? | Proposed: use normalized phone as first match key for intake, while keeping customer ID as internal identity. | `module_api_contracts.md:46`, `validation_rules_binding.md:10`, `modules/07_customers_whatsapp_intake.md:168` | Needs Confirmation, DEC-004 |
| Can one customer have multiple phones? | Proposed target supports multiple phones per customer. Whether family-shared phones and duplicate phone records are allowed remains undecided. | `physical_schema_design.md:63`, `backend_module_specs.md:12` | Needs Confirmation |
| What happens on exact phone match? | Proposed: hard block new duplicate and link to existing customer, unless sponsor defines an OM-only exception. | `validation_rules_binding.md:11` | Needs Confirmation |
| What happens on fuzzy match? | Proposed: warn and require staff confirmation or link decision. | `validation_rules_binding.md:11`, `modules/07_customers_whatsapp_intake.md:94` | Needs Confirmation |
| Can staff force-create duplicate? | Not verified. Recommended decision: OA cannot force; OM can only with reason if sponsor accepts. | `module_api_contracts.md:50`, `validation_rules_binding.md:59` | Needs Confirmation |
| What role can merge customers? | Target contract says OM merge, with audit and undo window. Old merge workflow not observed. | `module_api_contracts.md:50`, `physical_schema_design.md:67` | Inferred target; sponsor should confirm |

## 7. Allergy and health decisions

| Question | Decision-ready answer | Evidence | Status |
|---|---|---|---|
| Is allergy note required? | Old order-create evidence does not show allergy intake. Sponsor must decide whether every order asks for allergy status or only uses existing customer allergy profile. | `current_state_assessment.md:45`, `admin_route_screen_inventory.md:45` | Needs Confirmation |
| Is "no allergy" explicit or blank? | Not observed. Recommended signoff choice: require explicit "No known allergy" for new customers if allergy safety is P0; otherwise blank means unknown. | `validation_rules_binding.md:24` | Needs Confirmation |
| What severity levels exist? | Not observed. Target physical design currently proposes `note`, `avoid`, `severe`, but marks the scale NC. | `physical_schema_design.md:61`, `physical_schema_design.md:65` | Needs Confirmation |
| What conflicts block submit? | Proposed: do not block draft submit; show warning at intake and require review resolution or OM override before approval. | `validation_rules_binding.md:24`, `validation_rules_binding.md:26` | Needs Confirmation |
| What conflicts warn only? | Proposed: item/package conflicts against customer allergy profile warn at intake; missing severity also warns unless sponsor chooses hard block. | `validation_rules_binding.md:25`, `validation_rules_binding.md:26` | Needs Confirmation |
| Who can override? | Target rule says OM-only override with reason at review approval. | `validation_rules_binding.md:26`, `module_api_contracts.md:23` | Inferred target; sponsor should confirm |

## 8. Package, date, delivery, and payment capture decisions

| Question | Decision-ready answer | Evidence | Status |
|---|---|---|---|
| What date/time fields are required? | Proposed: start/delivery date and delivery slot are required for submit. End date/duration/off-days should be derived from selected package when rules are confirmed, or captured if legacy requires it. | `modules/01_order_intake_lifecycle.md:37`, `validation_rules_binding.md:13` | Needs Confirmation |
| Are packages/subscriptions supported in WP-07 or later? | Capture package/sub-package/package-for in WP-07 draft intake because old `/orders/create` depends on them. Subscription calendar expansion, day generation, order approval, and active order creation wait for WP-08/WP-09. | `modules/01_order_intake_lifecycle.md:11`, `legacy_first_section_alignment_audit.md:188`, `legacy_first_section_alignment_audit.md:196` | Needs Confirmation for exact package fields |
| What delivery fields are required? | Proposed: address, area, delivery slot/time, and delivery method are required for submit. Pickup mode, branch, capacity, and area rules remain undecided. | `modules/01_order_intake_lifecycle.md:38`, `admin_route_screen_inventory.md:52`, `admin_route_screen_inventory.md:53` | Needs Confirmation |
| What payment fields are required at creation? | Proposed: expected payment method is required at draft submit; paid-already/gateway/paid amount are captured only as intake/payment evidence, not finance confirmation. | `modules/06_payments_finance_reports.md:28`, `modules/06_payments_finance_reports.md:29`, `physical_schema_design.md:80` | Needs Confirmation, DEC-009 adjacent |
| Can unpaid orders be submitted? | Not verified. Recommended decision for WP-07: yes, unpaid drafts may submit to review with warning/status, because payment confirmation is a later payment/review concern. Sponsor may choose stricter gate later. | `validation_rules_binding.md:37`, `modules/06_payments_finance_reports.md:163` | Needs Confirmation |
| Can WP-07 generate payment links? | No. The old action exists, but WP-07 boundary is draft intake and manual WhatsApp refs; payment link integration waits for later payment work and sandbox verification. | `modules/06_payments_finance_reports.md:44`, `modules/06_payments_finance_reports.md:71`, `legacy_first_section_alignment_audit.md:196` | Verified boundary |

## 9. WP-07 implementation boundary

If sponsor signs the decisions above, WP-07 may implement only the WP-07 row:

- M01 draft order and draft item behavior.
- Completeness engine and incomplete queue.
- Customer matching through M04 target services.
- Allergy conflict computation using customer allergies and catalog allergens.
- M17 manual WhatsApp message reference panel.
- Draft aging alert hooks/events as scoped by the WP row.

WP-07 must not implement:

- WhatsApp webhook/API or raw chat-content storage.
- Review approval/conversion to real orders.
- Order core, subscription calendar day generation, lifecycle transitions beyond draft state.
- Kitchen tickets, kitchen board, packing labels, driver assignment, delivery app, dispatch board.
- Payment link generation, payment confirmation, refunds, credits, gateway webhook, reconciliation.
- Customer notifications, cart, checkout, customer app, labels/packing module, or legacy write-back.

Evidence: `legacy_first_section_alignment_audit.md:186`, `legacy_first_section_alignment_audit.md:196`, `module_api_contracts.md:131`, `physical_schema_design.md:108`.

## 10. Open sponsor questions

These questions must be answered by sponsor signature or explicit Assumed-for-build acceptance before WP-07 starts.

1. Confirm the P0 submit blocker set: matched/unverified customer, channel, WhatsApp ref when WhatsApp, package/item, start/delivery date, address, area, delivery slot/time, delivery method, expected payment method, and staff actor.
2. Confirm which fields can be missing in an open draft and which invalid supplied values block draft save.
3. Confirm DEC-004 customer identity: phone as first match key, multiple phones, family-shared phones, exact duplicate block, fuzzy warning, force-duplicate policy, and OM merge authority.
4. Confirm DEC-002 WhatsApp posture: manual-assisted first, message-ref fields, raw-content privacy rule, and no webhook/API in WP-07.
5. Confirm allergy behavior: required allergy question vs profile-only, blank vs explicit "no allergy", severity levels, conflict blocking vs warning, and override role.
6. Confirm package capture: package, sub-package, package-for, start date, end date/duration, quantity, and customization fields required for WP-07.
7. Confirm delivery capture: address structure, area, slot, method, pickup support, branch/site behavior, slot capacity mode, and cutoff/date override role.
8. Confirm payment capture: expected method values, unpaid submit policy, paid-already/gateway/paid amount capture, and no payment-link generation in WP-07.
9. Confirm coupon behavior: optional vs required, validation mode off/warn/strict, and whether invalid coupons block submit.
10. Confirm order/draft state names and edit-after-submit rule: whether submitted drafts can be edited directly or only after review return/reopen.
11. Confirm which changes require kitchen notification later and which require customer notification later; both are out of WP-07 but need later WPs.

## 11. Ready-to-sign decision checklist

WP-07 remains blocked until the sponsor/user checks every P0 item or writes an explicit replacement decision.

- [ ] P0 submit blocker set accepted or amended.
- [ ] Draft-save vs submit-block rules accepted.
- [ ] Customer identity and duplicate rules accepted, including merge role.
- [ ] WhatsApp manual message-reference/privacy rule accepted.
- [ ] Allergy/no-allergy/severity/conflict/override rule accepted.
- [ ] Package/sub-package/package-for/date/quantity capture accepted.
- [ ] Delivery/address/area/slot/method/pickup/branch capture accepted.
- [ ] Payment/coupon/unpaid-submit/payment-link boundary accepted.
- [ ] Edit-after-submit and audit rules accepted.
- [ ] WP-07 boundary accepted: no APIs/webhooks/payment links/order core/kitchen/dispatch/labels/customer notifications.
- [ ] Register may be updated to mark WP-07 eligible only after the accepted decisions are recorded in the allowed decision/register location.
