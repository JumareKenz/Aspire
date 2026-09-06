import { randomUUID } from 'node:crypto';
import { execute, query } from '../db/client';

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

export interface AuditInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}

/**
 * Records an administratively significant event. Called for sign-in, sign-out,
 * configuration changes, synchronisation and every AI question, so that the
 * platform can account for what it was asked and what it changed.
 *
 * Auditing must never break the operation it is recording, so a write failure
 * is logged and swallowed rather than propagated.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await execute(
      `INSERT INTO audit_log (id, at, actor_id, actor_email, action, target, detail, ip)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.actorId ?? null,
        input.actorEmail ?? null,
        input.action,
        input.target ?? null,
        input.detail ?? null,
        input.ip ?? null,
      ],
    );
  } catch (error) {
    console.error('[audit] failed to record event', input.action, error);
  }
}

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const rows = await query<{
    id: string;
    at: Date | string;
    actor_id: string | null;
    actor_email: string | null;
    action: string;
    target: string | null;
    detail: string | null;
    ip: string | null;
  }>('SELECT * FROM audit_log ORDER BY at DESC LIMIT $1', [Math.min(500, Math.max(1, limit))]);

  return rows.map((row) => ({
    id: row.id,
    at: typeof row.at === 'string' ? row.at : row.at.toISOString(),
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    action: row.action,
    target: row.target,
    detail: row.detail,
    ip: row.ip,
  }));
}
