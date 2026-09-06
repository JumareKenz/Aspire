import { describe, expect, it } from 'vitest';
import { forecast, MIN_PERIODS_FOR_FORECAST } from '@/core/forecast/engine';
import { futurePeriods, nextPeriodId, parsePeriod, periodRange, previousPeriodId } from '@/core/model/periods';

const horizon = ['2026Q3', '2026Q4', '2027Q1'];

describe('forecast', () => {
  it('refuses to forecast on thin history and says why', () => {
    const result = forecast({ values: [10, 12, 14], horizonPeriodIds: horizon });
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.reason).toContain('Insufficient historical data');
      expect(result.requiredPeriods).toBe(MIN_PERIODS_FOR_FORECAST);
      expect(result.observedPeriods).toBe(3);
    }
  });

  it('counts only observed periods, not the gaps between them', () => {
    const result = forecast({
      values: [10, null, 12, null, 14, null, 16],
      horizonPeriodIds: horizon,
    });
    expect(result.available).toBe(false);
  });

  it('extrapolates a clean trend and widens its interval with distance', () => {
    const result = forecast({
      values: [10, 12, 14, 16, 18, 20, 22, 24],
      horizonPeriodIds: horizon,
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.points).toHaveLength(3);
    expect(result.points[0].value).toBeCloseTo(26, 0);
    expect(result.direction).toBe('RISING');
    expect(result.fitQuality).toBeCloseTo(1, 1);
    const firstSpread = result.points[0].upper - result.points[0].lower;
    const lastSpread = result.points[2].upper - result.points[2].lower;
    expect(lastSpread).toBeGreaterThanOrEqual(firstSpread);
  });

  it('never projects a negative value', () => {
    const result = forecast({ values: [30, 25, 20, 15, 10, 5, 2, 1], horizonPeriodIds: horizon });
    expect(result.available).toBe(true);
    if (!result.available) return;
    for (const point of result.points) {
      expect(point.value).toBeGreaterThanOrEqual(0);
      expect(point.lower).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads a flat series as flat', () => {
    const result = forecast({ values: new Array(8).fill(50), horizonPeriodIds: horizon });
    expect(result.available).toBe(true);
    if (result.available) expect(result.direction).toBe('FLAT');
  });

  it('puts a high probability on missing a target it is heading away from', () => {
    const result = forecast({
      values: [60, 58, 56, 54, 52, 50, 48, 46],
      horizonPeriodIds: horizon,
      target: 80,
      directionality: 'HIGHER_IS_BETTER',
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.targetMissProbability).toBeGreaterThan(0.9);
  });

  it('inverts the target test when lower is better', () => {
    const result = forecast({
      values: [30, 28, 26, 24, 22, 20, 18, 16],
      horizonPeriodIds: horizon,
      target: 5,
      directionality: 'LOWER_IS_BETTER',
    });
    expect(result.available).toBe(true);
    if (result.available) expect(result.targetMissProbability).toBeGreaterThan(0.9);
  });

  it('stamps the model and version on every published forecast', () => {
    const result = forecast({ values: [1, 2, 3, 4, 5, 6, 7], horizonPeriodIds: horizon });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.modelId).toBeTruthy();
      expect(result.modelVersion).toBeTruthy();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(0.95);
    }
  });
});

describe('periods', () => {
  it('parses quarterly identifiers into real date ranges', () => {
    const period = parsePeriod('2026Q1');
    expect(period.startDate).toBe('2026-01-01');
    expect(period.endDate).toBe('2026-03-31');
    expect(period.label).toBe('Q1 2026');
  });

  it('parses monthly and yearly identifiers', () => {
    expect(parsePeriod('202602').endDate).toBe('2026-02-28');
    expect(parsePeriod('2026').endDate).toBe('2026-12-31');
  });

  it('rolls over year boundaries in both directions', () => {
    expect(previousPeriodId('2026Q1')).toBe('2025Q4');
    expect(nextPeriodId('2026Q4')).toBe('2027Q1');
    expect(previousPeriodId('202601')).toBe('202512');
    expect(nextPeriodId('202612')).toBe('202701');
  });

  it('builds an ordered window ending at the requested period', () => {
    const window = periodRange('2026Q2', 4).map((period) => period.id);
    expect(window).toEqual(['2025Q3', '2025Q4', '2026Q1', '2026Q2']);
  });

  it('builds a forward horizon', () => {
    expect(futurePeriods('2026Q3', 3).map((period) => period.id)).toEqual(['2026Q4', '2027Q1', '2027Q2']);
  });

  it('rejects an identifier it does not recognise', () => {
    expect(() => parsePeriod('not-a-period')).toThrow(/Unrecognised period/);
  });
});
