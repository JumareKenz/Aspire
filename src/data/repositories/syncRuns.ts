import { randomUUID } from 'node:crypto';
import { getDb } from '../db/client';
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
  started_at: string;
  finished_at: string | null;
  status: string;
  org_units: number;
  observations: number;
  findings: number;
  message: string | null;
}

function toRun(row: Row): SyncRun {
  return {
    id: row.id,
    source: row.source as DataMode,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status as SyncRun['status'],
    orgUnits: row.org_units,
    observations: row.observations,
    findings: row.findings,
    message: row.message,
  };
}

export function startSyncRun(source: DataMode): string {
  const id = randomUUID();
  getDb()
    .prepare('INSERT INTO sync_runs (id, source, started_at, status) VALUES (?, ?, ?, ?)')
    .run(id, source, new Date().toISOString(), 'RUNNING');
  return id;
}

export function finishSyncRun(
  id: string,
  result: { status: 'SUCCESS' | 'FAILED'; orgUnits?: number; observations?: number; findings?: number; message?: string },
): void {
  getDb()
    .prepare(
      `UPDATE sync_runs SET finished_at = ?, status = ?, org_units = ?, observations = ?, findings = ?, message = ?
       WHERE id = ?`,
    )
    .run(
      new Date().toISOString(),
      result.status,
      result.orgUnits ?? 0,
      result.observations ?? 0,
      result.findings ?? 0,
      result.message ?? null,
      id,
    );
}

export function listSyncRuns(limit = 20): SyncRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?')
    .all(Math.min(100, Math.max(1, limit))) as Row[];
  return rows.map(toRun);
}

export function lastSuccessfulSync(): SyncRun | null {
  const row = getDb()
    .prepare("SELECT * FROM sync_runs WHERE status = 'SUCCESS' ORDER BY finished_at DESC LIMIT 1")
    .get() as Row | undefined;
  return row ? toRun(row) : null;
}
