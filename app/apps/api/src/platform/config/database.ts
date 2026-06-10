import { Pool } from 'pg';

// PostgreSQL connection pattern (WP-00): env-driven, one lazy pool per process.
// DATABASE_URL comes from the environment (.env locally; host secret store in
// staging/prod — 16_Deployment/environment_plan.md). No queries exist until the
// WP-01 wave-1 migrations land; this module only fixes the pattern.
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — copy app/.env.example to app/.env');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}
