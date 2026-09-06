import type { OrgUnit } from '@/core/model/types';
import type { IndicatorDefinition, DomainDefinition } from '@/core/registry/types';
import type { AnalyticalQuery, QueryKind } from './types';

/**
 * Rule-based intent understanding.
 *
 * This is the primary planner, not a fallback. It is deterministic, testable
 * against a fixed answer set, needs no credentials, and cannot invent an
 * indicator that does not exist — it can only select from the registry it is
 * given. A language model may refine the result (see `planner.ts`), but the
 * platform is never dependent on one to answer a question correctly.
 */

export interface IntentContext {
  orgUnits: OrgUnit[];
  indicators: IndicatorDefinition[];
  domains: DomainDefinition[];
  defaultOrgUnitId: string;
  defaultPeriodId: string;
  /** Period ids available, newest last. */
  periodIds: string[];
}

export interface Intent {
  query: AnalyticalQuery;
  /** Plain-language restatement, shown so a user can see how they were read. */
  interpretation: string;
  /** 0..1 confidence in the interpretation. Low values prompt a clarification. */
  confidence: number;
  /** Terms in the question that matched nothing in the registry. */
  unmatched: string[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'in', 'of', 'for', 'and', 'or', 'to', 'is', 'are', 'was', 'were',
  'what', 'which', 'who', 'how', 'why', 'when', 'where', 'me', 'our', 'we', 'us', 'my',
  'show', 'give', 'tell', 'list', 'please', 'do', 'does', 'did', 'has', 'have', 'this',
  'that', 'it', 'be', 'on', 'at', 'by', 'with', 'from', 'about', 'lga', 'lgas', 'state',
  'area', 'areas', 'performance', 'performing', 'data', 'quarter', 'period',
]);

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value: string): string[] {
  return normalise(value).split(' ').filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/**
 * Matches a name against the question by counting distinctive word overlap.
 * Requires a whole-word match so "Ilesan" does not match "iles".
 */
function nameScore(name: string, question: string): number {
  const normalisedQuestion = ` ${normalise(question)} `;
  const nameTokens = tokens(name);
  if (nameTokens.length === 0) return 0;
  const matched = nameTokens.filter((token) => normalisedQuestion.includes(` ${token} `));
  return matched.length / nameTokens.length;
}

/** Aliases for indicators people name in shorthand rather than by full title. */
const INDICATOR_ALIASES: Record<string, string[]> = {
  'anc4-coverage': ['anc', 'anc4', 'antenatal'],
  'skilled-birth-attendance': ['sba', 'skilled birth', 'skilled delivery', 'deliveries'],
  'pnc-48h': ['pnc', 'postnatal'],
  mcpr: ['mcpr', 'contraceptive prevalence'],
  'fp-new-acceptors': ['acceptors', 'new acceptors'],
  'fp-counselling-coverage': ['counselling', 'counseling'],
  'adolescent-fp-uptake': ['adolescent uptake', 'adolescent fp', 'adolescent family planning'],
  'youth-friendly-services': ['youth friendly', 'yfs'],
  'adolescent-anc1': ['adolescent anc'],
  'gbv-clinical-care': ['gbv care', 'gbv clinical'],
  'gbv-referral-completion': ['gbv referral', 'referral completion'],
  'hiv-test-pregnancy': ['hiv testing', 'hiv test', 'pmtct'],
  'sti-management': ['sti'],
  'contraceptive-stockout': ['stockout', 'stock out', 'stock-out', 'stockouts'],
  'essential-medicines-availability': ['essential medicines', 'medicines availability'],
};

const DOMAIN_ALIASES: Record<string, string[]> = {
  'maternal-health': ['maternal'],
  'family-planning': ['family planning', 'fp'],
  'adolescent-srhr': ['adolescent', 'adolescents', 'young people', 'youth'],
  'gbv-response': ['gbv', 'gender based violence', 'gender-based violence'],
  'hiv-sti': ['hiv', 'sti'],
  'commodity-security': ['commodity', 'commodities', 'supply', 'stock'],
};

function matchIndicator(question: string, indicators: IndicatorDefinition[]): IndicatorDefinition | null {
  const lower = normalise(question);
  let best: { indicator: IndicatorDefinition; score: number } | null = null;
  for (const indicator of indicators) {
    let score = Math.max(nameScore(indicator.name, question), nameScore(indicator.shortName, question));
    for (const alias of INDICATOR_ALIASES[indicator.id] ?? []) {
      if (lower.includes(alias)) score = Math.max(score, 0.9 + alias.length / 200);
    }
    if (score >= 0.6 && (!best || score > best.score)) best = { indicator, score };
  }
  return best?.indicator ?? null;
}

function matchDomain(question: string, domains: DomainDefinition[]): DomainDefinition | null {
  const lower = normalise(question);
  for (const domain of domains) {
    if (nameScore(domain.name, question) >= 0.8) return domain;
    for (const alias of DOMAIN_ALIASES[domain.id] ?? []) {
      if (lower.includes(alias)) return domain;
    }
  }
  return null;
}

function matchOrgUnits(question: string, orgUnits: OrgUnit[]): OrgUnit[] {
  return orgUnits
    .map((unit) => ({ unit, score: nameScore(unit.name, question) }))
    .filter((entry) => entry.score >= 0.75)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.unit);
}

