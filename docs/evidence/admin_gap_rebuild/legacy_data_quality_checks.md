# Legacy Data Quality Checks

Date: 2026-06-15

These checks are required before any real legacy apply. They should run in dry-run/report mode first and must not mutate production.

| Check | Severity | Rule |
|---|---|---|
| Duplicate customers | High | Same normalized phone across multiple legacy customers; route to merge-review if not exact safe match. |
| Missing phone numbers | High | Customer/order rows without any usable phone must be review-needed. |
| Invalid phone formats | Medium | Normalize; flag values that cannot be parsed. |
| Missing names | Medium | Customer rows without display name require fallback label and review. |
| Invalid DOB/date formats | Medium | Reject invalid dates to row report; do not coerce silently. |
| Invalid addresses | High | Empty address, unknown area, or unparseable required delivery text must be review-needed. |
| Orphan orders without customers | Critical | Order customer legacy key must resolve to imported customer or row fails. |
| Orphan order details without orders | Critical | Detail row must resolve to a legacy order. |
| Orders without delivery/start date | Critical | Active/pending orders require at least start/delivery date. |
| End date before start date | Critical | Reject row or send to review. |
| Paid orders with missing paid amount | High | Paid/collected status requires non-negative amount or finance review. |
| Unpaid orders marked delivered/completed | High | Route to finance/ops review. |
| Cancelled orders with payment | High | Preserve but flag for refund/credit/cancellation review. |
| Missing package reference | High | Active plan should resolve package or freeze legacy text and review. |
| Unknown package/sub-package | High | Import frozen names; no synthetic package creation without Batch 1 decision. |
| Unknown product/item | Medium | For order details, freeze item name; flag if kitchen routing needed. |
| Unknown status | Critical | Unknown order/payment/fulfillment status must not be silently mapped. |
| Inconsistent branch/location | Medium | Preserve text; flag if branch/area conflicts with address. |
| Duplicate legacy order IDs | Critical | Legacy order key must be unique per source object type. |
| Duplicate payment references | High | Same gateway/transaction ref across multiple orders requires finance review. |
| Negative money values | Critical | Reject or review; no negative totals/paid amounts without explicit credit/refund model. |
| Currency mismatch | High | Non-KWD or missing currency requires finance review. |
| Coupon without discount | Medium | Preserve code, flag missing discount if legacy says discounted. |
| Discount greater than package amount | High | Finance review. |
| Missing delivery slot | Medium | Allow null only with `slot_unverified`/review marker. |
| Unknown delivery method | Medium | Preserve text and review. |
| Allergy text not mapped to allergen master | High | Preserve health note; require dietician/ops review before kitchen use. |
| Diet status not mapped | Medium | Preserve text; no hard eligibility rule until mapped. |
| Driver assignment unknown | Medium | Preserve in report only while dispatch module is dormant. |
| Import idempotency | Critical | Re-running dry-run/apply must not create duplicate customers/orders/payments. |
| Audit/report completeness | Critical | Every rejected, warned, applied, and rolled-back row must appear in import report. |

## Required Report Sections

- Total rows by entity.
- Applied/failed/warned counts by entity.
- Top failure reasons.
- Duplicate customer clusters.
- Unknown status vocabularies.
- Unknown package/product/master references.
- Finance/payment exceptions.
- Address/area/slot exceptions.
- Health/allergy mapping exceptions.
- Sample row IDs for each failure class, with sensitive values masked.
