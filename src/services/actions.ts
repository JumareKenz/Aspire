import { listActions, type ActionItem } from '@/data/repositories/actions';
import { getOrgUnit } from '@/data/repositories/orgUnits';
import { listUsers } from '@/data/repositories/users';
import { getScorecard } from './scorecards';
import { round } from '@/core/analytics/stats';
import { latestCompletePeriodId } from '@/data/sync/periods';

export interface ActionView extends ActionItem {
  orgUnitName: string | null;
  assigneeName: string | null;
  createdByName: string | null;
  /**
   * Movement in the org unit's overall score since the action was raised.
   * This is what closes the loop: an action is not "done" until the measure it
   * was raised against has been looked at again.
   */
  scoreSinceRaised: { baseline: number; current: number; change: number } | null;
}

export function getActionViews(scopeIds: string[]): ActionView[] {
  const users = new Map(listUsers().map((user) => [user.id, user.name]));
  const currentPeriod = latestCompletePeriodId();

  return listActions({ orgUnitIds: scopeIds }).map((action) => {
    let scoreSinceRaised: ActionView['scoreSinceRaised'] = null;
    if (action.orgUnitId && action.baselineScore !== null) {
      const current = getScorecard(action.orgUnitId, currentPeriod)?.overallScore ?? null;
      if (current !== null) {
        scoreSinceRaised = {
          baseline: action.baselineScore,
          current,
          change: round(current - action.baselineScore, 1),
        };
      }
    }
    return {
      ...action,
      orgUnitName: action.orgUnitId ? (getOrgUnit(action.orgUnitId)?.name ?? null) : null,
      assigneeName: action.assigneeId ? (users.get(action.assigneeId) ?? null) : null,
      createdByName: users.get(action.createdBy) ?? null,
      scoreSinceRaised,
    };
  });
}
