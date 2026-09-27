import { z } from 'zod';
import { runOutlierCheck } from '@/services/validation';
import { recordAudit } from '@/data/repositories/audit';
import { ok, withUser } from '@/lib/api';

export const maxDuration = 150;

const schema = z.object({
  dataElements: z.array(z.string()).min(1).max(20),
  orgUnit: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  algorithm: z.enum(['Z_SCORE', 'MOD_Z_SCORE', 'MIN_MAX']),
  threshold: z.number().positive().max(10).nullable(),
});

/** DHIS2 outlier detection over facility-level values. */
export const POST = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const result = await runOutlierCheck(user, body);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.outlier_check',
    target: body.orgUnit,
    detail: `${body.dataElements.length} data elements, ${body.startDate} to ${body.endDate}, ${body.algorithm}: ${result.rows.length} outliers`,
  });
  return ok(result);
}, 'admin.view');
