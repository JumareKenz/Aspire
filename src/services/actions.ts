import { listActions, type ActionItem } from '@/data/repositories/actions';
import { getOrgUnit } from '@/data/repositories/orgUnits';
import { listUsers } from '@/data/repositories/users';
import { getScorecard } from './scorecards';
import { round } from '@/core/analytics/stats';
import { defaultPeriodId } from '@/services/scorecards';

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

export async function getActionViews(scopeIds: string[]): Promise<ActionView[]> {
  const [userList, actions] = await Promise.all([listUsers(), listActions({ orgUnitIds: scopeIds })]);
  const users = new Map(userList.map((user) => [user.id, user.name]));
  const currentPeriod = await defaultPeriodId();

  return Promise.all(actions.map(async (action) => {
    let scoreSinceRaised: ActionView['scoreSinceRaised'] = null;
    if (action.orgUnitId && action.baselineScore !== null) {
      const current = (await getScorecard(action.orgUnitId, currentPeriod))?.overallScore ?? null;
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
      orgUnitName: action.orgUnitId ? ((await getOrgUnit(action.orgUnitId))?.name ?? null) : null,
      assigneeName: action.assigneeId ? (users.get(action.assigneeId) ?? null) : null,
      createdByName: users.get(action.createdBy) ?? null,
      scoreSinceRaised,
    };
  }));
}
