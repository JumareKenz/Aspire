import type { IndicatorDefinition } from '@/core/registry/types';
import type { QualityFinding } from '@/core/quality/types';
import type { Trend } from '@/core/scoring/types';
import { computeTrend } from '@/core/analytics/trend';
import { achievement, applyScoringRule, statusForScore } from '@/core/scoring/engine';
import { forecast, type ForecastResult } from '@/core/forecast/engine';
import { futurePeriods, periodRange } from '@/core/model/periods';
import { round } from '@/core/analytics/stats';
import { getActiveMethodology, listReportingIndicators } from '@/data/repositories/registry';
import { getBreakdown, getSeries, getSeriesForUnits } from '@/data/repositories/observations';
import type { TargetScope } from '@/core/targets/resolve';
import { resolveTargetsFor } from './targets';
import { getOrgUnit, listChildren } from '@/data/repositories/orgUnits';
import { listFindings } from '@/data/repositories/findings';
import { HISTORY_PERIODS } from '@/data/sync/periods';

export interface ContributingUnit {
  orgUnitId: string;
  orgUnitName: string;
  value: number | null;
  changePct: number | null;
  trend: Trend;
  hasChildren: boolean;
}

export interface IndicatorDetail {
  indicator: IndicatorDefinition;
  orgUnitId: string;
  orgUnitName: string;
  periodId: string;
  periodLabel: string;
  labels: string[];
  values: Array<number | null>;
  value: number | null;
  /** Null when no target applies to this area and period. */
  target: number | null;
  targetScope: TargetScope | null;
  /** Why there is no target, when there is none. */
  targetMissingReason: string | null;
  achievementPct: number | null;
  score: number | null;
  status: ReturnType<typeof statusForScore>;
  trend: Trend;
  forecast: ForecastResult;
  /** Children ranked by how far they moved, worst first. */
  contributors: ContributingUnit[];
  findings: QualityFinding[];
  /** The indicator's count split by one category, for this unit and period. */
  breakdown: {
    label: string;
    counts: string;
    rows: Array<{ option: string; value: number; share: number }>;
  } | null;
}

/**
 * Everything needed to explain one indicator in one geography.
 *
 * This is the payload behind "why is this indicator moving?": the series it was
 * measured from, the units underneath that moved most, the quality findings
 * that touch it, and a forecast only where the history supports one.
 */
export async function getIndicatorDetail(
  orgUnitId: string,
  indicatorId: string,
  periodId: string,
): Promise<IndicatorDetail | null> {
  // Only indicators in the reporting workflow can be opened: an unverified
  // indicator is not reachable by id any more than it is on a scorecard.
  const [reporting, orgUnit] = await Promise.all([listReportingIndicators(), getOrgUnit(orgUnitId)]);
  const indicator = reporting.find((entry) => entry.id === indicatorId) ?? null;
  if (!indicator || !orgUnit) return null;

  const methodology = await getActiveMethodology();
  const periods = periodRange(periodId, HISTORY_PERIODS);
  const [seriesByIndicator, targets] = await Promise.all([
    getSeries(orgUnitId, periods, [indicatorId]),
    resolveTargetsFor([indicator], [orgUnitId], periodId).then((byUnit) => byUnit.get(orgUnitId)!),
  ]);
  const series = seriesByIndicator[indicatorId] ?? [];
  const target = targets.values[indicatorId];
  const value = series[series.length - 1] ?? null;
  const lowerIsBetter = indicator.directionality === 'LOWER_IS_BETTER';

  const trend = computeTrend(series, {
    minPeriods: methodology.minPeriodsForTrend,
    lowerIsBetter,
  });

  const children = await listChildren(orgUnitId);
  const childSeries = await getSeriesForUnits(
    children.map((child) => child.id),
    periods,
    [indicatorId],
  );

  const contributors: ContributingUnit[] = children
    .map((child) => {
      const values = childSeries.get(child.id)?.[indicatorId] ?? [];
      const latest = values[values.length - 1] ?? null;
      const prior = values[values.length - 2] ?? null;
      const changePct =
        latest === null || prior === null || Math.abs(prior) < 1e-9
          ? null
          : round(((latest - prior) / Math.abs(prior)) * 100, 1);
      return {
        orgUnitId: child.id,
        orgUnitName: child.name,
        value: latest === null ? null : round(latest, 1),
        changePct,
        trend: computeTrend(values, { minPeriods: methodology.minPeriodsForTrend, lowerIsBetter }),
        hasChildren: child.level !== 'FACILITY',
      };
    })
    // Worst movement first: the question this list answers is "who is dragging
    // this down?", so the ordering has to be by change, not by level.
    .sort((a, b) => {
      const aChange = a.changePct ?? 0;
      const bChange = b.changePct ?? 0;
      return lowerIsBetter ? bChange - aChange : aChange - bChange;
    });

  const horizon = futurePeriods(periodId, 3).map((period) => period.id);
  const drivers = contributors
    .filter((entry) => entry.trend.direction === 'DECLINING')
    .slice(0, 3)
    .map((entry) => `Sustained decline in ${entry.orgUnitName}`);

  return {
    indicator,
    orgUnitId,
    orgUnitName: orgUnit.name,
    periodId,
    periodLabel: periods[periods.length - 1].label,
    labels: periods.map((period) => period.label),
    values: series,
    value: value === null ? null : round(value, 1),
    target,
    targetScope: targets.scopes[indicatorId],
    targetMissingReason: targets.missing[indicatorId],
    achievementPct: achievement(value, target, indicator.directionality),
    score: applyScoringRule(value, target, indicator.scoring, indicator.directionality),
    status: statusForScore(
      applyScoringRule(value, target, indicator.scoring, indicator.directionality),
      methodology.statusBands,
    ),
    trend,
    forecast: forecast({
      values: series,
      horizonPeriodIds: horizon,
      target,
      directionality: indicator.directionality,
      drivers,
    }),
    contributors,
    findings: (
      await listFindings({
        orgUnitIds: [orgUnitId, ...children.map((child) => child.id)],
        status: 'OPEN',
      })
    ).filter((finding) => finding.indicatorId === indicatorId),
    breakdown: await breakdownFor(indicator, orgUnitId, periodId),
  };
}

/** The breakdown rows as shares of their total, largest first; null when there are none. */
async function breakdownFor(
  indicator: IndicatorDefinition,
  orgUnitId: string,
  periodId: string,
): Promise<IndicatorDetail['breakdown']> {
  const spec = indicator.source.breakdown;
  if (!spec) return null;
  const rows = (await getBreakdown(indicator.id, orgUnitId, periodId))
    .filter((row) => row.key.startsWith(`${spec.label}:`))
    .map((row) => ({ option: row.key.slice(spec.label.length + 1), value: row.value }));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (rows.length === 0 || total <= 0) return null;
  return {
    label: spec.label,
    counts: spec.counts,
    rows: rows
      .map((row) => ({ ...row, share: round((row.value / total) * 100, 1) }))
      .sort((a, b) => b.value - a.value),
  };
}
