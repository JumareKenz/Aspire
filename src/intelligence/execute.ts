import { attributeChange, attributeDomainChange, rankScorecards } from '@/core/analytics/attribution';
import { round } from '@/core/analytics/stats';
import { previousPeriodId } from '@/core/model/periods';
import { getChildScorecards, getScorecard } from '@/services/scorecards';
import { getIndicatorDetail } from '@/services/indicators';
import { getOrgUnit, listChildren } from '@/data/repositories/orgUnits';
import { listFindings } from '@/data/repositories/findings';
import { getActiveMethodology } from '@/data/repositories/registry';
import type { AnalyticalQuery, AnalyticalResult, Finding, ResultRow } from './types';

/**
 * Executes a structured query against the canonical store.
 *
 * Every number in an answer is produced here, by the same engines that produce
 * the scorecards on screen. That is what makes the two agree, and what makes
 * "the AI said 62" and "the scorecard says 62" the same statement rather than
 * two independent claims.
 */
export interface ExecutionScope {
  /**
   * Org units this user may read. Results are filtered against it after
   * execution as a second line of defence: the query is already scoped, and
   * this ensures no executor branch can widen it by accident.
   */
  permittedOrgUnitIds?: Set<string>;
}

export async function executeQuery(
  query: AnalyticalQuery,
  scope: ExecutionScope = {},
): Promise<AnalyticalResult> {
  const result = await runQuery(query);
  const permitted = scope.permittedOrgUnitIds;
  if (!permitted) return result;

  const rows = result.rows.filter(
    (row) => row.refKind !== 'ORG_UNIT' || row.refId === null || permitted.has(row.refId),
  );
  if (rows.length === result.rows.length) return result;
  return { ...result, rows };
}

async function runQuery(query: AnalyticalQuery): Promise<AnalyticalResult> {
  switch (query.kind) {
    case 'RANK_UNITS':
    case 'BELOW_TARGET':
    case 'MOST_IMPROVED':
      return rankUnits(query);
    case 'EXPLAIN_CHANGE':
      return explainChange(query);
    case 'INDICATOR_TREND':
      return indicatorTrend(query);
    case 'COMPARE_UNITS':
      return compareUnits(query);
    case 'DATA_QUALITY':
      return dataQuality(query);
    case 'RISK_OUTLOOK':
      return riskOutlook(query);
    case 'SUMMARY':
      return summary(query);
    default: {
      const exhaustive: never = query.kind;
      throw new Error(`Unsupported query kind: ${String(exhaustive)}`);
    }
  }
}

async function basisFor(query: AnalyticalQuery): Promise<string> {
  const [orgUnit, methodology] = await Promise.all([getOrgUnit(query.orgUnitId), getActiveMethodology()]);
  return `${orgUnit?.name ?? query.orgUnitId}, ${query.periodId}, scored with ${methodology.version}${
    methodology.status === 'PROVISIONAL' ? ' (provisional)' : ''
  }.`;
}

function confidenceCaveats(cards: Array<{ orgUnitName: string; dataConfidence: { score: number; band: string } }>): string[] {
  const low = cards.filter((card) => card.dataConfidence.band === 'LOW');
  if (low.length === 0) return [];
  return [
    `Data confidence is low for ${low
      .map((card) => `${card.orgUnitName} (${card.dataConfidence.score}%)`)
      .join(', ')}. Treat those figures as provisional.`,
  ];
}

