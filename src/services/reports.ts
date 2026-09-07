import type { Scorecard } from '@/core/scoring/types';
import type { QualityFinding } from '@/core/quality/types';
import type { Insight, Recommendation } from '@/core/insight/types';
import type { RankedUnit, Contribution } from '@/core/analytics/attribution';
import { rankScorecards, attributeChange } from '@/core/analytics/attribution';
import { generateInsights, generateRecommendations } from '@/core/insight/engine';
import { previousPeriodId } from '@/core/model/periods';
import { listFindings } from '@/data/repositories/findings';
import { listChildren, listDescendants } from '@/data/repositories/orgUnits';
import { getDataMode, getLastSyncAt } from '@/data/repositories/settings';
import { getSourceAdapter } from '@/data/sources';
import { getChildScorecards, getScorecard } from './scorecards';
import { compareStates, type StateComparison } from './states';

export const REPORT_TYPES = [
  'EXECUTIVE_BRIEF',
  'QUARTERLY_PERFORMANCE',
  'STATE_COMPARISON',
  'AREA_PERFORMANCE',
  'DATA_QUALITY',
  'INTELLIGENCE_SUMMARY',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_META: Record<ReportType, { title: string; description: string; audience: string }> = {
  EXECUTIVE_BRIEF: {
    title: 'Executive brief',
    description: 'One page: overall performance, what changed, what needs attention, and what is recommended.',
    audience: 'Ministry and agency leadership',
  },
  QUARTERLY_PERFORMANCE: {
    title: 'Quarterly SRHR performance report',
    description: 'Full scorecard, domain detail, area ranking and period-on-period movement.',
    audience: 'Programme management and technical review',
  },
  STATE_COMPARISON: {
    title: 'Cross-state comparison',
    description:
      'The programme states side by side: overall score, every domain, where the gap is widest, and where they are moving in opposite directions.',
    audience: 'Programme leadership and cross-state coordination',
  },
  AREA_PERFORMANCE: {
    title: 'Area performance report',
    description: 'A single geography in depth: every domain, every indicator, and its reporting record.',
    audience: 'LGA and facility supervision',
  },
  DATA_QUALITY: {
    title: 'Data-quality report',
    description: 'Completeness, timeliness and detected anomalies, with the evidence behind each finding.',
    audience: 'M&E and data management',
  },
  INTELLIGENCE_SUMMARY: {
    title: 'Intelligence summary',
    description: 'Automatically identified insights and evidence-based recommendations for the period.',
    audience: 'Programme leads and technical working groups',
  },
};

export interface ReportSection {
  heading: string;
  /** Narrative paragraphs, each assembled from computed figures. */
  paragraphs: string[];
  table?: {
    caption: string;
    columns: string[];
    rows: Array<Array<string | number | null>>;
  };
}

export interface GeneratedReport {
  type: ReportType;
  title: string;
  orgUnitName: string;
  periodLabel: string;
  generatedAt: string;
  /** Provenance shown on the report itself, so a printed copy is still honest. */
  provenance: {
    mode: 'DEMO' | 'DHIS2';
    sourceLabel: string;
    lastSyncAt: string | null;
    methodologyVersion: string;
    methodologyStatus: string;
  };
  sections: ReportSection[];
}

interface Assembled {
  scorecard: Scorecard;
  previous: Scorecard | null;
  children: Scorecard[];
  ranking: RankedUnit[];
  contributions: Contribution[];
  insights: Insight[];
  recommendations: Recommendation[];
  findings: QualityFinding[];
}

async function assemble(orgUnitId: string, periodId: string): Promise<Assembled | null> {
  const scorecard = await getScorecard(orgUnitId, periodId);
  if (!scorecard) return null;
  const priorId = previousPeriodId(periodId);
  const [previous, children, priorChildren, directChildren, facilities] = await Promise.all([
    getScorecard(orgUnitId, priorId),
    getChildScorecards(orgUnitId, periodId),
    getChildScorecards(orgUnitId, priorId),
    listChildren(orgUnitId),
    listDescendants(orgUnitId, 'FACILITY'),
  ]);
  const childrenPrevious = new Map(priorChildren.map((card) => [card.orgUnitId, card]));
  const scope = [
    orgUnitId,
    ...directChildren.map((child) => child.id),
    ...facilities.map((unit) => unit.id),
  ];
  const findings = await listFindings({ orgUnitIds: scope, status: 'OPEN' });
  const contributions = previous ? attributeChange(previous, scorecard) : [];

  return {
    scorecard,
    previous,
    children,
    ranking: rankScorecards(children, childrenPrevious),
    contributions,
    insights: generateInsights({
      parent: scorecard,
      parentPrevious: previous,
      children,
      childrenPrevious,
      findings,
    }),
    recommendations: generateRecommendations({
      parent: scorecard,
      parentPrevious: previous,
      children,
      childrenPrevious,
      findings,
      contributions,
    }),
    findings,
  };
}

/**
 * Builds a report from stored data.
 *
 * Every sentence here is assembled from figures that were computed by the same
 * engines the screens use. Nothing is written ahead of the data, and a report
 * that has nothing to say says so rather than being padded.
 */
export async function generateReport(
  type: ReportType,
  orgUnitId: string,
  periodId: string,
): Promise<GeneratedReport | null> {
  const data = await assemble(orgUnitId, periodId);
  if (!data) return null;
  const { scorecard } = data;

  // A cross-state report is only producible where the selected geography
  // actually contains more than one state. The caller has already checked the
  // geography against the user's scope, so states beneath it are states they
  // may read; there is nothing further to authorise here, and nothing to leak
  // when there is only one.
  let comparison: StateComparison | null = null;
  if (type === 'STATE_COMPARISON') {
    comparison = await compareStates(await listDescendants(orgUnitId, 'STATE'), periodId);
    if (!comparison) return null;
  }

  const provenance = {
    mode: await getDataMode(),
    sourceLabel: getSourceAdapter().label,
    lastSyncAt: await getLastSyncAt(),
    methodologyVersion: scorecard.methodologyVersion,
    methodologyStatus: scorecard.methodologyStatus,
  };

  const base = {
    type,
    title: REPORT_META[type].title,
    orgUnitName: scorecard.orgUnitName,
    periodLabel: scorecard.periodLabel,
    generatedAt: new Date().toISOString(),
    provenance,
  };

  switch (type) {
    case 'EXECUTIVE_BRIEF':
      return { ...base, sections: executiveBrief(data) };
    case 'QUARTERLY_PERFORMANCE':
      return { ...base, sections: quarterlyPerformance(data) };
    case 'STATE_COMPARISON':
      return { ...base, sections: stateComparisonReport(comparison!) };
    case 'AREA_PERFORMANCE':
      return { ...base, sections: areaPerformance(data) };
    case 'DATA_QUALITY':
      return { ...base, sections: dataQualityReport(data) };
    case 'INTELLIGENCE_SUMMARY':
      return { ...base, sections: intelligenceSummary(data) };
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown report type: ${String(exhaustive)}`);
    }
  }
}

function headlineParagraph(data: Assembled): string {
  const { scorecard, previous } = data;
  const movement =
    previous && previous.overallScore !== null && scorecard.overallScore !== null
      ? `That is a change of ${Math.round((scorecard.overallScore - previous.overallScore) * 10) / 10} points on ${previous.periodLabel}.`
      : 'No comparable previous period is available.';
  return `${scorecard.orgUnitName} scored ${scorecard.overallScore ?? 'no publishable score'} out of 100 for ${scorecard.periodLabel}, which the methodology classifies as ${scorecard.status
    .toLowerCase()
    .replace('_', ' ')}. ${movement} Data confidence for the period is ${scorecard.dataConfidence.score}%, which is ${scorecard.dataConfidence.band.toLowerCase()}.`;
}

function executiveBrief(data: Assembled): ReportSection[] {
  const { scorecard, ranking, insights, recommendations, contributions } = data;
  const attention = ranking.filter((unit) => unit.status === 'NEEDS_ATTENTION');
  const sections: ReportSection[] = [
    { heading: 'Position', paragraphs: [headlineParagraph(data)] },
  ];

  const decliners = contributions.filter((entry) => entry.contributionPoints < 0).slice(0, 3);
  sections.push({
    heading: 'What changed',
    paragraphs:
      decliners.length > 0
        ? [
            `The largest negative contributions came from ${decliners
              .map((entry) => `${entry.name} (${entry.contributionPoints} points)`)
              .join(', ')}. Contribution is a domain's own movement multiplied by its weight in the methodology.`,
          ]
        : ['No domain contributed a material decline this period.'],
  });

  sections.push({
    heading: 'What needs attention',
    paragraphs:
      insights.length > 0
        ? insights.slice(0, 4).map((insight) => `${insight.headline}. ${insight.detail}`)
        : ['No area in scope fell below the attention threshold or lost data confidence this period.'],
    table:
      attention.length > 0
        ? {
            caption: 'Areas below the attention threshold',
            columns: ['Area', 'Score', 'Change', 'Data confidence'],
            rows: attention.map((unit) => [
              unit.orgUnitName,
              unit.score,
              unit.changePoints,
              `${unit.dataConfidence}%`,
            ]),
          }
        : undefined,
  });

  sections.push({
    heading: 'Recommended next steps',
    paragraphs:
      recommendations.length > 0
        ? recommendations.slice(0, 3).map((entry) => `${entry.title}. ${entry.nextStep}`)
        : ['No recommendation met the evidence threshold this period.'],
  });

  sections.push({
    heading: 'How to read this',
    paragraphs: [
      `Performance and data confidence are separate measures. Performance is ${scorecard.overallScore ?? '—'} out of 100; data confidence is ${scorecard.dataConfidence.score}%. A high score resting on low confidence is a reporting finding, not a programme finding.`,
    ],
  });

  return sections;
}

