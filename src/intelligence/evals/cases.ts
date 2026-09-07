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
  /**
   * Geography the question is asked from. Rank, comparison and below-target
   * questions are answered about the children of the current geography, so a
   * case about LGAs must be asked from inside a state, and a case about states
   * from the programme root.
   */
  fromOrgUnitId?: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'lowest-performing-state',
    question: 'Which state is performing worst?',
    // Asked at the programme root, where the children are the two states.
    // Sokoto is seeded below Bauchi, so this has one correct answer.
    fromOrgUnitId: 'aspire-programme',
    expectKind: 'RANK_UNITS',
    expectTopRefId: 'state-sokoto',
    expectHeadlineContains: ['sokoto', 'lowest'],
  },
  {
    id: 'compare-the-states',
    question: 'Compare Bauchi and Sokoto',
    fromOrgUnitId: 'aspire-programme',
    expectKind: 'COMPARE_UNITS',
    expectHeadlineContains: ['bauchi', 'sokoto'],
    expectMinRows: 2,
  },
  {
    id: 'lowest-performing-area',
    question: 'Which area has the lowest performance?',
    fromOrgUnitId: 'state-bauchi',
    expectKind: 'RANK_UNITS',
    expectTopRefId: 'lga-bauchi-darazo',
    expectHeadlineContains: ['darazo', 'lowest'],
  },
  {
    id: 'below-target',
    question: 'Which LGAs are performing below target?',
    fromOrgUnitId: 'state-bauchi',
    expectKind: 'BELOW_TARGET',
    // The two Bauchi LGAs given a sustained planted decline must be listed.
    expectContainsRefIds: ['lga-bauchi-darazo', 'lga-bauchi-ningi'],
    expectMinRows: 2,
  },
  {
    id: 'below-target-other-state',
    question: 'Which LGAs are performing below target?',
    // The same question inside the other state must find that state's own
    // planted declines, not the first state's.
    fromOrgUnitId: 'state-sokoto',
    expectKind: 'BELOW_TARGET',
    expectContainsRefIds: ['lga-sokoto-isa', 'lga-sokoto-gada'],
    expectMinRows: 2,
  },
  {
    id: 'most-improved',
    question: 'Which areas improved most?',
    fromOrgUnitId: 'state-bauchi',
    expectKind: 'MOST_IMPROVED',
    expectTopRefId: 'lga-bauchi-katagum',
    expectHeadlineContains: ['katagum'],
  },
  {
    id: 'why-declining',
    question: 'Why is performance declining?',
    // Asked inside an LGA that is genuinely declining. Asked at state level the
    // planted declines are offset by the planted improvement and the honest
    // answer is "nothing is driving a decline" — which is a different, also
    // correct, answer and not what this case is testing.
    fromOrgUnitId: 'lga-bauchi-darazo',
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
    question: 'Compare Darazo and Ningi',
    fromOrgUnitId: 'state-bauchi',
    expectKind: 'COMPARE_UNITS',
    expectHeadlineContains: ['darazo', 'ningi'],
  },
  {
    id: 'data-quality',
    question: 'Which areas have unusual reporting patterns?',
    fromOrgUnitId: 'state-sokoto',
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
