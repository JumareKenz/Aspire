import type { PeriodType } from '../model/types';
import type { IndicatorDefinition } from '../registry/types';

/**
 * Target resolution.
 *
 * A target row names an indicator and, optionally, an org unit and a period.
 * The period may be a concrete period ("2025Q4", "202512"), a period type
 * ("QUARTERLY", "MONTHLY" — every period of that type), or absent (every
 * period). The most specific row that applies wins: an area beats no area, and
 * an exact period beats a period type, which beats any period.
 *
 * Two rules keep a target from being applied where it does not mean anything:
 *
 *  - **Counts are not shared across areas.** A count target such as "1,200 new
 *    family planning acceptors" describes one population. Applying it equally
 *    to the federal tier, a state and a single facility — what a programme-wide
 *    default did before — assumes a parent's target can be copied to its
 *    children. So a count is only scored against a target set for that area.
 *  - **Counts are not shared across period lengths.** A quarterly count target
 *    is not a monthly one, and dividing it by three would invent a methodology.
 *    A count target applies only to periods of its own type; an untyped default
 *    is read as belonging to the indicator's reporting frequency.
 *
 * Rates and percentages are independent of the area's size and the period's
 * length, so their defaults apply everywhere.
 *
 * Where no target applies the result is null — never a guess — and the
 * indicator is shown with its value but without an achievement figure.
 */
export interface TargetRow {
  indicatorId: string;
  /** Null applies to every area. */
  orgUnitId: string | null;
  /** A period id, a period type, or null for every period. */
  periodId: string | null;
  value: number;
}

export type TargetScope =
  | 'AREA_PERIOD'
  | 'AREA_PERIOD_TYPE'
  | 'AREA'
  | 'PERIOD'
  | 'PERIOD_TYPE'
  | 'DEFAULT';

export interface ResolvedTarget {
  value: number | null;
  /** Which kind of row supplied it. Null when no target applies. */
  scope: TargetScope | null;
  /** Why no target applies, in words. Null when one does. */
  missingReason: string | null;
}

export const PERIOD_TYPE_KEYS: PeriodType[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];

export function isPeriodTypeKey(value: string | null): value is PeriodType {
  return value !== null && (PERIOD_TYPE_KEYS as string[]).includes(value);
}

/** Counts scale with the size of the area and the length of the period; rates do not. */
export function isExtensive(indicator: Pick<IndicatorDefinition, 'unit'>): boolean {
  return indicator.unit === 'COUNT';
}

const SCOPE_BY_SPECIFICITY: Record<number, TargetScope> = {
  0: 'DEFAULT',
  1: 'PERIOD_TYPE',
  2: 'PERIOD',
  4: 'AREA',
  5: 'AREA_PERIOD_TYPE',
  6: 'AREA_PERIOD',
};

export function resolveTarget(
  indicator: Pick<IndicatorDefinition, 'id' | 'unit' | 'frequency'>,
  rows: TargetRow[],
  orgUnitId: string,
  period: { id: string; type: PeriodType },
): ResolvedTarget {
  const extensive = isExtensive(indicator);
  let best: { row: TargetRow; specificity: number } | null = null;

  for (const row of rows) {
    if (row.indicatorId !== indicator.id || !Number.isFinite(row.value)) continue;
    if (row.orgUnitId !== null && row.orgUnitId !== orgUnitId) continue;

    let periodScore: number;
    if (row.periodId === null) {
      if (extensive && period.type !== indicator.frequency) continue;
      periodScore = 0;
    } else if (row.periodId === period.id) {
      periodScore = 2;
    } else if (row.periodId === period.type) {
      periodScore = 1;
    } else {
      continue;
    }
    if (extensive && row.orgUnitId === null) continue;

    const specificity = (row.orgUnitId === null ? 0 : 4) + periodScore;
    if (!best || specificity > best.specificity) best = { row, specificity };
  }

  if (best) {
    return { value: best.row.value, scope: SCOPE_BY_SPECIFICITY[best.specificity], missingReason: null };
  }
  return {
    value: null,
    scope: null,
    missingReason: extensive
      ? `No ${period.type.toLowerCase()} target is set for this area. Count targets are set per area and period type, because a count target for one population does not carry to another.`
      : 'No target is set.',
  };
}

/**
 * Whether a proposed target value makes sense for the indicator. Returns the
 * reason it does not, or null when it is acceptable.
 */
export function validateTargetValue(
  indicator: Pick<IndicatorDefinition, 'unit' | 'directionality' | 'scoring'>,
  value: unknown,
): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Enter a number.';
  if (value < 0) return 'A target cannot be negative.';
  if (indicator.unit === 'PERCENT' && value > 100) return 'A percentage target cannot exceed 100.';
  if (indicator.unit === 'COUNT' && !Number.isInteger(value)) return 'A count target must be a whole number.';
  if (
    indicator.scoring.kind === 'TARGET_RATIO' &&
    indicator.directionality === 'HIGHER_IS_BETTER' &&
    value === 0
  ) {
    return 'A target of zero cannot be scored against: achievement would be undefined.';
  }
  return null;
}

/** The label a target scope reads as in the interface. */
export const TARGET_SCOPE_LABEL: Record<TargetScope, string> = {
  AREA_PERIOD: 'Set for this area and period',
  AREA_PERIOD_TYPE: 'Set for this area',
  AREA: 'Set for this area',
  PERIOD: 'Programme target for this period',
  PERIOD_TYPE: 'Programme default',
  DEFAULT: 'Programme default',
};
