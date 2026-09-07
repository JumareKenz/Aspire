import type { User } from '@/data/repositories/users';
import { answerQuestion } from '../answer';
import { EVAL_CASES, type EvalCase } from './cases';

export interface EvalOutcome {
  case: EvalCase;
  passed: boolean;
  failures: string[];
  headline: string | null;
  kind: string | null;
}

/**
 * Runs one case through the full pipeline — intent, execution, validation,
 * explanation — and checks the analytical result, not the prose. Wording may
 * legitimately vary; the answer may not.
 */
export async function runCase(
  testCase: EvalCase,
  user: User,
  defaults: { orgUnitId: string; periodId: string },
): Promise<EvalOutcome> {
  // A case may pin the geography it is asked from. Rank and comparison
  // questions are answered about the *children* of the current geography, so
  // "which area is lowest" means states at the programme root and LGAs inside
  // a state. The cases say which they mean rather than depending on whatever
  // the caller happened to pass.
  const answer = await answerQuestion(testCase.question, user, {
    ...defaults,
    orgUnitId: testCase.fromOrgUnitId ?? defaults.orgUnitId,
  });
  const failures: string[] = [];
  const result = answer.result;

  if (testCase.expectDeclined) {
    if (!answer.declined) failures.push('Expected the platform to decline, but it answered.');
    return {
      case: testCase,
      passed: failures.length === 0,
      failures,
      headline: result?.headline ?? null,
      kind: result?.query.kind ?? null,
    };
  }

  if (!result) {
    failures.push('No analytical result was produced.');
    return { case: testCase, passed: false, failures, headline: null, kind: null };
  }

  if (result.query.kind !== testCase.expectKind) {
    failures.push(`Expected query kind ${testCase.expectKind}, got ${result.query.kind}.`);
  }

  if ('expectIndicatorId' in testCase) {
    const actual = result.query.indicatorId ?? undefined;
    if (actual !== testCase.expectIndicatorId) {
      failures.push(
        `Expected indicator ${testCase.expectIndicatorId ?? 'none'}, got ${actual ?? 'none'}.`,
      );
    }
  }

  if (testCase.expectTopRefId) {
    const top = result.rows[0]?.refId ?? null;
    if (top !== testCase.expectTopRefId) {
      failures.push(`Expected first row ${testCase.expectTopRefId}, got ${top ?? 'no rows'}.`);
    }
  }

  if (testCase.expectContainsRefIds) {
    const present = new Set(result.rows.map((row) => row.refId));
    const missing = testCase.expectContainsRefIds.filter((id) => !present.has(id));
    if (missing.length > 0) failures.push(`Missing expected rows: ${missing.join(', ')}.`);
  }

  if (testCase.expectHeadlineContains) {
    const headline = result.headline.toLowerCase();
    const missing = testCase.expectHeadlineContains.filter((term) => !headline.includes(term.toLowerCase()));
    if (missing.length > 0) failures.push(`Headline missing: ${missing.join(', ')}.`);
  }

  if (testCase.expectMinRows !== undefined && result.rows.length < testCase.expectMinRows) {
    failures.push(`Expected at least ${testCase.expectMinRows} rows, got ${result.rows.length}.`);
  }

  return {
    case: testCase,
    passed: failures.length === 0,
    failures,
    headline: result.headline,
    kind: result.query.kind,
  };
}

export async function runAllCases(
  user: User,
  defaults: { orgUnitId: string; periodId: string },
): Promise<EvalOutcome[]> {
  const outcomes: EvalOutcome[] = [];
  for (const testCase of EVAL_CASES) {
    outcomes.push(await runCase(testCase, user, defaults));
  }
  return outcomes;
}
