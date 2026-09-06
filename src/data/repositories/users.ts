import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db/client';

/**
 * Three user tiers, as defined by the product. LGA, M&E, programme and
 * technical users are deliberately a single tier — they share one workspace and
 * are separated by geographic scope and permissions, not by duplicated screens.
 */
export const ROLES = ['EXECUTIVE', 'ANALYST', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Org unit ids this user may see, including descendants. Empty = national. */
  scope: string[];
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface Row {
  id: string;
  email: string;
  name: string;
  role: string;
  scope: string;
  password_hash: string;
  active: number;
  created_at: string;
  last_login_at: string | null;
}

function toUser(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    scope: row.scope ? row.scope.split(',').filter(Boolean) : [],
    active: row.active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

/** scrypt with a per-user salt. Stored as `salt:derivedKey`, both hex. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export function listUsers(): User[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY name').all() as Row[];
  return rows.map(toUser);
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
  return row ? toUser(row) : null;
}

export function getUserByEmail(email: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | Row
    | undefined;
  return row ? toUser(row) : null;
}

/** Verifies credentials. Returns null for unknown, inactive or wrong-password. */
export function authenticate(email: string, password: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | Row
    | undefined;
  if (!row || row.active !== 1) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return toUser(row);
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  scope: string[];
  password: string;
}

export function createUser(input: CreateUserInput): User {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO users (id, email, name, role, scope, password_hash, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(id, input.email.toLowerCase(), input.name, input.role, input.scope.join(','), hashPassword(input.password), now);
  const created = getUserById(id);
  if (!created) throw new Error('User creation failed');
  return created;
}

export function updateUser(
  id: string,
  changes: Partial<Pick<User, 'name' | 'role' | 'scope' | 'active'>>,
): User | null {
  const existing = getUserById(id);
  if (!existing) return null;
  const merged = { ...existing, ...changes };
  getDb()
    .prepare('UPDATE users SET name = ?, role = ?, scope = ?, active = ? WHERE id = ?')
    .run(merged.name, merged.role, merged.scope.join(','), merged.active ? 1 : 0, id);
  return getUserById(id);
}

export function countUsers(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}
