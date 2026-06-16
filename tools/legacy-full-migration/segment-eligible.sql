-- WhatsApp segmentation (post-Exception-Recovery) with eligibility exclusion.
-- A customer is WhatsApp-INELIGIBLE if their legacy phone is a placeholder/blacklisted phone
-- (shared by >=10 legacy customers) or flagged high-risk in migration_exception_review.
-- Run against staging: docker exec -i nutrezee-postgres-1 psql -U nutrezee -d nutrezee < this
WITH excl_phones AS (
  SELECT DISTINCT phone_original FROM migration_exception_review
  WHERE reason IN ('placeholder_phone','placeholder_phone_blacklisted','invalid_or_missing_phone')
),
latest AS (
  SELECT DISTINCT ON (o.customer_id) o.customer_id, o.id AS order_id, o.status, o.start_date, o.end_date
  FROM customer_order o WHERE o.origin='legacy'
  ORDER BY o.customer_id, o.end_date DESC NULLS LAST, o.start_date DESC NULLS LAST
),
enr AS (
  SELECT l.*, ph.phone_normalized, pay.status AS pay_status,
    (l.end_date - CURRENT_DATE) AS days_until, (CURRENT_DATE - l.end_date) AS days_since,
    (sp.legacy_phone IN (SELECT phone_original FROM excl_phones)) AS excluded_phone
  FROM latest l
  LEFT JOIN LATERAL (SELECT phone_normalized FROM customer_phone p WHERE p.customer_id=l.customer_id ORDER BY is_primary DESC NULLS LAST LIMIT 1) ph ON true
  LEFT JOIN LATERAL (SELECT status FROM payment_record pr WHERE pr.order_id=l.order_id ORDER BY created_at DESC LIMIT 1) pay ON true
  LEFT JOIN LATERAL (SELECT legacy_key AS legacy_phone FROM sync_record s WHERE s.object_type='customer' AND s.new_ref=l.customer_id LIMIT 1) sp ON true
),
seg AS (
  SELECT *,
    CASE
      WHEN phone_normalized IS NULL OR phone_normalized !~ '^\+?[0-9]{8,15}$' THEN 'INVALID_PHONE_EXCLUDE'
      WHEN end_date IS NULL OR start_date IS NULL THEN 'MISSING_DATE_REVIEW'
      WHEN status='cancelled' THEN 'CANCELLED_EXCLUDE'
      WHEN status='rejected' OR pay_status='unpaid' THEN 'PENDING_PAYMENT'
      WHEN days_until=0 THEN 'EXPIRES_TODAY'
      WHEN days_until BETWEEN 1 AND 3 THEN 'ACTIVE_RENEWAL_3_DAYS'
      WHEN days_until BETWEEN 4 AND 7 THEN 'ACTIVE_RENEWAL_7_DAYS'
      WHEN days_until > 7 THEN 'ACTIVE_FUTURE_NObot'
      WHEN days_since BETWEEN 1 AND 7 THEN 'EXPIRED_1_7_DAYS'
      WHEN days_since BETWEEN 8 AND 30 THEN 'EXPIRED_8_30_DAYS'
      WHEN days_since BETWEEN 31 AND 90 THEN 'EXPIRED_31_90_DAYS'
      WHEN days_since > 90 THEN 'EXPIRED_90_PLUS'
      ELSE 'UNCLASSIFIED' END AS segment,
    (phone_normalized IS NOT NULL AND phone_normalized ~ '^\+?[0-9]{8,15}$' AND NOT coalesce(excluded_phone,false)) AS whatsapp_eligible
  FROM enr
)
SELECT segment, count(*) AS total,
       count(*) FILTER (WHERE whatsapp_eligible) AS eligible,
       count(*) FILTER (WHERE NOT whatsapp_eligible) AS excluded
FROM seg GROUP BY segment ORDER BY total DESC;
