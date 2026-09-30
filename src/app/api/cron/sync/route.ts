import { ensureBootstrapped } from '@/data/bootstrap';
import { recordAudit } from '@/data/repositories/audit';
import { runSync } from '@/data/sync/orchestrator';
import { ok } from '@/lib/api';
import { refuseUnlessCron } from '@/lib/cron';

/** A full sync runs inside this one request; see the adapter's concurrency note. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Scheduled synchronisation, called by Vercel Cron (see vercel.json). */
export async function GET(request: Request): Promise<Response> {
  const refusal = refuseUnlessCron(request);
  if (refusal) return refusal;

  await ensureBootstrapped();
  const result = await runSync();
  await recordAudit({
    action: 'system.scheduled_sync',
    detail: `${result.ok ? 'Succeeded' : 'Failed'}: ${result.message}`,
  });
  return ok(result, { status: result.ok ? 200 : 502 });
}
