import { describe, expect, it } from 'vitest';
import { interpret, type IntentContext } from '@/intelligence/intent';
import { validateResult, isPresentable } from '@/intelligence/validate';
import type { AnalyticalResult } from '@/intelligence/types';
import { DOMAINS } from '@/config/domains';
import { INDICATORS } from '@/config/indicators';
import type { OrgUnit } from '@/core/model/types';

function unit(id: string, name: string, level: OrgUnit['level'], parentId: string | null): OrgUnit {
  return {
    id,
    name,
    code: null,
    level,
    parentId,
    path: parentId ? [parentId, id] : [id],
    centroid: null,
    active: true,
  };
}

const context: IntentContext = {
  orgUnits: [
    unit('state-1', 'Kandara State', 'STATE', null),
    unit('lga-eguma', 'Eguma', 'LGA', 'state-1'),
    unit('lga-chalawa', 'Chalawa', 'LGA', 'state-1'),
  ],
  indicators: INDICATORS,
  domains: DOMAINS,
  defaultOrgUnitId: 'state-1',
  defaultPeriodId: '2026Q2',
  periodIds: ['2025Q4', '2026Q1', '2026Q2'],
};

describe('intent parsing', () => {
  it.each([
    ['Which LGAs are performing below target?', 'BELOW_TARGET'],
    ['Which areas improved most?', 'MOST_IMPROVED'],
    ['Why is performance declining?', 'EXPLAIN_CHANGE'],
    ['What changed this quarter?', 'EXPLAIN_CHANGE'],
    ['Which areas have unusual reporting patterns?', 'DATA_QUALITY'],
    ['What are the biggest SRHR risks?', 'RISK_OUTLOOK'],
    ['Generate an executive summary.', 'SUMMARY'],
    ['Which area has the lowest performance?', 'RANK_UNITS'],
    ['Compare Eguma and Chalawa', 'COMPARE_UNITS'],
  ])('reads %j as %s', (question, kind) => {
    expect(interpret(question, context).query.kind).toBe(kind);
  });

  it('recognises two named geographies as a comparison even without the word compare', () => {
    const intent = interpret('Eguma and Chalawa', context);
    expect(intent.query.kind).toBe('COMPARE_UNITS');
    expect(intent.query.compareOrgUnitIds).toEqual(
      expect.arrayContaining(['lga-eguma', 'lga-chalawa']),
    );
  });

  it('scopes a question to the geography it names', () => {
    expect(interpret('How is Eguma performing?', context).query.orgUnitId).toBe('lga-eguma');
  });

  it('falls back to the default scope when no geography is named', () => {
    expect(interpret('What changed this quarter?', context).query.orgUnitId).toBe('state-1');
  });

  it('resolves indicators by full name and by common shorthand', () => {
    expect(interpret('How is adolescent family planning uptake doing?', context).query.indicatorId).toBe(
      'adolescent-fp-uptake',
    );
    expect(interpret('What is the trend in stockouts?', context).query.indicatorId).toBe(
      'contraceptive-stockout',
    );
    expect(interpret('Show me ANC4 coverage', context).query.indicatorId).toBe('anc4-coverage');
  });

  it('cannot resolve an indicator the registry does not contain', () => {
    const intent = interpret('What is the malaria positivity rate?', context);
    expect(intent.query.indicatorId).toBeNull();
    expect(intent.confidence).toBeLessThan(0.6);
  });

  it('honours an explicit period and ignores one that is out of range', () => {
    expect(interpret('How did we do in Q1 2026?', context).query.periodId).toBe('2026Q1');
    expect(interpret('How did we do in Q1 2019?', context).query.periodId).toBe('2026Q2');
  });

  it('reads superlatives as a direction', () => {
    expect(interpret('Which area is best?', context).query.direction).toBe('BEST_FIRST');
    expect(interpret('Which area is worst?', context).query.direction).toBe('WORST_FIRST');
  });

  it('restates its interpretation so a user can see how they were read', () => {
    expect(interpret('Which LGAs are below target?', context).interpretation).toMatch(/below the on-track/i);
  });
});

