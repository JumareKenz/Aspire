import { parsePeriod } from '@/core/model/periods';
import { isExtensive, isPeriodTypeKey, validateTargetValue, type TargetRow } from '@/core/targets/resolve';
import type { IndicatorDefinition } from '@/core/registry/types';
import { isInScope } from '@/auth/rbac';
import { assertOrgUnitInScope } from '@/auth/server';
import type { User } from '@/data/repositories/users';
import { listReportingIndicators, saveIndicator } from '@/data/repositories/registry';
import { deleteTarget, listTargets, setTarget } from '@/data/repositories/targets';
import { getOrgUnit } from '@/data/repositories/orgUnits';
import { recordAudit } from '@/data/repositories/audit';
import { ApiError } from '@/lib/api';

/**
 * Target administration.
 *
 * Targets are set only for indicators in the reporting workflow (verified
 * NHMIS indicators), only for areas inside the administrator's own scope, and
 * only with values that make sense for the indicator. Every change is
 * audited with the value it replaced. A target for one period never touches
 * another period's, so setting next quarter's target cannot re-score history.
 */
export interface TargetListing {
  indicator: Pick<IndicatorDefinition, 'id' | 'name' | 'unit' | 'frequency' | 'defaultTarget' | 'directionality'>;
  rows: Array<TargetRow & { orgUnitName: string | null; periodLabel: string }>;
}

async function reportableIndicator(id: string): Promise<IndicatorDefinition> {
  const indicator = (await listReportingIndicators()).find((entry) => entry.id === id);
  if (!indicator) {
    throw new ApiError('Targets can only be set for indicators in the reporting workflow (verified NHMIS indicators).', 404);
  }
  return indicator;
}

function periodLabel(periodId: string | null): string {
  if (periodId === null) return 'Every period';
  if (isPeriodTypeKey(periodId)) return `Every ${periodId === 'MONTHLY' ? 'month' : periodId === 'QUARTERLY' ? 'quarter' : 'year'}`;
  return parsePeriod(periodId).label;
}

/** Normalises a period selector: a period id, a period type, or null. Throws on anything else. */
function normalisePeriod(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (isPeriodTypeKey(value)) return value;
  try {
    const period = parsePeriod(value);
    if (period.type === 'YEARLY') throw new Error('yearly');
    return period.id;
  } catch {
    throw new ApiError('Choose a month, a quarter, a period type or every period.', 422);
  }
}

export async function listIndicatorTargets(user: User, indicatorId: string): Promise<TargetListing> {
  const indicator = await reportableIndicator(indicatorId);
  const rows = await listTargets(indicatorId);
  const visible: TargetListing['rows'] = [];
  for (const row of rows) {
    if (row.orgUnitId === null) {
      visible.push({ ...row, orgUnitName: null, periodLabel: periodLabel(row.periodId) });
      continue;
    }
    const unit = await getOrgUnit(row.orgUnitId);
    // Another state's targets are not listed for a state administrator.
    if (!unit || !isInScope(user.scope, unit.path)) continue;
    visible.push({ ...row, orgUnitName: unit.name, periodLabel: periodLabel(row.periodId) });
  }
  return {
    indicator: {
      id: indicator.id,
      name: indicator.name,
      unit: indicator.unit,
      frequency: indicator.frequency,
      defaultTarget: indicator.defaultTarget,
      directionality: indicator.directionality,
    },
    rows: visible,
  };
}

async function checkKey(
  user: User,
  indicator: IndicatorDefinition,
  orgUnitId: string | null,
): Promise<string> {
  if (orgUnitId === null) {
    if (user.scope.length > 0) {
      throw new ApiError('Programme-wide targets can only be set by an administrator with programme-wide access.', 403);
    }
    if (isExtensive(indicator)) {
      throw new ApiError(
        'Count targets are set for a specific area: a count for one population does not apply to another.',
        422,
      );
    }
    return 'programme-wide';
  }
  const unit = await assertOrgUnitInScope(user, orgUnitId);
  return unit.name;
}

export async function saveIndicatorTarget(
  user: User,
  input: { indicatorId: string; orgUnitId: string | null; periodId: string | null; value: number },
): Promise<TargetListing> {
  const indicator = await reportableIndicator(input.indicatorId);
  const problem = validateTargetValue(indicator, input.value);
  if (problem) throw new ApiError(problem, 422);
  const periodId = normalisePeriod(input.periodId);
  const area = await checkKey(user, indicator, input.orgUnitId);

  const previous = await setTarget({ indicatorId: indicator.id, orgUnitId: input.orgUnitId, periodId, value: input.value });
  // The programme default also lives on the indicator record, which seeds it
  // at every sync; the two are kept in step.
  if (input.orgUnitId === null && periodId === null && indicator.defaultTarget !== input.value) {
    await saveIndicator({ ...indicator, defaultTarget: input.value });
  }
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.target_set',
    target: `${indicator.id}:${input.orgUnitId ?? '*'}:${periodId ?? '*'}`,
    detail: `${indicator.name}, ${area}, ${periodLabel(periodId)}: ${previous ?? 'none'} → ${input.value}`,
  });
  return listIndicatorTargets(user, indicator.id);
}

export async function removeIndicatorTarget(
  user: User,
  input: { indicatorId: string; orgUnitId: string | null; periodId: string | null },
): Promise<TargetListing> {
  const indicator = await reportableIndicator(input.indicatorId);
  const periodId = normalisePeriod(input.periodId);
  if (input.orgUnitId === null && periodId === null) {
    throw new ApiError('The programme default cannot be removed; change its value instead.', 422);
  }
  const area = input.orgUnitId === null ? (await checkKey(user, indicator, null)) : await checkKey(user, indicator, input.orgUnitId);
  const removed = await deleteTarget({ indicatorId: indicator.id, orgUnitId: input.orgUnitId, periodId });
  if (!removed) throw new ApiError('That target does not exist.', 404);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'admin.target_removed',
    target: `${indicator.id}:${input.orgUnitId ?? '*'}:${periodId ?? '*'}`,
    detail: `${indicator.name}, ${area}, ${periodLabel(periodId)}`,
  });
  return listIndicatorTargets(user, indicator.id);
}
