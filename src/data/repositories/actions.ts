import { randomUUID } from 'node:crypto';
import { execute, query, queryOne } from '../db/client';
import type { Severity } from '@/core/quality/types';

/**
 * A deliberately small follow-up layer: insight → investigate → act → resolve →
 * measure. It is not a project-management system, and does not try to be one.
 */
export const ACTION_STATUSES = ['OPEN', 'INVESTIGATING', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface ActionItem {
  id: string;
  title: string;
  detail: string;
  orgUnitId: string | null;
  indicatorId: string | null;
  periodId: string | null;
  /** What produced this action: an insight, a recommendation, or a person. */
  source: 'INSIGHT' | 'RECOMMENDATION' | 'FINDING' | 'MANUAL';
  sourceRef: string | null;
  priority: Severity;
  status: ActionStatus;
  assigneeId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  dueDate: string | null;
  outcome: string | null;
  /** The org unit's score when the action was raised, for outcome measurement. */
  baselineScore: number | null;
}

interface Row {
  id: string;
  title: string;
  detail: string;
  org_unit_id: string | null;
  indicator_id: string | null;
  period_id: string | null;
  source: string;
  source_ref: string | null;
  priority: string;
  status: string;
  assignee_id: string | null;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
  due_date: Date | string | null;
  outcome: string | null;
  baseline_score: number | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function toAction(row: Row): ActionItem {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    orgUnitId: row.org_unit_id,
    indicatorId: row.indicator_id,
    periodId: row.period_id,
    source: row.source as ActionItem['source'],
    sourceRef: row.source_ref,
    priority: row.priority as Severity,
    status: row.status as ActionStatus,
    assigneeId: row.assignee_id,
    createdBy: row.created_by,
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
    dueDate: row.due_date === null ? null : (iso(row.due_date) ?? '').slice(0, 10) || null,
    outcome: row.outcome,
    baselineScore: row.baseline_score,
  };
}

export type CreateActionInput = Omit<
  ActionItem,
  'id' | 'createdAt' | 'updatedAt' | 'outcome' | 'status'
> &
  Partial<Pick<ActionItem, 'status'>>;

export async function createAction(input: CreateActionInput): Promise<ActionItem> {
  const id = randomUUID();
  await execute(
    `INSERT INTO actions (id, title, detail, org_unit_id, indicator_id, period_id, source, source_ref,
                          priority, status, assignee_id, created_by, created_at, updated_at, due_date,
                          outcome, baseline_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW(),$13,NULL,$14)`,
    [
      id,
      input.title,
      input.detail,
      input.orgUnitId,
      input.indicatorId,
      input.periodId,
      input.source,
      input.sourceRef,
      input.priority,
      input.status ?? 'OPEN',
      input.assigneeId,
      input.createdBy,
      input.dueDate,
      input.baselineScore,
    ],
  );
  const created = await getAction(id);
  if (!created) throw new Error('Action creation failed');
  return created;
}

export async function getAction(id: string): Promise<ActionItem | null> {
  const row = await queryOne<Row>('SELECT * FROM actions WHERE id = $1', [id]);
  return row ? toAction(row) : null;
}

export async function listActions(
  filter: { orgUnitIds?: string[]; status?: ActionStatus } = {},
): Promise<ActionItem[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.orgUnitIds && filter.orgUnitIds.length > 0) {
    params.push(filter.orgUnitIds);
    clauses.push(`(org_unit_id IS NULL OR org_unit_id = ANY($${params.length}))`);
  }
  if (filter.status) {
    params.push(filter.status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query<Row>(
    `SELECT * FROM actions ${where}
     ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'INVESTIGATING' THEN 1 WHEN 'IN_PROGRESS' THEN 2
                          WHEN 'RESOLVED' THEN 3 ELSE 4 END,
              CASE priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END,
              created_at DESC`,
    params,
  );
  return rows.map(toAction);
}

export async function updateAction(
  id: string,
  changes: Partial<Pick<ActionItem, 'status' | 'assigneeId' | 'outcome' | 'dueDate' | 'priority'>>,
): Promise<ActionItem | null> {
  const existing = await getAction(id);
  if (!existing) return null;
  const merged = { ...existing, ...changes };
  await execute(
    `UPDATE actions SET status = $1, assignee_id = $2, outcome = $3, due_date = $4,
       priority = $5, updated_at = NOW() WHERE id = $6`,
    [merged.status, merged.assigneeId, merged.outcome, merged.dueDate, merged.priority, id],
  );
  return getAction(id);
}