/** Recognises an explicit period like "Q1 2026", "2026Q1" or "202603". */
function matchPeriod(question: string, periodIds: string[]): string | null {
  const iso = /\b(\d{4})\s*q\s*([1-4])\b/i.exec(question);
  if (iso) {
    const candidate = `${iso[1]}Q${iso[2]}`;
    if (periodIds.includes(candidate)) return candidate;
  }
  const reversed = /\bq\s*([1-4])\s*(\d{4})\b/i.exec(question);
  if (reversed) {
    const candidate = `${reversed[2]}Q${reversed[1]}`;
    if (periodIds.includes(candidate)) return candidate;
  }
  return null;
}

interface KindRule {
  kind: QueryKind;
  /** All of these must be present. */
  patterns: RegExp[];
  weight: number;
}

// Ordered by specificity: the highest-weight rule whose patterns all match wins.
//
// Suffixes are written out rather than relying on a bare stem: `/\bimprov\b/`
// looks like it matches "improved" and does not, because there is no word
// boundary in the middle of a word. Every stem here therefore carries its own
// explicit ending list.
const KIND_RULES: KindRule[] = [
  {
    kind: 'DATA_QUALITY',
    patterns: [
      /\b(data quality|reporting quality|anomal(?:y|ies|ous)|unusual|suspicious|missing report(?:s|ing)?|incomplete|outlier(?:s)?)\b/i,
    ],
    weight: 5,
  },
  {
    kind: 'COMPARE_UNITS',
    patterns: [/\b(compare(?:d|s)?|comparison|versus|vs\.?|difference between)\b/i],
    weight: 5,
  },
  {
    kind: 'EXPLAIN_CHANGE',
    patterns: [
      /\b(why|what changed|what has changed|driv(?:e|es|ing|er|ers)|caus(?:e|ed|es|ing)|reason(?:s)?|explain(?:s|ed)?|behind)\b/i,
    ],
    weight: 4,
  },
  {
    kind: 'MOST_IMPROVED',
    patterns: [/\b(improv(?:e|es|ed|ing|ement|ements)?|best progress|most progress|gain(?:s|ed)?)\b/i],
    weight: 4,
  },
  {
    kind: 'BELOW_TARGET',
    patterns: [
      /\b(below target|below the target|under target|missing target(?:s)?|off track|below threshold|underperform(?:s|ing|ance)?|not meeting)\b/i,
    ],
    weight: 4,
  },
  {
    kind: 'RISK_OUTLOOK',
    patterns: [
      /\b(risk(?:s|y)?|forecast(?:s|ed|ing)?|predict(?:s|ed|ing|ion|ions)?|outlook|at risk|likely to|expect(?:ed)?)\b/i,
    ],
    weight: 3,
  },
  {
    kind: 'SUMMARY',
    patterns: [/\b(summar(?:y|ise|ize|ised|ized)|brief(?:ing)?|overview|executive)\b/i],
    weight: 3,
  },
  { kind: 'INDICATOR_TREND', patterns: [/\b(trend(?:s|ing)?|over time|history|trajectory)\b/i], weight: 2 },
  {
    kind: 'RANK_UNITS',
    patterns: [
      /\b(rank(?:s|ing|ings)?|worst|lowest|best|highest|top|bottom|which (?:lga|lgas|area|areas|facilit(?:y|ies)))\b/i,
    ],
    weight: 2,
  },
];

/**
 * Turns a question into a structured query.
 *
 * Where the question is ambiguous the interpretation is stated back to the
 * user rather than guessed at silently, and `confidence` drops so the UI can
 * offer a correction.
 */
