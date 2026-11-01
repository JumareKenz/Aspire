import { z } from 'zod';
import { recordAudit } from '@/data/repositories/audit';
import { getUserById, setPassword } from '@/data/repositories/users';
import { assertCanManageScope } from '@/auth/server';
import { ApiError, ok, withUser } from '@/lib/api';

const schema = z.object({
  id: z.string().min(1),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
});

/** Sets a new password for someone who has lost theirs. The password is never logged. */
export const POST = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  // Going through Account keeps the check of the current password.
  if (body.id === user.id) throw new ApiError('Change your own password on the Account page.', 400);

  const target = await getUserById(body.id);
  if (!target) throw new ApiError('That account no longer exists.', 404);
  await assertCanManageScope(user, target.scope);

  await setPassword(target.id, body.password);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.password_reset',
    target: target.id,
    detail: target.email,
  });
  return ok({ reset: true });
}, 'admin.manage');
