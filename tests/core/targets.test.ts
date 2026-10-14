import { describe, expect, it } from 'vitest';
import { resolveTarget, validateTargetValue, type TargetRow } from '@/core/targets/resolve';
import { buildScorecard } from '@/core/scoring/engine';
import { explainDomain, explainOverall } from '@/core/scoring/explain';
import { parsePeriod, monthsOf, quarterOf } from '@/core/model/periods';
import { INDICATORS } from '@/config/indicators';
import { DOMAINS } from '@/config/domains';
import { PROVISIONAL_METHODOLOGY } from '@/config/methodology';

const rate = INDICATORS.find((indicator) => indicator.id === 'anc4-coverage')!;
const count = INDICATORS.find((indicator) => indicator.id === 'fp-new-acceptors')!;
const q4 = parsePeriod('2025Q4');
const dec = parsePeriod('202512');

const rows: TargetRow[] = [
  { indicatorId: rate.id, orgUnitId: null, periodId: null, value: 75 },
  { indicatorId: rate.id, orgUnitId: null, periodId: 'MONTHLY', value: 70 },
  { indicatorId: rate.id, orgUnitId: 'bauchi', periodId: '2025Q4', value: 80 },
  { indicatorId: count.id, orgUnitId: null, periodId: null, value: 1200 },
  { indicatorId: count.id, orgUnitId: 'bauchi', periodId: null, value: 30000 },
  { indicatorId: count.id, orgUnitId: 'bauchi', periodId: 'MONTHLY', value: 10500 },
];

describe('target resolution', () => {
  it('chooses the most specific row: area and period, then period type, then default', () => {
    expect(resolveTarget(rate, rows, 'bauchi', q4)).toMatchObject({ value: 80, scope: 'AREA_PERIOD' });
    expect(resolveTarget(rate, rows, 'sokoto', q4)).toMatchObject({ value: 75, scope: 'DEFAULT' });
    expect(resolveTarget(rate, rows, 'sokoto', dec)).toMatchObject({ value: 70, scope: 'PERIOD_TYPE' });
  });

  it('never applies a count target to a different area or period length', () => {
    // The programme-wide 1,200 is not copied to Sokoto, a state or a facility.
    expect(resolveTarget(count, rows, 'sokoto', q4).value).toBeNull();
    expect(resolveTarget(count, rows, 'sokoto', q4).missingReason).toMatch(/quarterly target/);
    // Bauchi's untyped count target belongs to the indicator's frequency (quarterly) ...
    expect(resolveTarget(count, rows, 'bauchi', q4)).toMatchObject({ value: 30000, scope: 'AREA' });
    // ... and a month uses only a monthly target, never a third of the quarter's.
    expect(resolveTarget(count, rows, 'bauchi', dec)).toMatchObject({ value: 10500, scope: 'AREA_PERIOD_TYPE' });
    expect(resolveTarget(count, rows.slice(0, 5), 'bauchi', dec).value).toBeNull();
  });

  it('validates values against the indicator', () => {
    expect(validateTargetValue(rate, 101)).toMatch(/exceed 100/);
    expect(validateTargetValue(rate, -1)).toMatch(/negative/);
    expect(validateTargetValue(rate, 0)).toMatch(/zero/);
    expect(validateTargetValue(rate, Number.NaN)).toMatch(/number/);
    expect(validateTargetValue(count, 10.5)).toMatch(/whole number/);
    expect(validateTargetValue(count, 1200)).toBeNull();
    expect(validateTargetValue(rate, 80)).toBeNull();
  });
});

describe('periods', () => {
  it('maps months to quarters and back', () => {
    expect(quarterOf('202512')).toBe('2025Q4');
    expect(quarterOf('202601')).toBe('2026Q1');
    expect(monthsOf('2025Q4')).toEqual(['202510', '202511', '202512']);
  });
});

describe('scoring with resolved targets, and its reconciliation', () => {
  const periods = [{ id: '2025Q3', label: 'Q3 2025' }, { id: '2025Q4', label: 'Q4 2025' }];
  const confidence = {
    score: 90,
    band: 'HIGH' as const,
    components: { completeness: 90, timeliness: 90, validity: 90, consistency: 90, stability: 90 },
    reasons: [],
  };
  const fp = INDICATORS.filter((indicator) => indicator.domainId === 'family-planning');
  const maternal = INDICATORS.filter((indicator) => indicator.id === 'anc4-coverage' || indicator.id === 'pnc-48h');
  const card = buildScorecard({
    orgUnit: { id: 'bauchi', name: 'Bauchi', level: 'STATE' },
    periods,
    methodology: PROVISIONAL_METHODOLOGY,
    domains: DOMAINS,
    indicators: [...fp, ...maternal],
    series: {
      mcpr: [20, 28],
      'fp-new-acceptors': [900, 1000],
      'fp-counselling-coverage': [60, 68],
      'anc4-coverage': [50, 60],
      'pnc-48h': [null, null],
    },
    // No target applies to the count: its value is kept, its score is not invented.
    targets: { mcpr: 35, 'fp-new-acceptors': null, 'fp-counselling-coverage': 85, 'anc4-coverage': 75, 'pnc-48h': 70 },
    targetScopes: { mcpr: 'DEFAULT', 'fp-new-acceptors': null, 'fp-counselling-coverage': 'DEFAULT', 'anc4-coverage': 'AREA_PERIOD', 'pnc-48h': 'DEFAULT' },
    dataConfidence: confidence,
  });
  const fpDomain = card.domains.find((domain) => domain.domainId === 'family-planning')!;

  it('keeps a value with no target, unscored, rather than scoring it against a default', () => {
    const acceptors = fpDomain.indicators.find((indicator) => indicator.indicatorId === 'fp-new-acceptors')!;
    expect(acceptors.value).toBe(1000);
    expect(acceptors.target).toBeNull();
    expect(acceptors.score).toBeNull();
    expect(acceptors.achievementPct).toBeNull();
    expect(card.domains.find((domain) => domain.domainId === 'maternal-health')!.indicators[0].targetScope).toBe('AREA_PERIOD');
  });

  it('domain and overall scores reconcile exactly with their breakdown terms', () => {
    const domain = explainDomain(fpDomain);
    expect(domain.excluded).toBe(1);
    expect(domain.total).toBeCloseTo(fpDomain.score!, 0);
    // mCPR 28/35 = 80, counselling 68/85 = 80: an equal-weight mean of 80.
    expect(fpDomain.score).toBe(80);

    const overall = explainOverall(card);
    expect(overall.total).toBeCloseTo(card.overallScore!, 0);
    // Each domain counts once in the overall figure: no indicator is double-counted.
    expect(overall.terms.map((term) => term.id)).toEqual(card.domains.map((entry) => entry.domainId));
    expect(new Set(card.domains.flatMap((entry) => entry.indicators.map((indicator) => indicator.indicatorId))).size).toBe(
      card.domains.flatMap((entry) => entry.indicators).length,
    );
    expect(overall.terms.reduce((sum, term) => sum + term.share, 0)).toBeCloseTo(1, 3);
  });
});
