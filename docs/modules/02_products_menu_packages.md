# Module Analysis: Products, Menu, And Packages

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/products` | Product list with English/Arabic names, category, associated packages, status, operation, package/category filters. |
| `/package` | Package list with English/Arabic names, priority, coupon setting, operation. |
| `/packageFor` | Package-for rule list with type, Friday off-day, active-for-new-customers. |
| `/mealsType` | Meal type list with image and English/Arabic names. |
| `/addMeal` | Meal type add/update fields for name, package links, count-in, image. |
| `/tagslist` | Product tag list. |
| `/dietstatuslist` | Diet status/program list. |
| `/ingredients` | Ingredient master. |
| `/allergies` | Allergen master. |

## Current Purpose

The existing dashboard manages catalog and meal-plan foundations: products, packages, meal types, package audience/rules, product tags, diet statuses, ingredients, and allergens. These are the upstream data sources for order intake, kitchen routing, labels, nutrition, delivery planning, and finance reporting.

## Current Workflow

1. Admin maintains product records and associates products with packages/categories.
2. Admin maintains packages and package-for types.
3. Admin maintains meal types, tags, diet statuses, ingredients, and allergies.
4. Orders reference package/sub-package/package-for data during admin order creation.
5. Reports and order lists display package and plan concepts.

## Data Shown Or Needed

- Product names in English and Arabic.
- Category/meal type.
- Associated packages.
- Status.
- Package names in English and Arabic.
- Package priority and coupon enabled concept.
- Package-for type, Friday off-day, active-for-new-customers.
- Tags and diet status names.
- Ingredients and allergens.
- Missing in old evidence: structured calories/macros, price rules, availability windows, kitchen section routing, item components, prep time, shelf life, substitutions, and product-level delivery/label rules.

## Visible Actions

- Product list search, package filter, category filter, clear.
- Package and master-data row operation actions.
- Add/update forms for meal type, ingredient, allergy.
- Save/submit actions on add/update forms.

No operation, save, submit, edit, delete, or status action was clicked.

## State-Change Risks

- Product/package updates can affect customer ordering, kitchen prep, labels, prices, and reports.
- Package-for rule changes can affect eligibility, off days, and new-customer availability.
- Ingredient/allergen edits can affect allergy safety.
- Meal type/package mapping can affect kitchen routing and labels.

## Current Pain Points

- Kitchen has many sections but item-to-section routing is not confirmed.
- Calories/macros are not confirmed as structured fields.
- Items may need decomposition into components or prep tasks.
- Package lifecycle rules are unknown beyond visible list fields.
- Menu/package changes need audit and downstream impact review.

## Preserve Decisions

- Preserve product, package, meal type, tag, diet status, ingredient, allergen, and package-for master concepts.
- Preserve English/Arabic content support.
- Preserve package/product association.
- Preserve package-for/off-day/new-customer concepts.

## Improve Decisions

- Improve products into a complete menu catalog with structured nutrition, allergens, availability, pricing, images, and kitchen routing metadata.
- Improve packages into meal-plan/subscription builder with calendar rules, durations, pricing, meals, off days, coupons, and eligibility.
- Improve master data with validation, versioning where needed, and audit.
- Improve tag/diet status data into customer-facing filters and order validation.

## Replace Decisions

- Replace broad row operation links with role-gated editors and change review for high-impact catalog fields.
- Replace free-form nutrition in names with structured nutrition facts.
- Replace implicit package/routing behavior with explicit rules.

## Add Decisions

- Add menu item components and prep tasks where one meal needs multiple kitchen sections.
- Add item-to-kitchen-section routing rules.
- Add prep windows, freshness windows, cutoff rules, and shelf-life fields if confirmed.
- Add product availability by date, package, delivery slot, and customer eligibility.
- Add change-impact preview before package/menu changes go live.

## Automation And AI Opportunities

- Suggest kitchen routing based on ingredient/component metadata, with kitchen manager approval.
- Detect missing nutrition or allergen fields before publishing items.
- Suggest package compatibility and conflicts.
- Flag catalog changes that will affect active orders or tomorrow production.
- Generate bilingual draft descriptions from approved source fields, with human review.

## Required New System Capabilities

- Product/menu catalog.
- Package and meal-plan builder.
- Meal type, tag, diet status, ingredient, and allergen masters.
- Product-package association.
- Kitchen routing metadata.
- Nutrition fact management.
- Availability and eligibility rules.
- Versioned/audited catalog changes.

## Required Data Entities And Fields

- `Product`: English/Arabic name, category, image, status, availability, price references, nutrition profile, allergen profile.
- `ProductComponent`: product, component name, quantity, kitchen section, prep time, status.
- `Package`: English/Arabic name, priority, duration, price, coupon eligibility, active status.
- `SubPackage`: package, duration, meal count, price, delivery calendar rule.
- `PackageFor`: audience/type, off-day rules, new-customer availability.
- `MealType`: name, image, package associations, count-in rule.
- `Tag`: name, language, customer-facing visibility.
- `DietStatus`: program/status name, eligibility rules.
- `Ingredient`: names, nutrition values, allergen links, availability.
- `Allergen`: names, severity, warning rules.

## Required APIs High Level Only

- Product CRUD and publish API.
- Package/sub-package CRUD and pricing API.
- Package calendar and eligibility API.
- Product-package association API.
- Ingredient/allergen/nutrition API.
- Kitchen routing rule API.
- Catalog validation API.
- Catalog impact preview API.
- Catalog audit API.

## Role And Permission Needs

- Product admin can draft catalog changes.
- Nutrition/dietitian can manage nutrition, ingredients, allergens, diet status, and dietary labels.
- Kitchen manager can approve routing and prep metadata.
- Finance/management can approve price/package changes if required.
- Customer service can view catalog rules needed for order intake.
- Catalog changes that affect active/tomorrow orders require audit and possibly approval.

## Reports And KPIs

- Published products by package/category/status.
- Products missing nutrition, allergens, routing, or images.
- Package usage and active subscriptions by package.
- Catalog changes affecting active orders.
- Menu item kitchen section load.
- Allergen conflict count during order review.

## Open Questions For Nutrezee

1. What are all package, sub-package, duration, and price rules?
2. Do product names currently include calories because structured nutrition fields are missing?
3. What are all kitchen sections and which products/components map to each?
4. Do items require multiple components or section tasks?
5. Which nutrition fields must be customer-facing?
6. Are product/package changes effective immediately or scheduled?
7. Who approves price, package, allergen, or nutrition changes?

## Assumptions Marked

- Kitchen routing metadata is required for the new system but was not visible in old-admin product screens.
- Structured macros are assumed missing because old-admin evidence did not confirm calories/protein/carbs/fat fields.
- Product component modeling is proposed for multi-section kitchen routing and needs confirmation.

## Recommended Build Order

1. Product, package, meal type, tag, diet status, ingredient, and allergen masters.
2. Package/sub-package/calendar rules.
3. Structured nutrition and allergen relationships.
4. Product components and kitchen routing metadata.
5. Availability, eligibility, and change-impact review.
6. Catalog analytics and completeness checks.
