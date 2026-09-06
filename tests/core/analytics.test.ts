import { describe, expect, it } from 'vitest';
import { computeTrend } from '@/core/analytics/trend';
import { linearFit, medianAbsoluteDeviation, percentChange, robustZScore, round } from '@/core/analytics/stats';
import { attributeChange, attributeDomainChange, rankScorecards } from '@/core/analytics/attribution';
import type { Scorecard } from '@/core/scoring/types';

describe('stats', () => {
  it('fits a straight line exactly', () => {
    const fit = linearFit([1, 2, 3, 4]);
    expect(fit.slope).toBeCloseTo(1);
    expect(fit.r2).toBeCloseTo(1);
  });

  it('reports no slope for a flat series', () => {
    expect(linearFit([5, 5, 5, 5]).slope).toBe(0);
  });

  it('returns null percent change from zero rather than infinity', () => {
    expect(percentChange(0, 10)).toBeNull();
    expect(percentChange(50, 75)).toBe(50);
  });

  it('is not dragged around by the outlier it is testing', () => {
    const baseline = [10, 10, 11, 10, 9, 10, 10];
    expect(Math.abs(robustZScore(10, baseline))).toBeLessThan(1);
    expect(Math.abs(robustZScore(80, baseline))).toBeGreaterThan(10);
  });

  it('returns zero deviation for an identical series', () => {
    expect(medianAbsoluteDeviation([4, 4, 4, 4])).toBe(0);
  });

  it('rounds without exponent surprises', () => {
    expect(round(1.005, 2)).toBe(1.0);
    expect(round(76.25, 1)).toBe(76.3);
  });
});

describe('computeTrend', () => {
  it('refuses to assert a direction without enough history', () => {
    const trend = computeTrend([10, 12], { minPeriods: 3 });
    expect(trend.direction).toBe('UNKNOWN');
    expect(trend.changePct).toBeNull();
  });

  it('ignores movement inside the stable band', () => {
    expect(computeTrend([100, 100.5, 101], { minPeriods: 3 }).direction).toBe('STABLE');
  });

  it('reads a rising series as improving by default', () => {
    const trend = computeTrend([50, 60, 70, 80], { minPeriods: 3 });
    expect(trend.direction).toBe('IMPROVING');
    expect(trend.changePct).toBe(60);
  });

  it('reads a rising series as declining when lower is better', () => {
    expect(computeTrend([5, 10, 15, 20], { minPeriods: 3, lowerIsBetter: true }).direction).toBe('DECLINING');
  });

  it('skips missing periods rather than treating them as zero', () => {
    const trend = computeTrend([50, null, 60, null, 70], { minPeriods: 3 });
    expect(trend.periods).toBe(3);
    expect(trend.direction).toBe('IMPROVING');
  });
});

function card(id: string, score: number | null, domains: Array<[string, number | null, number]>): Scorecard {
  return {
    orgUnitId: id,
    orgUnitName: id.toUpperCase(),
    orgUnitLevel: 'LGA',
    periodId: '2026Q1',
    periodLabel: 'Q1 2026',
    methodologyId: 'm',
    methodologyVersion: 'v1',
    methodologyStatus: 'PROVISIONAL',
    overallScore: score,
    status: 'WATCH',
    trend: { direction: 'STABLE', changePct: 0, changePoints: 0, periods: 4 },
    coverage: 1,
    dataConfidence: {
      score: 90,
      band: 'HIGH',
      components: { completeness: 90, timeliness: 90, validity: 90, consistency: 90, stability: 90 },
      reasons: [],
    },
    domains: domains.map(([domainId, domainScore, weight]) => ({
      domainId,
      name: domainId,
      score: domainScore,
      target: 75,
      status: 'WATCH',
      trend: { direction: 'STABLE', changePct: 0, changePoints: 0, periods: 4 },
      effectiveWeight: weight,
      coverage: 1,
      indicators: [],
    })),
    overallSeries: [score],
    periodLabels: ['Q1 2026'],
  };
}

describe('attributeChange', () => {
  it('multiplies a domain’s own movement by its weight', () => {
    const before = card('u1', 80, [['a', 80, 0.25], ['b', 80, 0.75]]);
    const after = card('u1', 70, [['a', 60, 0.25], ['b', 80, 0.75]]);
    const contributions = attributeChange(before, after);
    expect(contributions[0].id).toBe('a');
    expect(contributions[0].changePoints).toBe(-20);
    expect(contributions[0].contributionPoints).toBe(-5);
    expect(contributions[0].share).toBe(1);
  });

  it('skips domains that cannot be compared', () => {
    const before = card('u1', 80, [['a', null, 0.5], ['b', 80, 0.5]]);
    const after = card('u1', 70, [['a', 60, 0.5], ['b', 70, 0.5]]);
    expect(attributeChange(before, after).map((entry) => entry.id)).toEqual(['b']);
  });

  it('returns nothing for a domain that is not in both periods', () => {
    expect(attributeDomainChange(card('u1', 80, []), card('u1', 70, []), 'missing')).toEqual([]);
  });
});

describe('rankScorecards', () => {
  it('ranks by score and places unscored units last', () => {
    const ranked = rankScorecards([card('a', 60, []), card('b', null, []), card('c', 90, [])]);
    expect(ranked.map((unit) => unit.orgUnitId)).toEqual(['c', 'a', 'b']);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[2].score).toBeNull();
  });

  it('reports movement only where a comparable previous period exists', () => {
    const previous = new Map([['a', card('a', 50, [])]]);
    const ranked = rankScorecards([card('a', 60, []), card('c', 90, [])], previous);
    expect(ranked.find((unit) => unit.orgUnitId === 'a')!.changePoints).toBe(10);
    expect(ranked.find((unit) => unit.orgUnitId === 'c')!.changePoints).toBeNull();
  });
});
