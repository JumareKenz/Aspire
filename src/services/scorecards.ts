import type { OrgUnit, Period } from '@/core/model/types';
import type { Scorecard } from '@/core/scoring/types';
import { buildScorecard } from '@/core/scoring/engine';
import { computeDataConfidence } from '@/core/quality/confidence';
import { listDomains, getActiveMethodology, listIndicators } from '@/data/repositories/registry';
import { getOrgUnit, listChildren, listDescendants } from '@/data/repositories/orgUnits';
import {
  getEffectiveTargets,
  getReporting,
  getSeries,
  getSeriesForUnits,
} from '@/data/repositories/observations';
import { listFindings } from '@/data/repositories/findings';
import { periodRange } from '@/core/model/periods';
import { HISTORY_PERIODS, latestCompletePeriodId } from '@/data/sync/periods';

export interface ScorecardOptions {
  /** Number of historical periods to include in the trend window. */
  history?: number;
}

/** The reporting units beneath an org unit, used for completeness and timeliness. */
async function reportingUnitIds(orgUnit: OrgUnit): Promise<string[]> {
  if (orgUnit.level === 'FACILITY') return [orgUnit.id];
  const facilities = await listDescendants(orgUnit.id, 'FACILITY');
  return facilities.length > 0 ? facilities.map((unit) => unit.id) : [orgUnit.id];
}

/**
 * Builds a scorecard for one org unit and period, including its data-confidence
 * assessment. Data confidence is computed from the reporting and quality
 * evidence for the same scope, never from the performance figures themselves.
 */
export async function getScorecard(
  orgUnitId: string,
  periodId: string,
  options: ScorecardOptions = {},
): Promise<Scorecard | null> {
  const orgUnit = await getOrgUnit(orgUnitId);
  if (!orgUnit) return null;

  const [methodology, indicators, domains] = await Promise.all([
    getActiveMethodology(),
    listIndicators(),
    listDomains(),
  ]);
  const periods = periodRange(periodId, options.history ?? HISTORY_PERIODS);

  const [series, targets, confidence] = await Promise.all([
    getSeries(
      orgUnitId,
      periods,
      indicators.map((indicator) => indicator.id),
    ),
    getEffectiveTargets(orgUnitId, periodId),
    getDataConfidenceFor(orgUnit, periodId, indicators.length),
  ]);

  return buildScorecard({
    orgUnit: { id: orgUnit.id, name: orgUnit.name, level: orgUnit.level },
    periods,
    methodology,
    domains,
    indicators,
    series,
    targets,
    dataConfidence: confidence,
  });
}

export async function getDataConfidenceFor(
  orgUnit: OrgUnit,
  periodId: string,
  indicatorCount: number,
) {
  const units = await reportingUnitIds(orgUnit);
  const [reporting, findings] = await Promise.all([
    getReporting(units, [periodId]),
    listFindings({
      orgUnitIds: [orgUnit.id, ...units],
      periodIds: [periodId],
      status: 'OPEN',
    }),
  ]);
  return computeDataConfidence({
    reporting,
    findings,
    checkedValues: Math.max(1, indicatorCount * units.length),
  });
}

/**
 * Scorecards for every child of an org unit, computed in one pass.
 *
 * Series for all children are loaded with a single query rather than one query
 * per child, which is what keeps a 14-LGA state view fast.
 */
export async function getChildScorecards(
  parentId: string,
  periodId: string,
  options: ScorecardOptions = {},
): Promise<Scorecard[]> {
  const children = await listChildren(parentId);
  if (children.length === 0) return [];

  const [methodology, indicators, domains] = await Promise.all([
    getActiveMethodology(),
    listIndicators(),
    listDomains(),
  ]);
  const periods = periodRange(periodId, options.history ?? HISTORY_PERIODS);
  const indicatorIds = indicators.map((indicator) => indicator.id);
  const seriesByUnit = await getSeriesForUnits(
    children.map((child) => child.id),
    periods,
    indicatorIds,
  );

  // Targets and confidence are resolved for every child in parallel: a state
  // view is a dozen LGAs, and doing this serially would make the page wait on a
  // dozen sequential round trips.
  const perChild = await Promise.all(
    children.map(async (child) => ({
      child,
      targets: await getEffectiveTargets(child.id, periodId),
      dataConfidence: await getDataConfidenceFor(child, periodId, indicators.length),
    })),
  );

  return perChild.map(({ child, targets, dataConfidence }) =>
    buildScorecard({
      orgUnit: { id: child.id, name: child.name, level: child.level },
      periods,
      methodology,
      domains,
      indicators,
      series: seriesByUnit.get(child.id) ?? {},
      targets,
      dataConfidence,
    }),
  );
}

/** The default reporting period: the most recent quarter that has fully elapsed. */
export function defaultPeriodId(): string {
  return latestCompletePeriodId();
}

export function analysisWindow(periodId: string, history = HISTORY_PERIODS): Period[] {
  return periodRange(periodId, history);
}
