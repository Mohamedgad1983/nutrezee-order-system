// SQL-first migration runner (DEC-011). Forward-only; each file applies in one
// transaction; applied files tracked in schema_migrations. Rollback = corrective
// migration, never history edits (16_Deployment/environment_plan.md §4).
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export async function migrate(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations
       (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    const applied = [];
    for (const f of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [f]);
      if (done.rowCount > 0) continue;
      const sql = await readFile(new URL(f, MIGRATIONS_DIR), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${e.message}`);
      }
    }
    return applied;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  migrate(url)
    .then((applied) => console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date'))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
