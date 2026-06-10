// One-time super-admin bootstrap (WP-01). Passwords never live in SQL seeds —
// hash is computed here from env vars and the action is audited.
// Usage: BOOTSTRAP_EMAIL=... BOOTSTRAP_PASSWORD=... BOOTSTRAP_NAME=... DATABASE_URL=... node scripts/bootstrap-admin.mjs
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';

const { BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD, BOOTSTRAP_NAME, DATABASE_URL } = process.env;
if (!BOOTSTRAP_EMAIL || !BOOTSTRAP_PASSWORD || !DATABASE_URL) {
  console.error('Required: BOOTSTRAP_EMAIL, BOOTSTRAP_PASSWORD, DATABASE_URL (optional BOOTSTRAP_NAME)');
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  const existing = await client.query('SELECT id FROM staff_user WHERE email = $1', [BOOTSTRAP_EMAIL]);
  if (existing.rowCount > 0) {
    console.log('user already exists — no action');
    process.exit(0);
  }
  const id = ulid();
  const pwd = await hash(BOOTSTRAP_PASSWORD);
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO staff_user (id, name_en, email, password_hash, created_by)
     VALUES ($1,$2,$3,$4,'bootstrap')`,
    [id, BOOTSTRAP_NAME ?? 'Super Admin', BOOTSTRAP_EMAIL, pwd],
  );
  await client.query(
    `INSERT INTO role_assignment (id, staff_id, role_id, assigned_by)
     SELECT $1, $2, id, 'bootstrap' FROM role WHERE code = 'super_admin'`,
    [ulid(), id],
  );
  await client.query(
    `INSERT INTO audit_event (id, event_type, actor_role, entity_type, entity_id, severity, after)
     VALUES ($1, 'staff.created', 'system', 'staff_user', $2, 'high', $3)`,
    [ulid(), id, JSON.stringify({ bootstrap: true, role: 'super_admin' })],
  );
  await client.query('COMMIT');
  console.log(`super admin created: ${id}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error(e.message);
  process.exit(1);
} finally {
  await client.end();
}
