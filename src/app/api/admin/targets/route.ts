import { z } from 'zod';
import { listIndicatorTargets, removeIndicatorTarget, saveIndicatorTarget } from '@/services/targetAdmin';
import { ApiError, ok, query, withUser } from '@/lib/api';

const key = z.object({
  indicatorId: z.string().min(1),
  /** Null for every area. */
  orgUnitId: z.string().min(1).nullable(),
  /** A period id ("2025Q4", "202512"), a period type ("MONTHLY"), or null for every period. */
  periodId: z.string().nullable(),
});

export const GET = withUser(async (user, request) => {
  const indicatorId = query(request).get('indicator');
  if (!indicatorId) throw new ApiError('indicator is required.', 400);
  return ok(await listIndicatorTargets(user, indicatorId), { headers: { 'Cache-Control': 'private, no-store' } });
}, 'admin.view');

export const PUT = withUser(async (user, request) => {
  const body = key.extend({ value: z.number() }).parse(await request.json());
  return ok(await saveIndicatorTarget(user, body));
}, 'admin.manage');

export const DELETE = withUser(async (user, request) => {
  const body = key.parse(await request.json());
  return ok(await removeIndicatorTarget(user, body));
}, 'admin.manage');