async function rankUnits(query: AnalyticalQuery): Promise<AnalyticalResult> {
  const [parent, children, priorCards] = await Promise.all([
    getScorecard(query.orgUnitId, query.periodId),
    getChildScorecards(query.orgUnitId, query.periodId),
    getChildScorecards(query.orgUnitId, previousPeriodId(query.periodId)),
  ]);
  const previous = new Map(priorCards.map((card) => [card.orgUnitId, card]));
  const ranked = rankScorecards(children, previous);

  let selected = ranked;
  let headline: string;

  if (query.kind === 'BELOW_TARGET') {
    const threshold = (await getActiveMethodology()).statusBands.onTrack;
    selected = ranked.filter((unit) => unit.score !== null && unit.score < threshold);
    headline =
      selected.length === 0
        ? `No area within ${parent?.orgUnitName ?? 'this geography'} is below the on-track threshold of ${threshold}.`
        : `${selected.length} of ${ranked.length} areas are below the on-track threshold of ${threshold}.`;
  } else if (query.kind === 'MOST_IMPROVED') {
    selected = [...ranked]
      .filter((unit) => unit.changePoints !== null)
      .sort((a, b) => (b.changePoints ?? 0) - (a.changePoints ?? 0));
    headline =
      selected.length === 0
        ? 'No area has a comparable previous period, so improvement cannot be measured.'
        : `${selected[0].orgUnitName} improved most, by ${selected[0].changePoints} points.`;
  } else {
    selected = query.direction === 'BEST_FIRST' ? ranked : [...ranked].reverse();
    headline =
      selected.length === 0
        ? 'There are no areas beneath this geography.'
        : `${selected[0].orgUnitName} ${
            query.direction === 'BEST_FIRST' ? 'has the highest' : 'has the lowest'
          } overall score, at ${selected[0].score}.`;
  }

  const limited = selected.slice(0, query.limit ?? 10);
  const findings: Finding[] = limited.slice(0, 3).map((unit) => ({
    statement: `${unit.orgUnitName} scored ${unit.score ?? 'no score'} out of 100${
      unit.changePoints === null ? '' : `, a change of ${unit.changePoints} points on the previous period`
    }.`,
    evidence: [
      { label: 'Overall score', value: String(unit.score ?? '—') },
      { label: 'Rank', value: `${unit.rank} of ${ranked.length}` },
      { label: 'Change on previous period', value: unit.changePoints === null ? '—' : `${unit.changePoints} points` },
      { label: 'Data confidence', value: `${unit.dataConfidence}%` },
    ],
  }));

  return {
    query,
    headline,
    findings,
    columns: [
      { key: 'rank', label: 'Rank', numeric: true },
      { key: 'area', label: 'Area' },
      { key: 'score', label: 'Score', numeric: true },
      { key: 'change', label: 'Change', numeric: true },
      { key: 'status', label: 'Status' },
      { key: 'confidence', label: 'Data confidence', numeric: true },
    ],
    rows: limited.map<ResultRow>((unit) => ({
      refId: unit.orgUnitId,
      refKind: 'ORG_UNIT',
      cells: {
        rank: unit.rank,
        area: unit.orgUnitName,
        score: unit.score,
        change: unit.changePoints,
        status: unit.status.toLowerCase().replace('_', ' '),
        confidence: unit.dataConfidence,
      },
    })),
    basis: await basisFor(query),
    caveats: confidenceCaveats(children.filter((card) => limited.some((u) => u.orgUnitId === card.orgUnitId))),
    href: `/performance?orgUnit=${query.orgUnitId}&period=${query.periodId}`,
  };
}

