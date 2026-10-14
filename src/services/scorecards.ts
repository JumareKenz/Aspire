import type { OrgUnit, Period } from '@/core/model/types';
import type { Scorecard } from '@/core/scoring/types';
import { buildScorecard } from '@/core/scoring/engine';
import { computeDataConfidence } from '@/core/quality/confidence';
import { listDomains, getActiveMethodology, listReportingIndicators } from '@/data/repositories/registry';
import { getOrgUnit, listChildren, listDescendants } from '@/data/repositories/orgUnits';
import { getReporting, getSeries, getSeriesForUnits } from '@/data/repositories/observations';
import { resolveTargetsFor } from './targets';
import { listFindings } from '@/data/repositories/findings';
import { periodRange } from '@/core/model/periods';
import { HISTORY_PERIODS, analysisPeriods, latestCompletePeriodId } from '@/data/sync/periods';
import { getLatestDataPeriod } from '@/data/repositories/settings';
import { env } from '@/lib/env';

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
    listReportingIndicators(),
    listDomains(),
  ]);
  const periods = periodRange(periodId, options.history ?? HISTORY_PERIODS);

  const [series, targets, confidence] = await Promise.all([
    getSeries(
      orgUnitId,
      periods,
      indicators.map((indicator) => indicator.id),
    ),
    resolveTargetsFor(indicators, [orgUnitId], periodId).then((byUnit) => byUnit.get(orgUnitId)!),
    getDataConfidenceFor(orgUnit, periodId, indicators.length),
  ]);

  return buildScorecard({
    orgUnit: { id: orgUnit.id, name: orgUnit.name, level: orgUnit.level },
    periods,
    methodology,
    domains,
    indicators,
    series,
    targets: targets.values,
    targetScopes: targets.scopes,
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
    listReportingIndicators(),
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
  const targetsByChild = await resolveTargetsFor(
    indicators,
    children.map((child) => child.id),
    periodId,
  );
  const perChild = await Promise.all(
    children.map(async (child) => ({
      child,
      targets: targetsByChild.get(child.id)!,
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
      targets: targets.values,
      targetScopes: targets.scopes,
      dataConfidence,
    }),
  );
}

/**
 * The period pages open on when none is chosen.
 *
 * `ASPIRE_DEFAULT_PERIOD` pins it (e.g. to the last quarter reported in full).
 * Otherwise it is the latest quarter the top of the hierarchy has data for, as
 * recorded by the last sync: a source that lags the calendar, as the DHIS2
 * staging server does, would otherwise open every page on an empty quarter.
 * Either value is used only when it falls inside the analysis window; failing
 * both, it is the most recent quarter that has fully elapsed.
 */
export async function defaultPeriodId(): Promise<string> {
  const window = new Set(analysisPeriods().map((period) => period.id));
  const pinned = env('ASPIRE_DEFAULT_PERIOD');
  if (pinned && window.has(pinned)) return pinned;
  const latest = await getLatestDataPeriod();
  if (latest && window.has(latest)) return latest;
  return latestCompletePeriodId();
}

export function analysisWindow(periodId: string, history = HISTORY_PERIODS): Period[] {
  return periodRange(periodId, history);
}
