import type { ReportingRecord } from '../model/types';
import { clamp, round } from '../analytics/stats';
import type { DataConfidence } from '../scoring/types';
import type { QualityFinding } from './types';

/**
 * Relative importance of each dimension in the composite confidence figure.
 * Completeness dominates because absent data is the failure mode most likely to
 * make a performance figure misleading.
 */
export const CONFIDENCE_WEIGHTS = {
  completeness: 0.4,
  timeliness: 0.15,
  validity: 0.15,
  consistency: 0.15,
  stability: 0.15,
} as const;

/**
 * Confidence can never exceed reporting completeness by more than this margin.
 *
 * Without this ceiling a scope whose data is half missing but internally tidy
 * would still score in the seventies, because the four remaining dimensions can
 * only assess the data that did arrive. Confidence in evidence that is largely
 * absent has to be capped by how much of it is there.
 */
export const COMPLETENESS_CEILING_MARGIN = 25;

export interface ConfidenceInput {
  /** Reporting records in scope, used for completeness and timeliness. */
  reporting: ReportingRecord[];
  /** Quality findings in scope, used for the remaining dimensions. */
  findings: QualityFinding[];
  /**
   * Number of indicator/period value slots that were checked. Used to convert
   * finding counts into a rate rather than an unbounded penalty.
   */
  checkedValues: number;
}

function penaltyScore(offenders: number, total: number, severityFactor: number): number {
  if (total <= 0) return 100;
  const rate = clamp(offenders / total, 0, 1);
  return round(clamp(100 - rate * 100 * severityFactor, 0, 100), 1);
}

function severityWeightedCount(findings: QualityFinding[]): number {
  return findings.reduce((acc, finding) => {
    if (finding.status === 'RESOLVED' || finding.status === 'DISMISSED') return acc;
    return acc + (finding.severity === 'HIGH' ? 1 : finding.severity === 'MEDIUM' ? 0.5 : 0.25);
  }, 0);
}

function band(score: number): DataConfidence['band'] {
  if (score >= 80) return 'HIGH';
  if (score >= 55) return 'MODERATE';
  return 'LOW';
}

/**
 * Computes data confidence for a scope. This is deliberately independent of the
 * performance score: it answers "how much should we trust this evidence?", not
 * "how well are we doing?".
 */
export function computeDataConfidence(input: ConfidenceInput): DataConfidence {
  const expected = input.reporting.filter((r) => r.expected);
  const reported = expected.filter((r) => r.reported);
  const completeness = expected.length === 0 ? 100 : round((reported.length / expected.length) * 100, 1);

  const onTime = reported.filter(
    (r) => r.submittedAt !== null && new Date(r.submittedAt) <= new Date(`${r.dueDate}T23:59:59Z`),
  );
  const timeliness = reported.length === 0 ? 100 : round((onTime.length / reported.length) * 100, 1);

  const checked = Math.max(input.checkedValues, 1);
  const validity = penaltyScore(
    severityWeightedCount(input.findings.filter((f) => f.dimension === 'VALIDITY')),
    checked,
    12,
  );
  const consistency = penaltyScore(
    severityWeightedCount(input.findings.filter((f) => f.dimension === 'CONSISTENCY')),
    checked,
    12,
  );
  const stability = penaltyScore(
    severityWeightedCount(
      input.findings.filter(
        (f) =>
          f.dimension === 'STATISTICAL' ||
          f.dimension === 'TEMPORAL' ||
          f.dimension === 'REPEATED_VALUE',
      ),
    ),
    checked,
    8,
  );

  const components = { completeness, timeliness, validity, consistency, stability };
  const weighted =
    completeness * CONFIDENCE_WEIGHTS.completeness +
    timeliness * CONFIDENCE_WEIGHTS.timeliness +
    validity * CONFIDENCE_WEIGHTS.validity +
    consistency * CONFIDENCE_WEIGHTS.consistency +
    stability * CONFIDENCE_WEIGHTS.stability;
  const score = round(Math.min(weighted, completeness + COMPLETENESS_CEILING_MARGIN), 1);

  const reasons: string[] = [];
  if (weighted > completeness + COMPLETENESS_CEILING_MARGIN) {
    reasons.push(
      'Confidence is limited by how much of the expected data is present, not by the quality of what was received.',
    );
  }
  if (completeness < 95) {
    reasons.push(
      `${Math.round(100 - completeness)}% of expected reporting submissions are missing for this scope.`,
    );
  }
  if (timeliness < 90) {
    reasons.push(`${Math.round(100 - timeliness)}% of received submissions arrived after their deadline.`);
  }
  if (validity < 95) reasons.push('Some reported values fall outside the possible range for their indicator.');
  if (consistency < 95) reasons.push('Some indicators report a numerator larger than their denominator.');
  if (stability < 95) reasons.push('Unusual spikes, level shifts or repeated values were detected in recent reporting.');

  return { score, band: band(score), components, reasons };
}
