import type { IndicatorDefinition } from '@/core/registry/types';
import { parsePeriod } from '@/core/model/periods';
import { resolveTarget, type TargetScope } from '@/core/targets/resolve';
import { getTargetRows } from '@/data/repositories/targets';

export interface ResolvedTargets {
  values: Record<string, number | null>;
  scopes: Record<string, TargetScope | null>;
  missing: Record<string, string | null>;
}

/**
 * The target each indicator is scored against, for each of several areas in
 * one period. One query for all of them; the choice between rows is made by
 * `resolveTarget`, the same rule everywhere a target is shown or used.
 */
export async function resolveTargetsFor(
  indicators: IndicatorDefinition[],
  orgUnitIds: string[],
  periodId: string,
): Promise<Map<string, ResolvedTargets>> {
  const period = parsePeriod(periodId);
  const rows = await getTargetRows(orgUnitIds, period);
  const result = new Map<string, ResolvedTargets>();
  for (const orgUnitId of orgUnitIds) {
    const entry: ResolvedTargets = { values: {}, scopes: {}, missing: {} };
    for (const indicator of indicators) {
      const resolved = resolveTarget(indicator, rows, orgUnitId, period);
      entry.values[indicator.id] = resolved.value;
      entry.scopes[indicator.id] = resolved.scope;
      entry.missing[indicator.id] = resolved.missingReason;
    }
    result.set(orgUnitId, entry);
  }
  return result;
}
