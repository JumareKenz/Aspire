import { timingSafeEqual } from 'node:crypto';
import { fail } from '@/lib/api';
import { env } from '@/lib/env';

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Guards a route called by Vercel Cron (see vercel.json).
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` when that variable is
 * set, and nothing else can: every request without it is refused, and the
 * route stays off entirely until the secret is configured. Returns the refusal,
 * or null when the request may proceed.
 */
export function refuseUnlessCron(request: Request): Response | null {
  const secret = env('CRON_SECRET');
  if (!secret) return fail('Scheduled jobs are not configured.', 503, 'not_configured');
  if (!matches(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return fail('Not authorised.', 401, 'unauthenticated');
  }
  return null;
}
