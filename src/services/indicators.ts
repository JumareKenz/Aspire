import type { IndicatorDefinition } from '@/core/registry/types';
import type { QualityFinding } from '@/core/quality/types';
import type { Trend } from '@/core/scoring/types';
import { computeTrend } from '@/core/analytics/trend';
import { achievement, applyScoringRule, statusForScore } from '@/core/scoring/engine';
import { forecast, type ForecastResult } from '@/core/forecast/engine';
import { futurePeriods, periodRange } from '@/core/model/periods';
import { round } from '@/core/analytics/stats';
import { getActiveMethodology, getIndicator } from '@/data/repositories/registry';
import { getEffectiveTargets, getSeries, getSeriesForUnits } from '@/data/repositories/observations';
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
  target: number;
  achievementPct: number | null;
  score: number | null;
  status: ReturnType<typeof statusForScore>;
  trend: Trend;
  forecast: ForecastResult;
  /** Children ranked by how far they moved, worst first. */
  contributors: ContributingUnit[];
  findings: QualityFinding[];
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
  const [indicator, orgUnit] = await Promise.all([getIndicator(indicatorId), getOrgUnit(orgUnitId)]);
  if (!indicator || !orgUnit) return null;

  const methodology = await getActiveMethodology();
  const periods = periodRange(periodId, HISTORY_PERIODS);
  const [seriesByIndicator, targets] = await Promise.all([
    getSeries(orgUnitId, periods, [indicatorId]),
    getEffectiveTargets(orgUnitId, periodId),
  ]);
  const series = seriesByIndicator[indicatorId] ?? [];
  const target = targets[indicatorId] ?? indicator.defaultTarget;
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
  };
}
