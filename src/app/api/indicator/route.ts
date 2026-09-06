import { assertOrgUnitInScope } from '@/auth/server';
import { getIndicatorDetail } from '@/services/indicators';
import { ApiError, ok, query, withUser } from '@/lib/api';

/**
 * Indicator detail for the drill-down panel.
 *
 * Fetched on demand rather than embedded in every page render: a scorecard has
 * fifteen indicators and only the one a user opens needs its full history,
 * contributor breakdown and forecast.
 */
export const GET = withUser(async (user, request) => {
  const params = query(request);
  const orgUnitId = params.get('orgUnit');
  const indicatorId = params.get('indicator');
  const periodId = params.get('period');
  if (!orgUnitId || !indicatorId || !periodId) {
    throw new ApiError('orgUnit, indicator and period are all required.', 400);
  }
  await assertOrgUnitInScope(user, orgUnitId);

  const detail = await getIndicatorDetail(orgUnitId, indicatorId, periodId);
  if (!detail) throw new ApiError('That indicator is not configured, or the geography is unknown.', 404);
  return ok(detail);
}, 'intelligence.view');
