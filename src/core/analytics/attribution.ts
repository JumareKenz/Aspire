import type { Scorecard } from '../scoring/types';
import { round } from './stats';

export interface Contribution {
  id: string;
  name: string;
  /** Points of the parent's change explained by this component. */
  contributionPoints: number;
  /** Share 0..1 of the total absolute change explained by this component. */
  share: number;
  /** The component's own change in points. */
  changePoints: number;
  weight: number;
}

/**
 * Decomposes the change in an overall score into per-domain contributions, and
 * a domain's change into per-indicator contributions.
 *
 * This is what lets the platform answer "which indicators are driving the
 * decline?" with arithmetic rather than assertion: a component's contribution
 * is its weight multiplied by its own movement.
 */
export function attributeChange(previous: Scorecard, current: Scorecard): Contribution[] {
  const previousDomains = new Map(previous.domains.map((d) => [d.domainId, d]));
  const raw = current.domains
    .map((domain) => {
      const before = previousDomains.get(domain.domainId);
      if (!before || before.score === null || domain.score === null) return null;
      const changePoints = domain.score - before.score;
      return {
        id: domain.domainId,
        name: domain.name,
        changePoints: round(changePoints, 1),
        weight: domain.effectiveWeight,
        contributionPoints: round(changePoints * domain.effectiveWeight, 2),
      };
    })
    .filter((entry): entry is Omit<Contribution, 'share'> => entry !== null);

  const totalAbs = raw.reduce((acc, entry) => acc + Math.abs(entry.contributionPoints), 0);
  return raw
    .map((entry) => ({
      ...entry,
      share: totalAbs === 0 ? 0 : round(Math.abs(entry.contributionPoints) / totalAbs, 3),
    }))
    .sort((a, b) => Math.abs(b.contributionPoints) - Math.abs(a.contributionPoints));
}

/** Same decomposition one level down, within a single domain. */
export function attributeDomainChange(
  previous: Scorecard,
  current: Scorecard,
  domainId: string,
): Contribution[] {
  const before = previous.domains.find((d) => d.domainId === domainId);
  const after = current.domains.find((d) => d.domainId === domainId);
  if (!before || !after) return [];
  const beforeIndicators = new Map(before.indicators.map((i) => [i.indicatorId, i]));

  const raw = after.indicators
    .map((indicator) => {
      const prior = beforeIndicators.get(indicator.indicatorId);
      if (!prior || prior.score === null || indicator.score === null) return null;
      const changePoints = indicator.score - prior.score;
      return {
        id: indicator.indicatorId,
        name: indicator.name,
        changePoints: round(changePoints, 1),
        weight: indicator.effectiveWeight,
        contributionPoints: round(changePoints * indicator.effectiveWeight, 2),
      };
    })
    .filter((entry): entry is Omit<Contribution, 'share'> => entry !== null);

  const totalAbs = raw.reduce((acc, entry) => acc + Math.abs(entry.contributionPoints), 0);
  return raw
    .map((entry) => ({
      ...entry,
      share: totalAbs === 0 ? 0 : round(Math.abs(entry.contributionPoints) / totalAbs, 3),
    }))
    .sort((a, b) => Math.abs(b.contributionPoints) - Math.abs(a.contributionPoints));
}

export interface RankedUnit {
  orgUnitId: string;
  orgUnitName: string;
  score: number | null;
  rank: number;
  changePoints: number | null;
  status: Scorecard['status'];
  dataConfidence: number;
}

/**
 * Ranks org units by score, highest first. Units without a publishable score
 * are ranked last and keep a null score rather than being silently zeroed.
 */
export function rankScorecards(
  cards: Scorecard[],
  previousById?: Map<string, Scorecard>,
): RankedUnit[] {
  const sorted = [...cards].sort((a, b) => {
    if (a.overallScore === null && b.overallScore === null) return a.orgUnitName.localeCompare(b.orgUnitName);
    if (a.overallScore === null) return 1;
    if (b.overallScore === null) return -1;
    return b.overallScore - a.overallScore;
  });

  return sorted.map((card, index) => {
    const prior = previousById?.get(card.orgUnitId);
    const changePoints =
      prior && prior.overallScore !== null && card.overallScore !== null
        ? round(card.overallScore - prior.overallScore, 1)
        : null;
    return {
      orgUnitId: card.orgUnitId,
      orgUnitName: card.orgUnitName,
      score: card.overallScore,
      rank: index + 1,
      changePoints,
      status: card.status,
      dataConfidence: card.dataConfidence.score,
    };
  });
}