function result(overrides: Partial<AnalyticalResult> = {}): AnalyticalResult {
  return {
    query: { kind: 'RANK_UNITS', orgUnitId: 'state-1', periodId: '2026Q2' },
    headline: 'Test',
    findings: [],
    columns: [],
    rows: [],
    basis: '',
    caveats: [],
    href: null,
    ...overrides,
  };
}

describe('result validation', () => {
  it('accepts a well-formed result', () => {
    expect(isPresentable(validateResult(result()))).toBe(true);
  });

  it('rejects rows that break the requested limit', () => {
    const issues = validateResult(
      result({
        query: { kind: 'RANK_UNITS', orgUnitId: 'state-1', periodId: '2026Q2', limit: 1 },
        rows: [
          { refId: 'a', refKind: 'ORG_UNIT', cells: {} },
          { refId: 'b', refKind: 'ORG_UNIT', cells: {} },
        ],
      }),
    );
    expect(isPresentable(issues)).toBe(false);
  });

  it('rejects duplicate ranks', () => {
    const issues = validateResult(
      result({
        rows: [
          { refId: 'a', refKind: 'ORG_UNIT', cells: { rank: 1 } },
          { refId: 'b', refKind: 'ORG_UNIT', cells: { rank: 1 } },
        ],
      }),
    );
    expect(isPresentable(issues)).toBe(false);
  });

  it('accepts descending ranks, because "which is worst" legitimately starts at the bottom', () => {
    const issues = validateResult(
      result({
        rows: [
          { refId: 'a', refKind: 'ORG_UNIT', cells: { rank: 3 } },
          { refId: 'b', refKind: 'ORG_UNIT', cells: { rank: 2 } },
          { refId: 'c', refKind: 'ORG_UNIT', cells: { rank: 1 } },
        ],
      }),
    );
    expect(isPresentable(issues)).toBe(true);
  });

  it('rejects unordered ranks for a rank-ordered query', () => {
    const issues = validateResult(
      result({
        rows: [
          { refId: 'a', refKind: 'ORG_UNIT', cells: { rank: 1 } },
          { refId: 'b', refKind: 'ORG_UNIT', cells: { rank: 5 } },
          { refId: 'c', refKind: 'ORG_UNIT', cells: { rank: 3 } },
        ],
      }),
    );
    expect(isPresentable(issues)).toBe(false);
  });

  it('permits movement ordering for a most-improved query', () => {
    const issues = validateResult(
      result({
        query: { kind: 'MOST_IMPROVED', orgUnitId: 'state-1', periodId: '2026Q2' },
        rows: [
          { refId: 'a', refKind: 'ORG_UNIT', cells: { rank: 7 } },
          { refId: 'b', refKind: 'ORG_UNIT', cells: { rank: 2 } },
          { refId: 'c', refKind: 'ORG_UNIT', cells: { rank: 5 } },
        ],
      }),
    );
    expect(isPresentable(issues)).toBe(true);
  });

  it('rejects a score outside the 0–100 range', () => {
    const issues = validateResult(
      result({ rows: [{ refId: 'a', refKind: 'ORG_UNIT', cells: { area: 'A', score: 140 } }] }),
    );
    expect(isPresentable(issues)).toBe(false);
  });

  it('warns when a statement quotes a figure its evidence does not support', () => {
    const issues = validateResult(
      result({
        findings: [
          {
            statement: 'Eguma scored 56.4 and fell 12.3 points.',
            evidence: [{ label: 'Overall score', value: '56.4' }],
          },
        ],
      }),
    );
    expect(issues.some((issue) => issue.severity === 'WARNING' && issue.message.includes('12.3'))).toBe(true);
    // A warning annotates the answer; it does not suppress it.
    expect(isPresentable(issues)).toBe(true);
  });

  it('does not demand evidence for the scale a score is expressed on', () => {
    const issues = validateResult(
      result({
        findings: [
          {
            statement: 'Eguma scored 56.4 out of 100.',
            evidence: [{ label: 'Overall score', value: '56.4' }],
          },
        ],
      }),
    );
    expect(issues).toHaveLength(0);
  });
});
