import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { execute, query, queryOne } from '../db/client';

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
  active: boolean;
  created_at: Date | string;
  last_login_at: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function toUser(row: Row): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as Role,
    scope: row.scope ? row.scope.split(',').filter(Boolean) : [],
    active: row.active,
    createdAt: iso(row.created_at) ?? '',
    lastLoginAt: iso(row.last_login_at),
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

export async function listUsers(): Promise<User[]> {
  const rows = await query<Row>('SELECT * FROM users ORDER BY name');
  return rows.map(toUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const row = await queryOne<Row>('SELECT * FROM users WHERE id = $1', [id]);
  return row ? toUser(row) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const row = await queryOne<Row>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return row ? toUser(row) : null;
}

/** Verifies credentials. Returns null for unknown, inactive or wrong-password. */
export async function authenticate(email: string, password: string): Promise<User | null> {
  const row = await queryOne<Row>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  if (!row || !row.active) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  await execute('UPDATE users SET last_login_at = NOW() WHERE id = $1', [row.id]);
  return toUser(row);
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: Role;
  scope: string[];
  password: string;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const id = randomUUID();
  await execute(
    `INSERT INTO users (id, email, name, role, scope, password_hash, active, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())`,
    [
      id,
      input.email.toLowerCase(),
      input.name,
      input.role,
      input.scope.join(','),
      hashPassword(input.password),
    ],
  );
  const created = await getUserById(id);
  if (!created) throw new Error('User creation failed');
  return created;
}

export async function updateUser(
  id: string,
  changes: Partial<Pick<User, 'name' | 'role' | 'scope' | 'active'>>,
): Promise<User | null> {
  const existing = await getUserById(id);
  if (!existing) return null;
  const merged = { ...existing, ...changes };
  await execute('UPDATE users SET name = $1, role = $2, scope = $3, active = $4 WHERE id = $5', [
    merged.name,
    merged.role,
    merged.scope.join(','),
    merged.active,
    id,
  ]);
  return getUserById(id);
}

export async function countUsers(): Promise<number> {
  const row = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM users');
  return Number(row?.n ?? 0);
}
