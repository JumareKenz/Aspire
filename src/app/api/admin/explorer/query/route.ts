import { z } from 'zod';
import { runExplorerQuery } from '@/services/explorer';
import { recordAudit } from '@/data/repositories/audit';
import { ok, withUser } from '@/lib/api';

const schema = z.object({
  dx: z.array(z.string()).max(50),
  periods: z.array(z.string()).max(60),
  orgUnits: z.array(z.string()).max(200),
  level: z.enum(['STATE', 'LGA', 'WARD', 'FACILITY']).nullable(),
  category: z.string().nullable(),
});

/** Runs an explorer query against DHIS2 analytics. Audited, like every question asked of the data. */
export const POST = withUser(async (user, request) => {
  const body = schema.parse(await request.json());
  const result = await runExplorerQuery(user, body);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.explorer_query',
    detail: `${body.dx.length} data items × ${body.periods.length} periods × ${body.orgUnits.length} areas${body.level ? ` by ${body.level}` : ''}: ${result.rows.length} values in ${result.durationMs} ms`,
  });
  return ok(result);
}, 'admin.view');
