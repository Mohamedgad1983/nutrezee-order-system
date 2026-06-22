// expiring-subscription-email.mjs
// ----------------------------------------------------------------------------
// Daily INTERNAL report: customers whose subscription expires within N "days left"
// (default 3) from the Asia/Kuwait business date. Day-counting is INCLUSIVE by default
// (today = day 1, so "3 days left" => expires today + 2) to match the legacy/call-centre
// "Days Left" report — set EXPIRING_SUBSCRIPTION_DAYS_INCLUSIVE=false for exclusive.
// Reads analytics.customer_
// subscription_status (migration 0021). Sends ONE email to the Nutrition Doctor
// (NUTRITION_DOCTOR_EMAIL) — an internal staff recipient. NEVER emails customers,
// never triggers WhatsApp/marketing. Disabled + dry-run by default.
//
// Report format: a clean HTML table + a CSV (Excel) attachment. When
// EXPIRING_SUBSCRIPTION_INCLUDE_CONTACT=true (owner-authorized, internal call
// list) it includes customer Name + Phone so the doctor can follow up; otherwise
// it stays ID-only (no PII). Customer contact details are NEVER used as the email
// recipient — the only recipient is NUTRITION_DOCTOR_EMAIL.
//
// Business date is Asia/Kuwait, computed in SQL to match the view exactly.
// Run:  node scripts/expiring-subscription-email.mjs           (dry-run; default)
// ----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
    // Inclusive day-counting (default true): "N days left" counts today as day 1, so a
    // customer with N days left expires on today + (N-1) — matching the legacy/call-centre
    // "Days Left" report. Set false for exclusive counting (expire == today + N).
    inclusive: boolEnv('EXPIRING_SUBSCRIPTION_DAYS_INCLUSIVE', true),
    tz: env('EXPIRING_SUBSCRIPTION_TZ', 'Asia/Kuwait'),
    // Owner-authorized internal call list: include customer Name + Phone so the
    // Nutrition Doctor can follow up. Default OFF (ID-only) for PII safety.
    includeContact: boolEnv('EXPIRING_SUBSCRIPTION_INCLUDE_CONTACT', false),
    // Manual override to re-send for a target date already marked sent (e.g. a
    // corrected report). Off by default so the daily run stays idempotent.
    force: boolEnv('EXPIRING_SUBSCRIPTION_FORCE', false),
    previewDir: env('EXPIRING_SUBSCRIPTION_PREVIEW_DIR', '/tmp'),
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
  // Inclusive counting: "N days left" => expires today + (N-1). hiOff is the farthest
  // expiry offset in the window, loOff the nearest; exact => single day (loOff == hiOff).
  const hiOff = cfg.inclusive ? cfg.daysAhead - 1 : cfg.daysAhead;
  const loOff = cfg.windowMode === 'within' ? (cfg.inclusive ? 0 : 1) : hiOff;
  const where = 'css.subscription_expire_date BETWEEN (t.today + $2::int) AND (t.today + $3::int)';
  // Name + phone are only selected when the owner enabled the contact list.
  const contactSelect = cfg.includeContact
    ? `, c.full_name_en AS customer_name,
       c.full_name_ar AS customer_name_ar,
       (SELECT p.phone_normalized FROM customer_phone p
         WHERE p.customer_id = css.customer_id
         ORDER BY p.is_primary DESC NULLS LAST LIMIT 1) AS phone`
    : `, NULL::text AS customer_name, NULL::text AS customer_name_ar, NULL::text AS phone`;
  const contactJoin = cfg.includeContact ? 'LEFT JOIN customer c ON c.id = css.customer_id' : '';
  const sql = `
    WITH t AS (SELECT (now() AT TIME ZONE $1)::date AS today)
    SELECT
      to_char(t.today, 'YYYY-MM-DD')                          AS report_date,
      to_char(t.today + $3::int, 'YYYY-MM-DD')                AS target_expiry,
      css.customer_id,
      css.current_order_id,
      css.current_package_name,
      to_char(css.subscription_expire_date, 'YYYY-MM-DD')     AS subscription_expire_date,
      css.days_remaining,
      css.subscription_status,
      css.source_confidence
      ${contactSelect}
    FROM analytics.customer_subscription_status css
    CROSS JOIN t
    ${contactJoin}
    WHERE ${where}
    ORDER BY css.subscription_expire_date,
             css.current_package_name NULLS LAST,
             css.customer_id`;
  const { rows } = await client.query(sql, [cfg.tz, loOff, hiOff]);
  // Display "Days Left" inclusively (today = day 1) to match the call-centre report.
  for (const r of rows) r.days_left = cfg.inclusive ? Number(r.days_remaining) + 1 : Number(r.days_remaining);
  return rows;
}

