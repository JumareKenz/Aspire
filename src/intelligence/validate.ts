import type { AnalyticalResult } from './types';

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  message: string;
}

const NUMBER_PATTERN = /-?\d+(?:\.\d+)?/g;

/**
 * Not every digit in a sentence is a measurement.
 *
 * Two kinds are stripped before the evidence check:
 *
 *  - **Scale notation** — "out of 100", "/100" states how a score is expressed.
 *  - **Period references** — "Q2 2026", "2026Q2", "202603" name a reporting
 *    period. They are identifiers, and demanding that every finding carry the
 *    year as evidence would make the check noise rather than signal.
 *
 * What remains is the set of figures a reader could reasonably ask to trace,
 * and each of those must appear in the finding's own evidence.
 */
function withoutNonMeasurements(value: string): string {
  return value
    .replace(/\bout of 100\b/gi, '')
    .replace(/\/\s*100\b/g, '')
    .replace(/\bQ[1-4]\s+\d{4}\b/gi, '')
    .replace(/\b\d{4}Q[1-4]\b/gi, '')
    .replace(/\b\d{6}\b/g, '');
}

function numbersIn(value: string): string[] {
  return (withoutNonMeasurements(value).match(NUMBER_PATTERN) ?? []).map((entry) => String(Number(entry)));
}

/**
 * Checks a computed result before anything is written about it.
 *
 * The important rule is the last one: every figure quoted in a finding must
 * also appear in that finding's own evidence. This is what stops a number from
 * entering the narrative without a traceable source, and it is checked whether
 * the finding was assembled by the platform or, later, rephrased by a model.
 */
export function validateResult(result: AnalyticalResult): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (result.query.limit !== undefined && result.rows.length > result.query.limit) {
    issues.push({
      severity: 'ERROR',
      message: `Result returned ${result.rows.length} rows for a limit of ${result.query.limit}.`,
    });
  }

  // Ranks must always be distinct — two areas cannot both be third. They must
  // additionally be in ascending order only for the query kinds that promise
  // rank ordering; a "most improved" list is deliberately ordered by movement
  // while still reporting each area's overall rank.
  const ranks = result.rows
    .map((row) => row.cells.rank)
    .filter((value): value is number => typeof value === 'number');
  if (new Set(ranks).size !== ranks.length) {
    issues.push({ severity: 'ERROR', message: 'Ranked rows contain duplicate ranks.' });
  }
  // Rank-ordered results must be monotonic, but either direction is valid:
  // "which area is weakest" legitimately returns rank 14 first.
  const rankOrdered = result.query.kind === 'RANK_UNITS' || result.query.kind === 'BELOW_TARGET';
  if (rankOrdered && ranks.length > 1) {
    const ascending = ranks.every((rank, index) => index === 0 || rank > ranks[index - 1]);
    const descending = ranks.every((rank, index) => index === 0 || rank < ranks[index - 1]);
    if (!ascending && !descending) {
      issues.push({ severity: 'ERROR', message: 'Ranked rows are not in rank order.' });
    }
  }

  // Scores are 0..100 by construction; anything else means a scoring bug.
  for (const row of result.rows) {
    const score = row.cells.score;
    if (typeof score === 'number' && (score < 0 || score > 100)) {
      issues.push({
        severity: 'ERROR',
        message: `Score ${score} for ${String(row.cells.area ?? row.refId)} is outside 0–100.`,
      });
    }
    const confidence = row.cells.confidence;
    if (typeof confidence === 'number' && (confidence < 0 || confidence > 100)) {
      issues.push({
        severity: 'ERROR',
        message: `Data confidence ${confidence} is outside 0–100.`,
      });
    }
  }

  for (const finding of result.findings) {
    const quoted = numbersIn(finding.statement);
    const supported = new Set(finding.evidence.flatMap((item) => numbersIn(item.value)));
    const unsupported = quoted.filter((value) => !supported.has(value));
    if (unsupported.length > 0) {
      issues.push({
        severity: 'WARNING',
        message: `Statement quotes ${unsupported.join(', ')} without matching evidence.`,
      });
    }
  }

  return issues;
}

/** True when the result is safe to present. Errors block; warnings annotate. */
export function isPresentable(issues: ValidationIssue[]): boolean {
  return !issues.some((issue) => issue.severity === 'ERROR');
}
