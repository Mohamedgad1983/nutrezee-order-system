// expiring-subscription-email.mjs
// ----------------------------------------------------------------------------
// Daily INTERNAL report: customers whose subscription expires in exactly N days
// (default 3) from the Asia/Kuwait business date. Reads analytics.customer_
// subscription_status (migration 0021). Sends ONE email to the Nutrition Doctor
// (NUTRITION_DOCTOR_EMAIL) — an internal staff recipient. NEVER emails customers,
// never triggers WhatsApp/marketing. Disabled + dry-run by default.
//
// Safety contract:
//   * The ONLY email recipient is NUTRITION_DOCTOR_EMAIL (env). Customer contact
//     details are never used as recipients and are not included in the report.
//   * No real send unless: ENABLED=true AND dry-run=false AND recipient set AND
//     an SMTP transport is configured. Otherwise the report is rendered to logs
//     and a run row is written to audit_event — nothing leaves the system.
//   * Report contains internal IDs + non-PII subscription fields only.
//   * Business date is Asia/Kuwait, computed in SQL to match the view exactly.
//
// Run:  node scripts/expiring-subscription-email.mjs           (dry-run; default)
//       (configure via env — see app/.env.example and the docs under
//        docs/evidence/expiring_subscription_email/)
// ----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const EVENT_TYPE = 'report.expiring_subscription_email';

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function boolEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function readConfig() {
  const daysAhead = Number.parseInt(env('EXPIRING_SUBSCRIPTION_DAYS_AHEAD', '3'), 10);
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > 90) {
    throw new Error(`EXPIRING_SUBSCRIPTION_DAYS_AHEAD must be an integer 0..90 (got ${env('EXPIRING_SUBSCRIPTION_DAYS_AHEAD', '3')})`);
  }
  const windowMode = env('EXPIRING_SUBSCRIPTION_WINDOW_MODE', 'exact'); // 'exact' | 'within'
  if (!['exact', 'within'].includes(windowMode)) {
    throw new Error(`EXPIRING_SUBSCRIPTION_WINDOW_MODE must be 'exact' or 'within' (got ${windowMode})`);
  }
  return {
    databaseUrl: env('DATABASE_URL', undefined),
    enabled: boolEnv('EXPIRING_SUBSCRIPTION_EMAIL_ENABLED', false),
    // dry-run defaults TRUE; a real send needs an explicit EXPIRING_SUBSCRIPTION_DRY_RUN=false
    dryRun: boolEnv('EXPIRING_SUBSCRIPTION_DRY_RUN', true),
    recipient: env('NUTRITION_DOCTOR_EMAIL', undefined),
    daysAhead,
    windowMode,
    tz: env('EXPIRING_SUBSCRIPTION_TZ', 'Asia/Kuwait'),
    smtp: {
      host: env('SMTP_HOST', undefined),
      port: Number.parseInt(env('SMTP_PORT', '587'), 10),
      user: env('SMTP_USER', undefined),
      pass: env('SMTP_PASS', undefined),
      from: env('SMTP_FROM', env('NUTRITION_DOCTOR_EMAIL', undefined)),
      secure: boolEnv('SMTP_SECURE', false),
    },
  };
}

function log(level, msg, extra) {
  const line = `[expiring-subscription-email] ${level.toUpperCase()} ${msg}`;
  if (extra !== undefined) console.log(line, JSON.stringify(extra));
  else console.log(line);
}

async function fetchReport(client, cfg) {
  // Business date + target computed in SQL (Asia/Kuwait) so the cut matches the
  // view's own (now() AT TIME ZONE 'Asia/Kuwait')::date anchor exactly.
  const where =
    cfg.windowMode === 'within'
      ? 'css.subscription_expire_date BETWEEN (t.today + 1) AND (t.today + $2::int)'
      : 'css.subscription_expire_date = (t.today + $2::int)';
  const sql = `
    WITH t AS (SELECT (now() AT TIME ZONE $1)::date AS today)
    SELECT
      to_char(t.today, 'YYYY-MM-DD')                          AS report_date,
      to_char(t.today + $2::int, 'YYYY-MM-DD')                AS target_expiry,
      css.customer_id,
      css.current_order_id,
      css.current_package_id,
      css.current_package_name,
      to_char(css.subscription_expire_date, 'YYYY-MM-DD')     AS subscription_expire_date,
      css.days_remaining,
      css.subscription_status,
      css.source_confidence
    FROM analytics.customer_subscription_status css, t
    WHERE ${where}
    ORDER BY css.current_package_name NULLS LAST, css.subscription_status, css.customer_id`;
  const { rows } = await client.query(sql, [cfg.tz, cfg.daysAhead]);
  return rows;
}

function summarize(rows) {
  const byPackage = new Map();
  const byStatus = new Map();
  let lowConfidence = 0;
  for (const r of rows) {
    const pkg = r.current_package_name ?? '(no package)';
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + 1);
    byStatus.set(r.subscription_status, (byStatus.get(r.subscription_status) ?? 0) + 1);
    if (r.source_confidence === 'low') lowConfidence += 1;
  }
  return { byPackage, byStatus, lowConfidence };
}