async function explainChange(query: AnalyticalQuery): Promise<AnalyticalResult> {
  const priorId = previousPeriodId(query.periodId);
  const [current, prior] = await Promise.all([
    getScorecard(query.orgUnitId, query.periodId),
    getScorecard(query.orgUnitId, priorId),
  ]);

  if (!current || !prior || current.overallScore === null || prior.overallScore === null) {
    return {
      query,
      headline: 'There is no comparable previous period, so the change cannot be explained.',
      findings: [],
      columns: [],
      rows: [],
      basis: await basisFor(query),
      caveats: ['A scored previous period is required before change can be attributed.'],
      href: null,
    };
  }

  const delta = round(current.overallScore - prior.overallScore, 1);
  const contributions = query.domainId
    ? attributeDomainChange(prior, current, query.domainId)
    : attributeChange(prior, current);

  const drivers = contributions.filter((entry) => Math.abs(entry.contributionPoints) > 0.05).slice(0, 5);
  const negative = drivers.filter((entry) => entry.contributionPoints < 0);

  // Statements quote the signed change, which is what the evidence records.
  // Restating it as "down 0.4" against evidence of "-0.4" would leave a figure
  // in the prose that cannot be traced, and the validator would rightly say so.
  const findings: Finding[] = [
    {
      statement: `Overall performance moved ${delta} points, from ${prior.overallScore} in ${
        prior.periodLabel
      } to ${current.overallScore} in ${current.periodLabel}.`,
      evidence: [
        { label: prior.periodLabel, value: String(prior.overallScore) },
        { label: current.periodLabel, value: String(current.overallScore) },
        { label: 'Change', value: `${delta} points` },
      ],
    },
    ...negative.slice(0, 3).map<Finding>((entry) => ({
      statement: `${entry.name} contributed ${entry.contributionPoints} points of the change, ${Math.round(
        entry.share * 100,
      )}% of the total movement.`,
      evidence: [
        { label: 'Own movement', value: `${entry.changePoints} points` },
        { label: 'Weight', value: `${Math.round(entry.weight * 100)}%` },
        { label: 'Contribution', value: `${entry.contributionPoints} points` },
        { label: 'Share of total movement', value: `${Math.round(entry.share * 100)}%` },
      ],
    })),
  ];

  return {
    query,
    headline:
      negative.length === 0
        ? `Performance moved ${delta} points, with no single area driving a decline.`
        : `Performance moved ${delta} points, driven mainly by ${negative[0].name}.`,
    findings,
    columns: [
      { key: 'name', label: query.domainId ? 'Indicator' : 'Domain' },
      { key: 'change', label: 'Own change', numeric: true },
      { key: 'weight', label: 'Weight', numeric: true },
      { key: 'contribution', label: 'Contribution', numeric: true },
      { key: 'share', label: 'Share of change', numeric: true },
    ],
    rows: drivers.map<ResultRow>((entry) => ({
      refId: entry.id,
      refKind: query.domainId ? 'INDICATOR' : null,
      cells: {
        name: entry.name,
        change: entry.changePoints,
        weight: `${Math.round(entry.weight * 100)}%`,
        contribution: entry.contributionPoints,
        share: `${Math.round(entry.share * 100)}%`,
      },
    })),
    basis: await basisFor(query),
    caveats: confidenceCaveats([current]),
    href: `/performance?orgUnit=${query.orgUnitId}&period=${query.periodId}`,
  };
}

async function indicatorTrend(query: AnalyticalQuery): Promise<AnalyticalResult> {
  if (!query.indicatorId) {
    return declined(query, 'The question did not name an indicator the platform recognises.');
  }
  const detail = await getIndicatorDetail(query.orgUnitId, query.indicatorId, query.periodId);
  if (!detail) return declined(query, 'That indicator is not configured for this geography.');

  const suffix = detail.indicator.unit === 'PERCENT' ? '%' : '';
  const findings: Finding[] = [
    {
      statement: `${detail.indicator.name} in ${detail.orgUnitName} is ${
        detail.value === null ? 'not reported' : `${detail.value}${suffix}`
      } for ${detail.periodLabel}, ${detail.target === null ? 'with no target set for this area and period' : `against a target of ${detail.target}${suffix}`}.`,
      evidence: [
        { label: 'Current value', value: detail.value === null ? '—' : `${detail.value}${suffix}` },
        { label: 'Target', value: detail.target === null ? 'Not set' : `${detail.target}${suffix}` },
        { label: 'Achievement', value: detail.achievementPct === null ? '—' : `${detail.achievementPct}%` },
      ],
    },
    {
      statement:
        detail.trend.direction === 'UNKNOWN'
          ? 'There is not enough reporting history to establish a trend for this indicator.'
          : `The indicator is ${detail.trend.direction.toLowerCase()}, ${detail.trend.changePct}% across ${
              detail.trend.periods
            } reporting periods.`,
      evidence: [
        { label: 'Direction', value: detail.trend.direction.toLowerCase() },
        { label: 'Change', value: detail.trend.changePct === null ? '—' : `${detail.trend.changePct}%` },
        { label: 'Periods', value: String(detail.trend.periods) },
      ],
    },
  ];

  return {
    query,
    headline: `${detail.indicator.name} in ${detail.orgUnitName}: ${
      detail.value === null ? 'no value reported' : `${detail.value}${suffix}`
    }${detail.target === null ? ', with no target set' : ` against a target of ${detail.target}${suffix}`}.`,
    findings,
    columns: [
      { key: 'area', label: 'Area' },
      { key: 'value', label: 'Value', numeric: true },
      { key: 'change', label: 'Change on previous', numeric: true },
      { key: 'trend', label: 'Trend' },
    ],
    rows: detail.contributors.slice(0, query.limit ?? 8).map<ResultRow>((entry) => ({
      refId: entry.orgUnitId,
      refKind: 'ORG_UNIT',
      cells: {
        area: entry.orgUnitName,
        value: entry.value,
        change: entry.changePct === null ? null : `${entry.changePct}%`,
        trend: entry.trend.direction.toLowerCase(),
      },
    })),
    basis: await basisFor(query),
    caveats: detail.findings.length > 0
      ? [`${detail.findings.length} open data-quality finding(s) touch this indicator.`]
      : [],
    href: `/performance?orgUnit=${query.orgUnitId}&period=${query.periodId}`,
  };
}

