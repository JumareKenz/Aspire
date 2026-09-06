import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  detectCompleteness,
  detectConsistency,
  detectRepeatedValues,
  detectStatisticalAnomalies,
  detectTemporalAnomalies,
  detectTimeliness,
  detectValidity,
  runQualityScan,
  type DetectorContext,
} from '@/core/quality/detectors';
import { computeDataConfidence, COMPLETENESS_CEILING_MARGIN } from '@/core/quality/confidence';
import { rollup } from '@/core/quality/types';
import type { IndicatorDefinition } from '@/core/registry/types';
import type { OrgUnit, Period, ReportingRecord } from '@/core/model/types';
import { periodRange } from '@/core/model/periods';

const orgUnit: OrgUnit = {
  id: 'lga-1',
  code: 'L1',
  name: 'Testville',
  level: 'LGA',
  parentId: 'state-1',
  path: ['state-1', 'lga-1'],
  centroid: null,
  active: true,
};

const indicator: IndicatorDefinition = {
  id: 'ind-1',
  name: 'Test indicator',
  shortName: 'Test',
  description: '',
  domainId: 'd',
  unit: 'PERCENT',
  directionality: 'HIGHER_IS_BETTER',
  frequency: 'QUARTERLY',
  lowestLevel: 'FACILITY',
  disaggregations: [],
  defaultTarget: 80,
  scoring: { kind: 'TARGET_RATIO', cap: 100 },
  quality: { min: 0, max: 100, numeratorMustNotExceedDenominator: true, maxPeriodChangePct: 50 },
  source: { system: 'DEMO', dx: null, datasetId: 'ds', numeratorDx: null, denominatorDx: null },
  active: true,
};

const periods: Period[] = periodRange('2026Q2', 12);

const ctx: DetectorContext = {
  orgUnits: new Map([[orgUnit.id, orgUnit]]),
  indicators: new Map([[indicator.id, indicator]]),
  periods,
  now: '2026-07-01T00:00:00.000Z',
};

function reporting(overrides: Partial<ReportingRecord> = {}): ReportingRecord {
  return {
    orgUnitId: 'lga-1',
    datasetId: 'ds',
    periodId: '2026Q2',
    expected: true,
    reported: true,
    submittedAt: '2026-07-05T00:00:00.000Z',
    dueDate: '2026-07-15',
    ...overrides,
  };
}

describe('completeness', () => {
  it('flags missing submissions and grades severity by how much is missing', () => {
    const records = [
      reporting({ datasetId: 'a', reported: false, submittedAt: null }),
      reporting({ datasetId: 'b', reported: false, submittedAt: null }),
      reporting({ datasetId: 'c', reported: false, submittedAt: null }),
      reporting({ datasetId: 'd' }),
    ];
    const [finding] = detectCompleteness(records, ctx);
    expect(finding.dimension).toBe('COMPLETENESS');
    expect(finding.severity).toBe('HIGH');
    expect(finding.title).toContain('75%');
  });

  it('says nothing when reporting is effectively complete', () => {
    expect(detectCompleteness([reporting(), reporting({ datasetId: 'b' })], ctx)).toHaveLength(0);
  });

  it('ignores units that were never expected to report', () => {
    expect(detectCompleteness([reporting({ expected: false, reported: false })], ctx)).toHaveLength(0);
  });
});

describe('timeliness', () => {
  it('flags late submissions once they pass a quarter of the batch', () => {
    const records = [
      reporting({ datasetId: 'a', submittedAt: '2026-08-20T00:00:00.000Z' }),
      reporting({ datasetId: 'b' }),
    ];
    const [finding] = detectTimeliness(records, ctx);
    expect(finding.dimension).toBe('TIMELINESS');
    expect(finding.evidence.some((item) => item.label === 'Longest delay')).toBe(true);
  });

  it('says nothing when everything arrived on time', () => {
    expect(detectTimeliness([reporting(), reporting({ datasetId: 'b' })], ctx)).toHaveLength(0);
  });
});

