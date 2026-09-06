import { getDb } from '../db/client';
import type { EvidenceItem, FindingStatus, QualityFinding, QualityDimension, Severity } from '@/core/quality/types';

interface Row {
  id: string;
  dimension: string;
  severity: string;
  org_unit_id: string;
  org_unit_name: string;
  indicator_id: string | null;
  indicator_name: string | null;
  period_id: string;
  title: string;
  reason: string;
  evidence: string;
  status: string;
  detected_at: string;
}

function toFinding(row: Row): QualityFinding {
  return {
    id: row.id,
    dimension: row.dimension as QualityDimension,
    severity: row.severity as Severity,
    orgUnitId: row.org_unit_id,
    orgUnitName: row.org_unit_name,
    indicatorId: row.indicator_id,
    indicatorName: row.indicator_name,
    periodId: row.period_id,
    title: row.title,
    reason: row.reason,
    evidence: JSON.parse(row.evidence) as EvidenceItem[],
    status: row.status as FindingStatus,
    detectedAt: row.detected_at,
  };
}

/**
 * Replaces findings for a scan, preserving any triage status a user has already
 * applied so that acknowledging a finding is not undone by the next sync.
 */
export function replaceFindings(findings: QualityFinding[]): void {
  const db = getDb();
  const existing = db.prepare('SELECT id, status FROM quality_findings').all() as Array<{
    id: string;
    status: string;
  }>;
  const previousStatus = new Map(existing.map((row) => [row.id, row.status as FindingStatus]));

  const insert = db.prepare(
    `INSERT INTO quality_findings
       (id, dimension, severity, org_unit_id, org_unit_name, indicator_id, indicator_name,
        period_id, title, reason, evidence, status, detected_at)
     VALUES (@id, @dimension, @severity, @org_unit_id, @org_unit_name, @indicator_id, @indicator_name,
             @period_id, @title, @reason, @evidence, @status, @detected_at)`,
  );

  db.transaction(() => {
    db.prepare('DELETE FROM quality_findings').run();
    for (const finding of findings) {
      const carried = previousStatus.get(finding.id);
      insert.run({
        id: finding.id,
        dimension: finding.dimension,
        severity: finding.severity,
        org_unit_id: finding.orgUnitId,
        org_unit_name: finding.orgUnitName,
        indicator_id: finding.indicatorId,
        indicator_name: finding.indicatorName,
        period_id: finding.periodId,
        title: finding.title,
        reason: finding.reason,
        evidence: JSON.stringify(finding.evidence),
        status: carried && carried !== 'OPEN' ? carried : finding.status,
        detected_at: finding.detectedAt,
      });
    }
  })();
}

export interface FindingQuery {
  orgUnitIds?: string[];
  periodIds?: string[];
  dimensions?: QualityDimension[];
  severities?: Severity[];
  status?: FindingStatus;
  limit?: number;
}

export function listFindings(query: FindingQuery = {}): QualityFinding[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const inClause = (column: string, values?: string[]) => {
    if (!values || values.length === 0) return;
    clauses.push(`${column} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };
  inClause('org_unit_id', query.orgUnitIds);
  inClause('period_id', query.periodIds);
  inClause('dimension', query.dimensions);
  inClause('severity', query.severities);
  if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = query.limit ? `LIMIT ${Math.max(1, Math.floor(query.limit))}` : '';
  const rows = getDb()
    .prepare(
      `SELECT * FROM quality_findings ${where}
       ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, detected_at DESC ${limit}`,
    )
    .all(...params) as Row[];
  return rows.map(toFinding);
}

export function setFindingStatus(id: string, status: FindingStatus): boolean {
  const result = getDb().prepare('UPDATE quality_findings SET status = ? WHERE id = ?').run(status, id);
  return result.changes > 0;
}