function summarize(rows) {
  const byPackage = new Map();
  let lowConfidence = 0;
  for (const r of rows) {
    const pkg = r.current_package_name ?? '(no package)';
    byPackage.set(pkg, (byPackage.get(pkg) ?? 0) + 1);
    if (r.source_confidence === 'low') lowConfidence += 1;
  }
  return { byPackage, lowConfidence };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function csvCell(v) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}

function renderCsv(cfg, rows) {
  const header = ['#', 'Name', 'Phone', 'Package', 'Expiry date', 'Days left', 'Status', 'Confidence', 'Customer ID', 'Order ID'];
  const out = [header.map(csvCell).join(',')];
  rows.forEach((r, i) => {
    out.push([
      i + 1,
      cfg.includeContact ? (r.customer_name ?? '') : '',
      cfg.includeContact ? (r.phone ?? '') : '',
      r.current_package_name ?? '',
      r.subscription_expire_date,
      r.days_left,
      r.subscription_status,
      r.source_confidence,
      r.customer_id,
      r.current_order_id ?? '',
    ].map(csvCell).join(','));
  });
  // UTF-8 BOM so Excel opens names (incl. Arabic) correctly; CRLF line endings.
  return '﻿' + out.join('\r\n') + '\r\n';
}

function renderHtml(cfg, rows, summary, meta) {
  const td = 'padding:6px 10px;border:1px solid #e2e8e6;font-size:13px;vertical-align:top';
  const th = 'padding:8px 10px;border:1px solid #0a6b4d;font-size:12px;text-align:left;color:#fff;background:#0a8f5f';
  const body = rows.map((r, i) => {
    const low = r.source_confidence === 'low';
    const bg = low ? '#fff7e6' : (i % 2 ? '#f7faf9' : '#ffffff');
    const cells = [
      `<td style="${td};text-align:center;color:#888">${i + 1}</td>`,
      cfg.includeContact ? `<td style="${td};font-weight:600">${esc(r.customer_name ?? '—')}</td>` : '',
      cfg.includeContact ? `<td style="${td};font-family:monospace;white-space:nowrap">${esc(r.phone ?? '—')}</td>` : '',
      `<td style="${td}">${esc(r.current_package_name ?? '—')}</td>`,
      `<td style="${td};white-space:nowrap">${esc(r.subscription_expire_date)}</td>`,
      `<td style="${td};text-align:center">${esc(r.days_left)}</td>`,
      `<td style="${td}">${esc(r.subscription_status)}${low ? ' <span title="latest order cancelled/rejected — verify">⚠</span>' : ''}</td>`,
    ].join('');
    return `<tr style="background:${bg}">${cells}</tr>`;
  }).join('');
  const headCells = [
    '<th style="' + th + ';text-align:center">#</th>',
    cfg.includeContact ? '<th style="' + th + '">Name</th>' : '',
    cfg.includeContact ? '<th style="' + th + '">Phone</th>' : '',
    '<th style="' + th + '">Package</th>',
    '<th style="' + th + '">Expiry date</th>',
    '<th style="' + th + ';text-align:center">Days left</th>',
    '<th style="' + th + '">Status</th>',
  ].join('');
  const pkgList = [...summary.byPackage.entries()].sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `<li>${esc(p)}: <b>${n}</b></li>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#f0f4f3;padding:18px">
  <div style="max-width:920px;margin:auto;background:#fff;border:1px solid #e2e8e6;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1a2b27">
    <div style="background:#0a8f5f;color:#fff;padding:16px 22px">
      <div style="font-size:18px;font-weight:700">Nutrezee — Subscriptions Expiring in ${cfg.daysAhead} Days</div>
      <div style="font-size:12px;opacity:.9">Internal call list for the Nutrition Doctor · staff use only</div>
    </div>
    <div style="padding:18px 22px">
      <table style="font-size:13px;margin-bottom:8px"><tr>
        <td style="padding:2px 16px 2px 0">Report date (Kuwait): <b>${esc(meta.reportDate)}</b></td>
        <td style="padding:2px 16px 2px 0">Expiring on: <b>${esc(meta.targetExpiry)}</b></td>
        <td style="padding:2px 16px 2px 0">Total: <b>${rows.length}</b></td>
        <td style="padding:2px 0">⚠ low-confidence: <b>${summary.lowConfidence}</b></td>
      </tr></table>
      <div style="font-size:12px;color:#666;margin-bottom:14px">By package: <ul style="margin:6px 0">${pkgList}</ul></div>
      <table style="border-collapse:collapse;width:100%">
        <thead><tr>${headCells}</tr></thead>
        <tbody>${body || `<tr><td style="${td}" colspan="7">No subscriptions match the window.</td></tr>`}</tbody>
      </table>
      <p style="font-size:11px;color:#8a9a95;margin-top:14px">
        ⚠ = latest order is cancelled/rejected (verify before calling). Expiry = scheduled service-schedule end
        (from fulfillment_day), not confirmed delivery. The full list is attached as a CSV (open in Excel).
      </p>
    </div>
  </div></body></html>`;
}

