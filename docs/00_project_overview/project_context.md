# Nutrezee Project Context

Date: 2026-06-09

## Project

Nutrezee is a healthy food ordering platform. The current production dashboard suggests the business model includes meal/package subscriptions, order management, delivery scheduling, driver operations, customer management, promotions, and health/diet-related support.

## Delivery Methodology

The project follows this methodology:

0. Safety / Backup / Staging
1. Discovery
2. Context Engineering
3. Workflow Design
4. Architecture
5. Gap Analysis
6. Implementation Plan
7. Development
8. Testing
9. Release

Current work is limited to Step 0 and Step 1.

## Operating Rules

- Read-only discovery only.
- Do not modify production.
- Do not create, edit, delete, approve, cancel, refund, assign, save, or submit production data.
- Do not test real payments.
- Do not expose secrets or sensitive customer/payment/health data.
- Do not store cookies or session files in the repository.
- Do not implement code before discovery and gap analysis.

## Known Actors

Inferred from dashboard structure:

- Customer/user
- Driver
- Admin user
- Dietician or dietician-request reviewer
- Operations/admin staff
- Kitchen or fulfillment staff, inferred from pre-kitchen screen

Roles are inferred from UI labels only. A formal roles/permissions model was not verified.

## Known Business Objects

Inferred from dashboard structure:

- User/customer
- Driver
- Admin user
- Product/menu item
- Package/subscription
- Order
- Coupon
- Cashback entry
- Advertisement/offer
- Gallery media
- Ingredient
- Allergy
- Meal type
- Diet status
- Tag
- Package-for type
- Delivery time slot
- Delivery method
- Contact message
- Subscriber
- Social media link
- Push notification
- Sales report
- Payment report
- Customer revenue report
- Dietician request

## Known Order Concepts

Observed order-related fields and screens:

- Active, pending, pause, expired, and canceled order lists.
- Order number.
- Customer name.
- Package name.
- Sub-package.
- Start date.
- End date.
- Transaction date.
- Transaction ID.
- Order type.
- Payment status.
- Order status.
- Coupon code.
- Package amount.
- Paid amount.
- Operation/action column.

The exact state machine, allowed transitions, and side effects are not documented.

## Healthy Food Context

Dashboard support exists for:

- Ingredients.
- Allergies.
- Meal types.
- Diet status.
- Tags.
- Package-for types.
- Dietician requests.
- Delivery time slots.

Dashboard support was not confirmed for:

- Calories.
- Protein, carbohydrate, and fat macros.
- Nutrition facts per product.
- Freshness windows.
- Preparation slots.
- Shelf-life rules.
- Ingredient inventory dependency.
- Special requests.
- Central kitchen or branch dispatch.

## Context Needed For Step 2

Step 2 Context Engineering should collect:

- Source-code repository.
- Database schema.
- Current workflow descriptions from operations staff.
- Current production/staging inventory.
- Environment variable names.
- Auth, role, and session model.
- Payment and webhook documentation.
- Kitchen and driver operations details.
- Nutrition and healthy-food product requirements.
- Deployment, rollback, backup, and monitoring process.
- Known incidents, bugs, and support pain points.

## Assumptions To Avoid

Do not assume:

- The dashboard route list equals the full product surface.
- Hidden routes are safe or intended for current use.
- GET routes are read-only.
- Payment confirmation is functional.
- Driver assignment is safe to trigger.
- Admin users imply a complete permissions model.
- Ingredient/allergy/tag masters imply complete nutrition support.
- Production has staging parity.
- The application has tests or deployment automation.