async function compareUnits(query: AnalyticalQuery): Promise<AnalyticalResult> {
  const ids = (query.compareOrgUnitIds ?? []).slice(0, 3);
  if (ids.length < 2) {
    return declined(query, 'Two or more geographies the platform recognises are needed for a comparison.');
  }
  const cards = (await Promise.all(ids.map((id) => getScorecard(id, query.periodId)))).filter(
    (card): card is NonNullable<typeof card> => card !== null,
  );
  if (cards.length < 2) {
    return declined(query, 'At least one of the named geographies has no stored reporting for this period.');
  }

  const sorted = [...cards].sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));
  const best = sorted[0].overallScore;
  const worst = sorted[sorted.length - 1].overallScore;
  const gap = best !== null && worst !== null ? round(best - worst, 1) : null;

  const findings: Finding[] = cards.map((card) => ({
    statement: `${card.orgUnitName} scored ${card.overallScore ?? 'no score'} out of 100 for ${
      card.periodLabel
    }, with ${card.dataConfidence.score}% data confidence.`,
    evidence: [
      { label: 'Overall score', value: String(card.overallScore ?? '—') },
      { label: 'Status', value: card.status.toLowerCase().replace('_', ' ') },
      { label: 'Data confidence', value: `${card.dataConfidence.score}%` },
    ],
  }));

  // Domain-by-domain rows make the comparison answerable rather than decorative.
  const domainIds = cards[0].domains.map((domain) => domain.domainId);
  const rows: ResultRow[] = domainIds.map((domainId) => {
    const cells: Record<string, string | number | null> = {
      domain: cards[0].domains.find((domain) => domain.domainId === domainId)?.name ?? domainId,
    };
    for (const card of cards) {
      cells[card.orgUnitId] = card.domains.find((domain) => domain.domainId === domainId)?.score ?? null;
    }
    return { refId: domainId, refKind: null, cells };
  });

  return {
    query,
    headline:
      gap === null
        ? `${sorted[0].orgUnitName} scores highest of the geographies compared.`
        : `${sorted[0].orgUnitName} leads ${sorted[sorted.length - 1].orgUnitName} by ${gap} points.`,
    findings,
    columns: [
      { key: 'domain', label: 'Domain' },
      ...cards.map((card) => ({ key: card.orgUnitId, label: card.orgUnitName, numeric: true })),
    ],
    rows,
    basis: `${cards.map((card) => card.orgUnitName).join(', ')}, ${query.periodId}, scored with ${
      cards[0].methodologyVersion
    }.`,
    caveats: confidenceCaveats(cards),
    href: `/performance?orgUnit=${cards[0].orgUnitId}&period=${query.periodId}`,
  };
}

