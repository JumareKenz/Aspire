import { recordAudit } from '@/data/repositories/audit';
import { ok, withUser } from '@/lib/api';
import { getFacilityScorecard, runValidationBatch } from '@/services/validationScorecard';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/** The facility validation scorecard for an area (`?ou=`), or the user's own area. */
export const GET = withUser(async (user, request) => {
  const orgUnit = new URL(request.url).searchParams.get('ou');
  return ok(await getFacilityScorecard(user, orgUnit));
}, 'admin.view');

/**
 * Checks outstanding facility-months for a short while and reports progress;
 * the page calls it repeatedly until nothing is left.
 */
export const POST = withUser(async (user) => {
  const result = await runValidationBatch({ budgetMs: 40_000 });
  if (result.remaining === 0 && result.done > 0) {
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'admin.validation_scorecard',
      detail: `Facility validation complete: ${result.checked.toLocaleString('en-GB')} facility-months checked`,
    });
  }
  return ok(result);
}, 'admin.sync');
