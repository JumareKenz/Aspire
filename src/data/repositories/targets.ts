import { execute, query } from '../db/client';
import type { Period } from '@/core/model/types';
import type { TargetRow } from '@/core/targets/resolve';

/**
 * Target rows. The `targets` table stores "every area" and "every period" as
 * empty strings so they can sit in the primary key; this module is the only
 * place that knows it, and hands the rest of the platform nulls.
 */
interface Row {
  indicator_id: string;
  org_unit_id: string;
  period_id: string;
  value: number;
}

function toTarget(row: Row): TargetRow {
  return {
    indicatorId: row.indicator_id,
    orgUnitId: row.org_unit_id === '' ? null : row.org_unit_id,
    periodId: row.period_id === '' ? null : row.period_id,
    value: Number(row.value),
  };
}

/**
 * Every row that could apply to any of `orgUnitIds` in `period`: programme
 * defaults, rows for those areas, and rows for the period, its type or any
 * period. `resolveTarget` chooses between them.
 */
export async function getTargetRows(orgUnitIds: string[], period: Pick<Period, 'id' | 'type'>): Promise<TargetRow[]> {
  const rows = await query<Row>(
    `SELECT indicator_id, org_unit_id, period_id, value FROM targets
     WHERE (org_unit_id = '' OR org_unit_id = ANY($1))
       AND period_id IN ('', $2, $3)`,
    [orgUnitIds, period.id, period.type],
  );
  return rows.map(toTarget);
}

/** Every target row for one indicator, for the target editor. */
export async function listTargets(indicatorId: string): Promise<TargetRow[]> {
  const rows = await query<Row>(
    `SELECT indicator_id, org_unit_id, period_id, value FROM targets
     WHERE indicator_id = $1 ORDER BY org_unit_id, period_id`,
    [indicatorId],
  );
  return rows.map(toTarget);
}

/** Creates or replaces the one row for this indicator, area and period. Returns the value it replaced. */
export async function setTarget(target: TargetRow): Promise<number | null> {
  const previous = await query<{ value: number }>(
    'SELECT value FROM targets WHERE indicator_id = $1 AND org_unit_id = $2 AND period_id = $3',
    [target.indicatorId, target.orgUnitId ?? '', target.periodId ?? ''],
  );
  await execute(
    `INSERT INTO targets (indicator_id, org_unit_id, period_id, value) VALUES ($1, $2, $3, $4)
     ON CONFLICT (indicator_id, org_unit_id, period_id) DO UPDATE SET value = EXCLUDED.value`,
    [target.indicatorId, target.orgUnitId ?? '', target.periodId ?? '', target.value],
  );
  return previous[0] ? Number(previous[0].value) : null;
}

export async function deleteTarget(key: Omit<TargetRow, 'value'>): Promise<boolean> {
  const removed = await execute(
    'DELETE FROM targets WHERE indicator_id = $1 AND org_unit_id = $2 AND period_id = $3',
    [key.indicatorId, key.orgUnitId ?? '', key.periodId ?? ''],
  );
  return removed > 0;
}
