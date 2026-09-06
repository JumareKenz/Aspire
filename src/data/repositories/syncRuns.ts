import { randomUUID } from 'node:crypto';
import { execute, query, queryOne } from '../db/client';
import type { DataMode } from '@/core/model/types';

export interface SyncRun {
  id: string;
  source: DataMode;
  startedAt: string;
  finishedAt: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  orgUnits: number;
  observations: number;
  findings: number;
  message: string | null;
}

interface Row {
  id: string;
  source: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  status: string;
  org_units: number;
  observations: number;
  findings: number;
  message: string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function toRun(row: Row): SyncRun {
  return {
    id: row.id,
    source: row.source as DataMode,
    startedAt: iso(row.started_at) ?? '',
    finishedAt: iso(row.finished_at),
    status: row.status as SyncRun['status'],
    orgUnits: row.org_units,
    observations: row.observations,
    findings: row.findings,
    message: row.message,
  };
}

export async function startSyncRun(source: DataMode): Promise<string> {
  const id = randomUUID();
  await execute('INSERT INTO sync_runs (id, source, started_at, status) VALUES ($1, $2, NOW(), $3)', [
    id,
    source,
    'RUNNING',
  ]);
  return id;
}

export async function finishSyncRun(
  id: string,
  result: {
    status: 'SUCCESS' | 'FAILED';
    orgUnits?: number;
    observations?: number;
    findings?: number;
    message?: string;
  },
): Promise<void> {
  await execute(
    `UPDATE sync_runs SET finished_at = NOW(), status = $1, org_units = $2, observations = $3,
       findings = $4, message = $5 WHERE id = $6`,
    [
      result.status,
      result.orgUnits ?? 0,
      result.observations ?? 0,
      result.findings ?? 0,
      result.message ?? null,
      id,
    ],
  );
}

export async function listSyncRuns(limit = 20): Promise<SyncRun[]> {
  const rows = await query<Row>('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT $1', [
    Math.min(100, Math.max(1, limit)),
  ]);
  return rows.map(toRun);
}

export async function lastSuccessfulSync(): Promise<SyncRun | null> {
  const row = await queryOne<Row>(
    "SELECT * FROM sync_runs WHERE status = 'SUCCESS' ORDER BY finished_at DESC LIMIT 1",
  );
  return row ? toRun(row) : null;
}
