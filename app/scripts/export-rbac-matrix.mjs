// Matrix export-compare guard (rbac_architecture: "export-compare report guards
// drift"): prints the LIVE role->permission matrix as JSON for review against the
// documented matrix. Read-only.
// Usage: DATABASE_URL=... node scripts/export-rbac-matrix.mjs
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
const { rows } = await client.query(
  `SELECT r.code AS role, r.dormant,
          coalesce(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
   FROM role r
   LEFT JOIN role_permission rp ON rp.role_id = r.id
   LEFT JOIN permission p ON p.id = rp.permission_id
   GROUP BY r.code, r.dormant ORDER BY r.code`,
);
await client.end();
console.log(JSON.stringify(rows, null, 2));
