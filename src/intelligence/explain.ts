import type { AnalyticalResult, AnswerSection } from './types';

/**
 * Deterministic explanation.
 *
 * Prose is assembled from findings that have already been computed and
 * validated. No model is required for the platform to answer well, and when one
 * is used (see `narrate.ts`) it is given exactly these findings and asked only
 * to phrase them.
 *
 * Answers stay short on purpose. A user who wants the full picture opens the
 * evidence table beneath, which is right there.
 */
export function explain(result: AnalyticalResult): AnswerSection[] {
  const sections: AnswerSection[] = [];

  if (result.findings.length > 0) {
    sections.push({
      heading: null,
      body: result.findings
        .slice(0, 3)
        .map((finding) => finding.statement)
        .join(' '),
    });
  }

  if (result.rows.length > 0) {
    const label =
      result.query.kind === 'EXPLAIN_CHANGE'
        ? 'Main drivers'
        : result.query.kind === 'DATA_QUALITY'
          ? 'Findings'
          : result.query.kind === 'COMPARE_UNITS'
            ? 'By domain'
            : 'Most affected';
    const names = result.rows
      .slice(0, 3)
      .map((row) => String(row.cells.area ?? row.cells.name ?? row.cells.domain ?? row.cells.issue ?? ''))
      .filter(Boolean);
    if (names.length > 0) {
      sections.push({ heading: label, body: names.map((name, index) => `${index + 1}. ${name}`).join('\n') });
    }
  }

  if (result.caveats.length > 0) {
    sections.push({ heading: 'Read with care', body: result.caveats.join(' ') });
  }

  sections.push({ heading: 'Basis', body: result.basis });
  return sections;
}
