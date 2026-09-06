import { z } from 'zod';
import {
  ACTION_STATUSES,
  createAction,
  listActions,
  updateAction,
} from '@/data/repositories/actions';
import { recordAudit } from '@/data/repositories/audit';
import { assertOrgUnitInScope, resolveScope } from '@/auth/server';
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
export const POST = withUser(async (user, request) => {
  const body = createSchema.parse(await request.json());
  if (body.orgUnitId) await assertOrgUnitInScope(user, body.orgUnitId);

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
