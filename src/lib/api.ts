import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { getCurrentUser } from '@/auth/server';
import { can, type Permission } from '@/auth/rbac';
import { ScopeError } from '@/auth/server';
import type { User } from '@/data/repositories/users';
import { Dhis2Error } from '@/data/sources/dhis2/client';

/**
 * Shared API conventions.
 *
 * Every handler returns either `{ data }` or `{ error }` with a human-readable
 * message. Internal detail — stack traces, SQL, DHIS2 credentials — never
 * reaches the client; administrators get diagnostics through the audit log and
 * the sync history instead.
 */

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function fail(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json({ error: { message, code } }, { status });
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Wraps a handler with authentication, permission checking and error
 * translation. Handlers receive the resolved user and never repeat this logic.
 */
export function withUser(
  // Handlers return a plain Response so that non-JSON replies — a CSV export,
  // for instance — do not need a cast to satisfy the wrapper.
  handler: (user: User, request: Request) => Promise<Response>,
  permission?: Permission,
) {
  return async (request: Request): Promise<Response> => {
    try {
      const user = await getCurrentUser();
      if (!user) return fail('You need to sign in to view this.', 401, 'unauthenticated');
      if (permission && !can(user.role, permission)) {
        return fail('You do not have permission to do this.', 403, 'forbidden');
      }
      return await handler(user, request);
    } catch (error) {
      return translateError(error);
    }
  };
}

export function translateError(error: unknown): NextResponse {
  if (error instanceof ApiError) return fail(error.message, error.status);
  if (error instanceof ScopeError) return fail(error.message, error.status);
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return fail(
      first ? `${first.path.join('.') || 'request'}: ${first.message}` : 'The request was not valid.',
      422,
      'invalid_request',
    );
  }
  if (error instanceof Dhis2Error) {
    return fail(
      'We could not reach DHIS2. Check the connection settings, or try again shortly.',
      502,
      'dhis2_unavailable',
    );
  }
  // Log server-side for operators; return something a person can act on.
  console.error('[api] unhandled error', error);
  return fail('Something went wrong on our side. Please try again.', 500, 'internal_error');
}

/** Parses search params with a small amount of ceremony and no repetition. */
export function query(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}
