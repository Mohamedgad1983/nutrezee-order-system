# 03 — Validation Report

**Date:** 2026-06-20 · **Result: PASS** (dry-run, no email sent, no business mutation).

---

## What was validated

1. **Syntax:** `node --check app/scripts/expiring-subscription-email.mjs` → OK (local).
2. **Report query** against staging `analytics.customer_subscription_status` (read-only): for Kuwait today `2026-06-20`, target `+3 = 2026-06-23`, **54** customers expire exactly in 3 days (134 within 1–3 days).
3. **End-to-end dry-run** inside the api container (`nutrezee-api-1`, which has node + `pg` + `DATABASE_URL`): the job connected, built the report, did **NOT send** (disabled), and wrote a run record.

## Dry-run output (staging, 2026-06-20)

```
INFO starting {"enabled":false,"dryRun":true,"daysAhead":3,"windowMode":"exact","tz":"Asia/Kuwait","recipientSet":true}
INFO report built {"subject":"Nutrezee Subscriptions Expiring in 3 Days - 2026-06-20","total":54}
INFO NOT sent (disabled). Rendered report below:
  Report date (Asia/Kuwait): 2026-06-20
  Target expiry date:        2026-06-23  (exactly 3 days ahead)
  Total customers:           54
  Low-confidence rows:       16  (latest order is cancelled/rejected — review)
  By package:
    - 630 - 1730 calories (almost): 21
    - (150p-150c) 620-2240 calories (almost): 18
    - 720- 1920 calories (almost): 11
    - (200p-200c) 1020 - 3520 Calories (almost): 4
  By status:
    - expiring_soon: 54
  Customers (internal IDs — no PII):  [54 rows: customer_id | current_order_id | package | expire | days_left | status | confidence]
```

- **Subject** matches spec: `Nutrezee Subscriptions Expiring in 3 Days - 2026-06-20`.
- **No PII** in the body — internal ULIDs only.
- **Counts reconcile** with the direct view query (54; 16 low-confidence).

## Run-history record (audit_event)

The dry-run wrote one `audit_event` row (the intended run record — additive, benign):

| entity_id | actor_role | mode | sent | blocked | total | recipient_present |
|---|---|---|---|---|---|---|
| `expiring-subscription-2026-06-23` | system | dry_run | false | disabled | 54 | true |

## Safety assertions verified

- `enabled=false` → `send_blocked_reason='disabled'`; **nothing sent**.
- Recipient set (placeholder) but still no send (disabled) — proves the gate ordering.
- The only DB write was the additive `audit_event` run row; no business table touched; no customer contacted.

## Not exercised (documented, gated)

- **Real SMTP send** — requires `nodemailer` + `SMTP_*` + `ENABLED=true` + `DRY_RUN=false`. Not installed/enabled. The send code path exists and degrades gracefully without `nodemailer`.
- **Scheduling** — no timer installed/enabled.
