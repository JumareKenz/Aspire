import { round } from '../analytics/stats';
import type { DomainScore, Scorecard } from './types';

/**
 * How a published score is made up, term by term.
 *
 * A domain score is the weighted mean of its indicators' scores over the
 * indicators that have one; the overall score is the weighted mean of the
 * domain scores over the domains that have one. Each entry's contribution is
 * its score times its share of the weight that was actually used, so the
 * contributions add up to the published figure (to rounding). The breakdown
 * panels show exactly these terms, which is what lets a reader reconcile the
 * card with the records behind it.
 */
export interface ScoreTerm {
  id: string;
  name: string;
  score: number | null;
  /** Share of the weight actually used, 0..1. Zero when the term had no score. */
  share: number;
  /** score × share, in points. Null when the term had no score. */
  contribution: number | null;
}

export interface ScoreExplanation {
  score: number | null;
  terms: ScoreTerm[];
  /** Sum of the contributions, for reconciliation against `score`. */
  total: number | null;
  /** Terms that had no score and were excluded under the missing-data rule. */
  excluded: number;
}

function explain(
  score: number | null,
  entries: Array<{ id: string; name: string; score: number | null; weight: number }>,
): ScoreExplanation {
  const used = entries.filter((entry) => entry.score !== null).reduce((sum, entry) => sum + entry.weight, 0);
  const terms = entries.map((entry) => {
    const share = entry.score === null || used <= 0 ? 0 : entry.weight / used;
    return {
      id: entry.id,
      name: entry.name,
      score: entry.score,
      share: round(share, 4),
      contribution: entry.score === null ? null : round(entry.score * share, 2),
    };
  });
  const scored = terms.filter((term) => term.contribution !== null);
  return {
    score,
    terms,
    total: score === null || scored.length === 0 ? null : round(scored.reduce((sum, term) => sum + term.contribution!, 0), 1),
    excluded: terms.length - scored.length,
  };
}

export function explainDomain(domain: DomainScore): ScoreExplanation {
  return explain(
    domain.score,
    domain.indicators.map((indicator) => ({
      id: indicator.indicatorId,
      name: indicator.name,
      score: indicator.score,
      weight: indicator.effectiveWeight,
    })),
  );
}

export function explainOverall(scorecard: Scorecard): ScoreExplanation {
  return explain(
    scorecard.overallScore,
    scorecard.domains.map((domain) => ({
      id: domain.domainId,
      name: domain.name,
      score: domain.score,
      weight: domain.effectiveWeight,
    })),
  );
}