describe('validity and consistency', () => {
  it('flags a value outside the indicator’s possible range', () => {
    const [finding] = detectValidity(
      [{ indicatorId: 'ind-1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 128.4, numerator: null, denominator: null, disaggregation: null }],
      ctx,
    );
    expect(finding.severity).toBe('HIGH');
    expect(finding.reason).toContain('above the maximum');
  });

  it('accepts a value at the boundary', () => {
    expect(
      detectValidity(
        [{ indicatorId: 'ind-1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 100, numerator: null, denominator: null, disaggregation: null }],
        ctx,
      ),
    ).toHaveLength(0);
  });

  it('flags a numerator larger than its denominator', () => {
    const [finding] = detectConsistency(
      [{ indicatorId: 'ind-1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 118, numerator: 118, denominator: 100, disaggregation: null }],
      ctx,
    );
    expect(finding.dimension).toBe('CONSISTENCY');
  });

  it('does not flag a consistent numerator and denominator', () => {
    expect(
      detectConsistency(
        [{ indicatorId: 'ind-1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 80, numerator: 80, denominator: 100, disaggregation: null }],
        ctx,
      ),
    ).toHaveLength(0);
  });
});

describe('statistical anomalies', () => {
  const series = (values: Array<number | null>) => [{ orgUnitId: 'lga-1', indicatorId: 'ind-1', values }];

  it('flags a genuine spike against a stable history', () => {
    const findings = detectStatisticalAnomalies(
      series([50, 51, 49, 50, 52, 48, 50, 51, 49, 50, 51, 140]),
      ctx,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('spike');
  });

  it('does not treat a smooth decline as an anomaly', () => {
    // A sustained decline is a performance finding, not a data-quality one.
    const findings = detectStatisticalAnomalies(
      series([90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35]),
      ctx,
    );
    expect(findings).toHaveLength(0);
  });

  it('stays silent when there is not enough history', () => {
    expect(detectStatisticalAnomalies(series([50, 120]), ctx)).toHaveLength(0);
  });

  it('does not fire on a perfectly flat series', () => {
    expect(detectStatisticalAnomalies(series(new Array(12).fill(50)), ctx)).toHaveLength(0);
  });
});

describe('temporal and repeated-value detection', () => {
  it('flags a sustained level shift', () => {
    const findings = detectTemporalAnomalies(
      [{ orgUnitId: 'lga-1', indicatorId: 'ind-1', values: [80, 79, 81, 80, 82, 78, 30, 31, 29, 30, 32, 28] }],
      ctx,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].dimension).toBe('TEMPORAL');
  });

  it('flags implausibly repeated non-zero values', () => {
    const findings = detectRepeatedValues(
      [{ orgUnitId: 'lga-1', indicatorId: 'ind-1', values: [10, 20, 44, 44, 44, 44, 44, 30, 12, 8, 9, 11] }],
      ctx,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].evidence[1].value).toBe('5');
  });

  it('tolerates repeated zeros, which are normal in low-volume units', () => {
    expect(
      detectRepeatedValues(
        [{ orgUnitId: 'lga-1', indicatorId: 'ind-1', values: [0, 0, 0, 0, 0, 0, 1, 2, 0, 0, 1, 0] }],
        ctx,
      ),
    ).toHaveLength(0);
  });
});

describe('runQualityScan', () => {
  it('orders findings by severity', () => {
    const findings = runQualityScan(
      {
        observations: [
          { indicatorId: 'ind-1', orgUnitId: 'lga-1', periodId: '2026Q2', value: 300, numerator: null, denominator: null, disaggregation: null },
        ],
        reporting: [
          reporting({ datasetId: 'a', submittedAt: '2026-08-20T00:00:00.000Z' }),
          reporting({ datasetId: 'b' }),
        ],
        series: [],
      },
      ctx,
      DEFAULT_THRESHOLDS,
    );
    expect(findings[0].severity).toBe('HIGH');
    expect(rollup(findings).total).toBe(findings.length);
  });
});

describe('data confidence', () => {
  it('is high when everything reported on time and nothing was flagged', () => {
    const confidence = computeDataConfidence({
      reporting: [reporting(), reporting({ datasetId: 'b' })],
      findings: [],
      checkedValues: 50,
    });
    expect(confidence.score).toBe(100);
    expect(confidence.band).toBe('HIGH');
    expect(confidence.reasons).toHaveLength(0);
  });

  it('cannot exceed completeness by more than the documented margin', () => {
    const confidence = computeDataConfidence({
      reporting: [
        reporting({ datasetId: 'a', reported: false, submittedAt: null }),
        reporting({ datasetId: 'b', reported: false, submittedAt: null }),
        reporting({ datasetId: 'c', reported: false, submittedAt: null }),
        reporting({ datasetId: 'd' }),
      ],
      findings: [],
      checkedValues: 50,
    });
    expect(confidence.components.completeness).toBe(25);
    expect(confidence.score).toBeLessThanOrEqual(25 + COMPLETENESS_CEILING_MARGIN);
    expect(confidence.band).toBe('LOW');
    expect(confidence.reasons.join(' ')).toContain('missing');
  });

  it('is independent of performance — it only reads the evidence', () => {
    const withProblems = computeDataConfidence({
      reporting: [reporting(), reporting({ datasetId: 'b' })],
      findings: [
        {
          id: 'f1',
          dimension: 'VALIDITY',
          severity: 'HIGH',
          orgUnitId: 'lga-1',
          orgUnitName: 'Testville',
          indicatorId: 'ind-1',
          indicatorName: 'Test',
          periodId: '2026Q2',
          title: 'Impossible value',
          reason: '',
          evidence: [],
          status: 'OPEN',
          detectedAt: ctx.now,
        },
      ],
      checkedValues: 20,
    });
    expect(withProblems.components.validity).toBeLessThan(100);
    expect(withProblems.components.completeness).toBe(100);
  });

  it('ignores findings that have been resolved or dismissed', () => {
    const base = {
      id: 'f1',
      dimension: 'VALIDITY' as const,
      severity: 'HIGH' as const,
      orgUnitId: 'lga-1',
      orgUnitName: 'Testville',
      indicatorId: 'ind-1',
      indicatorName: 'Test',
      periodId: '2026Q2',
      title: 'Impossible value',
      reason: '',
      evidence: [],
      detectedAt: ctx.now,
    };
    const resolved = computeDataConfidence({
      reporting: [reporting()],
      findings: [{ ...base, status: 'RESOLVED' }],
      checkedValues: 20,
    });
    expect(resolved.components.validity).toBe(100);
  });
});
