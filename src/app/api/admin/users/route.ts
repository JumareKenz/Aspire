import { z } from 'zod';
import { ROLES, createUser, getUserByEmail, listUsers, updateUser } from '@/data/repositories/users';
import { recordAudit } from '@/data/repositories/audit';
import { ApiError, ok, withUser } from '@/lib/api';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(120),
  role: z.enum(ROLES),
  scope: z.array(z.string()).default([]),
  password: z.string().min(10, 'Use at least 10 characters.'),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  scope: z.array(z.string()).optional(),
  active: z.boolean().optional(),
});

export const GET = withUser(async () => ok(listUsers()), 'admin.view');

export const POST = withUser(async (user, request) => {
  const body = createSchema.parse(await request.json());
  if (getUserByEmail(body.email)) throw new ApiError('An account with that email already exists.', 409);

  const created = createUser(body);
  recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.user_create',
    target: created.id,
    detail: `${created.email} as ${created.role}, scope ${created.scope.join(',') || 'national'}`,
  });
  return ok(created, { status: 201 });
}, 'admin.manage');

export const PATCH = withUser(async (user, request) => {
  const body = updateSchema.parse(await request.json());
  // An administrator locking themselves out is a support incident, not a
  // legitimate operation, so it is refused here rather than explained later.
  if (body.id === user.id && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
    throw new ApiError('You cannot remove your own administrator access.', 400);
  }

  const updated = updateUser(body.id, {
    name: body.name,
    role: body.role,
    scope: body.scope,
    active: body.active,
  });
  if (!updated) throw new ApiError('That account no longer exists.', 404);

  recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.user_update',
    target: updated.id,
    detail: `${updated.email}: role ${updated.role}, scope ${updated.scope.join(',') || 'national'}, ${
      updated.active ? 'active' : 'disabled'
    }`,
  });
  return ok(updated);
}, 'admin.manage');
