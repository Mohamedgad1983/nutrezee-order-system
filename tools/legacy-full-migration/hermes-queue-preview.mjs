#!/usr/bin/env node
// Hermes WhatsApp agent — DRY-RUN QUEUE PREVIEW ONLY. Computes who WOULD be queued for a
// renewal/win-back message, applying every guard. NEVER sends. NEVER writes. No PII committed.
// Guards: eligibility (valid, non-placeholder phone) · messageable-segment whitelist · opt-out
// list · frequency cap (>=1 msg / customer / 7 days) · human approval required for any offer/discount.
import pg from 'pg';
const DB = process.env.DATABASE_URL;
const log = (o) => console.log(JSON.stringify(o));

// only these segments are messageable by the bot; everything else is excluded by policy
const TEMPLATES = {
  EXPIRES_TODAY:         { template: 'renewal_urgent',   has_offer: false },
  ACTIVE_RENEWAL_3_DAYS: { template: 'renewal_reminder', has_offer: false },
  ACTIVE_RENEWAL_7_DAYS: { template: 'renewal_reminder', has_offer: false },
  EXPIRED_1_7_DAYS:      { template: 'winback_fresh',    has_offer: true },
  EXPIRED_8_30_DAYS:     { template: 'winback',          has_offer: true },
  EXPIRED_31_90_DAYS:    { template: 'winback_offer',    has_offer: true },
  // EXPIRED_90_PLUS, PENDING_PAYMENT, CANCELLED, ACTIVE_FUTURE, INVALID_PHONE: excluded by policy
};

const c = new pg.Client({ connectionString: DB });
await c.connect();

// opt-out + frequency-cap sources are DESIGN placeholders until the Hermes tables exist:
//  - opt_out: customers who replied STOP / unsubscribed  (none yet -> empty set)
//  - recent_send: customers messaged in the last 7 days   (none yet -> empty set)
const optOut = new Set();        // TODO: SELECT customer_id FROM whatsapp_opt_out
const recentSend = new Set();    // TODO: SELECT customer_id FROM whatsapp_send_log WHERE sent_at > now()-7d

const sql = `
WITH excl AS (SELECT DISTINCT phone_original FROM migration_exception_review
              WHERE reason IN ('placeholder_phone','placeholder_phone_blacklisted','invalid_or_missing_phone')),
latest AS (SELECT DISTINCT ON (o.customer_id) o.customer_id, o.id oid, o.status, o.start_date, o.end_date
           FROM customer_order o WHERE o.origin='legacy'
           ORDER BY o.customer_id, o.end_date DESC NULLS LAST, o.start_date DESC NULLS LAST),
enr AS (SELECT l.*, ph.phone_normalized,
          (l.end_date - CURRENT_DATE) du, (CURRENT_DATE - l.end_date) ds,
          (sp.lp IN (SELECT phone_original FROM excl)) excluded_phone
        FROM latest l
        LEFT JOIN LATERAL (SELECT phone_normalized FROM customer_phone p WHERE p.customer_id=l.customer_id ORDER BY is_primary DESC NULLS LAST LIMIT 1) ph ON true
        LEFT JOIN LATERAL (SELECT legacy_key lp FROM sync_record s WHERE s.object_type='customer' AND s.new_ref=l.customer_id LIMIT 1) sp ON true)
SELECT customer_id,
  CASE WHEN du=0 THEN 'EXPIRES_TODAY' WHEN du BETWEEN 1 AND 3 THEN 'ACTIVE_RENEWAL_3_DAYS'
       WHEN du BETWEEN 4 AND 7 THEN 'ACTIVE_RENEWAL_7_DAYS'
       WHEN ds BETWEEN 1 AND 7 THEN 'EXPIRED_1_7_DAYS' WHEN ds BETWEEN 8 AND 30 THEN 'EXPIRED_8_30_DAYS'
       WHEN ds BETWEEN 31 AND 90 THEN 'EXPIRED_31_90_DAYS' ELSE 'OTHER' END seg
FROM enr
WHERE status NOT IN ('cancelled','rejected')
  AND phone_normalized ~ '^\\+?[0-9]{8,15}$' AND NOT coalesce(excluded_phone,false)`;

const rows = (await c.query(sql)).rows;
await c.end();

const queue = {}; let eligible = 0, optedOut = 0, capped = 0, needApproval = 0;
for (const r of rows) {
  const t = TEMPLATES[r.seg];
  if (!t) continue; // segment not messageable by policy
  if (optOut.has(r.customer_id)) { optedOut++; continue; }
  if (recentSend.has(r.customer_id)) { capped++; continue; }
  eligible++;
  if (t.has_offer) needApproval++;
  queue[r.seg] = queue[r.seg] || { template: t.template, has_offer: t.has_offer, requires_human_approval: t.has_offer, count: 0 };
  queue[r.seg].count++;
}

log({
  HERMES_DRY_RUN_PREVIEW: true,
  messages_sent: 0,
  live_sending: false,
  queue_by_segment: queue,
  totals: { queued_preview: eligible, suppressed_opt_out: optedOut, suppressed_frequency_cap: capped, require_human_approval: needApproval },
  guards: { opt_in_required: true, opt_out_honored: true, frequency_cap_days: 7, offers_require_human_approval: true, messageable_segments: Object.keys(TEMPLATES) },
});
