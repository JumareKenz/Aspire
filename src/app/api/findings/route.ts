import { z } from 'zod';
import { setFindingStatus } from '@/data/repositories/findings';
import { recordAudit } from '@/data/repositories/audit';
import { ApiError, ok, withUser } from '@/lib/api';

const schema = z.object({
  id: z.string().min(1),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED']),
});

/**
 * Triage of a data-quality finding. Status changes survive the next
 * synchronisation, so acknowledging a known issue is not undone by a re-scan.
 */
export const PATCH = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const updated = await setFindingStatus(body.id, body.status);
  if (!updated) throw new ApiError('That finding no longer exists.', 404);

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'quality.triage',
    target: body.id,
    detail: `Status set to ${body.status}.`,
  });
  return ok({ id: body.id, status: body.status });
}, 'quality.triage');
