# 15 — A51: Partner zero nutrition arrives as null; read absent as zero

Date: 2026-09-03 · Owner: "خليه يقبل الحفظ صفر … حل المشروع برمجياً يقبل الصفر".

## Evidence (Verified)

- Partner admin `products/addProduct/425` (Chopped Pineapple), read-only screenshot: Calory 44, Carbohydrate 11,
  **Fat 0, Proteins 0** (owner-entered). Partner `meal-catalog-v2` for meal 425 at the same time:
  `{"calories":44,"protein_g":null,"carbs_g":11,"fat_g":null}`.
- Whole catalog (1,411 meals): zero meals with `fat_g == 0` or `protein_g == 0`; 79 meals with nulls, 10 of them
  used on 2026-09-05 → 176 of 695 orders blocked with `partner_label_source_nutrition_incomplete`.

## Change

`partner-label-source.ts` `buildSnapshot()`: null / undefined / blank-string nutrition values are read as **0**;
a meal whose four values are all absent, or any non-numeric value (e.g. `"n/a"`), still fails `nutrition_incomplete`.
Totals therefore print `Fat 0` for fruit/juice rows. TS-U `ts-u-partner-label-source` updated (zero / blank /
all-absent / garbage cases).

## Staging deploy (Verified 2026-09-03)

PR #64 CI 29/29 → merged `b7e82e7`; `nutrezee-api:a51-01ede1e` built and running (no migration), admin nginx
restarted, `/health` 200 public, `/nz/health` 200. Deployed-code check for 2026-09-05: orders 28906 and 19486
now resolve (Chopped Pineapple p0 f0 c11 k44, pomegranate p1 f0 c14 k60); **695 / 695 Saturday orders with items
are label-ready, 0 blocked** (was 176 blocked). Rollback image `nutrezee-api:a50-061dfc6`.