async function dataQuality(query: AnalyticalQuery): Promise<AnalyticalResult> {
  const children = await listChildren(query.orgUnitId);
  const scope = [query.orgUnitId, ...children.map((child) => child.id)];
  const findings = await listFindings({ orgUnitIds: scope, status: 'OPEN', limit: query.limit ?? 12 });

  if (findings.length === 0) {
    return {
      query,
      headline: 'No open data-quality findings for this scope.',
      findings: [],
      columns: [],
      rows: [],
      basis: await basisFor(query),
      caveats: [],
      href: '/intelligence/data-quality',
    };
  }

  const high = findings.filter((finding) => finding.severity === 'HIGH');
  return {
    query,
    headline: `${findings.length} open data-quality findings, ${high.length} of them high severity.`,
    findings: findings.slice(0, 3).map<Finding>((finding) => ({
      statement: `${finding.orgUnitName}: ${finding.title}. ${finding.reason}`,
      evidence: finding.evidence,
    })),
    columns: [
      { key: 'severity', label: 'Severity' },
      { key: 'dimension', label: 'Type' },
      { key: 'area', label: 'Area' },
      { key: 'issue', label: 'Issue' },
      { key: 'period', label: 'Period' },
    ],
    rows: findings.map<ResultRow>((finding) => ({
      refId: finding.orgUnitId,
      refKind: 'ORG_UNIT',
      cells: {
        severity: finding.severity.toLowerCase(),
        dimension: finding.dimension.toLowerCase().replace('_', ' '),
        area: finding.orgUnitName,
        issue: finding.title,
        period: finding.periodId,
      },
    })),
    basis: await basisFor(query),
    caveats: [],
    href: '/intelligence/data-quality',
  };
}

async function riskOutlook(query: AnalyticalQuery): Promise<AnalyticalResult> {
  const [children, priorCards, methodology] = await Promise.all([
    getChildScorecards(query.orgUnitId, query.periodId),
    getChildScorecards(query.orgUnitId, previousPeriodId(query.periodId)),
    getActiveMethodology(),
  ]);
  const previous = new Map(priorCards.map((card) => [card.orgUnitId, card]));

  // Risk here is defined and computed, not asserted: distance below the
  // threshold, recent movement, and how much the evidence can be trusted.
  const threshold = methodology.statusBands.onTrack;
  const scored = children
    .filter((card) => card.overallScore !== null)
    .map((card) => {
      const prior = previous.get(card.orgUnitId);
      const change =
        prior && prior.overallScore !== null && card.overallScore !== null
          ? round(card.overallScore - prior.overallScore, 1)
          : null;
      const shortfall = Math.max(0, threshold - (card.overallScore ?? 0));
      const momentum = change !== null && change < 0 ? Math.abs(change) : 0;
      const uncertainty = Math.max(0, 100 - card.dataConfidence.score) / 10;
      return { card, change, risk: round(shortfall + momentum * 2 + uncertainty, 1) };
    })
    .filter((entry) => entry.risk > 0)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, query.limit ?? 6);

  if (scored.length === 0) {
    return {
      query,
      headline: 'No area in this scope is currently below threshold, declining or short of reliable data.',
      findings: [],
      columns: [],
      rows: [],
      basis: await basisFor(query),
      caveats: [],
      href: `/performance?orgUnit=${query.orgUnitId}&period=${query.periodId}`,
    };
  }

  return {
    query,
    headline: `${scored[0].card.orgUnitName} carries the highest risk, from a combination of shortfall against threshold, recent decline and data confidence.`,
    findings: scored.slice(0, 3).map<Finding>((entry) => ({
      statement: `${entry.card.orgUnitName} scores ${entry.card.overallScore} against a threshold of ${threshold}${
        entry.change === null ? '' : `, moved ${entry.change} points`
      }, with ${entry.card.dataConfidence.score}% data confidence.`,
      evidence: [
        { label: 'Score', value: String(entry.card.overallScore) },
        { label: 'On-track threshold', value: String(threshold) },
        { label: 'Change', value: entry.change === null ? '—' : `${entry.change} points` },
        { label: 'Data confidence', value: `${entry.card.dataConfidence.score}%` },
      ],
    })),
    columns: [
      { key: 'area', label: 'Area' },
      { key: 'score', label: 'Score', numeric: true },
      { key: 'change', label: 'Change', numeric: true },
      { key: 'confidence', label: 'Data confidence', numeric: true },
      { key: 'risk', label: 'Risk index', numeric: true },
    ],
    rows: scored.map<ResultRow>((entry) => ({
      refId: entry.card.orgUnitId,
      refKind: 'ORG_UNIT',
      cells: {
        area: entry.card.orgUnitName,
        score: entry.card.overallScore,
        change: entry.change,
        confidence: entry.card.dataConfidence.score,
        risk: entry.risk,
      },
    })),
    basis: `${await basisFor(query)} Risk index combines shortfall against threshold, recent movement and data confidence.`,
    caveats: confidenceCaveats(scored.map((entry) => entry.card)),
    href: `/performance?orgUnit=${query.orgUnitId}&period=${query.periodId}`,
  };
}