function quarterlyPerformance(data: Assembled): ReportSection[] {
  const { scorecard, ranking, contributions } = data;
  return [
    { heading: 'Summary', paragraphs: [headlineParagraph(data)] },
    {
      heading: 'Domain scorecard',
      paragraphs: [
        `Each domain is scored from its indicators and weighted according to ${scorecard.methodologyVersion}.`,
      ],
      table: {
        caption: `SRHR scorecard — ${scorecard.orgUnitName}, ${scorecard.periodLabel}`,
        columns: ['Domain', 'Score', 'Threshold', 'Status', 'Trend', 'Indicator coverage'],
        rows: scorecard.domains.map((domain) => [
          domain.name,
          domain.score,
          domain.target,
          domain.status.toLowerCase().replace('_', ' '),
          domain.trend.direction.toLowerCase(),
          `${Math.round(domain.coverage * 100)}%`,
        ]),
      },
    },
    {
      heading: 'Movement by domain',
      paragraphs:
        contributions.length > 0
          ? ['Contribution is each domain’s own change multiplied by its weight in the methodology.']
          : ['No comparable previous period is available, so movement cannot be attributed.'],
      table:
        contributions.length > 0
          ? {
              caption: 'Contribution to the overall change',
              columns: ['Domain', 'Own change', 'Weight', 'Contribution', 'Share of change'],
              rows: contributions.map((entry) => [
                entry.name,
                entry.changePoints,
                `${Math.round(entry.weight * 100)}%`,
                entry.contributionPoints,
                `${Math.round(entry.share * 100)}%`,
              ]),
            }
          : undefined,
    },
    {
      heading: 'Areas',
      paragraphs: [`${ranking.length} areas were scored for this period.`],
      table: {
        caption: 'Area ranking',
        columns: ['Rank', 'Area', 'Score', 'Change', 'Status', 'Data confidence'],
        rows: ranking.map((unit) => [
          unit.rank,
          unit.orgUnitName,
          unit.score,
          unit.changePoints,
          unit.status.toLowerCase().replace('_', ' '),
          `${unit.dataConfidence}%`,
        ]),
      },
    },
  ];
}

