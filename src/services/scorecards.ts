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
function reportingUnitIds(orgUnit: OrgUnit): string[] {
  if (orgUnit.level === 'FACILITY') return [orgUnit.id];
  const facilities = listDescendants(orgUnit.id, 'FACILITY');
  return facilities.length > 0 ? facilities.map((unit) => unit.id) : [orgUnit.id];
}

/**
 * Builds a scorecard for one org unit and period, including its data-confidence
 * assessment. Data confidence is computed from the reporting and quality
 * evidence for the same scope, never from the performance figures themselves.
 */
export function getScorecard(
  orgUnitId: string,
  periodId: string,
  options: ScorecardOptions = {},
): Scorecard | null {
  const orgUnit = getOrgUnit(orgUnitId);
  if (!orgUnit) return null;

  const methodology = getActiveMethodology();
  const indicators = listIndicators();
  const domains = listDomains();
  const periods = periodRange(periodId, options.history ?? HISTORY_PERIODS);

  const series = getSeries(
    orgUnitId,
    periods,
    indicators.map((indicator) => indicator.id),
  );
  const targets = getEffectiveTargets(orgUnitId, periodId);
  const confidence = getDataConfidenceFor(orgUnit, periodId, indicators.length);

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

export function getDataConfidenceFor(orgUnit: OrgUnit, periodId: string, indicatorCount: number) {
  const units = reportingUnitIds(orgUnit);
  const reporting = getReporting(units, [periodId]);
  const findings = listFindings({
    orgUnitIds: [orgUnit.id, ...units],
    periodIds: [periodId],
    status: 'OPEN',
  });
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
export function getChildScorecards(
  parentId: string,
  periodId: string,
  options: ScorecardOptions = {},
): Scorecard[] {
  const children = listChildren(parentId);
  if (children.length === 0) return [];

  const methodology = getActiveMethodology();
  const indicators = listIndicators();
  const domains = listDomains();
  const periods = periodRange(periodId, options.history ?? HISTORY_PERIODS);
  const indicatorIds = indicators.map((indicator) => indicator.id);
  const seriesByUnit = getSeriesForUnits(
    children.map((child) => child.id),
    periods,
    indicatorIds,
  );

  return children.map((child) =>
    buildScorecard({
      orgUnit: { id: child.id, name: child.name, level: child.level },
      periods,
      methodology,
      domains,
      indicators,
      series: seriesByUnit.get(child.id) ?? {},
      targets: getEffectiveTargets(child.id, periodId),
      dataConfidence: getDataConfidenceFor(child, periodId, indicators.length),
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