async function summary(query: AnalyticalQuery): Promise<AnalyticalResult> {
  const card = await getScorecard(query.orgUnitId, query.periodId);
  if (!card || card.overallScore === null) {
    return declined(query, 'There is not enough reported data to summarise this period.');
  }
  const [children, priorCards] = await Promise.all([
    getChildScorecards(query.orgUnitId, query.periodId),
    getChildScorecards(query.orgUnitId, previousPeriodId(query.periodId)),
  ]);
  const previous = new Map(priorCards.map((entry) => [entry.orgUnitId, entry]));
  const ranked = rankScorecards(children, previous);
  const attention = ranked.filter((unit) => unit.status === 'NEEDS_ATTENTION');
  const weakest = [...card.domains]
    .filter((domain) => domain.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];

  const findings: Finding[] = [
    {
      statement: `${card.orgUnitName} scored ${card.overallScore} out of 100 for ${card.periodLabel}, which is ${card.status
        .toLowerCase()
        .replace('_', ' ')}.`,
      evidence: [
        { label: 'Overall score', value: String(card.overallScore) },
        { label: 'Trend', value: card.trend.direction.toLowerCase() },
        { label: 'Data confidence', value: `${card.dataConfidence.score}%` },
      ],
    },
  ];
  if (weakest) {
    findings.push({
      statement: `${weakest.name} is the weakest domain at ${weakest.score}, and is ${weakest.trend.direction.toLowerCase()}.`,
      evidence: [
        { label: 'Domain score', value: String(weakest.score) },
        { label: 'Trend', value: weakest.trend.direction.toLowerCase() },
      ],
    });
  }
  if (ranked.length > 0) {
    findings.push({
      statement: `${attention.length} of ${ranked.length} areas need attention; ${ranked[0].orgUnitName} performs best at ${ranked[0].score} and ${
        ranked[ranked.length - 1].orgUnitName
      } lowest at ${ranked[ranked.length - 1].score}.`,
      evidence: [
        { label: 'Areas needing attention', value: String(attention.length) },
        { label: 'Areas scored', value: String(ranked.length) },
        { label: 'Highest', value: `${ranked[0].orgUnitName} (${ranked[0].score})` },
        {
          label: 'Lowest',
          value: `${ranked[ranked.length - 1].orgUnitName} (${ranked[ranked.length - 1].score})`,
        },
      ],
    });
  }

  return {
    query,
    headline: `${card.orgUnitName} scored ${card.overallScore} out of 100 for ${card.periodLabel}.`,
    findings,
    columns: [
      { key: 'domain', label: 'Domain' },
      { key: 'score', label: 'Score', numeric: true },
      { key: 'status', label: 'Status' },
      { key: 'trend', label: 'Trend' },
    ],
    rows: card.domains.map<ResultRow>((domain) => ({
      refId: domain.domainId,
      refKind: null,
      cells: {
        domain: domain.name,
        score: domain.score,
        status: domain.status.toLowerCase().replace('_', ' '),
        trend: domain.trend.direction.toLowerCase(),
      },
    })),
    basis: await basisFor(query),
    caveats: confidenceCaveats([card]),
    href: `/performance?orgUnit=${query.orgUnitId}&period=${query.periodId}`,
  };
}

async function declined(query: AnalyticalQuery, reason: string): Promise<AnalyticalResult> {
  return {
    query,
    headline: reason,
    findings: [],
    columns: [],
    rows: [],
    basis: await basisFor(query),
    caveats: [reason],
    href: null,
  };
}