function areaPerformance(data: Assembled): ReportSection[] {
  const { scorecard } = data;
  const sections: ReportSection[] = [
    { heading: 'Summary', paragraphs: [headlineParagraph(data)] },
  ];

  for (const domain of scorecard.domains) {
    sections.push({
      heading: domain.name,
      paragraphs: [
        `${domain.name} scored ${domain.score ?? 'no publishable score'} against a threshold of ${domain.target}, and is ${domain.trend.direction.toLowerCase()}. ${Math.round(
          domain.coverage * 100,
        )}% of its weighted indicators reported data.`,
      ],
      table: {
        caption: `${domain.name} indicators`,
        columns: ['Indicator', 'Value', 'Target', 'Achievement', 'Score', 'Status', 'Trend'],
        rows: domain.indicators.map((indicator) => [
          indicator.name,
          indicator.value,
          indicator.target,
          indicator.achievementPct === null ? null : `${indicator.achievementPct}%`,
          indicator.score,
          indicator.status.toLowerCase().replace('_', ' '),
          indicator.trend.direction.toLowerCase(),
        ]),
      },
    });
  }

  return sections;
}

function dataQualityReport(data: Assembled): ReportSection[] {
  const { scorecard, findings } = data;
  const confidence = scorecard.dataConfidence;
  const bySeverity = {
    HIGH: findings.filter((finding) => finding.severity === 'HIGH').length,
    MEDIUM: findings.filter((finding) => finding.severity === 'MEDIUM').length,
    LOW: findings.filter((finding) => finding.severity === 'LOW').length,
  };

  return [
    {
      heading: 'Data confidence',
      paragraphs: [
        `Data confidence for ${scorecard.orgUnitName} in ${scorecard.periodLabel} is ${confidence.score}% (${confidence.band.toLowerCase()}). This measures the evidence, not the performance.`,
        ...(confidence.reasons.length > 0 ? confidence.reasons : ['No material quality concerns were detected.']),
      ],
      table: {
        caption: 'Confidence components',
        columns: ['Component', 'Score'],
        rows: Object.entries(confidence.components).map(([key, value]) => [key, `${value}%`]),
      },
    },
    {
      heading: 'Open findings',
      paragraphs: [
        `${findings.length} findings are open: ${bySeverity.HIGH} high, ${bySeverity.MEDIUM} medium and ${bySeverity.LOW} low severity.`,
      ],
      table: {
        caption: 'Open data-quality findings',
        columns: ['Severity', 'Type', 'Area', 'Indicator', 'Period', 'Issue'],
        rows: findings
          .slice(0, 60)
          .map((finding) => [
            finding.severity.toLowerCase(),
            finding.dimension.toLowerCase().replace('_', ' '),
            finding.orgUnitName,
            finding.indicatorName ?? '—',
            finding.periodId,
            finding.title,
          ]),
      },
    },
  ];
}

