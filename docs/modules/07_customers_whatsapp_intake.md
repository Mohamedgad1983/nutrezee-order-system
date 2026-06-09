# Module Analysis: Customers And WhatsApp Intake

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/users/list/3` | Customer/user list with identity, contact, DOB, order totals, status, operation. |
| `/users/newuser/9` | Labeled add user but displayed a listing; ambiguous. |
| `/orders/create` | Customer search and new order creation fields. |
| `/contact_us` | Contact message list. |
| `/subscribers` | Subscriber list. |
| `/birthdayOrders` | Customer occasion report concept. |
| `/settings` | WhatsApp and WhatsApp number settings. |
| `/dietician_requests` | Customer health/dietician requests. |

## Current Purpose

The existing dashboard supports customer/user listing, contact messages, subscriber records, customer-related reports, and staff-assisted order creation. It does not confirm customer self-service, website ordering, customer app, cart, checkout, or structured WhatsApp intake.

## Current Workflow

1. Staff can search or review customer records in admin.
2. Staff can create an order for a customer through `/orders/create`.
3. Contact messages and subscribers are visible in admin.
4. WhatsApp contact settings exist.
5. Business pain points indicate WhatsApp orders are manually interpreted and entered.

## Data Shown Or Needed

- Existing: customer/user identity, contact, DOB concept, order totals, status, contact messages, subscriber email/status, WhatsApp setting.
- Needed: customer profile, phone/WhatsApp identity, multiple addresses, preferences, allergies, dietary restrictions, order history, contact preferences, source channel, consent, WhatsApp message reference, intake owner, incomplete fields.

## Visible Actions

- Customer/user operation actions.
- Customer search in order creation.
- Contact/subscriber operation actions.
- Order create/payment link action.
- Settings save action.

No customer operation, contact operation, order create, payment link, settings save, or export action was clicked.

## State-Change Risks

- Customer edits can alter identity, contact, delivery, allergy, and order history context.
- WhatsApp intake can create duplicate customers or incomplete orders.
- Customer support operations can expose sensitive message data.
- Health/dietician fields require privacy controls.
- Payment/order creation from customer data requires audit.

## Current Pain Points

- WhatsApp orders are manually entered.
- Order details are not consistently structured at intake.
- Manual order entry duplicates customer data.
- Customer-facing checkout is not verified.
- Customer profile matching and reusable addresses are needed.
- Contact/support workflow is currently list-based, not ownership-based.

## Preserve Decisions

- Preserve customer/user listing and customer search.
- Preserve contact messages, subscribers, birthday/occasion reporting, and dietician request concepts.
- Preserve WhatsApp as a known business channel.

## Improve Decisions

- Improve customer records into full customer profile with phone matching, address book, preferences, allergies, order history, and privacy controls.
- Improve contact messages into support tickets with owner/status.
- Improve subscriber data with consent/source tracking.
- Improve WhatsApp settings into source-aware intake workflow.

## Replace Decisions

- Replace ambiguous add-user route with guided customer creation and duplicate detection.
- Replace manual WhatsApp entry with structured intake and review.
- Replace raw contact-message list with support workflow.

## Add Decisions

- Add WhatsApp draft order intake.
- Add customer matching by phone/WhatsApp number.
- Add incomplete-order queue.
- Add customer profile merge/review.
- Add source metadata without storing unnecessary chat content.
- Add customer-facing app/website discovery as a required future access item.

## Automation And AI Opportunities

- Parse WhatsApp messages into draft fields for staff review.
- Detect customer duplicates by phone, name, and address.
- Identify missing order fields and ask staff to resolve them.
- Suggest previous address/package/preferences during intake.
- Summarize customer service history for staff, without exposing unnecessary sensitive data.

## Required New System Capabilities

- Customer profile and address book.
- WhatsApp source tracking.
- Draft order intake linked to customer profile.
- Incomplete-order queue.
- Customer duplicate detection and merge review.
- Support ticket/inbox.
- Consent-aware subscriber and notification preferences.
- Privacy controls for health/payment/contact fields.

## Required Data Entities And Fields

- `Customer`: name, phone, WhatsApp number, email, DOB if needed, status, preferences, privacy flags.
- `CustomerAddress`: area, block/street/house concept, location pin, notes, contact, type, active status.
- `CustomerPreference`: dietary, delivery, communication, special instructions.
- `CustomerAllergyRestriction`: allergen, severity, notes, verified by.
- `IntakeSource`: channel, message reference, owner, timestamp, source notes.
- `SupportTicket`: source, customer, subject, message summary, owner, status, resolution.
- `Consent`: channel, opt-in/out, timestamp, source.

## Required APIs High Level Only

- Customer search/match API.
- Customer profile API.
- Address API.
- WhatsApp intake/draft API.
- Duplicate detection API.
- Support ticket API.
- Consent/preference API.
- Customer order history API.
- Customer audit API.

## Role And Permission Needs

- Customer service can create/update customers, draft orders, support tickets, and intake records.
- Operations can view order-relevant customer data.
- Finance can view payment-relevant customer references.
- Dietitian can view health/diet fields as needed.
- Driver can view only delivery-required customer/address/contact rules.
- Marketing can view subscribers/consent, not broad customer/payment/health data.
- Customer profile changes and merges require audit.

## Reports And KPIs

- WhatsApp drafts by status and owner.
- Incomplete intake reasons.
- Duplicate customer candidates.
- Customer creation source.
- Support tickets by status and age.
- Customer retention/renewal by package.
- Customer communication opt-in/out.
- Manual intake cycle time.

## Open Questions For Nutrezee

1. Is WhatsApp Business API required in first release or should staff-assisted copy/paste intake come first?
2. What is the source of truth for customer identity: phone, WhatsApp number, account ID, or email?
3. Which WhatsApp message details should be stored versus excluded for privacy?
4. What customer fields are required before order confirmation?
5. Are customer-facing website/app ordering screens required for first release?
6. What support ticket statuses and owners are needed?
7. Which customer data can drivers, chefs, finance, and marketing see?

## Assumptions Marked

- WhatsApp intake is a known business pain point, not a discovered old-admin workflow.
- Customer app and website ordering are not discovered and must not be treated as confirmed baseline.
- Phone/WhatsApp matching is proposed as likely identity logic and needs Nutrezee confirmation.

## Recommended Build Order

1. Customer profile and address model.
2. Customer search/matching and duplicate detection.
3. WhatsApp/staff-assisted intake draft.
4. Incomplete-order queue.
5. Admin order review integration.
6. Support ticket workflow.
7. Customer app/website discovery and later self-service design.
