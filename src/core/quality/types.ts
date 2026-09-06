export const QUALITY_DIMENSIONS = [
  'COMPLETENESS',
  'TIMELINESS',
  'VALIDITY',
  'CONSISTENCY',
  'STATISTICAL',
  'TEMPORAL',
  'REPEATED_VALUE',
] as const;
export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];

export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type FindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

export interface EvidenceItem {
  label: string;
  value: string;
}

/**
 * One detected data-quality problem. Every finding carries enough context for a
 * user to judge it without leaving the page: what, where, when, why, and the
 * figures the detector actually looked at.
 */
export interface QualityFinding {
  id: string;
  dimension: QualityDimension;
  severity: Severity;
  orgUnitId: string;
  orgUnitName: string;
  indicatorId: string | null;
  indicatorName: string | null;
  periodId: string;
  title: string;
  /** Plain-language explanation of why this was flagged. */
  reason: string;
  evidence: EvidenceItem[];
  status: FindingStatus;
  detectedAt: string;
}

export interface QualityRollup {
  total: number;
  bySeverity: Record<Severity, number>;
  byDimension: Record<QualityDimension, number>;
}

export function emptyRollup(): QualityRollup {
  return {
    total: 0,
    bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    byDimension: {
      COMPLETENESS: 0,
      TIMELINESS: 0,
      VALIDITY: 0,
      CONSISTENCY: 0,
      STATISTICAL: 0,
      TEMPORAL: 0,
      REPEATED_VALUE: 0,
    },
  };
}

export function rollup(findings: QualityFinding[]): QualityRollup {
  const result = emptyRollup();
  for (const finding of findings) {
    result.total += 1;
    result.bySeverity[finding.severity] += 1;
    result.byDimension[finding.dimension] += 1;
  }
  return result;
}
