import { z } from 'zod';
import {
  ACTION_STATUSES,
  createAction,
  getAction,
  listActions,
  updateAction,
} from '@/data/repositories/actions';
import { recordAudit } from '@/data/repositories/audit';
import { listUsers } from '@/data/repositories/users';
import { scopesOverlap } from '@/auth/rbac';
import { assertOrgUnitInScope, resolveScope, type Scope } from '@/auth/server';
import { getScorecard } from '@/services/scorecards';
import { ApiError, ok, withUser } from '@/lib/api';

const createSchema = z.object({
  title: z.string().min(3).max(200),
  detail: z.string().max(4000).default(''),
  orgUnitId: z.string().nullable().optional(),
  indicatorId: z.string().nullable().optional(),
  periodId: z.string().nullable().optional(),
  source: z.enum(['INSIGHT', 'RECOMMENDATION', 'FINDING', 'MANUAL']).default('MANUAL'),
  sourceRef: z.string().nullable().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(ACTION_STATUSES).optional(),
  assigneeId: z.string().nullable().optional(),
  outcome: z.string().max(2000).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
});

export const GET = withUser(async (user) => {
  const scope = await resolveScope(user);
  return ok(await listActions({ orgUnitIds: scope.ids }));
}, 'actions.view');

/**
 * Raises a follow-up action.
 *
 * The org unit's score at the moment of creation is stored as a baseline, so
 * that when the action is closed the platform can say what happened to the
 * measure it was raised against rather than only that someone ticked it off.
 */
/**
 * An assignee must be someone the caller shares geography with.
 *
 * The Actions board only offers such people, but the board is a convenience —
 * the request carries an arbitrary id and is checked here. Without this, a
 * state officer could assign follow-up to an officer in the other state by
 * sending their id directly.
 */
async function assertAssigneeReachable(
  assigneeId: string | null | undefined,
  scope: Scope,
): Promise<void> {
  if (!assigneeId) return;
  const candidate = (await listUsers()).find((entry) => entry.id === assigneeId);
  if (!candidate || !candidate.active) {
    throw new ApiError('That person does not have an active account.', 404);
  }
  if (!scopesOverlap(scope.ids, scope.root.path, candidate.scope)) {
    throw new ApiError('That person works outside your geographic access.', 403);
  }
}

export const POST = withUser(async (user, request) => {
  const body = createSchema.parse(await request.json());
  if (body.orgUnitId) await assertOrgUnitInScope(user, body.orgUnitId);
  await assertAssigneeReachable(body.assigneeId, await resolveScope(user));

  const baseline =
    body.orgUnitId && body.periodId
      ? ((await getScorecard(body.orgUnitId, body.periodId))?.overallScore ?? null)
      : null;

  const action = await createAction({
    title: body.title,
    detail: body.detail,
    orgUnitId: body.orgUnitId ?? null,
    indicatorId: body.indicatorId ?? null,
    periodId: body.periodId ?? null,
    source: body.source,
    sourceRef: body.sourceRef ?? null,
    priority: body.priority,
    assigneeId: body.assigneeId ?? null,
    createdBy: user.id,
    dueDate: body.dueDate ?? null,
    baselineScore: baseline,
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'actions.create',
    target: action.id,
    detail: action.title,
  });
  return ok(action, { status: 201 });
}, 'actions.manage');

export const PATCH = withUser(async (user, request) => {
  const body = updateSchema.parse(await request.json());

  // An action is addressed by its own id, so scope has to be checked against
  // the action rather than against anything in the request. Without this, a
  // state officer holding an id could reassign or close an action raised in
  // the other state.
  const existing = await getAction(body.id);
  if (!existing) throw new ApiError('That action no longer exists.', 404);
  const scope = await resolveScope(user);
  if (existing.orgUnitId) await assertOrgUnitInScope(user, existing.orgUnitId);
  await assertAssigneeReachable(body.assigneeId, scope);

  const updated = await updateAction(body.id, {
    status: body.status,
    assigneeId: body.assigneeId,
    outcome: body.outcome,
    dueDate: body.dueDate,
    priority: body.priority,
  });
  if (!updated) throw new ApiError('That action no longer exists.', 404);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'actions.update',
    target: body.id,
    detail: body.status ? `Status set to ${body.status}.` : 'Action updated.',
  });
  return ok(updated);
}, 'actions.manage');
