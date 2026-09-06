import { randomBytes } from 'node:crypto';

/**
 * Each store-backed suite runs against its own PostgreSQL schema.
 *
 * A schema rather than a whole database: it is cheap to create and drop, and it
 * gives the same isolation — suites cannot see one another's rows even when
 * they share a server. `options=-c search_path=…` scopes every connection in
 * the suite without changing a single query.
 */
export function isolatedSchema(): string {
  const schema = `aspire_test_${randomBytes(6).toString('hex')}`;
  const base =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://aspire:aspire@127.0.0.1:55433/aspire';
  const url = new URL(base);
  url.searchParams.set('options', `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  return schema;
}

export async function createSchema(schema: string): Promise<void> {
  const { getPool, ensureSchema } = await import('@/data/db/client');
  await getPool().query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await ensureSchema();
}

export async function dropSchema(schema: string): Promise<void> {
  const { getPool, closeDb } = await import('@/data/db/client');
  try {
    await getPool().query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await closeDb();
  }
}
