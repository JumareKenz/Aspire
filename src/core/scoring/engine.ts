import type { DomainDefinition, IndicatorDefinition, ScoringRule } from '../registry/types';
import { clamp, round } from '../analytics/stats';
import { computeTrend } from '../analytics/trend';
import { UNKNOWN_TREND } from '../analytics/trend';
import type {
  DataConfidence,
  DomainScore,
  IndicatorScore,
  PerformanceStatus,
  Scorecard,
  ScorecardMethodology,
} from './types';
import type { OrgLevel } from '../model/types';
import { isMapped } from '../registry/mapping';
import type { TargetScope } from '../targets/resolve';

/**
 * Direction-aware achievement against target, expressed as a percentage.
 * For LOWER_IS_BETTER indicators, achieving a value below target is over-100%.
 */
export function achievement(
  value: number | null,
  target: number | null,
  directionality: IndicatorDefinition['directionality'],
): number | null {
  if (value === null || target === null || !Number.isFinite(value) || !Number.isFinite(target)) return null;
  if (directionality === 'HIGHER_IS_BETTER') {
    if (target <= 0) return null;
    return round(clamp((value / target) * 100, 0, 400), 1);
  }
  if (value <= 0) return target > 0 ? 200 : null;
  if (target <= 0) return null;
  return round(clamp((target / value) * 100, 0, 400), 1);
}

/**
 * Applies a methodology's scoring rule to a raw value, producing 0..100.
 *
 * LINEAR is direction-agnostic by construction: `floor` is the value that
 * scores 0 and `ceiling` the value that scores 100, so a LOWER_IS_BETTER
 * indicator simply configures a ceiling below its floor.
 */
