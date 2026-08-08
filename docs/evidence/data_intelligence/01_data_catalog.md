# 01 — Data Catalog (New System)

> Complete catalog of the populated tables, grouped by module, with analytics reliability. **PII/health/
> payment columns are flagged but never dumped.** Reliability = fitness for analytics/AI, not row count.

Legend — **Class**: OPER(ational) · MIG(ration) · AUDIT · EXC(eption) · REF(erence) · REPORT-ready.
**Rel**: 🟢 reliable · 🟡 partial · 🔴 unreliable/empty.

## Customers
| table | rows | PK | key FKs | PII/health | class | rel | notes |
|---|---|---|---|---|---|---|---|
| `customer` | 19,476 | id | diet_status_id→(empty) | **PII**: full_name, email, dob | OPER/MIG | 🟢 | identity solid; `status` 100% `active` (no lifecycle signal); `diet_status_id` unused |
| `customer_phone` | 19,371 | id | customer_id | **PII**: phone | OPER | 🟢 | 99.5% of customers have ≥1 phone |
| `address` | 9,511 | id | customer_id, area_id | **PII**: address_text, location_pin | OPER | 🟢 | 48.8% of customers; area-linked |
| `customer_allergy` | 0 | — | customer_id, allergen_id | health | OPER | 🔴 | **empty** — no allergy capture |
| `preference` | 0 | — | customer_id | — | OPER | 🔴 | **empty** — no preference capture |
| `merge_record` | 2 | id | winner/loser→customer | — | MIG | 🟡 | dedup trail (tiny) |

## Orders & order-sync
| table | rows | PK | key FKs | money | class | rel | notes |
|---|---|---|---|---|---|---|---|
| `customer_order` | 20,104 | id | customer_id, package_id | **money**: package_amount/discount/total | OPER | 🟢 | start/end dates, status, calorie-tier package, delivery area/time; `off_days` 100% empty |
| `fulfillment_day` | **527,724** | id | order_id, slot_id | — | OPER | 🟡 | per-order delivery-day schedule 2023–2027; **status 100% `scheduled`** (no outcome); reschedule/reason empty |
| `sync_record` | 52,423 | id | (legacy_key→new_ref) | — | MIG | 🟢 | legacy↔new id map (order 20,103 / customer 19,463 / payment / product) |
| `order_item` | 1 | id | order_id, product_id | money | OPER | 🔴 | **effectively empty** — no order line items migrated |
| `order_status_history` | 8 | id | reason_code_id | — | AUDIT | 🔴 | almost empty |
| `draft_order`/`draft_item` | 4 / 3 | id | customer/package/product | — | OPER | 🔴 | intake drafts (test-scale) |

## Meal history (m22)
| table | rows | PK | key FKs | class | rel | notes |
|---|---|---|---|---|---|---|
| `customer_meal_history` | 4,955 | id | customer_id, order_id, import_run_id | MIG | 🟡 | last-90 parents; 4,913 linked, 42 exception; `package_name` null; `meal_types` jsonb is a scrape artifact |
| `customer_meal_history_items` | 67,908 | id | meal_history_id, order_id | MIG | 🟡 | last-90 meal-**days**; **meal_type/name/ref/delivery_status all null** → effectively `(order, date)` pairs |
| `legacy_meal_history_raw` | 4,987 | id | import_run_id | MIG | 🟢 | lossless raw archive (4,987 distinct sha) |
| `customer_meal_history_exceptions` | 77 | id | import_run_id | EXC | 🟢 | all `missing_order_link/open` (40 orders) — see m22 docs 34 |
| `customer_meal_history_import_runs` | 8 | id | — | AUDIT | 🟢 | import provenance |

## Packages / plans / products (menu)
| table | rows | PK | class | rel | notes |
|---|---|---|---|---|---|
| `package` | 9 (5 in real use) | id | REF | 🟢 | **calorie/macro tiers** encoded in names; `duration_days`/`meals_per_day` present |
| `package_for_type` | 7 | id | REF | 🟡 | package segmentation |
| `product` | 1,298 | id | REF | 🔴 | **names only** — meal_type/price/tags/description all empty; no recipe |
| `meal_type` | 2 | id | REF | 🟡 | only Lunch, Dinner |
| `nutrition_facts` | 1 | id | REF | 🔴 | **empty** |
| `product_allergen`/`product_ingredient`/`product_component` | 1 / 0 / 0 | — | REF | 🔴 | **empty** — no recipe/allergen mapping |
| `allergen` | 3 | id | REF | 🟡 | Peanuts/Gluten/Dairy ref only; no customer/product links |

## Payments
| table | rows | PK | money/PII | class | rel | notes |
|---|---|---|---|---|---|---|
| `payment_record` | 11,539 | id | **money** amount; ref (PII-ish) | OPER | 🟢 | status paid/unpaid; method/transaction_ref empty |
| `payment_review_item` | 1,547 | id | — | EXC | 🟡 | payment reconciliation queue |

## Packing / delivery / kitchen / drivers (operational — mostly dormant)
| table | rows | class | rel | notes |
|---|---|---|---|---|
| `area` | 127 (113 used) | REF | 🟢 | Kuwait delivery areas |
| `delivery_method`/`delivery_slot` | 1 / 1 | REF | 🔴 | minimal |
| `driver`/`driver_area`/`driver_shift`/`driver_assignment_history` | 0 | OPER | 🔴 | **empty** |
| `delivery_route`/`delivery_route_order` | 0 | OPER | 🔴 | **empty** |
| `packing_batch`/`packing_item`/`packing_label`/`packing_batch_order` | 0 | OPER | 🔴 | **empty** |
| `kitchen_ticket`/`ticket_status_event` | 0 | OPER | 🔴 | **empty** |

## Migration / audit / system
| table | rows | class | rel | notes |
|---|---|---|---|---|
| `import_batch` | 414 | MIG | 🟢 | import provenance |
| `import_row_result` | 111,484 | MIG | 🟢 | per-row import outcomes (rich migration audit) |
| `migration_exception_review` | 1,272 | EXC | 🟢 | non-deterministic order/customer cases (placeholder/duplicate phone, etc.) |
| `audit_event_default` | 13,075 | AUDIT | 🟢 | same-tx audit trail |
| `outbox_event` | 181 | SYSTEM | 🟡 | event outbox |
| `notification_log`/`whatsapp_message_ref` | 0 | OPER | 🔴 | **empty** — nothing sent |
| `setting`/`feature_flag`/`reason_code`/`transition_config`/`role*`/`permission` | 16/5/11/48/… | REF/SYSTEM | 🟢 | governance/config |

## Catalog takeaways
- **Analytics-ready spine (🟢):** `customer`, `customer_order`, `fulfillment_day` (cadence),
  `payment_record`, `package`, `address`/`area`, `sync_record`, import/audit provenance.
- **Partial (🟡):** meal-history (dates only, no content), `product` exists as a name list only.
- **Empty/unusable (🔴) — the AI blockers:** order line items, dish content, nutrition, allergy,
  preference, diet status, driver/route/packing/kitchen, notifications, delivery outcome.
</content>
