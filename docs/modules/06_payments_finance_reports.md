# Module Analysis: Payments, Finance, And Reports

Date: 2026-06-09
Phase: Phase 3 Old Admin Dashboard Module-by-Module Existing System Analysis
Priority: P0 for payment status and core finance reports; P1 for refunds/credits unless business raises to P0

## Old Dashboard Evidence

| Screen / Route | Evidence Used |
| --- | --- |
| `/orders/create` | Payment fields and payment-link generation action. |
| `/orders/list/*` | Payment status, transaction, coupon, package amount, paid amount concepts. |
| `/cashback/list` | Active cashback balance dashboard. |
| `/salesreport` | Monthly sales report. |
| `/singledaysalesreport` | Daily sales report. |
| `/sales-report-by-payment` | Payment-method report with gateway transaction concept. |
| `/customer-revenue-report` | Accrual-style customer revenue report. |
| `/confirm-payment` | Payment confirmation route; timed out/partial. |
| `/packageexpirestoday` | Package expiration report. |
| `/coupon` | Coupon usage and monthly usage report hints. |

## Current Purpose

The old dashboard provides finance visibility through order payment fields, sales reports, payment-method reports, customer revenue reporting, cashback, coupons, and expiration reporting. Payment confirmation and refunds remain unverified.

## Current Workflow

1. Orders carry payment status, transaction ID, coupon, package amount, and paid amount.
2. Admin order creation can mark paid-already, select gateway, enter paid amount, and generate a payment link.
3. Finance/management can view monthly sales, daily sales, payment-method sales, customer revenue, cashback, and expiration reports.
4. Confirm-payment route exists but was unstable.
5. Refunds were not observed.

## Data Shown Or Needed

- Existing: order/payment status, transaction reference concept, gateway transaction concept, paid/package amounts, coupons, revenue per active day, cashback balances.
- Needed: payment lifecycle, payment method, gateway event, manual transfer proof, reviewer, decision, hold reason, refund/credit status, reconciliation state, ledger entries, export audit.

## Visible Actions

- Apply/reset report filters.
- Export CSV/report controls.
- Coupon/monthly usage links.
- Payment-link generation action on order create.
- Confirm-payment route exists but not loaded.
- Cashback detail action.

No payment link, export, detail, confirmation, refund, or report drilldown action was clicked.

## State-Change Risks

- Payment confirmation affects order readiness and revenue.
- Payment-link generation can create customer-facing payment artifacts.
- Refunds/credits affect finance balances.
- Exports expose payment/customer data.
- Cashback adjustments need ledger integrity.
- Manual payment review requires strict audit and permissions.

## Current Pain Points

- Payment confirmation and refunds are unclear.
- Confirm-payment route is unstable.
- Payment flow for WhatsApp/manual orders and online orders is not verified.
- Finance reports exist but need stronger reconciliation and role-based export controls.
- Analytics are needed for revenue by channel, package, payment method, customer cohort, and order status.

## Preserve Decisions

- Preserve monthly sales, daily sales, payment-method sales, customer revenue, cashback, coupon usage, and expiration report concepts.
- Preserve payment status and transaction concepts on orders.
- Preserve payment-link generation as a business capability, subject to sandbox verification.

## Improve Decisions

- Improve payment status into a clear lifecycle with pending, link sent, paid, failed, manual review, confirmed, refunded, credited, disputed, and voided states as confirmed.
- Improve reports with reconciliation, filters, privacy controls, and export audit.
- Improve cashback into immutable wallet/credit ledger.
- Improve customer revenue report with formal accrual rules.

## Replace Decisions

- Replace unstable confirm-payment route with controlled payment review queue.
- Replace unaudited exports with role-gated export workflow.
- Replace direct finance actions with approval/hold/reason-based workflows.

## Add Decisions

- Add payment review queue for gateway and manual payments.
- Add refund and credit workflow.
- Add gateway webhook/event log if online payments are used.
- Add reconciliation dashboard.
- Add finance audit events.
- Add payment exception queue.

## Automation And AI Opportunities

- Match gateway transactions to orders by amount, customer, timestamp, and reference.
- Flag duplicate or suspicious payments.
- Recommend finance exceptions needing review.
- Forecast recognized revenue from active subscription calendars.
- Detect payment/report inconsistencies before export.

## Required New System Capabilities

- Payment status lifecycle.
- Payment-link generation and tracking.
- Payment review and confirmation queue.
- Refunds, credits, and cashback ledger.
- Gateway reconciliation.
- Finance reports and controlled exports.
- Revenue recognition/accrual model.
- Finance audit trail.

## Required Data Entities And Fields

- `Payment`: order, amount, currency, method, status, gateway, reference, created/updated timestamps.
- `PaymentLink`: order, amount, gateway, link status, expiry, generated by.
- `PaymentEvent`: gateway/manual event, raw reference, mapped payment, status.
- `PaymentReview`: payment/order, reviewer, decision, reason, timestamp.
- `Refund`: order/payment, amount, method, status, reason, approved by.
- `WalletLedgerEntry`: customer, amount, type, reason, source order, actor.
- `RevenueEntry`: order, active day, recognized amount, report period.
- `FinanceExportAudit`: report, filters, actor, timestamp.

## Required APIs High Level Only

- Payment status API.
- Payment link API.
- Payment review API.
- Gateway event/reconciliation API.
- Refund/credit API.
- Cashback ledger API.
- Finance report API.
- Revenue recognition API.
- Export API with audit.
- Payment audit API.

## Role And Permission Needs

- Finance can review/confirm/hold payment and run finance reports.
- Management can view finance analytics and approve high-risk overrides.
- Customer service can see limited payment status but not full sensitive details unless needed.
- Operations can see payment readiness only.
- Refund/credit actions require stricter permission and audit.
- Exports require permission, purpose, and audit.

## Reports And KPIs

- Sales by date, package, channel, and payment method.
- Payment status aging.
- Manual review queue count.
- Failed payment count.
- Refunds and credits by reason.
- Cashback liability and movements.
- Revenue recognized by period.
- Payment reconciliation differences.
- Export activity by user/report.

## Open Questions For Nutrezee

1. Which payment methods are used today?
2. How are WhatsApp/manual orders paid?
3. Does payment need to be confirmed before kitchen production?
4. Who can confirm payment?
5. What refund, credit, and cancellation rules apply?
6. Which gateway is used, and is a sandbox available?
7. What finance reports are mandatory for day one?
8. What export controls are required?

## Assumptions Marked

- Payment route behavior is partial because `/confirm-payment` timed out and no payment action was tested.
- Refunds and credits are proposed from business requirements; no refund route was discovered.
- Payment gateway APIs and webhook behavior are not confirmed without source/API docs and sandbox access.

## Recommended Build Order

1. Payment status model tied to order lifecycle.
2. Payment link integration in sandbox.
3. Payment review queue and audit.
4. Finance reports: sales, payment, revenue, expiration.
5. Cashback/credit ledger.
6. Refund workflow and reconciliation.
7. Finance analytics and export audit.