export function interpret(question: string, context: IntentContext): Intent {
  const indicator = matchIndicator(question, context.indicators);
  const domain = matchDomain(question, context.domains);
  const namedUnits = matchOrgUnits(question, context.orgUnits);
  const period = matchPeriod(question, context.periodIds) ?? context.defaultPeriodId;

  let kind: QueryKind | null = null;
  let weight = 0;
  for (const rule of KIND_RULES) {
    if (rule.weight <= weight) continue;
    if (rule.patterns.every((pattern) => pattern.test(question))) {
      kind = rule.kind;
      weight = rule.weight;
    }
  }

  // Two or more named geographies is a comparison regardless of phrasing.
  if (namedUnits.length >= 2 && kind !== 'DATA_QUALITY') kind = 'COMPARE_UNITS';
  // A named indicator with no other signal is a question about that indicator.
  if (!kind && indicator) kind = 'INDICATOR_TREND';
  if (!kind) kind = 'SUMMARY';

  const direction: AnalyticalQuery['direction'] = /\b(best|highest|top|strongest)\b/i.test(question)
    ? 'BEST_FIRST'
    : 'WORST_FIRST';

  // The geography a question is *about* is its scope, unless the question
  // compares units — then the named units are the subject and the scope stays
  // where the user is.
  const subject =
    kind === 'COMPARE_UNITS'
      ? null
      : (namedUnits.find((unit) => unit.level !== 'FACILITY') ?? namedUnits[0] ?? null);

  const query: AnalyticalQuery = {
    kind,
    orgUnitId: subject?.id ?? context.defaultOrgUnitId,
    periodId: period,
    indicatorId: indicator?.id ?? null,
    domainId: domain?.id ?? null,
    compareOrgUnitIds: kind === 'COMPARE_UNITS' ? namedUnits.slice(0, 3).map((unit) => unit.id) : undefined,
    limit: /\btop\s+(\d+)\b/i.test(question) ? Number(/\btop\s+(\d+)\b/i.exec(question)?.[1]) : undefined,
    direction,
  };

  const scopeName =
    context.orgUnits.find((unit) => unit.id === query.orgUnitId)?.name ?? 'the current geography';
  const interpretation = describe(kind, {
    scopeName,
    period,
    indicatorName: indicator?.name ?? null,
    domainName: domain?.name ?? null,
    unitNames: namedUnits.slice(0, 3).map((unit) => unit.name),
    direction,
  });

  // Confidence reflects how much of the question was actually recognised.
  let confidence = weight > 0 ? 0.75 : 0.4;
  if (indicator || domain) confidence += 0.1;
  if (namedUnits.length > 0) confidence += 0.1;
  if (kind === 'SUMMARY' && weight === 0) confidence = 0.45;

  const questionTokens = tokens(question);
  const recognised = new Set(
    [
      ...(indicator ? tokens(indicator.name) : []),
      ...(domain ? tokens(domain.name) : []),
      ...namedUnits.flatMap((unit) => tokens(unit.name)),
    ].map((token) => token),
  );
  const unmatched = questionTokens.filter(
    (token) => !recognised.has(token) && !KIND_RULES.some((rule) => rule.patterns.some((p) => p.test(token))),
  );

  return { query, interpretation, confidence: Math.min(0.95, confidence), unmatched };
}

function describe(
  kind: QueryKind,
  parts: {
    scopeName: string;
    period: string;
    indicatorName: string | null;
    domainName: string | null;
    unitNames: string[];
    direction: AnalyticalQuery['direction'];
  },
): string {
  const where = `in ${parts.scopeName} for ${parts.period}`;
  switch (kind) {
    case 'RANK_UNITS':
      return `Ranking areas ${where}, ${parts.direction === 'BEST_FIRST' ? 'strongest' : 'weakest'} first.`;
    case 'BELOW_TARGET':
      return `Listing areas below the on-track threshold ${where}.`;
    case 'MOST_IMPROVED':
      return `Ranking areas by improvement on the previous period ${where}.`;
    case 'EXPLAIN_CHANGE':
      return `Attributing the change in ${parts.domainName ?? 'overall performance'} ${where}.`;
    case 'INDICATOR_TREND':
      return `Reporting ${parts.indicatorName ?? 'the named indicator'} ${where}.`;
    case 'COMPARE_UNITS':
      return `Comparing ${parts.unitNames.join(', ')} for ${parts.period}.`;
    case 'DATA_QUALITY':
      return `Listing open data-quality findings ${where}.`;
    case 'RISK_OUTLOOK':
      return `Assessing which areas carry the most risk ${where}.`;
    case 'SUMMARY':
      return `Summarising performance ${where}.`;
    default:
      return `Answering about ${parts.scopeName} for ${parts.period}.`;
  }
}