function intelligenceSummary(data: Assembled): ReportSection[] {
  const { insights, recommendations } = data;
  return [
    { heading: 'Summary', paragraphs: [headlineParagraph(data)] },
    {
      heading: 'Insights',
      paragraphs:
        insights.length > 0
          ? insights.slice(0, 8).map((insight) => `${insight.headline}. ${insight.detail}`)
          : ['No insight met the significance threshold for this period.'],
    },
    {
      heading: 'Recommendations',
      paragraphs:
        recommendations.length > 0
          ? recommendations.map(
              (entry) =>
                `${entry.title}. ${entry.issue} Likely driver: ${entry.likelyDriver} Recommended: ${entry.nextStep} (priority ${entry.priority.toLowerCase()}, confidence ${Math.round(entry.confidence * 100)}%).`,
            )
          : ['No recommendation met the evidence threshold this period.'],
    },
  ];
}

/**
 * The cross-state comparison report.
 *
 * Everything here is read off the same `compareStates` result the Overview
 * renders, so a printed copy and the screen cannot disagree. Where a figure is
 * not publishable it is left blank rather than filled with a zero.
 */
function stateComparisonReport(comparison: StateComparison): ReportSection[] {
  const { states, domains, widestGaps, diverging, periodLabel } = comparison;
  const ranked = [...states].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const leader = ranked[0];
  const trailer = ranked[ranked.length - 1];
  const gap =
    leader.score !== null && trailer.score !== null
      ? Math.round((leader.score - trailer.score) * 10) / 10
      : null;

  const sections: ReportSection[] = [
    {
      heading: 'Overall',
      paragraphs: [
        gap === null
          ? `Not every state has a publishable overall score for ${periodLabel}, so the states cannot be ranked against one another for this period.`
          : `For ${periodLabel}, ${leader.name} scored ${leader.score} out of 100 and ${trailer.name} scored ${trailer.score}, a difference of ${gap} points. Both are scored on the same methodology and the same indicator set, so the difference is comparable.`,
        `Data confidence is ${states
          .map((state) => `${state.dataConfidence}% in ${state.name}`)
          .join(' and ')}. A comparison is only as good as the weaker of the two.`,
      ],
      table: {
        caption: `Overall performance by state, ${periodLabel}`,
        columns: [
          'State',
          'Overall score',
          'Status',
          'Change on previous period',
          'Data confidence (%)',
          'Indicator coverage (%)',
        ],
        rows: states.map((state) => [
          state.name,
          state.score,
          state.status.replace('_', ' ').toLowerCase(),
          state.changePoints,
          state.dataConfidence,
          Math.round(state.coverage * 100),
        ]),
      },
    },
    {
      heading: 'By domain',
      paragraphs: [
        widestGaps.length > 0 && widestGaps[0].spread !== null
          ? [
              `The widest difference is in ${widestGaps[0].name}, ${widestGaps[0].spread} points apart.`,
              widestGaps.slice(1).filter((row) => row.spread !== null).length > 0
                ? `${widestGaps
                    .slice(1)
                    .filter((row) => row.spread !== null)
                    .map((row) => `${row.name} differs by ${row.spread} points`)
                    .join(', and ')}.`
                : 'No other domain differs by as much.',
            ].join(' ')
          : 'No domain can be compared across the states for this period.',
      ],
      table: {
        caption: `Domain scores by state, ${periodLabel}`,
        columns: ['Domain', ...states.map((state) => state.name), 'Difference', 'Higher'],
        rows: domains.map((row) => [
          row.name,
          ...states.map((state) => row.scores[state.orgUnitId] ?? null),
          row.spread,
          states.find((state) => state.orgUnitId === row.leaderId)?.name ?? null,
        ]),
      },
    },
    {
      heading: 'Moving in opposite directions',
      paragraphs: [
        diverging.length === 0
          ? 'No domain is improving in one state while declining in the other. Where the states differ, they differ in level rather than in direction.'
          : `${diverging.length} ${diverging.length === 1 ? 'domain is' : 'domains are'} moving in opposite directions across the two states. These are the strongest candidates for asking what one state is doing that the other is not.`,
      ],
      ...(diverging.length > 0
        ? {
            table: {
              caption: 'Domains diverging between the states',
              columns: ['Domain', 'Improving in', 'Declining in'],
              rows: diverging.map((row) => [row.name, row.improvingState, row.decliningState]),
            },
          }
        : {}),
    },
    {
      heading: 'How to read this',
      paragraphs: [
        'Both states are scored with the same versioned methodology over the same indicator set, so their scores are directly comparable. A difference in score is not by itself a difference in performance: check the data confidence column first, because a state that reports less completely is measured on less evidence.',
        'This report compares states. It does not explain them. The area ranking inside each state, and the data-quality report for each, are where a difference found here is followed up.',
      ],
    },
  ];

  return sections;
}
