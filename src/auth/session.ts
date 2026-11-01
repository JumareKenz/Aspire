import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@/data/repositories/users';
import { env } from '@/lib/env';

export const SESSION_COOKIE = 'aspire_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export interface SessionClaims {
  sub: string;
  email: string;
  name: string;
  role: Role;
  scope: string[];
  /** Seconds since the epoch, from the token. Absent on a token being created. */
  issuedAt?: number;
}

/** Cookie settings shared by everything that issues a session. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/**
 * Whether a session predates the account's latest password change.
 *
 * A password is replaced because it may be known to someone else, so a session
 * opened with the old one must stop working rather than run out its 8 hours.
 * Tokens carry whole seconds, so the comparison is made in whole seconds.
 */
export function sessionIsCurrent(issuedAt: number | undefined, passwordChangedAt: string | null): boolean {
  if (!passwordChangedAt) return true;
  if (issuedAt === undefined) return false;
  return issuedAt >= Math.floor(new Date(passwordChangedAt).getTime() / 1000);
}

/**
 * Signing key.
 *
 * In production `ASPIRE_SESSION_SECRET` must be set; the server refuses to
 * start a session without it rather than silently signing with a known value.
 */
function secret(): Uint8Array {
  const value = env('ASPIRE_SESSION_SECRET');
  if (value && value.length >= 32) return new TextEncoder().encode(value);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ASPIRE_SESSION_SECRET must be set to a value of at least 32 characters in production.',
    );
  }
  return new TextEncoder().encode('aspire-development-secret-not-for-production-use');
}

export async function createSessionToken(claims: SessionClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setIssuer('aspire-gac')
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'aspire-gac' });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
    return {
      sub: payload.sub,
      email: payload.email,
      name: String(payload.name ?? ''),
      role: payload.role as Role,
      scope: Array.isArray(payload.scope) ? (payload.scope as string[]) : [],
      issuedAt: payload.iat,
    };
  } catch {
    return null;
  }
}
