import { runSync } from '@/data/sync/orchestrator';
import { recordAudit } from '@/data/repositories/audit';
import { ok, withUser } from '@/lib/api';

/**
 * Runs a synchronisation on demand.
 *
 * Kept synchronous: the analysis window is small enough to complete inside a
 * request, and a job queue for one operation an administrator triggers by hand
 * would be infrastructure without a purpose.
 */
export const POST = withUser(async (user) => {
  const result = await runSync();
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.sync',
    detail: `${result.ok ? 'Succeeded' : 'Failed'}: ${result.message}`,
  });
  return ok(result, { status: result.ok ? 200 : 502 });
}, 'admin.sync');