function renderEmail(cfg, rows) {
  const reportDate = rows[0]?.report_date ?? '(computed at query time)';
  const targetExpiry = rows[0]?.target_expiry ?? '(none)';
  const subject = `Nutrezee Subscriptions Expiring in ${cfg.daysAhead} Days - ${reportDate}`;
  const { byPackage, byStatus, lowConfidence } = summarize(rows);

  const lines = [];
  lines.push('Nutrezee — Internal Subscription Expiry Report (staff only)');
  lines.push('');
  lines.push(`Report date (Asia/Kuwait): ${reportDate}`);
  lines.push(`Target expiry date:        ${targetExpiry}  (${cfg.windowMode === 'within' ? `within ${cfg.daysAhead} days` : `exactly ${cfg.daysAhead} days ahead`})`);
  lines.push(`Total customers:           ${rows.length}`);
  lines.push(`Low-confidence rows:       ${lowConfidence}  (latest order is cancelled/rejected — review)`);
  lines.push('');
  lines.push('Expiry = scheduled service-schedule end (fulfillment_day), NOT confirmed delivery.');
  lines.push('');
  lines.push('By package:');
  for (const [pkg, n] of [...byPackage.entries()].sort((a, b) => b[1] - a[1])) lines.push(`  - ${pkg}: ${n}`);
  lines.push('By status:');
  for (const [st, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) lines.push(`  - ${st}: ${n}`);
  lines.push('');
  lines.push('Customers (internal IDs — no PII):');
  lines.push('customer_id | current_order_id | package | expire | days_left | status | confidence');
  for (const r of rows) {
    lines.push(
      `${r.customer_id} | ${r.current_order_id ?? '—'} | ${r.current_package_name ?? '—'} | ${r.subscription_expire_date} | ${r.days_remaining} | ${r.subscription_status} | ${r.source_confidence}`,
    );
  }
  if (rows.length === 0) lines.push('  (no subscriptions match the window today)');
  return { subject, text: lines.join('\n'), targetExpiry, reportDate };
}

async function alreadySent(client, entityId) {
  const { rows } = await client.query(
    `SELECT 1 FROM audit_event
     WHERE entity_type='report' AND entity_id=$1 AND event_type=$2 AND (after->>'sent')='true'
     LIMIT 1`,
    [entityId, EVENT_TYPE],
  );
  return rows.length > 0;
}

async function recordRun(client, entityId, after) {
  await client.query(
    `INSERT INTO audit_event
       (id, event_type, actor_id, actor_role, entity_type, entity_id,
        related_refs, after, source, severity)
     VALUES ($1,$2,NULL,'system','report',$3,'{}'::jsonb,$4::jsonb,$5::jsonb,'info')`,
    [
      `rpt-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
      EVENT_TYPE,
      entityId,
      JSON.stringify(after),
      JSON.stringify({ job: 'expiring-subscription-email' }),
    ],
  );
}

async function sendEmail(cfg, email) {
  // SMTP transport is optional. nodemailer is NOT a declared dependency; a real
  // send requires the operator to install it (npm i nodemailer) — see docs. Until
  // then this throws and the job stays effectively dry-run.
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    throw new Error('SMTP send requires the optional dependency `nodemailer` (npm i nodemailer); not installed');
  }
  if (!cfg.smtp.host) throw new Error('SMTP_HOST is not set');
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
  });
  await transport.sendMail({
    from: cfg.smtp.from,
    to: cfg.recipient, // ONLY the internal Nutrition Doctor address
    subject: email.subject,
    text: email.text,
  });
}

async function main() {
  const cfg = readConfig();
  if (!cfg.databaseUrl) {
    log('error', 'DATABASE_URL is not set — cannot read the report.');
    process.exit(1);
  }
  log('info', 'starting', {
    enabled: cfg.enabled, dryRun: cfg.dryRun, daysAhead: cfg.daysAhead,
    windowMode: cfg.windowMode, tz: cfg.tz, recipientSet: Boolean(cfg.recipient),
  });

  const client = new pg.Client({ connectionString: cfg.databaseUrl });
  await client.connect();
  try {
    const rows = await fetchReport(client, cfg);
    const email = renderEmail(cfg, rows);
    const entityId = `expiring-subscription-${email.targetExpiry}`;
    log('info', 'report built', { subject: email.subject, total: rows.length });

    // Decide whether a real send is permitted.
    const wantSend = cfg.enabled && !cfg.dryRun;
    let sent = false;
    let sendBlockedReason = null;

    if (!wantSend) {
      sendBlockedReason = cfg.enabled ? 'dry_run' : 'disabled';
    } else if (!cfg.recipient) {
      sendBlockedReason = 'no_recipient'; // NUTRITION_DOCTOR_EMAIL not set
    } else if (await alreadySent(client, entityId)) {
      sendBlockedReason = 'already_sent'; // idempotent per target date
    } else {
      try {
        await sendEmail(cfg, email);
        sent = true;
        log('info', `email sent to internal recipient for target ${email.targetExpiry}`);
      } catch (e) {
        sendBlockedReason = 'send_error';
        log('warn', `send failed — staying report-only: ${e.message}`);
      }
    }

    if (!sent) {
      log('info', `NOT sent (${sendBlockedReason}). Rendered report below:`);
      console.log('\n----- BEGIN REPORT -----\n' + email.text + '\n----- END REPORT -----\n');
    }

    await recordRun(client, entityId, {
      mode: sent ? 'sent' : 'dry_run',
      sent,
      send_blocked_reason: sendBlockedReason,
      report_date: email.reportDate,
      target_expiry: email.targetExpiry,
      days_ahead: cfg.daysAhead,
      window_mode: cfg.windowMode,
      tz: cfg.tz,
      total: rows.length,
      recipient_present: Boolean(cfg.recipient),
    });
    log('info', 'run recorded in audit_event', { entityId, sent, total: rows.length });
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  log('error', e.message);
  process.exit(1);
});
