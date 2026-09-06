import { describe, expect, it } from 'vitest';
import { achievement, applyScoringRule, buildScorecard, statusForScore } from '@/core/scoring/engine';
import type { ScorecardInput } from '@/core/scoring/engine';
import type { ScorecardMethodology } from '@/core/scoring/types';
import type { DomainDefinition, IndicatorDefinition } from '@/core/registry/types';

const methodology: ScorecardMethodology = {
  id: 'test',
  version: 'TEST-v1',
  label: 'Test',
  status: 'PROVISIONAL',
  description: '',
  effectiveFrom: '2024-01-01',
  domainWeights: { a: 1, b: 3 },
  indicatorWeights: { i1: 1, i2: 1, i3: 1 },
  statusBands: { onTrack: 75, watch: 60 },
  aggregation: { domain: 'WEIGHTED_MEAN', overall: 'WEIGHTED_MEAN', geography: 'SIMPLE_MEAN' },
  missingData: { rule: 'EXCLUDE', carryMaxPeriods: 1, minCoverage: 0.5 },
  minPeriodsForTrend: 3,
};

const domains: DomainDefinition[] = [
  { id: 'a', name: 'Domain A', description: '', order: 1 },
  { id: 'b', name: 'Domain B', description: '', order: 2 },
];

function indicator(id: string, domainId: string, overrides: Partial<IndicatorDefinition> = {}): IndicatorDefinition {
  return {
    id,
    name: id,
    shortName: id,
    description: '',
    domainId,
    unit: 'PERCENT',
    directionality: 'HIGHER_IS_BETTER',
    frequency: 'QUARTERLY',
    lowestLevel: 'FACILITY',
    disaggregations: [],
    defaultTarget: 80,
    scoring: { kind: 'TARGET_RATIO', cap: 100 },
    quality: { min: 0, max: 100, numeratorMustNotExceedDenominator: true, maxPeriodChangePct: null },
    source: { system: 'DEMO', dx: null, datasetId: null, numeratorDx: null, denominatorDx: null },
    active: true,
    ...overrides,
  };
}

const periods = [
  { id: '2025Q1', label: 'Q1 2025' },
  { id: '2025Q2', label: 'Q2 2025' },
  { id: '2025Q3', label: 'Q3 2025' },
  { id: '2025Q4', label: 'Q4 2025' },
];

const confidence = {
  score: 90,
  band: 'HIGH' as const,
  components: { completeness: 90, timeliness: 90, validity: 90, consistency: 90, stability: 90 },
  reasons: [],
};

function input(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    orgUnit: { id: 'u1', name: 'Unit', level: 'LGA' },
    periods,
    methodology,
    domains,
    indicators: [indicator('i1', 'a'), indicator('i2', 'b'), indicator('i3', 'b')],
    series: {
      i1: [40, 50, 60, 80],
      i2: [80, 80, 80, 80],
      i3: [40, 40, 40, 40],
    },
    targets: { i1: 80, i2: 80, i3: 80 },
    dataConfidence: confidence,
    ...overrides,
  };
}

describe('achievement', () => {
  it('is the ratio to target for higher-is-better indicators', () => {
    expect(achievement(60, 80, 'HIGHER_IS_BETTER')).toBe(75);
    expect(achievement(80, 80, 'HIGHER_IS_BETTER')).toBe(100);
  });

  it('inverts for lower-is-better indicators, so beating a target exceeds 100%', () => {
    expect(achievement(5, 10, 'LOWER_IS_BETTER')).toBe(200);
    expect(achievement(20, 10, 'LOWER_IS_BETTER')).toBe(50);
  });

  it('treats zero as full achievement when lower is better', () => {
    expect(achievement(0, 5, 'LOWER_IS_BETTER')).toBe(200);
  });

  it('returns null rather than infinity when the target is zero', () => {
    expect(achievement(50, 0, 'HIGHER_IS_BETTER')).toBeNull();
  });

  it('returns null for a missing value', () => {
    expect(achievement(null, 80, 'HIGHER_IS_BETTER')).toBeNull();
  });
});

