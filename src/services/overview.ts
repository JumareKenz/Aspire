import type { Scorecard } from '@/core/scoring/types';
import type { Insight, Recommendation } from '@/core/insight/types';
import type { Contribution } from '@/core/analytics/attribution';
import { attributeChange, rankScorecards, type RankedUnit } from '@/core/analytics/attribution';
import { generateInsights, generateRecommendations } from '@/core/insight/engine';
import { previousPeriodId } from '@/core/model/periods';
import { listFindings } from '@/data/repositories/findings';
import { getReporting } from '@/data/repositories/observations';
import { listDescendants } from '@/data/repositories/orgUnits';
import { rollup, type QualityRollup } from '@/core/quality/types';
import { getChildScorecards, getScorecard } from './scorecards';

export interface ReportingStatus {
  /** Proportion 0..100 of expected submissions received for the period. */
  completeness: number;
  expected: number;
  received: number;
  /** Reporting units with nothing received at all. */
  silentUnits: number;
}

export interface OverviewData {
  scorecard: Scorecard;
  previous: Scorecard | null;
  children: Scorecard[];
  ranking: RankedUnit[];
  insights: Insight[];
  recommendations: Recommendation[];
  contributions: Contribution[];
  reporting: ReportingStatus;
  quality: QualityRollup;
  /** Score series for the scope across the analysis window, oldest first. */
  history: { labels: string[]; values: Array<number | null> };
}

/**
 * Assembles the Overview.
 *
 * The page answers four questions in order — how are we doing, what needs
 * attention, what changed, and why does it matter — so this function computes
 * exactly those and nothing else. Everything returned is derived from stored
 * observations; none of it is narrative written ahead of the data.
 */
export async function getOverview(
  orgUnitId: string,
  periodId: string,
): Promise<OverviewData | null> {
  const scorecard = await getScorecard(orgUnitId, periodId);
  if (!scorecard) return null;

  const previousId = previousPeriodId(periodId);
  const [previous, children, previousChildCards, facilities] = await Promise.all([
    getScorecard(orgUnitId, previousId),
    getChildScorecards(orgUnitId, periodId),
    getChildScorecards(orgUnitId, previousId),
    listDescendants(orgUnitId, 'FACILITY'),
  ]);
  const previousChildren = new Map(previousChildCards.map((card) => [card.orgUnitId, card]));

  const reportingUnits = facilities.length > 0 ? facilities.map((f) => f.id) : [orgUnitId];
  const records = (await getReporting(reportingUnits, [periodId])).filter((record) => record.expected);
  const received = records.filter((record) => record.reported).length;
  const submittedByUnit = new Map<string, number>();
  for (const record of records) {
    if (!record.reported) continue;
    submittedByUnit.set(record.orgUnitId, (submittedByUnit.get(record.orgUnitId) ?? 0) + 1);
  }

  const reporting: ReportingStatus = {
    completeness: records.length === 0 ? 100 : Math.round((received / records.length) * 1000) / 10,
    expected: records.length,
    received,
    silentUnits: reportingUnits.filter((id) => !submittedByUnit.has(id)).length,
  };

  const scopeIds = [orgUnitId, ...children.map((child) => child.orgUnitId), ...reportingUnits];
  const findings = await listFindings({ orgUnitIds: scopeIds, status: 'OPEN' });

  const insights = generateInsights({
    parent: scorecard,
    parentPrevious: previous,
    children,
    childrenPrevious: previousChildren,
    findings,
  });

  const contributions = previous ? attributeChange(previous, scorecard) : [];

  const recommendations = generateRecommendations({
    parent: scorecard,
    parentPrevious: previous,
    children,
    childrenPrevious: previousChildren,
    findings,
    contributions,
  });

  return {
    scorecard,
    previous,
    children,
    ranking: rankScorecards(children, previousChildren),
    insights,
    recommendations,
    contributions,
    reporting,
    quality: rollup(findings),
    history: await buildHistory(orgUnitId, periodId),
  };
}

/**
 * Overall score for each period in the analysis window.
 *
 * Each period is scored with the same methodology as the headline figure, so
 * the line and the number can never disagree.
 */
async function buildHistory(
  orgUnitId: string,
  periodId: string,
): Promise<{ labels: string[]; values: Array<number | null> }> {
  const WINDOW = 8;
  let cursor = periodId;
  const ids: string[] = [];
  for (let i = 0; i < WINDOW; i += 1) {
    ids.unshift(cursor);
    cursor = previousPeriodId(cursor);
  }
  const cards = await Promise.all(ids.map((id) => getScorecard(orgUnitId, id)));
  return {
    labels: cards.map((card, index) => card?.periodLabel ?? ids[index]),
    values: cards.map((card) => card?.overallScore ?? null),
  };
}
