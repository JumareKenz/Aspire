import type { Scorecard } from '../scoring/types';
import type { QualityFinding } from '../quality/types';
import type { Contribution } from '../analytics/attribution';
import { attributeChange } from '../analytics/attribution';
import { round } from '../analytics/stats';
import type { Insight, Recommendation } from './types';

export interface InsightInput {
  /** Scorecard for the scope being summarised, e.g. the state. */
  parent: Scorecard;
  /** Previous-period scorecard for the same scope, when available. */
  parentPrevious: Scorecard | null;
  /** Scorecards for the children of that scope, e.g. its LGAs. */
  children: Scorecard[];
  /** Previous-period scorecards for those children, keyed by org unit id. */
  childrenPrevious: Map<string, Scorecard>;
  /** Open quality findings within the scope. */
  findings: QualityFinding[];
}

function evidencePct(value: number | null): string {
  return value === null ? 'not available' : `${round(value, 1)}`;
}

/**
 * Derives the "what needs attention" and "what changed" content of the Overview.
 *
 * Every insight is produced from computed figures and carries the evidence it
 * was derived from; nothing here is generated text about unverified claims.
 */
export function generateInsights(input: InsightInput): Insight[] {
  const insights: Insight[] = [];
  const period = input.parent.periodId;

  // Units below the methodology's attention threshold.
  for (const child of input.children) {
    if (child.overallScore === null || child.status !== 'NEEDS_ATTENTION') continue;
    insights.push({
      id: `below-target:${child.orgUnitId}:${period}`,
      kind: 'BELOW_TARGET',
      severity: child.overallScore < 40 ? 'HIGH' : 'MEDIUM',
      headline: `${child.orgUnitName} is below the attention threshold`,
      detail: `${child.orgUnitName} scored ${evidencePct(child.overallScore)} out of 100 for ${child.periodLabel}, against an on-track threshold of ${child.domains[0]?.target ?? 75}. Data confidence for this unit is ${child.dataConfidence.score}%.`,
      orgUnitId: child.orgUnitId,
      orgUnitName: child.orgUnitName,
      indicatorId: null,
      periodId: period,
      evidence: [
        { label: 'Overall score', value: evidencePct(child.overallScore) },
        { label: 'Data confidence', value: `${child.dataConfidence.score}%` },
        { label: 'Indicator coverage', value: `${Math.round(child.coverage * 100)}%` },
      ],
      magnitude: 100 - (child.overallScore ?? 0),
      href: `/performance?orgUnit=${child.orgUnitId}&period=${period}`,
    });
  }

  // Units whose score fell materially since the previous period.
  for (const child of input.children) {
    const prior = input.childrenPrevious.get(child.orgUnitId);
    if (!prior || prior.overallScore === null || child.overallScore === null) continue;
    const delta = round(child.overallScore - prior.overallScore, 1);
    if (delta > -3) continue;
    insights.push({
      id: `decline:${child.orgUnitId}:${period}`,
      kind: 'DECLINE',
      severity: delta <= -8 ? 'HIGH' : 'MEDIUM',
      headline: `${child.orgUnitName} declined ${Math.abs(delta)} points`,
      detail: `Performance in ${child.orgUnitName} moved from ${prior.overallScore} to ${child.overallScore} between ${prior.periodLabel} and ${child.periodLabel}.`,
      orgUnitId: child.orgUnitId,
      orgUnitName: child.orgUnitName,
      indicatorId: null,
      periodId: period,
      evidence: [
        { label: prior.periodLabel, value: String(prior.overallScore) },
        { label: child.periodLabel, value: String(child.overallScore) },
        { label: 'Change', value: `${delta} points` },
      ],
      magnitude: Math.abs(delta) * 4,
      href: `/performance?orgUnit=${child.orgUnitId}&period=${period}`,
    });
  }

  // Units that improved materially — good news is also decision-relevant.
  const improvements = input.children
    .map((child) => {
      const prior = input.childrenPrevious.get(child.orgUnitId);
      if (!prior || prior.overallScore === null || child.overallScore === null) return null;
      return { child, prior, delta: round(child.overallScore - prior.overallScore, 1) };
    })
    .filter((entry): entry is { child: Scorecard; prior: Scorecard; delta: number } => entry !== null)
    .filter((entry) => entry.delta >= 5)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2);

  for (const { child, prior, delta } of improvements) {
    insights.push({
      id: `improvement:${child.orgUnitId}:${period}`,
      kind: 'IMPROVEMENT',
      severity: 'LOW',
      headline: `${child.orgUnitName} improved ${delta} points`,
      detail: `${child.orgUnitName} rose from ${prior.overallScore} to ${child.overallScore}, the strongest movement in the scope this period.`,
      orgUnitId: child.orgUnitId,
      orgUnitName: child.orgUnitName,
      indicatorId: null,
      periodId: period,
      evidence: [
        { label: prior.periodLabel, value: String(prior.overallScore) },
        { label: child.periodLabel, value: String(child.overallScore) },
        { label: 'Change', value: `+${delta} points` },
      ],
      magnitude: delta,
      href: `/performance?orgUnit=${child.orgUnitId}&period=${period}`,
    });
  }

  // Domains driving the parent's own movement.
  if (input.parentPrevious) {
    const contributions = attributeChange(input.parentPrevious, input.parent);
    const dominant = contributions.filter((c) => c.contributionPoints < -0.5).slice(0, 1);
    for (const contribution of dominant) {
      insights.push({
        id: `change:${contribution.id}:${period}`,
        kind: 'CHANGE',
        severity: contribution.contributionPoints <= -2 ? 'HIGH' : 'MEDIUM',
        headline: `${contribution.name} accounts for ${Math.round(contribution.share * 100)}% of the overall change`,
        detail: `${contribution.name} moved ${contribution.changePoints} points and carries ${Math.round(contribution.weight * 100)}% of the overall weight, making it the largest single contributor to this period's movement.`,
        orgUnitId: input.parent.orgUnitId,
        orgUnitName: input.parent.orgUnitName,
        indicatorId: null,
        periodId: period,
        evidence: [
          { label: 'Domain change', value: `${contribution.changePoints} points` },
          { label: 'Weight', value: `${Math.round(contribution.weight * 100)}%` },
          { label: 'Share of overall change', value: `${Math.round(contribution.share * 100)}%` },
        ],
        magnitude: Math.abs(contribution.contributionPoints) * 10,
        href: `/performance?orgUnit=${input.parent.orgUnitId}&domain=${contribution.id}&period=${period}`,
      });
    }
  }

  // Data-quality problems severe enough to change how performance should be read.
  const lowConfidence = input.children
    .filter((child) => child.dataConfidence.band === 'LOW')
    .sort((a, b) => a.dataConfidence.score - b.dataConfidence.score)
    .slice(0, 3);

  for (const child of lowConfidence) {
    insights.push({
      id: `quality:${child.orgUnitId}:${period}`,
      kind: 'DATA_QUALITY',
      severity: 'HIGH',
      headline: `Performance for ${child.orgUnitName} cannot be read with confidence`,
      detail: `Data confidence is ${child.dataConfidence.score}%. ${child.dataConfidence.reasons[0] ?? 'Underlying reporting is incomplete.'} Treat the reported score for this unit as provisional until reporting improves.`,
      orgUnitId: child.orgUnitId,
      orgUnitName: child.orgUnitName,
      indicatorId: null,
      periodId: period,
      evidence: [
        { label: 'Data confidence', value: `${child.dataConfidence.score}%` },
        { label: 'Completeness', value: `${child.dataConfidence.components.completeness}%` },
        { label: 'Reported score', value: evidencePct(child.overallScore) },
      ],
      magnitude: (100 - child.dataConfidence.score) * 1.5,
      href: `/intelligence/data-quality?orgUnit=${child.orgUnitId}&period=${period}`,
    });
  }

  return insights.sort((a, b) => b.magnitude - a.magnitude);
}

