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