export function applyScoringRule(
  value: number | null,
  target: number | null,
  rule: ScoringRule,
  directionality: IndicatorDefinition['directionality'],
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  switch (rule.kind) {
    case 'TARGET_RATIO': {
      const ach = achievement(value, target, directionality);
      if (ach === null) return null;
      return round(clamp(ach, 0, rule.cap), 1);
    }
    case 'BANDS': {
      const band = rule.bands.find((b) => value <= b.upTo);
      return round(clamp(band ? band.score : rule.above, 0, 100), 1);
    }
    case 'LINEAR': {
      const span = rule.ceiling - rule.floor;
      if (Math.abs(span) < 1e-9) return null;
      return round(clamp(((value - rule.floor) / span) * 100, 0, 100), 1);
    }
    default: {
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

export function statusForScore(
  score: number | null,
  bands: ScorecardMethodology['statusBands'],
): PerformanceStatus {
  if (score === null) return 'NO_DATA';
  if (score >= bands.onTrack) return 'ON_TRACK';
  if (score >= bands.watch) return 'WATCH';
  return 'NEEDS_ATTENTION';
}

export interface ScorecardInput {
  orgUnit: { id: string; name: string; level: OrgLevel };
  /** Period axis, oldest first. The last entry is the reporting period. */
  periods: Array<{ id: string; label: string }>;
  methodology: ScorecardMethodology;
  domains: DomainDefinition[];
  indicators: IndicatorDefinition[];
  /**
   * Value series per indicator id, aligned to `periods` and oldest first.
   * Missing entries are null and are handled by the methodology's rule.
   */
  series: Record<string, Array<number | null>>;
  /**
   * Effective target per indicator for the reporting period. Null means no
   * target applies (see `resolveTarget`): the value is shown, but a rule that
   * needs a target cannot score it. An absent key falls back to the
   * indicator's default, for callers that resolve no targets at all.
   */
  targets: Record<string, number | null>;
  /** Which kind of target row supplied each target, for display. */
  targetScopes?: Record<string, TargetScope | null>;
  dataConfidence: DataConfidence;
}

/** Resolves missing values according to the methodology's missing-data rule. */
function resolveValue(
  series: Array<number | null>,
  index: number,
  methodology: ScorecardMethodology,
): { value: number | null; carried: boolean } {
  const direct = series[index] ?? null;
  if (direct !== null) return { value: direct, carried: false };
  if (methodology.missingData.rule === 'ZERO') return { value: 0, carried: false };
  if (methodology.missingData.rule === 'CARRY') {
    const limit = Math.max(0, index - methodology.missingData.carryMaxPeriods);
    for (let i = index - 1; i >= limit; i -= 1) {
      const candidate = series[i] ?? null;
      if (candidate !== null) return { value: candidate, carried: true };
    }
  }
  return { value: null, carried: false };
}

interface WeightedScore {
  score: number | null;
  coverage: number;
  weight: number;
}

/** Weighted mean over entries that have a score, plus weighted coverage. */
function combine(entries: WeightedScore[], minCoverage: number): { score: number | null; coverage: number } {
  const totalWeight = entries.reduce((acc, e) => acc + e.weight, 0);
  if (totalWeight <= 0) return { score: null, coverage: 0 };
  let scored = 0;
  let weightWithData = 0;
  for (const entry of entries) {
    if (entry.score !== null) {
      scored += entry.score * entry.weight;
      weightWithData += entry.weight;
    }
  }
  const coverage = weightWithData / totalWeight;
  if (coverage < minCoverage || weightWithData <= 0) return { score: null, coverage };
  return { score: round(scored / weightWithData, 1), coverage };
}

/** Scores one period index across every domain. Used for both the reporting
 *  period and each historical period, so trends are computed on like for like. */
function scoreAtIndex(input: ScorecardInput, index: number) {
  const { methodology, domains, indicators, targets } = input;
  const byDomain = new Map<string, IndicatorDefinition[]>();
  for (const indicator of indicators) {
    if (!indicator.active) continue;
    const list = byDomain.get(indicator.domainId) ?? [];
    list.push(indicator);
    byDomain.set(indicator.domainId, list);
  }

  const domainResults = domains
    .filter((domain) => (byDomain.get(domain.id) ?? []).length > 0)
    .map((domain) => {
      const members = byDomain.get(domain.id) ?? [];
      const totalIndicatorWeight = members.reduce(
        (acc, ind) => acc + (methodology.indicatorWeights[ind.id] ?? 1),
        0,
      );
      const indicatorScores = members.map((indicator) => {
        const rawWeight = methodology.indicatorWeights[indicator.id] ?? 1;
        const effectiveWeight = totalIndicatorWeight > 0 ? rawWeight / totalIndicatorWeight : 0;
        const series = input.series[indicator.id] ?? [];
        const { value, carried } = resolveValue(series, index, methodology);
        const target = indicator.id in targets ? targets[indicator.id] : indicator.defaultTarget;
        const score = applyScoringRule(value, target, indicator.scoring, indicator.directionality);
        return { indicator, value, carried, target, score, effectiveWeight, rawWeight };
      });

      const combined = combine(
        indicatorScores.map((i) => ({ score: i.score, coverage: 0, weight: i.rawWeight })),
        methodology.missingData.minCoverage,
      );
      return { domain, indicatorScores, ...combined };
    });

  const overall = combine(
    domainResults.map((d) => ({
      score: d.score,
      coverage: d.coverage,
      weight: methodology.domainWeights[d.domain.id] ?? 1,
    })),
    methodology.missingData.minCoverage,
  );

  return { domainResults, overall };
}

/**
 * Builds a complete scorecard for one org unit and one reporting period,
 * including per-domain and per-indicator trends computed over the supplied
 * period axis. Pure: every input is passed in, nothing is fetched.
 */
export function buildScorecard(input: ScorecardInput): Scorecard {
  const { methodology, periods } = input;
  if (periods.length === 0) {
    throw new Error('buildScorecard requires at least one period');
  }
  const currentIndex = periods.length - 1;
  const current = scoreAtIndex(input, currentIndex);

  // Score every historical index once so domain and overall trends are derived
  // from the same methodology as the headline figure.
  const historical = periods.map((_, index) => scoreAtIndex(input, index));
  const overallSeries = historical.map((h) => h.overall.score);
  const overallTrend = computeTrend(overallSeries, {
    minPeriods: methodology.minPeriodsForTrend,
  });

  const domains: DomainScore[] = current.domainResults.map((result, domainIdx) => {
    const domainSeries = historical.map((h) => h.domainResults[domainIdx]?.score ?? null);
    const indicators: IndicatorScore[] = result.indicatorScores.map((entry) => {
      const series = input.series[entry.indicator.id] ?? [];
      const trend = computeTrend(series, {
        minPeriods: methodology.minPeriodsForTrend,
        lowerIsBetter: entry.indicator.directionality === 'LOWER_IS_BETTER',
      });
      return {
        indicatorId: entry.indicator.id,
        name: entry.indicator.name,
        domainId: entry.indicator.domainId,
        value: entry.value === null ? null : round(entry.value, 1),
        target: entry.target,
        achievementPct: achievement(entry.value, entry.target, entry.indicator.directionality),
        score: entry.score,
        status: statusForScore(entry.score, methodology.statusBands),
        trend,
        effectiveWeight: round(entry.effectiveWeight, 4),
        carriedForward: entry.carried,
        unit: entry.indicator.unit,
        directionality: entry.indicator.directionality,
        mapped: isMapped(entry.indicator),
        targetProvisional: !entry.indicator.targetOfficial,
        targetScope:
          entry.target === null ? null : (input.targetScopes?.[entry.indicator.id] ?? 'DEFAULT'),
      };
    });

    return {
      domainId: result.domain.id,
      name: result.domain.name,
      score: result.score,
      target: methodology.statusBands.onTrack,
      status: statusForScore(result.score, methodology.statusBands),
      trend: computeTrend(domainSeries, { minPeriods: methodology.minPeriodsForTrend }),
      effectiveWeight: round(
        (methodology.domainWeights[result.domain.id] ?? 1) /
          current.domainResults.reduce(
            (acc, d) => acc + (methodology.domainWeights[d.domain.id] ?? 1),
            0,
          ),
        4,
      ),
      coverage: round(result.coverage, 3),
      indicators,
    };
  });

  const period = periods[currentIndex];
  return {
    orgUnitId: input.orgUnit.id,
    orgUnitName: input.orgUnit.name,
    orgUnitLevel: input.orgUnit.level,
    periodId: period.id,
    periodLabel: period.label,
    methodologyId: methodology.id,
    methodologyVersion: methodology.version,
    methodologyStatus: methodology.status,
    overallScore: current.overall.score,
    status: statusForScore(current.overall.score, methodology.statusBands),
    trend: periods.length > 1 ? overallTrend : UNKNOWN_TREND,
    coverage: round(current.overall.coverage, 3),
    dataConfidence: input.dataConfidence,
    domains,
    overallSeries,
    periodLabels: periods.map((entry) => entry.label),
  };
}