export interface RecommendationInput extends InsightInput {
  /** Domain-level attribution for the scope, used to name likely drivers. */
  contributions: Contribution[];
}

/**
 * Produces specific, evidence-bearing recommendations.
 *
 * A recommendation is only emitted when the platform can name the unit, the
 * indicators, and the figures behind it. Generic advice is not produced.
 */
export function generateRecommendations(input: RecommendationInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const child of input.children) {
    const prior = input.childrenPrevious.get(child.orgUnitId);
    if (child.overallScore === null) continue;

    const decliningIndicators = child.domains
      .flatMap((domain) => domain.indicators)
      .filter((indicator) => indicator.trend.direction === 'DECLINING' && indicator.score !== null)
      .sort((a, b) => (a.trend.changePct ?? 0) - (b.trend.changePct ?? 0))
      .slice(0, 3);

    const unitFindings = input.findings.filter(
      (finding) => finding.orgUnitId === child.orgUnitId && finding.status === 'OPEN',
    );

    // Low confidence is a reporting problem, not a programme problem. Naming it
    // correctly prevents a data issue being actioned as a service issue.
    if (child.dataConfidence.band === 'LOW') {
      const completeness = child.dataConfidence.components.completeness;
      recommendations.push({
        id: `rec-quality:${child.orgUnitId}:${child.periodId}`,
        title: `Restore reporting completeness in ${child.orgUnitName} before acting on its score`,
        issue: `Data confidence in ${child.orgUnitName} is ${child.dataConfidence.score}%, which is too low to distinguish a service problem from a reporting problem.`,
        location: child.orgUnitName,
        orgUnitId: child.orgUnitId,
        indicatorIds: [],
        evidence: [
          { label: 'Data confidence', value: `${child.dataConfidence.score}%` },
          { label: 'Reporting completeness', value: `${completeness}%` },
          { label: 'Open quality findings', value: String(unitFindings.length) },
        ],
        likelyDriver:
          completeness < 80
            ? 'Reporting units within this LGA are not submitting their datasets on schedule.'
            : 'Submitted data contains values that fail validity or consistency checks.',
        nextStep: `Confirm which reporting units in ${child.orgUnitName} have outstanding submissions for ${child.periodLabel}, and resolve the ${unitFindings.length} open data-quality findings before the score is used for decisions.`,
        priority: 'HIGH',
        confidence: 0.85,
      });
      continue;
    }

    if (decliningIndicators.length === 0) continue;
    const delta =
      prior && prior.overallScore !== null ? round(child.overallScore - prior.overallScore, 1) : null;
    if (child.status === 'ON_TRACK' && (delta === null || delta > -3)) continue;

    const names = decliningIndicators.map((i) => i.name);
    recommendations.push({
      id: `rec-performance:${child.orgUnitId}:${child.periodId}`,
      title: `Review ${names[0].toLowerCase()} in ${child.orgUnitName}`,
      issue: `${child.orgUnitName} scored ${child.overallScore} out of 100 for ${child.periodLabel}${
        delta === null ? '' : `, a change of ${delta} points on the previous period`
      }, with ${decliningIndicators.length} indicator${decliningIndicators.length === 1 ? '' : 's'} in sustained decline.`,
      location: child.orgUnitName,
      orgUnitId: child.orgUnitId,
      indicatorIds: decliningIndicators.map((i) => i.indicatorId),
      evidence: [
        { label: 'Overall score', value: String(child.overallScore) },
        ...decliningIndicators.map((indicator) => ({
          label: indicator.name,
          value: `${indicator.value ?? '—'} against a target of ${indicator.target}${
            indicator.trend.changePct === null ? '' : ` (${round(indicator.trend.changePct, 1)}% over ${indicator.trend.periods} periods)`
          }`,
        })),
        { label: 'Data confidence', value: `${child.dataConfidence.score}%` },
      ],
      likelyDriver: `Sustained decline concentrated in ${names.slice(0, 2).join(' and ')} rather than across all domains, which points to a service-delivery or commodity issue specific to those services.`,
      nextStep: `Commission a targeted programme review of ${names.slice(0, 2).join(' and ')} in ${child.orgUnitName}, examining service availability and commodity supply at the facilities contributing most to the decline.`,
      priority: child.status === 'NEEDS_ATTENTION' ? 'HIGH' : 'MEDIUM',
      confidence: round(Math.min(0.9, 0.5 + (child.dataConfidence.score / 100) * 0.4), 2),
    });
  }

  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return recommendations.sort(
    (a, b) => order[a.priority] - order[b.priority] || b.confidence - a.confidence,
  );
}
