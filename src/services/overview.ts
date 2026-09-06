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
export function getOverview(orgUnitId: string, periodId: string): OverviewData | null {
  const scorecard = getScorecard(orgUnitId, periodId);
  if (!scorecard) return null;

  const previousId = previousPeriodId(periodId);
  const previous = getScorecard(orgUnitId, previousId);

  const children = getChildScorecards(orgUnitId, periodId);
  const previousChildren = new Map(
    getChildScorecards(orgUnitId, previousId).map((card) => [card.orgUnitId, card]),
  );

  const facilities = listDescendants(orgUnitId, 'FACILITY');
  const reportingUnits = facilities.length > 0 ? facilities.map((f) => f.id) : [orgUnitId];
  const records = getReporting(reportingUnits, [periodId]).filter((record) => record.expected);
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
  const findings = listFindings({ orgUnitIds: scopeIds, status: 'OPEN' });

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
    history: buildHistory(orgUnitId, periodId),
  };
}

/**
 * Overall score for each period in the analysis window.
 *
 * Each period is scored with the same methodology as the headline figure, so
 * the line and the number can never disagree.
 */
function buildHistory(orgUnitId: string, periodId: string): { labels: string[]; values: Array<number | null> } {
  const WINDOW = 8;
  const labels: string[] = [];
  const values: Array<number | null> = [];
  let cursor = periodId;
  const ids: string[] = [];
  for (let i = 0; i < WINDOW; i += 1) {
    ids.unshift(cursor);
    cursor = previousPeriodId(cursor);
  }
  for (const id of ids) {
    const card = getScorecard(orgUnitId, id);
    labels.push(card?.periodLabel ?? id);
    values.push(card?.overallScore ?? null);
  }
  return { labels, values };
}