describe('applyScoringRule', () => {
  it('caps target-ratio scores so overperformance cannot mask weakness', () => {
    expect(applyScoringRule(160, 80, { kind: 'TARGET_RATIO', cap: 100 }, 'HIGHER_IS_BETTER')).toBe(100);
  });

  it('selects the first band the value does not exceed', () => {
    const rule = { kind: 'BANDS' as const, bands: [{ upTo: 10, score: 100 }, { upTo: 20, score: 50 }], above: 0 };
    expect(applyScoringRule(5, 0, rule, 'LOWER_IS_BETTER')).toBe(100);
    expect(applyScoringRule(15, 0, rule, 'LOWER_IS_BETTER')).toBe(50);
    expect(applyScoringRule(50, 0, rule, 'LOWER_IS_BETTER')).toBe(0);
  });

  it('interpolates linearly and handles an inverted range for lower-is-better', () => {
    const rule = { kind: 'LINEAR' as const, floor: 30, ceiling: 0 };
    expect(applyScoringRule(0, 0, rule, 'LOWER_IS_BETTER')).toBe(100);
    expect(applyScoringRule(15, 0, rule, 'LOWER_IS_BETTER')).toBe(50);
    expect(applyScoringRule(30, 0, rule, 'LOWER_IS_BETTER')).toBe(0);
    expect(applyScoringRule(45, 0, rule, 'LOWER_IS_BETTER')).toBe(0);
  });

  it('returns null for a missing value rather than scoring it zero', () => {
    expect(applyScoringRule(null, 80, { kind: 'TARGET_RATIO', cap: 100 }, 'HIGHER_IS_BETTER')).toBeNull();
  });
});

describe('statusForScore', () => {
  it('maps scores onto the methodology bands', () => {
    expect(statusForScore(80, methodology.statusBands)).toBe('ON_TRACK');
    expect(statusForScore(75, methodology.statusBands)).toBe('ON_TRACK');
    expect(statusForScore(70, methodology.statusBands)).toBe('WATCH');
    expect(statusForScore(50, methodology.statusBands)).toBe('NEEDS_ATTENTION');
    expect(statusForScore(null, methodology.statusBands)).toBe('NO_DATA');
  });
});

describe('buildScorecard', () => {
  it('weights domains according to the methodology', () => {
    const card = buildScorecard(input());
    const a = card.domains.find((domain) => domain.domainId === 'a')!;
    const b = card.domains.find((domain) => domain.domainId === 'b')!;
    expect(a.score).toBe(100);
    // Domain B averages 100 and 50.
    expect(b.score).toBe(75);
    // Weighted 1:3 => (100 + 75*3) / 4 = 81.25 => 81.3
    expect(card.overallScore).toBe(81.3);
  });

  it('excludes indicators without data and renormalises the remaining weights', () => {
    const card = buildScorecard(
      input({ series: { i1: [40, 50, 60, 80], i2: [80, 80, 80, 80], i3: [null, null, null, null] } }),
    );
    const b = card.domains.find((domain) => domain.domainId === 'b')!;
    expect(b.score).toBe(100);
    expect(b.coverage).toBe(0.5);
  });

  it('withholds a score when coverage falls below the methodology minimum', () => {
    const card = buildScorecard(
      input({
        series: { i1: [null, null, null, null], i2: [null, null, null, null], i3: [null, null, null, null] },
      }),
    );
    expect(card.overallScore).toBeNull();
    expect(card.status).toBe('NO_DATA');
  });

  it('carries a value forward only when the methodology says to, and flags it', () => {
    const carry: ScorecardMethodology = {
      ...methodology,
      missingData: { rule: 'CARRY', carryMaxPeriods: 1, minCoverage: 0.5 },
    };
    const card = buildScorecard(
      input({ methodology: carry, series: { i1: [40, 50, 60, null], i2: [80, 80, 80, 80], i3: [40, 40, 40, 40] } }),
    );
    const indicatorScore = card.domains
      .flatMap((domain) => domain.indicators)
      .find((entry) => entry.indicatorId === 'i1')!;
    expect(indicatorScore.carriedForward).toBe(true);
    expect(indicatorScore.value).toBe(60);
  });

  it('scores a missing value as zero under the punitive rule', () => {
    const zero: ScorecardMethodology = {
      ...methodology,
      missingData: { rule: 'ZERO', carryMaxPeriods: 0, minCoverage: 0 },
    };
    const card = buildScorecard(
      input({ methodology: zero, series: { i1: [40, 50, 60, null], i2: [80, 80, 80, 80], i3: [40, 40, 40, 40] } }),
    );
    const indicatorScore = card.domains
      .flatMap((domain) => domain.indicators)
      .find((entry) => entry.indicatorId === 'i1')!;
    expect(indicatorScore.score).toBe(0);
    expect(indicatorScore.carriedForward).toBe(false);
  });

  it('exposes an overall score series aligned to the period axis', () => {
    const card = buildScorecard(input());
    expect(card.overallSeries).toHaveLength(periods.length);
    expect(card.periodLabels).toEqual(periods.map((period) => period.label));
    expect(card.overallSeries[card.overallSeries.length - 1]).toBe(card.overallScore);
  });

  it('stamps the methodology it used so a historical score stays traceable', () => {
    const card = buildScorecard(input());
    expect(card.methodologyVersion).toBe('TEST-v1');
    expect(card.methodologyStatus).toBe('PROVISIONAL');
  });

  it('requires at least one period', () => {
    expect(() => buildScorecard(input({ periods: [] }))).toThrow(/at least one period/i);
  });
});
