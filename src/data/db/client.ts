import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * PostgreSQL connection pool.
 *
 * A pool rather than a per-request client: Vercel's Fluid Compute reuses
 * function instances across invocations, so a warm pool is reused rather than
 * reconnecting on every request. Next.js also reloads modules in development,
 * so the pool is cached on `globalThis` to avoid leaking connections on hot
 * reload.
 *
 * Works against any PostgreSQL, including Neon over its pooled connection
 * string — which is what keeps the same code testable against a local database.
 */
declare global {
  var __aspirePool: Pool | undefined;
  var __aspireSchema: Promise<void> | undefined;
}

function connectionString(): string {
  const url =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_POSTGRES_URL;
  if (!url) {
    throw new Error(
      'No database configured. Set DATABASE_URL (Neon, or any PostgreSQL connection string).',
    );
  }
  return url;
}

function createPool(): Pool {
  const url = connectionString();
  return new Pool({
    connectionString: url,
    // Managed Postgres requires TLS; a local development database does not.
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    // Serverless instances are short-lived and numerous, so each one holds only
    // a small number of connections and releases them promptly.
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 15_000,
  });
}

export function getPool(): Pool {
  if (!globalThis.__aspirePool) {
    globalThis.__aspirePool = createPool();
  }
  return globalThis.__aspirePool;
}

/**
 * Applies the schema once per process. Every statement is idempotent, so this
 * is safe to run on every cold start and removes the need for a separate
 * migration step on a platform that has no deploy hook.
 */
export function ensureSchema(): Promise<void> {
  if (!globalThis.__aspireSchema) {
    globalThis.__aspireSchema = (async () => {
      const sql = readFileSync(resolve(process.cwd(), 'src/data/db/schema.sql'), 'utf8');
      await getPool().query(sql);
    })().catch((error) => {
      // A failed schema application must not be cached as success, or every
      // later query fails with a confusing "relation does not exist".
      globalThis.__aspireSchema = undefined;
      throw error;
    });
  }
  return globalThis.__aspireSchema;
}

/** Runs a query and returns its rows. */
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Runs a query expected to match at most one row. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Runs a statement and reports how many rows it changed. */
export async function execute(text: string, params: readonly unknown[] = []): Promise<number> {
  const result = await getPool().query(text, params as unknown[]);
  return result.rowCount ?? 0;
}

/**
 * Runs `fn` inside a transaction, rolling back on any error.
 *
 * Bulk writes during synchronisation go through this so a failed sync cannot
 * leave the store holding half an import.
 */
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Closes the pool. Used by tests and by re-seed operations. */
export async function closeDb(): Promise<void> {
  const pool = globalThis.__aspirePool;
  globalThis.__aspirePool = undefined;
  globalThis.__aspireSchema = undefined;
  if (pool) await pool.end();
}

/**
 * Builds a `VALUES` list for a bulk insert, returning the placeholder text and
 * the flattened parameters. Postgres has a 65535-parameter ceiling per
 * statement, so callers chunk their rows; see `chunk` below.
 */
export function valuesClause(rows: readonly unknown[][], startAt = 1): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  let position = startAt;
  const text = rows
    .map((row) => `(${row.map(() => `$${position++}`).join(',')})`)
    .join(',');
  for (const row of rows) params.push(...row);
  return { text, params };
}

/** Splits rows into batches that stay under the parameter ceiling. */
export function chunk<T>(rows: readonly T[], columnsPerRow: number): T[][] {
  const maxRows = Math.max(1, Math.floor(60_000 / Math.max(1, columnsPerRow)));
  const batches: T[][] = [];
  for (let i = 0; i < rows.length; i += maxRows) {
    batches.push(rows.slice(i, i + maxRows));
  }
  return batches;
}
