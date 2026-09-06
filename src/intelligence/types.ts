import type { EvidenceItem } from '@/core/quality/types';

/**
 * The structured analytical query.
 *
 * This is the contract at the heart of the Intelligence workspace. A question
 * in English is turned into one of these — by rules, or by a language model
 * that is only allowed to emit this shape — and the *platform* then executes it
 * against stored data. The model never computes, never aggregates and never
 * sees a figure it did not receive from an executed query.
 */
export const QUERY_KINDS = [
  'RANK_UNITS',
  'BELOW_TARGET',
  'MOST_IMPROVED',
  'EXPLAIN_CHANGE',
  'INDICATOR_TREND',
  'COMPARE_UNITS',
  'DATA_QUALITY',
  'RISK_OUTLOOK',
  'SUMMARY',
] as const;
export type QueryKind = (typeof QUERY_KINDS)[number];

export interface AnalyticalQuery {
  kind: QueryKind;
  /** Geography the question is about. Defaults to the user's scope root. */
  orgUnitId: string;
  /** Reporting period. Defaults to the latest complete period. */
  periodId: string;
  /** Indicator the question names, when it names one. */
  indicatorId?: string | null;
  /** Domain the question names, when it names one. */
  domainId?: string | null;
  /** Specific units being compared, for COMPARE_UNITS. */
  compareOrgUnitIds?: string[];
  /** How many rows the answer should return. */
  limit?: number;
  /** Sort direction, where the query kind supports it. */
  direction?: 'WORST_FIRST' | 'BEST_FIRST';
}

export interface ResultColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export interface ResultRow {
  /** Org unit or indicator this row is about, for deep links. */
  refId: string | null;
  refKind: 'ORG_UNIT' | 'INDICATOR' | null;
  cells: Record<string, string | number | null>;
}

/** A single verified statement of fact, with the figures behind it. */
export interface Finding {
  statement: string;
  evidence: EvidenceItem[];
}

export interface AnalyticalResult {
  query: AnalyticalQuery;
  /** One-line answer to the question as asked. */
  headline: string;
  /** Verified statements the explanation may draw on, and nothing else. */
  findings: Finding[];
  columns: ResultColumn[];
  rows: ResultRow[];
  /** Human note about scope, period and methodology used. */
  basis: string;
  /** Warnings that qualify the answer, e.g. low data confidence. */
  caveats: string[];
  /** Where the user should go to inspect this themselves. */
  href: string | null;
}

export interface AnswerSection {
  heading: string | null;
  body: string;
}

export interface Answer {
  question: string;
  /** Null when the question could not be turned into a query. */
  result: AnalyticalResult | null;
  /** Markdown-ish sections rendered by the UI. */
  sections: AnswerSection[];
  /** How the question was interpreted, shown so the user can correct it. */
  interpretation: string;
  /** Which planner produced the query. */
  plannedBy: 'RULES' | 'MODEL';
  /** Which writer produced the prose. */
  writtenBy: 'TEMPLATE' | 'MODEL';
  /** True when the platform declined to answer rather than guess. */
  declined: boolean;
}
