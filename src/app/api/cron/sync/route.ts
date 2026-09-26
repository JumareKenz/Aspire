import { timingSafeEqual } from 'node:crypto';
import { ensureBootstrapped } from '@/data/bootstrap';
import { recordAudit } from '@/data/repositories/audit';
import { runSync } from '@/data/sync/orchestrator';
import { fail, ok } from '@/lib/api';
import { env } from '@/lib/env';

/** A full sync runs inside this one request; see the adapter's concurrency note. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduled synchronisation, called by Vercel Cron (see vercel.json).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when that variable is
 * set, and nothing else can: the route refuses every request without it, and
 * stays off entirely until the secret is configured.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = env('CRON_SECRET');
  if (!secret) return fail('Scheduled synchronisation is not configured.', 503, 'not_configured');
  if (!matches(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return fail('Not authorised.', 401, 'unauthenticated');
  }

  await ensureBootstrapped();
  const result = await runSync();
  await recordAudit({
    action: 'system.scheduled_sync',
    detail: `${result.ok ? 'Succeeded' : 'Failed'}: ${result.message}`,
  });
  return ok(result, { status: result.ok ? 200 : 502 });
}
