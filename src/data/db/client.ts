import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Single embedded database connection.
 *
 * Next.js reloads modules in development, so the handle is cached on
 * `globalThis` to avoid opening a new file handle on every hot reload.
 */
declare global {
  var __aspireDb: Database.Database | undefined;
}

const DB_PATH = process.env.ASPIRE_DB_PATH ?? resolve(process.cwd(), '.data/aspire.db');

function open(): Database.Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const schema = readFileSync(resolve(process.cwd(), 'src/data/db/schema.sql'), 'utf8');
  db.exec(schema);
  return db;
}

export function getDb(): Database.Database {
  if (!globalThis.__aspireDb) {
    globalThis.__aspireDb = open();
  }
  return globalThis.__aspireDb;
}

/** Closes and forgets the connection. Used by tests and by re-seed operations. */
export function closeDb(): void {
  globalThis.__aspireDb?.close();
  globalThis.__aspireDb = undefined;
}

export type Db = Database.Database;
