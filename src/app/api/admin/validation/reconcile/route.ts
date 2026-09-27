import { getLastReconciliation, runReconciliation, saveReconciliation } from '@/services/reconciliation';
import { recordAudit } from '@/data/repositories/audit';
import { ok, withUser } from '@/lib/api';

export const maxDuration = 120;

export const GET = withUser(async () => ok(await getLastReconciliation()), 'admin.view');

/** Compares ASPIRE's stored figures with DHIS2's own, and keeps the result as the latest. */
export const POST = withUser(async (user) => {
  const result = await runReconciliation();
  await saveReconciliation(result);
  const { summary } = result;
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.reconciliation',
    detail: `${summary.matched} of ${summary.compared} values identical to DHIS2; ${summary.mismatched} different, ${summary.onlyDhis2 + summary.onlyAspire} on one side only`,
  });
  return ok(result);
}, 'admin.sync');
