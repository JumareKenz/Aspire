import { chunk, execute, query, transaction, valuesClause } from '../db/client';
import type {
  EvidenceItem,
  FindingStatus,
  QualityFinding,
  QualityDimension,
  Severity,
} from '@/core/quality/types';

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
  evidence: EvidenceItem[];
  status: string;
  detected_at: Date | string;
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
    evidence: row.evidence,
    status: row.status as FindingStatus,
    detectedAt:
      typeof row.detected_at === 'string' ? row.detected_at : row.detected_at.toISOString(),
  };
}

/**
 * Replaces findings for a scan, preserving any triage status a user has already
 * applied so that acknowledging a finding is not undone by the next sync.
 *
 * Runs in a transaction: a failed scan must not leave the table empty.
 */
export async function replaceFindings(findings: QualityFinding[]): Promise<void> {
  const existing = await query<{ id: string; status: string }>(
    'SELECT id, status FROM quality_findings',
  );
  const previousStatus = new Map(existing.map((row) => [row.id, row.status as FindingStatus]));

  await transaction(async (client) => {
    await client.query('DELETE FROM quality_findings');
    for (const batch of chunk(findings, 13)) {
      const { text, params } = valuesClause(
        batch.map((finding) => {
          const carried = previousStatus.get(finding.id);
          return [
            finding.id,
            finding.dimension,
            finding.severity,
            finding.orgUnitId,
            finding.orgUnitName,
            finding.indicatorId,
            finding.indicatorName,
            finding.periodId,
            finding.title,
            finding.reason,
            JSON.stringify(finding.evidence),
            carried && carried !== 'OPEN' ? carried : finding.status,
            finding.detectedAt,
          ];
        }),
      );
      await client.query(
        `INSERT INTO quality_findings
           (id, dimension, severity, org_unit_id, org_unit_name, indicator_id, indicator_name,
            period_id, title, reason, evidence, status, detected_at)
         VALUES ${text}`,
        params,
      );
    }
  });
}

export interface FindingQuery {
  orgUnitIds?: string[];
  periodIds?: string[];
  dimensions?: QualityDimension[];
  severities?: Severity[];
  status?: FindingStatus;
  limit?: number;
}

export async function listFindings(query_: FindingQuery = {}): Promise<QualityFinding[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const anyOf = (column: string, values?: string[]) => {
    if (!values || values.length === 0) return;
    params.push(values);
    clauses.push(`${column} = ANY($${params.length})`);
  };
  anyOf('org_unit_id', query_.orgUnitIds);
  anyOf('period_id', query_.periodIds);
  anyOf('dimension', query_.dimensions);
  anyOf('severity', query_.severities);
  if (query_.status) {
    params.push(query_.status);
    clauses.push(`status = $${params.length}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  let limit = '';
  if (query_.limit) {
    params.push(Math.max(1, Math.floor(query_.limit)));
    limit = `LIMIT $${params.length}`;
  }

  const rows = await query<Row>(
    `SELECT * FROM quality_findings ${where}
     ORDER BY CASE severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, detected_at DESC ${limit}`,
    params,
  );
  return rows.map(toFinding);
}

export async function setFindingStatus(id: string, status: FindingStatus): Promise<boolean> {
  const changed = await execute('UPDATE quality_findings SET status = $1 WHERE id = $2', [status, id]);
  return changed > 0;
}
