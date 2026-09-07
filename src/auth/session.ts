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
    };
  } catch {
    return null;
  }
}
