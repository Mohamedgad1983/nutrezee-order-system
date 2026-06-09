# Module Analysis: Nutrition, Allergens, And Dietician

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0 for allergens and nutrition data needed by orders/kitchen; P1 for extended dietician workflow unless business raises to P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/ingredients` | Ingredient master list. |
| `/ingredients/add` | Ingredient add/update form with name and status. |
| `/allergies` | Allergy/allergen master list. |
| `/allergies/add` | Allergy add/update form with name and status. |
| `/dietstatuslist` | Diet status/program list. |
| `/tagslist` | Product tag list. |
| `/mealsType` | Meal type list. |
| `/users/dietitians/8` | Dietitian user listing route. |
| `/dietician_requests` | Dietician request list with health-related fields. |
| `/diet-customer-service/dietactive-users` | Hidden diet/customer-service route; timed out. |
| `/products`, `/package` | Product/package names appear to include calorie concepts, but structured macros were not verified. |

## Current Purpose

The existing dashboard has nutrition-adjacent master data: ingredients, allergies, diet statuses, tags, meal types, dietitian users, and dietician requests. Structured calories, protein, carbs, fat, product-allergen links, customer allergy warnings, and full nutrition facts were not confirmed.

## Current Workflow

1. Admin maintains ingredient and allergy masters.
2. Admin maintains diet status, tags, and meal types.
3. Dietician requests are listed with health-related fields and status.
4. Dietitian user route exists.
5. No confirmed workflow links customer restrictions to order review, product selection, kitchen tasks, or labels.

## Data Shown Or Needed

- Existing: ingredient names, allergy names, diet status names, tags, meal types, dietician request profile fields, appointment/status concepts.
- Needed: calories, protein, carbs, fat, nutrition notes, allergen severity, ingredient-allergen-product links, customer allergies/restrictions, dietician notes, consent, customer-facing label flags, kitchen warning flags.

## Visible Actions

- Ingredient/allergy row operation and add/update save actions.
- Diet status/tag/meal type row operations.
- Dietician request list/status visibility.
- Dietitian user operations.

No operation, save, status change, or dietician action was clicked.

## State-Change Risks

- Incorrect allergen data can create customer safety risk.
- Nutrition data changes can affect customer trust and legal/health claims.
- Dietician request data is health-sensitive and requires field-level access.
- Customer allergy/restriction data must flow safely to order review and kitchen without overexposure.

## Current Pain Points

- Nutrition data is incomplete.
- Calories/macros are not confirmed as structured data.
- Allergy safety rules are not visible.
- Dietician workflow lacks confirmed privacy, notes, assignment, and follow-up.
- Healthy-food requirements need calories, protein, carbs, fat, allergens, dietary labels, meal plans, prep/freshness windows, and special requests.

## Preserve Decisions

- Preserve ingredient, allergy, diet status, tag, meal type, dietitian, and dietician request concepts.
- Preserve bilingual naming where used.
- Preserve health/diet request tracking as a business capability.

## Improve Decisions

- Improve ingredient master with nutrition values and allergen relationships.
- Improve allergen master with severity and warnings.
- Improve tags/diet statuses into dietary labels and eligibility rules.
- Improve dietician requests with privacy-aware workflow, owner, status, notes, and follow-up.

## Replace Decisions

- Replace nutrition embedded in names with structured nutrition facts.
- Replace broad health-data visibility with role-gated health fields.
- Replace unlinked master data with validation rules used by order review and kitchen.

## Add Decisions

- Add nutrition facts per product/meal/package: calories, protein, carbs, fat, and notes.
- Add customer allergy/dietary restriction warnings during order review.
- Add kitchen warning flags scoped to what chefs need.
- Add prep/freshness windows if confirmed.
- Add special request handling tied to order and kitchen tasks.
- Add dietician appointment/follow-up workflow.

## Automation And AI Opportunities

- Flag missing nutrition or allergen fields before product publish.
- Warn staff when customer restrictions conflict with selected product/package.
- Suggest allergen warnings from ingredient links.
- Summarize dietician requests for authorized dietitians.
- Detect special requests that need kitchen manager review.

## Required New System Capabilities

- Ingredient master with nutrition/allergen links.
- Allergen master with severity/warning rules.
- Nutrition facts model.
- Dietary tags/programs.
- Customer allergy/restriction model.
- Order review allergy/diet validation.
- Kitchen-safe warning display.
- Dietician request workflow.
- Health-data permissions and audit.

## Required Data Entities And Fields

- `Ingredient`: names, status, nutrition values, allergen links, availability if inventory is used.
- `Allergen`: names, severity, warning text, active status.
- `NutritionFacts`: calories, protein, carbs, fat, serving size, notes, source/version.
- `DietaryTag`: name, visibility, product/customer applicability.
- `DietProgram`: diet status, rules, eligibility, notes.
- `ProductNutritionProfile`: product/meal/package, nutrition facts, allergens, tags.
- `CustomerRestriction`: customer, allergen/diet restriction, severity, notes, verified source.
- `DieticianRequest`: customer/contact reference, health profile fields, appointment date, status, owner, consent, notes.

## Required APIs High Level Only

- Ingredient API.
- Allergen API.
- Nutrition facts API.
- Product nutrition profile API.
- Customer restriction API.
- Order allergy/diet validation API.
- Dietician request API.
- Health-data audit API.
- Nutrition report API.

## Role And Permission Needs

- Nutrition/dietitian roles can manage nutrition, allergies, dietary restrictions, and dietician requests.
- Product admin can view required nutrition completeness but may not edit sensitive customer health fields.
- Customer service can see order-relevant restrictions.
- Kitchen can see only necessary warnings and special prep notes.
- Driver should not see health details unless explicitly required for delivery.
- All health-data views/changes require audit.

## Reports And KPIs

- Products missing nutrition facts.
- Products missing allergen mappings.
- Allergy conflict warnings by order/package.
- Dietician requests by status and age.
- Customer restrictions by type, role-restricted.
- Special request volume and resolution.
- Nutrition data completeness by package/menu category.

## Open Questions For Nutrezee

1. Which nutrition fields are required: calories, protein, carbs, fat, sodium, fiber, or others?
2. Should nutrition be maintained per product, meal, package, or serving?
3. Which fields appear on customer app, labels, kitchen tasks, and admin only?
4. What allergen severities and warnings are required?
5. Who validates nutrition data?
6. What consent is needed for dietician/health data?
7. Are meal plans prescribed or only selected by customers?
8. What special requests should block order confirmation?

## Assumptions Marked

- Structured calories/macros are not confirmed in old-admin evidence.
- Allergy warning rules are proposed from safety needs; old admin only confirmed allergy master data.
- Dietician workflow details are partial because only listing/request surfaces were discovered.

## Recommended Build Order

1. Ingredient and allergen master with relationships.
2. Structured nutrition facts.
3. Product nutrition/allergen profiles.
4. Customer allergy/restriction model.
5. Order review warnings.
6. Kitchen warning display.
7. Dietician request workflow and health-data audit.
