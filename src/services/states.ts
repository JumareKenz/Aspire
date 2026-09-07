import type { OrgUnit } from '@/core/model/types';
import type { Scorecard } from '@/core/scoring/types';
import type { User } from '@/data/repositories/users';
import { isInScope } from '@/auth/rbac';
import { listOrgUnits } from '@/data/repositories/orgUnits';
import { previousPeriodId } from '@/core/model/periods';
import { round } from '@/core/analytics/stats';
import { getScorecard } from './scorecards';

/**
 * Which states a user may read.
 *
 * Role and geography are independent: this is derived from `user.scope` alone,
 * so a state-scoped executive and a state-scoped analyst see the same one
 * state, and a global user of either role sees both. Nothing here consults the
 * role — that would re-introduce the "executive means global" assumption the
 * model exists to avoid.
 */
export async function accessibleStates(user: Pick<User, 'scope'>): Promise<OrgUnit[]> {
  const states = await listOrgUnits('STATE');
  return states.filter((state) => isInScope(user.scope, state.path));
}

/** True when the user can genuinely compare — they hold more than one state. */
export async function hasCrossStateAccess(user: Pick<User, 'scope'>): Promise<boolean> {
  return (await accessibleStates(user)).length > 1;
}

export interface StateComparisonRow {
  domainId: string;
  name: string;
  /** Score per state, keyed by org unit id. Null where not publishable. */
  scores: Record<string, number | null>;
  /** Difference between the highest and lowest state on this domain. */
  spread: number | null;
  /** The state with the highest score on this domain. */
  leaderId: string | null;
}

export interface StateComparison {
  states: Array<{
    orgUnitId: string;
    name: string;
    score: number | null;
    previousScore: number | null;
    changePoints: number | null;
    status: Scorecard['status'];
    dataConfidence: number;
    confidenceBand: Scorecard['dataConfidence']['band'];
    coverage: number;
  }>;
  domains: StateComparisonRow[];
  periodLabel: string;
  /** Domains where the states diverge most — where the difference is real. */
  widestGaps: StateComparisonRow[];
  /**
   * Domains improving in one state while declining in the other. This is the
   * comparison that actually changes a decision, and it is computed rather
   * than asserted.
   */
  diverging: Array<{ name: string; improvingState: string; decliningState: string }>;
}

/**
 * Builds the cross-state comparison.
 *
 * Only ever called with states the caller has already authorised, so this
 * function does no permission work of its own — the scope decision belongs in
 * one place, not repeated per service.
 */
export async function compareStates(
  states: OrgUnit[],
  periodId: string,
): Promise<StateComparison | null> {
  if (states.length < 2) return null;

  const priorId = previousPeriodId(periodId);
  const cards = await Promise.all(
    states.map(async (state) => ({
      state,
      current: await getScorecard(state.id, periodId),
      previous: await getScorecard(state.id, priorId),
    })),
  );

  const usable = cards.filter((entry) => entry.current !== null);
  if (usable.length < 2) return null;

  const summary = usable.map(({ state, current, previous }) => {
    const score = current!.overallScore;
    const previousScore = previous?.overallScore ?? null;
    return {
      orgUnitId: state.id,
      name: state.name,
      score,
      previousScore,
      changePoints:
        score !== null && previousScore !== null ? round(score - previousScore, 1) : null,
      status: current!.status,
      dataConfidence: current!.dataConfidence.score,
      confidenceBand: current!.dataConfidence.band,
      coverage: current!.coverage,
    };
  });

  // Domains are compared on the union across states, so a domain missing from
  // one state still appears rather than silently dropping out of the table.
  const domainOrder: Array<{ id: string; name: string }> = [];
  for (const { current } of usable) {
    for (const domain of current!.domains) {
      if (!domainOrder.some((entry) => entry.id === domain.domainId)) {
        domainOrder.push({ id: domain.domainId, name: domain.name });
      }
    }
  }

  const domains: StateComparisonRow[] = domainOrder.map(({ id, name }) => {
    const scores: Record<string, number | null> = {};
    for (const { state, current } of usable) {
      scores[state.id] = current!.domains.find((d) => d.domainId === id)?.score ?? null;
    }
    const values = Object.entries(scores).filter(
      (entry): entry is [string, number] => entry[1] !== null,
    );
    const spread =
      values.length > 1
        ? round(Math.max(...values.map((v) => v[1])) - Math.min(...values.map((v) => v[1])), 1)
        : null;
    const leader =
      values.length > 0 ? values.reduce((best, e) => (e[1] > best[1] ? e : best))[0] : null;
    return { domainId: id, name, scores, spread, leaderId: leader };
  });

  const diverging: StateComparison['diverging'] = [];
  for (const { id, name } of domainOrder) {
    const trends = usable.map(({ state, current }) => ({
      state,
      direction: current!.domains.find((d) => d.domainId === id)?.trend.direction,
    }));
    const improving = trends.find((t) => t.direction === 'IMPROVING');
    const declining = trends.find((t) => t.direction === 'DECLINING');
    if (improving && declining) {
      diverging.push({
        name,
        improvingState: improving.state.name,
        decliningState: declining.state.name,
      });
    }
  }

  return {
    states: summary,
    domains,
    periodLabel: usable[0].current!.periodLabel,
    widestGaps: [...domains]
      .filter((row) => row.spread !== null)
      .sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))
      .slice(0, 3),
    diverging,
  };
}
