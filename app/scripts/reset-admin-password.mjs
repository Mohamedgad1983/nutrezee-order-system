// Reset a super-admin password (operator tool). Companion to bootstrap-admin.mjs,
// which is CREATE-ONLY (no-op if the email exists). This one UPDATES an existing
// account's password_hash, zeroes the lockout counter, ensures the account is active,
// and writes a HIGH-severity audit row. Hash params mirror the app exactly
// (platform/auth/password.ts: argon2id m=19456 KiB, t=2, p=1).
//
// Usage (run inside the api container so node_modules + DATABASE_URL are present):
//   RESET_PASSWORD='...' [RESET_EMAIL='admin@...'] node reset-admin-password.mjs
// If RESET_EMAIL is omitted, the single super_admin account is targeted; if more than
// one exists, it aborts and lists them (never guesses).
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';

const ARGON2_OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const { RESET_EMAIL, RESET_PASSWORD, DATABASE_URL } = process.env;

if (!RESET_PASSWORD || !DATABASE_URL) {
  console.error('Required: RESET_PASSWORD, DATABASE_URL (optional RESET_EMAIL to disambiguate)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  // Resolve the target account.
  let target;
  if (RESET_EMAIL) {
    const r = await client.query('SELECT id, email, active, failed_logins FROM staff_user WHERE email = $1', [RESET_EMAIL]);
    if (r.rowCount === 0) { console.error(`no staff_user with email ${RESET_EMAIL}`); process.exit(2); }
    target = r.rows[0];
  } else {
    const r = await client.query(
      `SELECT u.id, u.email, u.active, u.failed_logins
         FROM staff_user u
         JOIN role_assignment ra ON ra.staff_id = u.id
         JOIN role r ON r.id = ra.role_id
        WHERE r.code = 'super_admin'
        ORDER BY u.created_at`,
    );
    if (r.rowCount === 0) { console.error('no super_admin account found'); process.exit(2); }
    if (r.rowCount > 1) {
      console.error('multiple super_admin accounts — re-run with RESET_EMAIL set to one of:');
      for (const row of r.rows) console.error(`  - ${row.email}`);
      process.exit(3);
    }
    target = r.rows[0];
  }

  const newHash = await hash(RESET_PASSWORD, ARGON2_OPTS);
  await client.query('BEGIN');
  await client.query(
    `UPDATE staff_user
        SET password_hash = $2, failed_logins = 0, active = true, updated_at = now()
      WHERE id = $1`,
    [target.id, newHash],
  );
  await client.query(
    `INSERT INTO audit_event (id, event_type, actor_role, entity_type, entity_id, severity, after)
     VALUES ($1, 'staff.password_reset', 'system', 'staff_user', $2, 'high', $3)`,
    [ulid(), target.id, JSON.stringify({ password_reset: true, by: 'operator-reset-script', cleared_lockout: true })],
  );
  await client.query('COMMIT');
  console.log(`password reset for super_admin: ${target.email} (id ${target.id}); failed_logins cleared; active=true`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error(e.message);
  process.exit(1);
} finally {
  await client.end();
}
