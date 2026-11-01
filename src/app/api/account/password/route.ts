import { z } from 'zod';
import { recordAudit } from '@/data/repositories/audit';
import { passwordMatches, setPassword } from '@/data/repositories/users';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/auth/session';
import { ApiError, ok, withUser } from '@/lib/api';

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});

/**
 * Changes the signed-in user's own password.
 *
 * Other sessions end with the change, so this one is reissued to keep the
 * person who made it signed in.
 */
export const POST = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  if (!(await passwordMatches(user.id, body.currentPassword))) {
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'auth.password_change_failed',
      detail: 'Current password did not match',
    });
    throw new ApiError('Your current password is not correct.', 400);
  }
  if (body.newPassword === body.currentPassword) {
    throw new ApiError('Choose a password different from your current one.', 400);
  }

  await setPassword(user.id, body.newPassword);
  await recordAudit({ actorId: user.id, actorEmail: user.email, action: 'auth.password_changed' });

  const token = await createSessionToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    scope: user.scope,
  });
  const response = ok({ changed: true });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
});