function renderText(cfg, rows, summary, meta) {
  const lines = [];
  lines.push('Nutrezee — Subscriptions Expiring in ' + cfg.daysAhead + ' Days (internal call list)');
  lines.push('');
  lines.push(`Report date (Kuwait): ${meta.reportDate}   Expiring on: ${meta.targetExpiry}   Total: ${rows.length}   Low-confidence: ${summary.lowConfidence}`);
  lines.push('Full list attached as CSV (open in Excel).');
  lines.push('');
  rows.forEach((r, i) => {
    const who = cfg.includeContact ? `${r.customer_name ?? '—'} | ${r.phone ?? '—'} | ` : '';
    lines.push(`${i + 1}. ${who}${r.current_package_name ?? '—'} | expires ${r.subscription_expire_date} | ${r.days_left}d | ${r.subscription_status}${r.source_confidence === 'low' ? ' (!)' : ''}`);
  });
  if (rows.length === 0) lines.push('(no subscriptions match the window today)');
  return lines.join('\n');
}

function renderEmail(cfg, rows) {
  const reportDate = rows[0]?.report_date ?? '(computed at query time)';
  const targetExpiry = rows[0]?.target_expiry ?? '(none)';
  const subject = `Nutrezee — ${rows.length} subscriptions expiring ${targetExpiry} (in ${cfg.daysAhead} days)`;
  const summary = summarize(rows);
  const meta = { reportDate, targetExpiry };
  return {
    subject,
    text: renderText(cfg, rows, summary, meta),
    html: renderHtml(cfg, rows, summary, meta),
    csv: renderCsv(cfg, rows),
    csvName: `nutrezee_expiring_${targetExpiry}.csv`,
    targetExpiry,
    reportDate,
  };
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
    html: email.html,
    attachments: [{ filename: email.csvName, content: email.csv, contentType: 'text/csv; charset=utf-8' }],
  });
}

async function main() {
  const cfg = readConfig();
  if (!cfg.databaseUrl) {
    log('error', 'DATABASE_URL is not set — cannot read the report.');
    process.exit(1);
  }
  log('info', 'starting', {
    enabled: cfg.enabled, dryRun: cfg.dryRun, daysAhead: cfg.daysAhead, windowMode: cfg.windowMode,
    tz: cfg.tz, includeContact: cfg.includeContact, recipientSet: Boolean(cfg.recipient),
  });

  const client = new pg.Client({ connectionString: cfg.databaseUrl });
  await client.connect();
  try {
    const rows = await fetchReport(client, cfg);
    const email = renderEmail(cfg, rows);
    const entityId = `expiring-subscription-${email.targetExpiry}`;
    log('info', 'report built', { subject: email.subject, total: rows.length, includeContact: cfg.includeContact });

    const wantSend = cfg.enabled && !cfg.dryRun;
    let sent = false;
    let sendBlockedReason = null;

    if (!wantSend) {
      sendBlockedReason = cfg.enabled ? 'dry_run' : 'disabled';
    } else if (!cfg.recipient) {
      sendBlockedReason = 'no_recipient';
    } else if (!cfg.force && await alreadySent(client, entityId)) {
      sendBlockedReason = 'already_sent';
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
      // Dry-run / preview: write the full HTML + CSV to files so they can be reviewed
      // without dumping the whole PII list to the console.
      try {
        const base = `${cfg.previewDir}/expiring_${email.targetExpiry}`;
        writeFileSync(`${base}.html`, email.html);
        writeFileSync(`${base}.csv`, email.csv);
        log('info', `NOT sent (${sendBlockedReason}). Preview written: ${base}.html , ${base}.csv`);
      } catch (e) {
        log('warn', `could not write preview files: ${e.message}`);
      }
      // Small console sample only (first 6 rows) — full list is in the files/email.
      const sample = rows.slice(0, 6).map((r, i) =>
        `${i + 1}. ${cfg.includeContact ? `${r.customer_name ?? '—'} | ${r.phone ?? '—'} | ` : ''}${r.current_package_name ?? '—'} | ${r.subscription_expire_date} | ${r.days_left}d | ${r.subscription_status}`).join('\n');
      console.log(`\n----- PREVIEW (first ${Math.min(6, rows.length)} of ${rows.length}) -----\n${sample}\n----- END PREVIEW -----\n`);
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
      include_contact: cfg.includeContact,
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
