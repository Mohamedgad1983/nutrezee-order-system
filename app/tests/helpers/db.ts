import { Pool } from 'pg';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .mjs runtime module with sibling .d.mts types
import { migrate } from '../../db/migrate.mjs';

export const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://localhost:5432/nutrezee_test';

/** Drop + recreate the public schema, run all migrations, return a pool. */
export async function freshDb(): Promise<Pool> {
  const admin = new Pool({ connectionString: TEST_DB_URL, max: 1 });
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.end();
  await migrate(TEST_DB_URL);
  return new Pool({ connectionString: TEST_DB_URL, max: 5 });
}
