import type { QueryKind } from '../types';

/**
 * Evaluation set for the Intelligence pipeline.
 *
 * These are questions with known-correct answers, not questions with
 * plausible-looking answers. The expectations are derived from signals
 * deliberately planted in the demo dataset (documented in
 * `docs/DATA_MODEL.md`), so a regression in intent parsing, scoring, ranking or
 * attribution fails a test rather than quietly producing confident prose.
 *
 * When the platform is connected to a real DHIS2 instance these cases are
 * skipped, because their expected answers describe the demo dataset.
 */
export interface EvalCase {
  id: string;
  question: string;
  /** The query the question must be turned into. */
  expectKind: QueryKind;
  /** The indicator the question must resolve to, where it names one. */
  expectIndicatorId?: string;
  /** Org unit that must be the first row of the result. */
  expectTopRefId?: string;
  /** Org units that must all appear somewhere in the result. */
  expectContainsRefIds?: string[];
  /** Substrings the headline must contain, case-insensitively. */
  expectHeadlineContains?: string[];
  /** The result must return at least this many rows. */
  expectMinRows?: number;
  /** The platform must decline rather than answer. */
  expectDeclined?: boolean;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'lowest-performing-area',
    question: 'Which area has the lowest performance?',
    expectKind: 'RANK_UNITS',
    expectTopRefId: 'lga-balanga',
    expectHeadlineContains: ['balanga', 'lowest'],
  },
  {
    id: 'below-target',
    question: 'Which LGAs are performing below target?',
    expectKind: 'BELOW_TARGET',
    // The four LGAs given a sustained planted decline must all be listed.
    expectContainsRefIds: ['lga-shongom', 'lga-balanga', 'lga-dukku', 'lga-nafada'],
    expectMinRows: 4,
  },
  {
    id: 'most-improved',
    question: 'Which areas improved most?',
    expectKind: 'MOST_IMPROVED',
    expectTopRefId: 'lga-billiri',
    expectHeadlineContains: ['billiri'],
  },
  {
    id: 'why-declining',
    question: 'Why is performance declining?',
    expectKind: 'EXPLAIN_CHANGE',
    // Adolescent SRHR carries the planted decline, so it must be the top driver.
    expectTopRefId: 'adolescent-srhr',
  },
  {
    id: 'adolescent-indicator',
    question: 'How is adolescent family planning uptake doing?',
    expectKind: 'INDICATOR_TREND',
    expectIndicatorId: 'adolescent-fp-uptake',
  },
  {
    id: 'stockouts',
    question: 'What is the trend in contraceptive stock-outs?',
    expectKind: 'INDICATOR_TREND',
    expectIndicatorId: 'contraceptive-stockout',
  },
  {
    id: 'compare-two',
    question: 'Compare Balanga and Billiri',
    expectKind: 'COMPARE_UNITS',
    expectHeadlineContains: ['billiri', 'balanga'],
  },
  {
    id: 'data-quality',
    question: 'Which areas have unusual reporting patterns?',
    expectKind: 'DATA_QUALITY',
    expectMinRows: 1,
  },
  {
    id: 'risk',
    question: 'What are the biggest SRHR risks?',
    expectKind: 'RISK_OUTLOOK',
    expectMinRows: 1,
  },
  {
    id: 'summary',
    question: 'Generate an executive summary',
    expectKind: 'SUMMARY',
    expectMinRows: 1,
  },
  {
    id: 'unknown-indicator',
    question: 'What is the malaria positivity rate?',
    // Malaria is not in the SRHR registry. The platform must not silently
    // answer about something else, and must not invent the indicator.
    expectKind: 'SUMMARY',
    expectIndicatorId: undefined,
  },
];
