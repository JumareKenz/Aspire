import { ensureBootstrapped } from '@/data/bootstrap';
import { recordAudit } from '@/data/repositories/audit';
import { ok } from '@/lib/api';
import { refuseUnlessCron } from '@/lib/cron';
import { readDhis2Config } from '@/data/sources/dhis2/client';
import { runValidationBatch } from '@/services/validationScorecard';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Nightly top-up of the facility validation scorecard, after the sync: checks
 * whatever facility-months are outstanding or due a re-check, for as long as
 * the request may run. What is left is picked up the following night.
 */
export async function GET(request: Request): Promise<Response> {
  const refusal = refuseUnlessCron(request);
  if (refusal) return refusal;

  await ensureBootstrapped();
  if (!readDhis2Config()) return ok({ skipped: 'No DHIS2 instance is connected.' });
  const result = await runValidationBatch({ budgetMs: 240_000 });
  if (result.done > 0 || result.failed > 0) {
    await recordAudit({
      action: 'system.scheduled_validation',
      detail: `Checked ${result.done} facility-months against DHIS2 validation rules; ${result.remaining} outstanding${result.failed ? `, ${result.failed} unanswered` : ''}`,
    });
  }
  return ok(result);
}
