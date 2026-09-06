import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate } from '@/data/repositories/users';
import { recordAudit } from '@/data/repositories/audit';
import { ensureBootstrapped } from '@/data/bootstrap';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/auth/session';
import { fail, translateError } from '@/lib/api';

const schema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/**
 * Credential sign-in.
 *
 * Failures return one message regardless of cause, so the endpoint cannot be
 * used to discover which addresses have accounts. Both outcomes are audited.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await ensureBootstrapped();
    const body = schema.parse(await request.json());
    const ip = request.headers.get('x-forwarded-for');

    const user = authenticate(body.email, body.password);
    if (!user) {
      recordAudit({
        action: 'auth.sign_in_failed',
        actorEmail: body.email.toLowerCase(),
        detail: 'Invalid credentials',
        ip,
      });
      return fail('That email address and password do not match an active account.', 401);
    }

    const token = await createSessionToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      scope: user.scope,
    });

    recordAudit({ action: 'auth.sign_in', actorId: user.id, actorEmail: user.email, ip });

    const response = NextResponse.json({ data: { redirectTo: '/overview' } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return translateError(error);
  }
}
